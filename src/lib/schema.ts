/**
 * ScaleBridge database schema + Row Level Security policies.
 *
 * See README.md in this directory for the RLS pattern used by every data
 * access path. TL;DR: server functions run each request's queries inside a
 * single Postgres transaction and begin it with
 *   select set_config('app.user_id', <uuid>, true), set_config('app.role', <role>, true)
 * so `current_setting('app.user_id')`/`current_setting('app.role')` are
 * transaction-local and never leak across pooled connections. RLS policies on
 * the business tables then allow/deny rows based on those settings.
 *
 * `ensureSchema()` in ./db.ts runs every statement in SCHEMA_SQL once per
 * server process (idempotent: IF NOT EXISTS / DROP POLICY IF EXISTS).
 *
 * Note: policy expressions (and their subqueries) are evaluated with the
 * privileges of the table owner, so RLS is NOT applied recursively inside a
 * policy — the predicate itself is what scopes the rows (e.g. the invitations
 * subquery in the workspace select policy filters by the caller's email).
 */

export const ROLES_CHECK = "('sb_admin','lead_contractor','company_user','buyer','project_user','guest')";

// ------------------------------------------------------------------
// Portal-phase policy helpers. These are SQL *string fragments* used to build
// the portal policy statements below with the exact same
// current_setting('app.user_id') / current_setting('app.role') expressions the
// workspace policies above use, so the portal tables test identity and role
// identically. The fragments only ever subquery tables whose own policies are
// self-contained (client_org_members, contract_clients, support_cases,
// invitations, companies) or the RLS-free users table — never a table whose
// policy could point back, so the policy graph stays acyclic.
const UID = "nullif(current_setting('app.user_id', true), '')::uuid";
const ROLE = "nullif(current_setting('app.role', true), '')";
const IS_ADMIN = `${ROLE} = 'sb_admin'`;
/**
 * Any client-portal role. Client server functions scope every request with the
 * acting user's CLIENT role (client_admin / client_pm / client_finance /
 * client_reviewer / client_read_only) in app.role — the server derives it from
 * the user's client_org_members row before calling asUser(), mirroring how
 * sb_admin is asserted from admin_roles. Policies below use IS_CLIENT /
 * ROLE='client_admin' as the RLS gate for client-visible data and
 * client-admin-only mutations (an org-scoped roster check would be a
 * self-referential subquery on client_org_members, which RLS rejects as
 * infinite recursion; the server always re-verifies membership + role).
 */
const IS_CLIENT = `${ROLE} in ('client_admin','client_pm','client_finance','client_reviewer','client_read_only')`;

/** Caller is a member of <t>.client_org_id (optionally limited to roles). */
const clientMember = (t: string, roles?: string) =>
  `exists (select 1 from client_org_members m where m.org_id = ${t}.client_org_id and m.user_id = ${UID}${roles ? ` and m.role in (${roles})` : ""})`;

/** Caller was invited into (or is a participant of) <t>'s workspace. */
const participantIn = (t: string) =>
  `exists (select 1 from invitations i where i.workspace_id = ${t}.workspace_id and i.status in ('invited','joined','verified') and lower(i.email) = (select lower(u.email) from users u where u.id = ${UID}))`;

/** <t>'s client_org_id is actually linked to <t>'s workspace (contract_clients). */
const clientLinked = (t: string) =>
  `exists (select 1 from contract_clients cc where cc.contract_workspaces_id = ${t}.workspace_id and cc.client_org_id = ${t}.client_org_id)`;

export const SCHEMA_SQL: string[] = [
  // ------------------------------------------------------------------
  // Tables
  // ------------------------------------------------------------------
  `create table if not exists users (
    id uuid primary key default gen_random_uuid(),
    email text not null unique,
    password_hash text not null,
    created_at timestamptz not null default now()
  )`,
  // Admin Portal additions (idempotent): account lifecycle status + internal
  // notes. status follows the spec's user statuses: active, suspended,
  // deactivated, invited, pending_verification.
  `alter table users add column if not exists status text not null default 'active'`,
  `alter table users drop constraint if exists users_status_check`,
  `alter table users add constraint users_status_check check (
    status in ('active','suspended','deactivated','invited','pending_verification')
  )`,
  `alter table users add column if not exists internal_notes text[] not null default '{}'::text[]`,

  // companies is created before profiles because profiles.company_id fks to it.
  // owner_id is unique: for the MVP each user manages exactly one company
  // profile record (later phases can relax this for multi-member companies).
  `create table if not exists companies (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null unique references users(id) on delete cascade,
    name text not null,
    type text,
    description text,
    contact_email text,
    verification_status text not null default 'unverified'
      check (verification_status in ('unverified','pending','verified')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  // Admin Portal additions (idempotent). The verification_status check is
  // widened to the full spec lifecycle (draft → registered →
  // documents_pending → under_review → verified, plus rejected / suspended /
  // archived) while keeping the legacy values ('unverified','pending') valid
  // for the existing self-serve company flow. Drop + re-add is idempotent.
  `alter table companies add column if not exists internal_notes text[] not null default '{}'::text[]`,
  `alter table companies drop constraint if exists companies_verification_status_check`,
  `alter table companies add constraint companies_verification_status_check check (
    verification_status in ('unverified','pending','verified','draft','registered','documents_pending','under_review','rejected','suspended','archived')
  )`,

  `create table if not exists profiles (
    user_id uuid primary key references users(id) on delete cascade,
    role text not null default 'lead_contractor' check (role in ${ROLES_CHECK}),
    name text,
    company_id uuid references companies(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,

  `create table if not exists contract_workspaces (
    id uuid primary key default gen_random_uuid(),
    lead_contractor_id uuid not null references users(id) on delete cascade,
    title text not null,
    description text,
    status text not null default 'draft'
      check (status in ('draft','active','in_review','completed','archived')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,

  // A contract workspace invitation. `role` is the SYSTEM role the invited
  // account will act under (default company_user); `participant_role` is the
  // COMMERCIAL role the invited company will play inside this workspace
  // (primary_contractor | subcontractor | supplier | consultant).
  `create table if not exists invitations (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references contract_workspaces(id) on delete cascade,
    -- Denormalized owner of the workspace this invitation belongs to. Set by
    -- the server on insert/re-invite (always the workspace lead). Exists so
    -- EVERY invitations policy can grant the lead access WITHOUT subquerying
    -- contract_workspaces — with FORCE RLS on every tenant table, a policy
    -- subquery against another FORCE'd table re-applies that table's policies,
    -- and contract_workspaces_select <-> invitations_select formed a rewrite
    -- cycle ("infinite recursion detected in policy"). All invitations
    -- policies therefore reference only invitations columns + the non-RLS
    -- users table; the server keeps lead_contractor_id in sync with the
    -- workspace's lead on every insert/re-invite (doInviteCompany/doSeedDemo).
    lead_contractor_id uuid references users(id) on delete cascade,
    company_id uuid references companies(id) on delete set null,
    company_name text,
    email text,
    role text not null default 'company_user' check (role in ${ROLES_CHECK}),
    participant_role text not null default 'subcontractor'
      check (participant_role in ('primary_contractor','subcontractor','supplier','consultant')),
    work_package text,
    status text not null default 'invited'
      check (status in ('invited','joined','verified','declined')),
    created_by uuid references users(id) on delete set null,
    joined_at timestamptz,
    verified_at timestamptz,
    responded_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  // Add lead_contractor_id to installations that predate it (idempotent).
  // A one-time backfill from contract_workspaces is only needed if legacy rows
  // exist; fresh databases have none (the server always sets it on insert).
  `alter table invitations add column if not exists lead_contractor_id uuid references users(id) on delete cascade`,

  `create table if not exists work_packages (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references contract_workspaces(id) on delete cascade,
    name text not null,
    description text,
    scope_notes text,
    category text,
    status text not null default 'defined'
      check (status in ('defined','in_progress','completed','on_hold')),
    created_by uuid references users(id) on delete set null,
    updated_by uuid references users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  // Client Portal additions (idempotent): work-package visibility for the
  // buying org + the responsible company. client_visible=true packages are
  // shown to members of the linked client org; company_id is the participating
  // company responsible for the package (names only — never pricing/margins).
  `alter table work_packages add column if not exists client_visible boolean not null default true`,
  `alter table work_packages add column if not exists company_id uuid references companies(id) on delete set null`,
  // Client Portal addition (idempotent): contract term dates for the client
  // contract overview / dashboard end-date list.
  `alter table contract_workspaces add column if not exists start_date date`,
  `alter table contract_workspaces add column if not exists end_date date`,

  // Per-user notification inbox. Rows are written by server functions on
  // invitation/accept/decline/verify events (the insert policy allows the
  // lead to notify people they invited, and invitees to notify the lead in
  // response). Full notifications UI ships in a later phase.
  `create table if not exists notifications (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id) on delete cascade,
    workspace_id uuid references contract_workspaces(id) on delete set null,
    type text not null,
    title text not null,
    body text,
    link text,
    read_at timestamptz,
    created_at timestamptz not null default now()
  )`,

  `create table if not exists sessions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id) on delete cascade,
    token_hash text not null unique,
    expires_at timestamptz not null,
    created_at timestamptz not null default now(),
    last_used_at timestamptz not null default now()
  )`,

  `create table if not exists audit_logs (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid references contract_workspaces(id) on delete set null,
    actor_id uuid references users(id) on delete set null,
    action text not null,
    details jsonb,
    created_at timestamptz not null default now()
  )`,

  // ------------------------------------------------------------------
  // Portal tables (Admin + Client portals). Every workspace-scoped row
  // denormalizes lead_contractor_id (workspace owner) and client_org_id (the
  // linked buying org) so RLS policies never need to subquery
  // contract_workspaces or contract_clients (see the invitations
  // lead_contractor_id comment above). The server sets both columns from the
  // workspace + its client link on insert.
  // ------------------------------------------------------------------

  // A ScaleBridge staff member can hold several admin roles (one row each).
  // app.role='sb_admin' (profiles.role) remains the RLS gate; this table is
  // the finer-grained staff role for the Admin Portal UI.
  `create table if not exists admin_roles (
    user_id uuid not null references users(id) on delete cascade,
    role text not null
      check (role in ('super_admin','operations','compliance','finance','support','read_only')),
    created_at timestamptz not null default now(),
    primary key (user_id, role)
  )`,

  // A buying organisation on the platform. Linked to contract workspaces via
  // contract_clients; the people who act for the org are client_org_members.
  `create table if not exists client_organizations (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    registration_number text,
    registration_country text,
    tax_id text,
    address text,
    contact_email text,
    contact_phone text,
    status text not null default 'draft'
      check (status in ('draft','registered','under_review','verified','suspended','archived')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,

  `create table if not exists client_org_members (
    org_id uuid not null references client_organizations(id) on delete cascade,
    user_id uuid not null references users(id) on delete cascade,
    role text not null
      check (role in ('client_admin','client_pm','client_finance','client_reviewer','client_read_only')),
    created_at timestamptz not null default now(),
    primary key (org_id, user_id)
  )`,
  // Client Portal addition (idempotent): client-org scoping on the audit trail
  // so client members see activity for their org's contracts (server sets it on
  // client-scoped audit rows; workspace-scoped rows keep workspace_id). Placed
  // after client_organizations so the FK can be created.
  `alter table audit_logs add column if not exists client_org_id uuid references client_organizations(id) on delete set null`,

  // Links a contract workspace to the buying organisation. lead_contractor_id
  // is denormalized (same rationale as invitations.lead_contractor_id) so the
  // workspace lead can manage the link without subquerying contract_workspaces.
  `create table if not exists contract_clients (
    contract_workspaces_id uuid not null references contract_workspaces(id) on delete cascade,
    client_org_id uuid not null references client_organizations(id) on delete cascade,
    lead_contractor_id uuid references users(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (contract_workspaces_id, client_org_id)
  )`,

  // Support / dispute case. internal_notes are admin-only; case_messages carry
  // the participant-facing communication history (internal=true rows are
  // admin-only notes).
  `create table if not exists support_cases (
    id uuid primary key default gen_random_uuid(),
    case_number text not null unique,
    reporter_user_id uuid not null references users(id) on delete cascade,
    company_id uuid references companies(id) on delete set null,
    workspace_id uuid references contract_workspaces(id) on delete set null,
    category text not null,
    description text,
    attachments jsonb not null default '[]'::jsonb,
    priority text not null default 'medium'
      check (priority in ('low','medium','high','urgent')),
    assignee_user_id uuid references users(id) on delete set null,
    status text not null default 'new'
      check (status in ('new','under_review','waiting_info','escalated','resolved','closed')),
    internal_notes jsonb not null default '[]'::jsonb,
    resolution text,
    closed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,

  `create table if not exists case_messages (
    id uuid primary key default gen_random_uuid(),
    case_id uuid not null references support_cases(id) on delete cascade,
    author_user_id uuid not null references users(id) on delete cascade,
    body text not null,
    internal boolean not null default false,
    created_at timestamptz not null default now()
  )`,

  // Delivery tracking shared by both portals. lead_contractor_id / client_org_id
  // are denormalized so policies grant lead/client access without subquerying
  // contract_workspaces or contract_clients; the server sets them from the
  // workspace + its client link on insert.
  `create table if not exists milestones (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references contract_workspaces(id) on delete cascade,
    work_package_id uuid references work_packages(id) on delete set null,
    lead_contractor_id uuid references users(id) on delete cascade,
    client_org_id uuid references client_organizations(id) on delete set null,
    name text not null,
    description text,
    responsible_company_id uuid references companies(id) on delete set null,
    due_date date,
    completed_at timestamptz,
    status text not null default 'upcoming'
      check (status in ('upcoming','in_progress','submitted_for_review','approved','rejected','requires_clarification','delayed','completed')),
    approval_history jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,

  `create table if not exists issues (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references contract_workspaces(id) on delete cascade,
    work_package_id uuid references work_packages(id) on delete set null,
    lead_contractor_id uuid references users(id) on delete cascade,
    client_org_id uuid references client_organizations(id) on delete set null,
    title text not null,
    description text,
    category text,
    severity text check (severity in ('low','medium','high','critical')),
    responsible_party text,
    status text not null default 'open'
      check (status in ('open','under_review','action_required','waiting_client','waiting_contractor','resolved','closed')),
    proposed_resolution text,
    documents jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,

  `create table if not exists variations (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references contract_workspaces(id) on delete cascade,
    lead_contractor_id uuid references users(id) on delete cascade,
    client_org_id uuid references client_organizations(id) on delete set null,
    title text not null,
    reason text,
    description text,
    cost_impact numeric(14,2),
    time_impact text,
    documents jsonb not null default '[]'::jsonb,
    status text not null default 'draft'
      check (status in ('draft','submitted','under_client_review','clarification_requested','approved','rejected','approved_with_conditions','implemented')),
    recommended_decision text,
    submitted_by uuid references users(id) on delete set null,
    submitted_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,

  // company_id is the billing company (e.g. the participant who issued the
  // invoice) — it backs the "own invoices" participant visibility rule.
  `create table if not exists invoices (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references contract_workspaces(id) on delete cascade,
    work_package_id uuid references work_packages(id) on delete set null,
    milestone_id uuid references milestones(id) on delete set null,
    company_id uuid references companies(id) on delete set null,
    lead_contractor_id uuid references users(id) on delete cascade,
    client_org_id uuid references client_organizations(id) on delete set null,
    invoice_number text not null unique,
    title text,
    amount numeric(14,2) not null default 0,
    status text not null default 'draft'
      check (status in ('draft','submitted','under_review','approved','rejected','correction_required','scheduled_for_payment','paid','overdue','cancelled')),
    documents jsonb not null default '[]'::jsonb,
    submitted_by uuid references users(id) on delete set null,
    submitted_at timestamptz,
    payment_recorded_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,

  `create table if not exists progress_reports (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references contract_workspaces(id) on delete cascade,
    lead_contractor_id uuid references users(id) on delete cascade,
    client_org_id uuid references client_organizations(id) on delete set null,
    reporting_period text,
    overall_progress numeric(5,2),
    work_package_progress jsonb not null default '{}'::jsonb,
    completed_activities text,
    upcoming_activities text,
    delays text,
    risks text,
    issues_requiring_client text,
    documents jsonb not null default '[]'::jsonb,
    status text not null default 'submitted'
      check (status in ('submitted','acknowledged','approved','clarification_requested')),
    submitted_by uuid references users(id) on delete set null,
    submitted_at timestamptz,
    created_at timestamptz not null default now()
  )`,

  // visibility: workspace = shared inside the contract workspace; client_visible
  // = additionally shared with the linked client org; company_only = private.
  `create table if not exists documents (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references contract_workspaces(id) on delete cascade,
    lead_contractor_id uuid references users(id) on delete cascade,
    client_org_id uuid references client_organizations(id) on delete set null,
    name text not null,
    category text,
    visibility text not null default 'workspace'
      check (visibility in ('workspace','client_visible','company_only')),
    version int not null default 1,
    file_url text,
    uploaded_by uuid references users(id) on delete set null,
    uploaded_at timestamptz not null default now()
  )`,
  // Admin Portal additions (idempotent): document verification workflow
  // (Part B) + expiry tracking for licences / insurance / certificates.
  `alter table documents add column if not exists review_status text not null default 'pending'`,
  `alter table documents drop constraint if exists documents_review_status_check`,
  `alter table documents add constraint documents_review_status_check check (
    review_status in ('pending','approved','rejected','needs_replacement','clarification_requested')
  )`,
  `alter table documents add column if not exists expiry_date date`,
  // Admin Portal Part B (idempotent): document review workflow metadata —
  // who reviewed a document, when, and what they said. The review decision
  // itself lives in review_status; these columns carry the audit context shown
  // on the document review screen and the company verification screen.
  `alter table documents add column if not exists reviewed_by uuid references users(id) on delete set null`,
  `alter table documents add column if not exists review_comment text`,
  `alter table documents add column if not exists reviewed_at timestamptz`,
  // Set by the "set expiry reminder" verification action; feeds the expiring
  // licences list on the dashboard.
  `alter table documents add column if not exists expiry_reminder_at timestamptz`,

  // Admin Portal Part B contract administration columns (idempotent):
  // industry / location / value power the contract list filters, internal_notes
  // records admin notes on the workspace, internal_support_user_id is the
  // assigned ScaleBridge staff member (from admin_roles).
  `alter table contract_workspaces add column if not exists industry text`,
  `alter table contract_workspaces add column if not exists location text`,
  `alter table contract_workspaces add column if not exists contract_value numeric(14,2)`,
  `alter table contract_workspaces add column if not exists internal_notes text[] not null default '{}'::text[]`,
  `alter table contract_workspaces add column if not exists internal_support_user_id uuid references users(id) on delete set null`,
  // Part B: admins suspend contracts (the spec's status list). Drop + re-add
  // is idempotent and keeps the legacy workspace statuses valid.
  `alter table contract_workspaces drop constraint if exists contract_workspaces_status_check`,
  `alter table contract_workspaces add constraint contract_workspaces_status_check check (
    status in ('draft','active','in_review','suspended','completed','archived')
  )`,

  // ------------------------------------------------------------------
  // Indexes
  // ------------------------------------------------------------------
  `create index if not exists sessions_token_hash_idx on sessions (token_hash)`,
  `create index if not exists sessions_user_id_idx on sessions (user_id)`,
  `create index if not exists profiles_company_id_idx on profiles (company_id)`,
  `create index if not exists contract_workspaces_lead_idx on contract_workspaces (lead_contractor_id)`,
  `create index if not exists contract_workspaces_status_idx on contract_workspaces (status)`,
  `create index if not exists audit_logs_created_at_idx on audit_logs (created_at desc)`,
  `create index if not exists audit_logs_action_idx on audit_logs (action)`,
  `create index if not exists documents_review_status_idx on documents (review_status)`,
  `create index if not exists support_cases_case_number_idx on support_cases (case_number)`,
  `create index if not exists invitations_workspace_id_idx on invitations (workspace_id)`,
  `create index if not exists invitations_company_id_idx on invitations (company_id)`,
  `create index if not exists invitations_email_idx on invitations (lower(email))`,
  `create index if not exists work_packages_workspace_id_idx on work_packages (workspace_id)`,
  `create index if not exists work_packages_client_visible_idx on work_packages (workspace_id, client_visible)`,
  `create index if not exists work_packages_company_id_idx on work_packages (company_id)`,
  `create index if not exists contract_workspaces_term_idx on contract_workspaces (end_date)`,
  `create index if not exists audit_logs_client_org_idx on audit_logs (client_org_id)`,
  `create index if not exists notifications_user_id_idx on notifications (user_id, created_at desc)`,
  `create index if not exists audit_logs_workspace_id_idx on audit_logs (workspace_id)`,
  `create index if not exists audit_logs_actor_id_idx on audit_logs (actor_id)`,
  `create index if not exists admin_roles_user_id_idx on admin_roles (user_id)`,
  `create index if not exists client_organizations_status_idx on client_organizations (status)`,
  `create index if not exists client_org_members_user_id_idx on client_org_members (user_id)`,
  `create index if not exists contract_clients_workspace_idx on contract_clients (contract_workspaces_id)`,
  `create index if not exists contract_clients_client_org_idx on contract_clients (client_org_id)`,
  `create index if not exists contract_clients_lead_idx on contract_clients (lead_contractor_id)`,
  `create index if not exists support_cases_status_idx on support_cases (status)`,
  `create index if not exists support_cases_reporter_idx on support_cases (reporter_user_id)`,
  `create index if not exists support_cases_assignee_idx on support_cases (assignee_user_id)`,
  `create index if not exists support_cases_workspace_idx on support_cases (workspace_id)`,
  `create index if not exists case_messages_case_id_idx on case_messages (case_id)`,
  `create index if not exists milestones_workspace_id_idx on milestones (workspace_id)`,
  `create index if not exists milestones_work_package_id_idx on milestones (work_package_id)`,
  `create index if not exists milestones_lead_idx on milestones (lead_contractor_id)`,
  `create index if not exists milestones_client_org_idx on milestones (client_org_id)`,
  `create index if not exists milestones_status_idx on milestones (status)`,
  `create index if not exists issues_workspace_id_idx on issues (workspace_id)`,
  `create index if not exists issues_status_idx on issues (status)`,
  `create index if not exists issues_lead_idx on issues (lead_contractor_id)`,
  `create index if not exists issues_client_org_idx on issues (client_org_id)`,
  `create index if not exists variations_workspace_id_idx on variations (workspace_id)`,
  `create index if not exists variations_status_idx on variations (status)`,
  `create index if not exists variations_lead_idx on variations (lead_contractor_id)`,
  `create index if not exists variations_client_org_idx on variations (client_org_id)`,
  `create index if not exists invoices_workspace_id_idx on invoices (workspace_id)`,
  `create index if not exists invoices_milestone_id_idx on invoices (milestone_id)`,
  `create index if not exists invoices_status_idx on invoices (status)`,
  `create index if not exists invoices_lead_idx on invoices (lead_contractor_id)`,
  `create index if not exists invoices_client_org_idx on invoices (client_org_id)`,
  `create index if not exists progress_reports_workspace_id_idx on progress_reports (workspace_id)`,
  `create index if not exists progress_reports_lead_idx on progress_reports (lead_contractor_id)`,
  `create index if not exists progress_reports_client_org_idx on progress_reports (client_org_id)`,
  `create index if not exists documents_workspace_id_idx on documents (workspace_id)`,
  `create index if not exists documents_visibility_idx on documents (visibility)`,
  `create index if not exists documents_lead_idx on documents (lead_contractor_id)`,
  `create index if not exists documents_client_org_idx on documents (client_org_id)`,

  // ------------------------------------------------------------------
  // Row Level Security
  //
  // users and sessions deliberately have NO RLS: they are internal auth
  // tables, only ever touched by server code with unguessable parameterized
  // lookups (email + password, or a 256-bit session token hash). Everything a
  // client can reach flows through server functions which scope queries with
  // the app.user_id / app.role transaction settings below.
  // ------------------------------------------------------------------
  `alter table companies enable row level security`,
  `alter table profiles enable row level security`,
  `alter table contract_workspaces enable row level security`,
  `alter table invitations enable row level security`,
  `alter table work_packages enable row level security`,
  `alter table notifications enable row level security`,
  `alter table audit_logs enable row level security`,

  // FORCE is required because the runtime database role owns these tables.
  // Without it, PostgreSQL lets the owner bypass RLS despite ENABLE RLS.
  `alter table companies force row level security`,
  `alter table profiles force row level security`,
  `alter table contract_workspaces force row level security`,
  `alter table work_packages force row level security`,
  `alter table invitations force row level security`,
  `alter table notifications force row level security`,
  `alter table audit_logs force row level security`,
  `alter table admin_roles enable row level security`,
  `alter table client_organizations enable row level security`,
  `alter table client_org_members enable row level security`,
  `alter table contract_clients enable row level security`,
  `alter table support_cases enable row level security`,
  `alter table case_messages enable row level security`,
  `alter table milestones enable row level security`,
  `alter table issues enable row level security`,
  `alter table variations enable row level security`,
  `alter table invoices enable row level security`,
  `alter table progress_reports enable row level security`,
  `alter table documents enable row level security`,
  `alter table admin_roles force row level security`,
  `alter table client_organizations force row level security`,
  `alter table client_org_members force row level security`,
  `alter table contract_clients force row level security`,
  `alter table support_cases force row level security`,
  `alter table case_messages force row level security`,
  `alter table milestones force row level security`,
  `alter table issues force row level security`,
  `alter table variations force row level security`,
  `alter table invoices force row level security`,
  `alter table progress_reports force row level security`,
  `alter table documents force row level security`,

  // --- profiles: users manage their own profile; sb_admin manages all ----
  `drop policy if exists profiles_select on profiles`,
  `create policy profiles_select on profiles for select using (
    user_id = nullif(current_setting('app.user_id', true), '')::uuid
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists profiles_insert on profiles`,
  `create policy profiles_insert on profiles for insert with check (
    user_id = nullif(current_setting('app.user_id', true), '')::uuid
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
    -- Client Portal: a client_admin creating a profile for a team member they
    -- are inviting (role asserted server-side from client_org_members).
    or nullif(current_setting('app.role', true), '') = 'client_admin'
  )`,
  `drop policy if exists profiles_update on profiles`,
  `create policy profiles_update on profiles for update using (
    user_id = nullif(current_setting('app.user_id', true), '')::uuid
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  ) with check (
    user_id = nullif(current_setting('app.user_id', true), '')::uuid
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists profiles_delete on profiles`,
  `create policy profiles_delete on profiles for delete using (
    user_id = nullif(current_setting('app.user_id', true), '')::uuid
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  // Client Portal: members of a client org may see the profile (name) of their
  // own org's members and of the lead contractor of a contract linked to their
  // org (key contacts on the contract overview). Acyclic: profiles →
  // client_org_members (self-only) → contract_clients.
  `drop policy if exists profiles_client_select on profiles`,
  `create policy profiles_client_select on profiles for select using (
    exists (
      select 1 from client_org_members m
      where m.user_id = ${UID}
        and (
          exists (
            select 1 from client_org_members m2
            where m2.org_id = m.org_id and m2.user_id = profiles.user_id
          )
          or exists (
            select 1 from contract_clients cc
            where cc.client_org_id = m.org_id and cc.lead_contractor_id = profiles.user_id
          )
        )
    )
  )`,

  // --- companies: owner manages; admins manage all; verified companies are
  // visible to any authenticated request (feeds the future directory) -------
  `drop policy if exists companies_select on companies`,
  `create policy companies_select on companies for select using (
    owner_id = nullif(current_setting('app.user_id', true), '')::uuid
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
    or verification_status = 'verified'
  )`,
  `drop policy if exists companies_insert on companies`,
  `create policy companies_insert on companies for insert with check (
    owner_id = nullif(current_setting('app.user_id', true), '')::uuid
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists companies_update on companies`,
  `create policy companies_update on companies for update using (
    owner_id = nullif(current_setting('app.user_id', true), '')::uuid
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  ) with check (
    owner_id = nullif(current_setting('app.user_id', true), '')::uuid
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists companies_delete on companies`,
  `create policy companies_delete on companies for delete using (
    owner_id = nullif(current_setting('app.user_id', true), '')::uuid
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  // Client Portal: a client-org member may see (names only — the server never
  // selects internal_notes / commercial columns for client views) the
  // companies responsible for their org's contracts: companies that own a
  // client-visible work package in a contract linked to their org, and the
  // lead contractor company of such a contract. Acyclic: companies →
  // work_packages → contract_clients → client_org_members (self-only).
  `drop policy if exists companies_client_select on companies`,
  `create policy companies_client_select on companies for select using (
    exists (
      select 1 from work_packages wp
      where wp.company_id = companies.id
        and wp.client_visible = true
        and exists (
          select 1 from contract_clients cc
          join client_org_members m on m.org_id = cc.client_org_id
          where cc.contract_workspaces_id = wp.workspace_id and m.user_id = ${UID}
        )
    )
    or exists (
      select 1 from contract_clients cc2
      join client_org_members m2 on m2.org_id = cc2.client_org_id
      where cc2.lead_contractor_id = companies.owner_id and m2.user_id = ${UID}
    )
  )`,

  // --- contract_workspaces: the lead owns their workspaces; participants
  // (anyone with an open or joined invitation for their email) can see the
  // workspace they were invited into. Declined invitees lose visibility. ----
  `drop policy if exists contract_workspaces_select on contract_workspaces`,
  `create policy contract_workspaces_select on contract_workspaces for select using (
    lead_contractor_id = nullif(current_setting('app.user_id', true), '')::uuid
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
    or exists (
      select 1 from invitations i
      where i.workspace_id = contract_workspaces.id
        and i.status in ('invited','joined','verified')
        and lower(i.email) = (
          select lower(u.email) from users u
          where u.id = nullif(current_setting('app.user_id', true), '')::uuid
        )
    )
    -- Client Portal: members of a client org linked to this workspace
    -- (contract_clients) may read the contract. Acyclic: contract_workspaces →
    -- contract_clients → client_org_members (self-only).
    or exists (
      select 1 from contract_clients cc
      join client_org_members m on m.org_id = cc.client_org_id
      where cc.contract_workspaces_id = contract_workspaces.id
        and m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )`,
  `drop policy if exists contract_workspaces_insert on contract_workspaces`,
  `create policy contract_workspaces_insert on contract_workspaces for insert with check (
    lead_contractor_id = nullif(current_setting('app.user_id', true), '')::uuid
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists contract_workspaces_update on contract_workspaces`,
  `create policy contract_workspaces_update on contract_workspaces for update using (
    lead_contractor_id = nullif(current_setting('app.user_id', true), '')::uuid
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  ) with check (
    lead_contractor_id = nullif(current_setting('app.user_id', true), '')::uuid
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists contract_workspaces_delete on contract_workspaces`,
  `create policy contract_workspaces_delete on contract_workspaces for delete using (
    lead_contractor_id = nullif(current_setting('app.user_id', true), '')::uuid
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,

  // --- invitations: the workspace lead sees/manages all; the person invited
  // by email sees theirs; admins see all. invitations_respond lets the invited
  // user move an OPEN invitation to joined/declined (and only that — the new
  // row must still carry their own email and a response status).
  //
  // NOTE (RLS recursion): with FORCE RLS on every tenant table, policy
  // subqueries against another FORCE'd table re-apply that table's policies at
  // rewrite time. That makes ANY policy subquery into an RLS table a potential
  // cycle edge: contract_workspaces_select subqueries invitations (participant
  // visibility), so invitations policies MUST NOT subquery contract_workspaces
  // (or profiles, or any other RLS table) — invitations_insert/update/delete
  // previously did, forming invitations <-> contract_workspaces and
  // invitations -> profiles rewrite cycles ("infinite recursion detected in
  // policy for relation invitations"). ALL invitations policies therefore
  // reference ONLY invitations columns (the denormalized
  // invitations.lead_contractor_id, which the server sets to the workspace
  // lead on every insert/re-invite) and the non-RLS users table. The graph
  // contract_workspaces -> invitations -> users is then acyclic.
  `drop policy if exists invitations_select on invitations`,
  `create policy invitations_select on invitations for select using (
    nullif(current_setting('app.role', true), '') = 'sb_admin'
    or invitations.lead_contractor_id = nullif(current_setting('app.user_id', true), '')::uuid
    or lower(invitations.email) = (
      select lower(u.email) from users u
      where u.id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )`,
  `drop policy if exists invitations_insert on invitations`,
  `create policy invitations_insert on invitations for insert with check (
    nullif(current_setting('app.role', true), '') = 'sb_admin'
    or invitations.lead_contractor_id = nullif(current_setting('app.user_id', true), '')::uuid
  )`,
  `drop policy if exists invitations_update on invitations`,
  `create policy invitations_update on invitations for update using (
    nullif(current_setting('app.role', true), '') = 'sb_admin'
    or invitations.lead_contractor_id = nullif(current_setting('app.user_id', true), '')::uuid
  ) with check (
    nullif(current_setting('app.role', true), '') = 'sb_admin'
    or invitations.lead_contractor_id = nullif(current_setting('app.user_id', true), '')::uuid
  )`,
  `drop policy if exists invitations_respond on invitations`,
  `create policy invitations_respond on invitations for update using (
    invitations.status = 'invited'
    and lower(invitations.email) = (
      select lower(u.email) from users u
      where u.id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  ) with check (
    lower(invitations.email) = (
      select lower(u.email) from users u
      where u.id = nullif(current_setting('app.user_id', true), '')::uuid
    )
    and invitations.status in ('joined','declined')
  )`,
  `drop policy if exists invitations_delete on invitations`,
  `create policy invitations_delete on invitations for delete using (
    nullif(current_setting('app.role', true), '') = 'sb_admin'
    or invitations.lead_contractor_id = nullif(current_setting('app.user_id', true), '')::uuid
  )`,

  // --- work_packages: the workspace lead manages them; participants can read
  // the packages of a workspace they are in (or were invited into). ---------
  `drop policy if exists work_packages_select on work_packages`,
  `create policy work_packages_select on work_packages for select using (
    nullif(current_setting('app.role', true), '') = 'sb_admin'
    or exists (
      select 1 from contract_workspaces cw
      where cw.id = work_packages.workspace_id
        and (
          cw.lead_contractor_id = nullif(current_setting('app.user_id', true), '')::uuid
          or exists (
            select 1 from invitations i
            where i.workspace_id = cw.id
              and i.status in ('invited','joined','verified')
              and lower(i.email) = (
                select lower(u.email) from users u
                where u.id = nullif(current_setting('app.user_id', true), '')::uuid
              )
          )
        )
    )
  )`,
  `drop policy if exists work_packages_insert on work_packages`,
  `create policy work_packages_insert on work_packages for insert with check (
    nullif(current_setting('app.role', true), '') = 'sb_admin'
    or exists (
      select 1 from contract_workspaces cw
      where cw.id = work_packages.workspace_id
        and cw.lead_contractor_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )`,
  `drop policy if exists work_packages_update on work_packages`,
  `create policy work_packages_update on work_packages for update using (
    nullif(current_setting('app.role', true), '') = 'sb_admin'
    or exists (
      select 1 from contract_workspaces cw
      where cw.id = work_packages.workspace_id
        and cw.lead_contractor_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  ) with check (
    nullif(current_setting('app.role', true), '') = 'sb_admin'
    or exists (
      select 1 from contract_workspaces cw
      where cw.id = work_packages.workspace_id
        and cw.lead_contractor_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )`,
  `drop policy if exists work_packages_delete on work_packages`,
  `create policy work_packages_delete on work_packages for delete using (
    nullif(current_setting('app.role', true), '') = 'sb_admin'
    or exists (
      select 1 from contract_workspaces cw
      where cw.id = work_packages.workspace_id
        and cw.lead_contractor_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )`,
  // Client Portal: members of a client org linked to the package's workspace
  // may read packages marked client_visible (never pricing/margins — the
  // server selects names/scope/status only). Acyclic: work_packages →
  // contract_clients → client_org_members (self-only).
  `drop policy if exists work_packages_client_select on work_packages`,
  `create policy work_packages_client_select on work_packages for select using (
    work_packages.client_visible = true
    and exists (
      select 1 from contract_clients cc
      join client_org_members m on m.org_id = cc.client_org_id
      where cc.contract_workspaces_id = work_packages.workspace_id
        and m.user_id = ${UID}
    )
  )`,

  // --- notifications: an inbox per user. Only the owner (or an admin) reads
  // them. Inserts come from trusted server functions: a user can notify
  // themselves, a lead can notify someone they invited into their workspace,
  // and an invitee can notify that workspace's lead when responding. --------
  `drop policy if exists notifications_select on notifications`,
  `create policy notifications_select on notifications for select using (
    notifications.user_id = nullif(current_setting('app.user_id', true), '')::uuid
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists notifications_insert on notifications`,
  `create policy notifications_insert on notifications for insert with check (
    nullif(current_setting('app.user_id', true), '') <> ''
    and (
      nullif(current_setting('app.role', true), '') = 'sb_admin'
      or notifications.user_id = nullif(current_setting('app.user_id', true), '')::uuid
      or exists (
        -- a lead notifying someone they invited into one of their workspaces
        select 1 from invitations i
        join contract_workspaces cw on cw.id = i.workspace_id
        where cw.lead_contractor_id = nullif(current_setting('app.user_id', true), '')::uuid
          and lower(i.email) = (
            select lower(u.email) from users u where u.id = notifications.user_id
          )
      )
      or exists (
        -- an invitee notifying the lead of the workspace they just answered
        select 1 from invitations i
        where i.workspace_id = notifications.workspace_id
          and i.status in ('joined','verified','declined')
          and lower(i.email) = (
            select lower(u.email) from users u
            where u.id = nullif(current_setting('app.user_id', true), '')::uuid
          )
          and exists (
            select 1 from contract_workspaces cw
            where cw.id = i.workspace_id
              and cw.lead_contractor_id = notifications.user_id
          )
      )
    )
  )`,
  `drop policy if exists notifications_update on notifications`,
  `create policy notifications_update on notifications for update using (
    notifications.user_id = nullif(current_setting('app.user_id', true), '')::uuid
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  ) with check (
    notifications.user_id = nullif(current_setting('app.user_id', true), '')::uuid
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,

  // --- audit_logs: any authenticated server call may append; only the
  // workspace lead (or an admin) may read a workspace's trail --------------
  `drop policy if exists audit_logs_insert on audit_logs`,
  `create policy audit_logs_insert on audit_logs for insert with check (
    nullif(current_setting('app.user_id', true), '') <> ''
  )`,
  `drop policy if exists audit_logs_select on audit_logs`,
  `create policy audit_logs_select on audit_logs for select using (
    nullif(current_setting('app.role', true), '') = 'sb_admin'
    or (
      audit_logs.workspace_id is not null
      and exists (
        select 1 from contract_workspaces cw
        where cw.id = audit_logs.workspace_id
          and cw.lead_contractor_id = nullif(current_setting('app.user_id', true), '')::uuid
      )
    )
    or audit_logs.actor_id = nullif(current_setting('app.user_id', true), '')::uuid
    -- Client Portal: members of the client org on the audit row may read the
    -- activity for their org's contracts (client_org_id set by server on
    -- client-scoped audit rows). Acyclic: audit_logs → client_org_members.
    or (
      audit_logs.client_org_id is not null
      and ${clientMember("audit_logs")}
    )
  )`,

  // ------------------------------------------------------------------
  // Portal-phase policies (Admin + Client portals).
  //
  // Same acyclicity discipline as invitations: every policy that needs a
  // workspace or client lookup uses a column denormalized onto the row
  // (lead_contractor_id, client_org_id) instead of subquerying
  // contract_workspaces / contract_clients. The only RLS tables subqueried
  // from these policies are client_org_members, contract_clients,
  // support_cases, invitations and companies — whose own policies reference
  // only their own columns and users, so the policy graph has no cycles
  // (verified against the live DB: self-references and mutual references are
  // rejected with "infinite recursion detected in policy", 1-hop chains are
  // fine). users/sessions remain the only RLS-free tables.
  // ------------------------------------------------------------------

  // --- admin_roles: sb_admin manages staff roles; a user can read their own.
  `drop policy if exists admin_roles_select on admin_roles`,
  `create policy admin_roles_select on admin_roles for select using (
    ${IS_ADMIN} or admin_roles.user_id = ${UID}
  )`,
  `drop policy if exists admin_roles_insert on admin_roles`,
  `create policy admin_roles_insert on admin_roles for insert with check (${IS_ADMIN})`,
  `drop policy if exists admin_roles_update on admin_roles`,
  `create policy admin_roles_update on admin_roles for update using (${IS_ADMIN}) with check (${IS_ADMIN})`,
  `drop policy if exists admin_roles_delete on admin_roles`,
  `create policy admin_roles_delete on admin_roles for delete using (${IS_ADMIN})`,

  // --- client_organizations: visible to sb_admin and the org's members
  // (membership comes from client_org_members, whose own policies never point
  // back here); created/maintained by sb_admin.
  `drop policy if exists client_organizations_select on client_organizations`,
  `create policy client_organizations_select on client_organizations for select using (
    ${IS_ADMIN}
    or exists (select 1 from client_org_members m where m.org_id = client_organizations.id and m.user_id = ${UID})
  )`,
  `drop policy if exists client_organizations_insert on client_organizations`,
  `create policy client_organizations_insert on client_organizations for insert with check (${IS_ADMIN})`,
  `drop policy if exists client_organizations_update on client_organizations`,
  `create policy client_organizations_update on client_organizations for update using (
    ${IS_ADMIN}
    -- Client Portal: a client_admin may update their org profile. The role is
    -- asserted server-side from client_org_members before asUser(); the
    -- org-scoping WHERE clause is applied by the server function.
    or ${ROLE} = 'client_admin'
  ) with check (
    ${IS_ADMIN}
    or ${ROLE} = 'client_admin'
  )`,
  `drop policy if exists client_organizations_delete on client_organizations`,
  `create policy client_organizations_delete on client_organizations for delete using (${IS_ADMIN})`,

  // --- client_org_members: users see their own membership; any client-role
  // scoped request (app.role = the acting user's client role, asserted
  // server-side from their own membership) may read the roster so the Team UI
  // can list the org (the server scopes WHERE org_id); sb_admin manages all;
  // client_admin manages the roster (Team UI); the lead contractor of a
  // contract that links this org may also add / update / remove members via the
  // denormalized contract_clients.lead_contractor_id. A self-referential
  // roster check would recurse, so client-admin grants key off app.role.
  `drop policy if exists client_org_members_select on client_org_members`,
  `create policy client_org_members_select on client_org_members for select using (
    ${IS_ADMIN} or client_org_members.user_id = ${UID} or ${IS_CLIENT}
  )`,
  `drop policy if exists client_org_members_insert on client_org_members`,
  `create policy client_org_members_insert on client_org_members for insert with check (
    ${IS_ADMIN}
    or ${ROLE} = 'client_admin'
    or exists (select 1 from contract_clients cc where cc.client_org_id = client_org_members.org_id and cc.lead_contractor_id = ${UID})
  )`,
  `drop policy if exists client_org_members_update on client_org_members`,
  `create policy client_org_members_update on client_org_members for update using (
    ${IS_ADMIN}
    or ${ROLE} = 'client_admin'
    or exists (select 1 from contract_clients cc where cc.client_org_id = client_org_members.org_id and cc.lead_contractor_id = ${UID})
  ) with check (
    ${IS_ADMIN}
    or ${ROLE} = 'client_admin'
    or exists (select 1 from contract_clients cc where cc.client_org_id = client_org_members.org_id and cc.lead_contractor_id = ${UID})
  )`,
  `drop policy if exists client_org_members_delete on client_org_members`,
  `create policy client_org_members_delete on client_org_members for delete using (
    ${IS_ADMIN}
    or ${ROLE} = 'client_admin'
    or exists (select 1 from contract_clients cc where cc.client_org_id = client_org_members.org_id and cc.lead_contractor_id = ${UID})
  )`,

  // --- contract_clients: the workspace lead manages the client link (via the
  // denormalized lead_contractor_id); client-org members see the contracts
  // their org is client on; sb_admin sees all.
  `drop policy if exists contract_clients_select on contract_clients`,
  `create policy contract_clients_select on contract_clients for select using (
    ${IS_ADMIN}
    or contract_clients.lead_contractor_id = ${UID}
    or exists (select 1 from client_org_members m where m.org_id = contract_clients.client_org_id and m.user_id = ${UID})
  )`,
  `drop policy if exists contract_clients_insert on contract_clients`,
  `create policy contract_clients_insert on contract_clients for insert with check (
    ${IS_ADMIN} or contract_clients.lead_contractor_id = ${UID}
  )`,
  `drop policy if exists contract_clients_update on contract_clients`,
  `create policy contract_clients_update on contract_clients for update using (
    ${IS_ADMIN} or contract_clients.lead_contractor_id = ${UID}
  ) with check (
    ${IS_ADMIN} or contract_clients.lead_contractor_id = ${UID}
  )`,
  `drop policy if exists contract_clients_delete on contract_clients`,
  `create policy contract_clients_delete on contract_clients for delete using (
    ${IS_ADMIN} or contract_clients.lead_contractor_id = ${UID}
  )`,

  // --- support_cases: reporter (any authenticated user) can open a case and
  // follow it; the assigned admin and sb_admin handle it. Case communication
  // lives in case_messages.
  `drop policy if exists support_cases_select on support_cases`,
  `create policy support_cases_select on support_cases for select using (
    ${IS_ADMIN}
    or support_cases.reporter_user_id = ${UID}
    or support_cases.assignee_user_id = ${UID}
  )`,
  `drop policy if exists support_cases_insert on support_cases`,
  `create policy support_cases_insert on support_cases for insert with check (
    ${IS_ADMIN} or support_cases.reporter_user_id = ${UID}
  )`,
  `drop policy if exists support_cases_update on support_cases`,
  `create policy support_cases_update on support_cases for update using (
    ${IS_ADMIN} or support_cases.assignee_user_id = ${UID}
  ) with check (
    ${IS_ADMIN} or support_cases.assignee_user_id = ${UID}
  )`,
  `drop policy if exists support_cases_delete on support_cases`,
  `create policy support_cases_delete on support_cases for delete using (${IS_ADMIN})`,

  // --- case_messages: admins see all (including internal notes); participants
  // of the case (reporter/assignee) see only non-internal messages and may add
  // non-internal ones; the author always sees their own.
  `drop policy if exists case_messages_select on case_messages`,
  `create policy case_messages_select on case_messages for select using (
    ${IS_ADMIN}
    or case_messages.author_user_id = ${UID}
    or (
      case_messages.internal = false
      and exists (
        select 1 from support_cases sc
        where sc.id = case_messages.case_id
          and (sc.reporter_user_id = ${UID} or sc.assignee_user_id = ${UID})
      )
    )
  )`,
  `drop policy if exists case_messages_insert on case_messages`,
  `create policy case_messages_insert on case_messages for insert with check (
    ${IS_ADMIN}
    or (
      case_messages.internal = false
      and exists (
        select 1 from support_cases sc
        where sc.id = case_messages.case_id
          and (sc.reporter_user_id = ${UID} or sc.assignee_user_id = ${UID})
      )
    )
  )`,
  `drop policy if exists case_messages_update on case_messages`,
  `create policy case_messages_update on case_messages for update using (${IS_ADMIN}) with check (${IS_ADMIN})`,
  `drop policy if exists case_messages_delete on case_messages`,
  `create policy case_messages_delete on case_messages for delete using (${IS_ADMIN})`,

  // --- milestones: lead (CRUD), client members read + approve
  // (client_admin / client_pm / client_reviewer update; client_org pinned to a
  // live contract_clients link), participants of the workspace read, sb_admin
  // all.
  `drop policy if exists milestones_select on milestones`,
  `create policy milestones_select on milestones for select using (
    ${IS_ADMIN}
    or milestones.lead_contractor_id = ${UID}
    or ${clientMember("milestones")}
    or ${participantIn("milestones")}
  )`,
  `drop policy if exists milestones_insert on milestones`,
  `create policy milestones_insert on milestones for insert with check (
    ${IS_ADMIN} or milestones.lead_contractor_id = ${UID}
  )`,
  `drop policy if exists milestones_update on milestones`,
  `create policy milestones_update on milestones for update using (
    ${IS_ADMIN}
    or milestones.lead_contractor_id = ${UID}
    or ${clientMember("milestones", "'client_admin','client_pm','client_reviewer'")}
  ) with check (
    ${IS_ADMIN}
    or milestones.lead_contractor_id = ${UID}
    or (${clientMember("milestones", "'client_admin','client_pm','client_reviewer'")} and ${clientLinked("milestones")})
  )`,
  `drop policy if exists milestones_delete on milestones`,
  `create policy milestones_delete on milestones for delete using (
    ${IS_ADMIN} or milestones.lead_contractor_id = ${UID}
  )`,

  // --- issues: lead (CRUD); clients may raise issues (client_admin /
  // client_pm, against a linked org) and update them; participants of the
  // workspace read (they resolve "waiting_contractor" items); sb_admin all.
  `drop policy if exists issues_select on issues`,
  `create policy issues_select on issues for select using (
    ${IS_ADMIN}
    or issues.lead_contractor_id = ${UID}
    or ${clientMember("issues")}
    or ${participantIn("issues")}
  )`,
  `drop policy if exists issues_insert on issues`,
  `create policy issues_insert on issues for insert with check (
    ${IS_ADMIN}
    or issues.lead_contractor_id = ${UID}
    or (${clientMember("issues", "'client_admin','client_pm'")} and ${clientLinked("issues")})
  )`,
  `drop policy if exists issues_update on issues`,
  `create policy issues_update on issues for update using (
    ${IS_ADMIN}
    or issues.lead_contractor_id = ${UID}
    or ${clientMember("issues", "'client_admin','client_pm'")}
  ) with check (
    ${IS_ADMIN}
    or issues.lead_contractor_id = ${UID}
    or (${clientMember("issues", "'client_admin','client_pm'")} and ${clientLinked("issues")})
  )`,
  `drop policy if exists issues_delete on issues`,
  `create policy issues_delete on issues for delete using (
    ${IS_ADMIN} or issues.lead_contractor_id = ${UID}
  )`,

  // --- variations: lead submits/manages; client reviews and decides
  // (client_admin / client_pm). Commercial data — participants get NO access.
  `drop policy if exists variations_select on variations`,
  `create policy variations_select on variations for select using (
    ${IS_ADMIN}
    or variations.lead_contractor_id = ${UID}
    or ${clientMember("variations")}
  )`,
  `drop policy if exists variations_insert on variations`,
  `create policy variations_insert on variations for insert with check (
    ${IS_ADMIN} or variations.lead_contractor_id = ${UID}
  )`,
  `drop policy if exists variations_update on variations`,
  `create policy variations_update on variations for update using (
    ${IS_ADMIN}
    or variations.lead_contractor_id = ${UID}
    or ${clientMember("variations", "'client_admin','client_pm'")}
  ) with check (
    ${IS_ADMIN}
    or variations.lead_contractor_id = ${UID}
    or (${clientMember("variations", "'client_admin','client_pm'")} and ${clientLinked("variations")})
  )`,
  `drop policy if exists variations_delete on variations`,
  `create policy variations_delete on variations for delete using (
    ${IS_ADMIN} or variations.lead_contractor_id = ${UID}
  )`,

  // --- invoices: lead (CRUD); client finance reviews/approves/pays
  // (client_admin / client_finance); a participant sees only invoices issued
  // by their own company (invoices.company_id -> companies.owner_id); sb_admin
  // all.
  `drop policy if exists invoices_select on invoices`,
  `create policy invoices_select on invoices for select using (
    ${IS_ADMIN}
    or invoices.lead_contractor_id = ${UID}
    or ${clientMember("invoices")}
    or (
      invoices.company_id is not null
      and exists (select 1 from companies c where c.id = invoices.company_id and c.owner_id = ${UID})
    )
  )`,
  `drop policy if exists invoices_insert on invoices`,
  `create policy invoices_insert on invoices for insert with check (
    ${IS_ADMIN} or invoices.lead_contractor_id = ${UID}
  )`,
  `drop policy if exists invoices_update on invoices`,
  `create policy invoices_update on invoices for update using (
    ${IS_ADMIN}
    or invoices.lead_contractor_id = ${UID}
    or ${clientMember("invoices", "'client_admin','client_finance'")}
  ) with check (
    ${IS_ADMIN}
    or invoices.lead_contractor_id = ${UID}
    or (${clientMember("invoices", "'client_admin','client_finance'")} and ${clientLinked("invoices")})
  )`,
  `drop policy if exists invoices_delete on invoices`,
  `create policy invoices_delete on invoices for delete using (
    ${IS_ADMIN} or invoices.lead_contractor_id = ${UID}
  )`,

  // --- progress_reports: lead submits; client members review/acknowledge/
  // approve (client_admin / client_pm / client_reviewer); participants of the
  // workspace read; sb_admin all.
  `drop policy if exists progress_reports_select on progress_reports`,
  `create policy progress_reports_select on progress_reports for select using (
    ${IS_ADMIN}
    or progress_reports.lead_contractor_id = ${UID}
    or ${clientMember("progress_reports")}
    or ${participantIn("progress_reports")}
  )`,
  `drop policy if exists progress_reports_insert on progress_reports`,
  `create policy progress_reports_insert on progress_reports for insert with check (
    ${IS_ADMIN} or progress_reports.lead_contractor_id = ${UID}
  )`,
  `drop policy if exists progress_reports_update on progress_reports`,
  `create policy progress_reports_update on progress_reports for update using (
    ${IS_ADMIN}
    or progress_reports.lead_contractor_id = ${UID}
    or ${clientMember("progress_reports", "'client_admin','client_pm','client_reviewer'")}
  ) with check (
    ${IS_ADMIN}
    or progress_reports.lead_contractor_id = ${UID}
    or (${clientMember("progress_reports", "'client_admin','client_pm','client_reviewer'")} and ${clientLinked("progress_reports")})
  )`,
  `drop policy if exists progress_reports_delete on progress_reports`,
  `create policy progress_reports_delete on progress_reports for delete using (
    ${IS_ADMIN} or progress_reports.lead_contractor_id = ${UID}
  )`,

  // --- documents: lead (CRUD); clients see only client_visible docs and may
  // review/approve those (client_admin / client_reviewer); participants see
  // workspace + client_visible docs and may upload (but never mark a doc
  // client_visible); company_only docs are lead/admin-only; sb_admin all.
  `drop policy if exists documents_select on documents`,
  `create policy documents_select on documents for select using (
    ${IS_ADMIN}
    or documents.lead_contractor_id = ${UID}
    or (documents.visibility = 'client_visible' and ${clientMember("documents")})
    or (documents.visibility <> 'company_only' and ${participantIn("documents")})
  )`,
  `drop policy if exists documents_insert on documents`,
  `create policy documents_insert on documents for insert with check (
    ${IS_ADMIN}
    or documents.lead_contractor_id = ${UID}
    or (${clientMember("documents")} and ${clientLinked("documents")})
    or (documents.visibility <> 'client_visible' and ${participantIn("documents")})
  )`,
  `drop policy if exists documents_update on documents`,
  `create policy documents_update on documents for update using (
    ${IS_ADMIN}
    or documents.lead_contractor_id = ${UID}
    or (documents.visibility = 'client_visible' and ${clientMember("documents", "'client_admin','client_reviewer'")})
  ) with check (
    ${IS_ADMIN}
    or documents.lead_contractor_id = ${UID}
    or (
      documents.visibility = 'client_visible'
      and ${clientMember("documents", "'client_admin','client_reviewer'")}
      and ${clientLinked("documents")}
    )
  )`,
  `drop policy if exists documents_delete on documents`,
  `create policy documents_delete on documents for delete using (
    ${IS_ADMIN} or documents.lead_contractor_id = ${UID}
  )`,
];
