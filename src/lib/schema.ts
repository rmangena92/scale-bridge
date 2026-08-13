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

  // Lead-contractor delivery task board (workspace Tasks tab). Created_by
  // records the actor; work_package_id links a task to a package; assignee
  // company is optional. RLS mirrors work_packages: the lead manages, any
  // participant (invited/joined/verified) can read and contribute.
  `create table if not exists tasks (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references contract_workspaces(id) on delete cascade,
    work_package_id uuid references work_packages(id) on delete set null,
    title text not null,
    description text,
    status text not null default 'todo'
      check (status in ('todo','in_progress','done','blocked')),
    assignee_company_id uuid references companies(id) on delete set null,
    due_date timestamptz,
    created_by uuid references users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  // Lead-contractor commercial tab (Pricing & Commercials): one row per
  // pricing submission against a work package. The lead records a reference
  // baseline (status 'accepted' immediately — their own reference price) and
  // participating companies submit quotes (status 'submitted') which the lead
  // accepts or rejects. RLS mirrors the work_packages/tasks pattern (acyclic
  // via contract_workspaces -> invitations -> users); only the lead or an
  // sb_admin deletes.
  `create table if not exists pricing_submissions (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references contract_workspaces(id) on delete cascade,
    work_package_id uuid references work_packages(id) on delete set null,
    company_id uuid references companies(id) on delete set null,
    amount numeric(12,2) not null,
    currency text not null default 'GBP',
    description text,
    status text not null default 'draft'
      check (status in ('draft','submitted','accepted','rejected')),
    submitted_by uuid references users(id) on delete set null,
    submitted_at timestamptz,
    reviewed_by uuid references users(id) on delete set null,
    reviewed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,

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
  // Part C: client<->lead contract messaging. Messages are scoped to a contract
  // workspace and grouped into threads (thread_key): 'general' is the default
  // contract-level channel; '<type>:<entity_id>' threads discussion against a
  // milestone / document / issue / variation / invoice / report / work package.
  // client_org_id + lead_contractor_id are denormalized (same rationale as the
  // other portal tables) so the policies grant the linked client org and the
  // workspace lead access without subquerying contract_workspaces /
  // contract_clients; the server sets both from the verified workspace-client
  // link on insert. Messages are immutable (no update/delete policies).
  `create table if not exists messages (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references contract_workspaces(id) on delete cascade,
    client_org_id uuid references client_organizations(id) on delete set null,
    lead_contractor_id uuid references users(id) on delete cascade,
    thread_key text not null,
    thread_type text not null default 'general'
      check (thread_type in ('general','milestone','document','issue','variation','invoice','report','package')),
    author_user_id uuid not null references users(id) on delete cascade,
    body text not null,
    created_at timestamptz not null default now()
  )`,
  // Per-participant read watermark per thread: the newest message the user has
  // seen. Unread = count(messages in thread newer than last_read_at). The
  // server upserts it on mark-read and when the user posts.
  `create table if not exists message_reads (
    workspace_id uuid not null references contract_workspaces(id) on delete cascade,
    client_org_id uuid references client_organizations(id) on delete set null,
    lead_contractor_id uuid references users(id) on delete cascade,
    thread_key text not null,
    user_id uuid not null references users(id) on delete cascade,
    last_read_at timestamptz not null default now(),
    primary key (workspace_id, thread_key, user_id)
  )`,
  // Lead-contractor workspace participant messaging (workspace Messages tab).
  // One 'general' thread per workspace, shared by the workspace lead and the
  // invited companies. This deliberately lives in its own table rather than
  // the client<->lead `messages` table: the messages RLS policies grant the
  // linked client org + the lead only, and cannot be extended to company
  // participants without changing them — so workspace participant threads get
  // their own table + policies (lead or invited/joined/verified participant,
  // acyclic via contract_workspaces -> invitations -> users). Immutable rows.
  `create table if not exists workspace_messages (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references contract_workspaces(id) on delete cascade,
    thread_key text not null default 'general',
    author_user_id uuid not null references users(id) on delete cascade,
    body text not null,
    created_at timestamptz not null default now()
  )`,
  // Per-user read watermark for the workspace thread (same semantics as
  // message_reads: unread = messages newer than last_read_at). Separate table
  // so it never collides with the client portal's message_reads rows (which
  // share the same workspace_id/thread_key primary key namespace).
  `create table if not exists workspace_message_reads (
    workspace_id uuid not null references contract_workspaces(id) on delete cascade,
    thread_key text not null default 'general',
    user_id uuid not null references users(id) on delete cascade,
    last_read_at timestamptz not null default now(),
    primary key (workspace_id, thread_key, user_id)
  )`,
  // Part C (idempotent): client-org scoping on the notification inbox so the
  // client portal lists/marks only its org's notifications. Rows created by
  // client-scoped server fns (new-message to the lead) and the demo seed set
  // it; legacy/lead-side rows keep it null and are matched via the
  // workspace -> contract_clients link at query time.
  `alter table notifications add column if not exists client_org_id uuid references client_organizations(id) on delete set null`,

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
  // Master Admin Portal: per-note internal notes on companies. Staff can add /
  // edit notes; every write tracks author + timestamps and is audit-logged.
  // Complements (does not replace) the legacy companies.internal_notes array.
  `create table if not exists company_notes (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references companies(id) on delete cascade,
    author_user_id uuid references users(id) on delete set null,
    body text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,

  // ------------------------------------------------------------------
  // Central service catalogue (plan item 2). Admin-managed catalogue data:
  // service_categories → services → company_services (the service ↔ company
  // relationship, the heart of the catalogue) → service_evidence (proof rows
  // behind AI discoveries / verification). Powers the master dashboard
  // catalogue cards, the /admin/services page, and the company detail
  // Services / Service Evidence / AI Insights / Upsell tabs. RLS mirrors
  // company_notes: sb_admin only (companies/clients never see catalogue
  // internals at the RLS layer; later phases may relax for lead contractors).
  // ------------------------------------------------------------------
  `create table if not exists service_categories (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    slug text not null unique,
    description text,
    sort_order int not null default 0,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists services (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    slug text not null unique,
    category_id uuid not null references service_categories(id) on delete restrict,
    description text,
    industry text,
    required_qualifications text[] not null default '{}'::text[],
    status text not null default 'Listed'
      check (status in ('Listed','Pending Review','Verified','AI Suggested','Client Intake Suggested','Rejected','Archived')),
    capacity text,
    geographic_coverage text,
    related_service_ids uuid[] not null default '{}'::uuid[],
    upsell_service_ids uuid[] not null default '{}'::uuid[],
    created_by uuid references users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  `create table if not exists company_services (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references companies(id) on delete cascade,
    service_id uuid not null references services(id) on delete cascade,
    source text not null default 'company profile'
      check (source in ('company profile','website','client intake form','uploaded documents','contract participation','manual entry','AI discovery','service proposal','company communication')),
    confidence text not null default 'Medium'
      check (confidence in ('High','Medium','Low','Requires manual review')),
    verification_status text not null default 'Pending'
      check (verification_status in ('Verified','Pending','Rejected')),
    evidence_summary text,
    discovered_at timestamptz,
    active_with_scalebridge boolean not null default false,
    upsell_recommended boolean not null default false,
    admin_decision text
      check (admin_decision is null or admin_decision in ('Approved','Rejected','Archived')),
    notes text,
    reviewed_by uuid references users(id) on delete set null,
    reviewed_at timestamptz,
    created_at timestamptz not null default now(),
    unique (company_id, service_id)
  )`,
  `create table if not exists service_evidence (
    id uuid primary key default gen_random_uuid(),
    company_service_id uuid not null references company_services(id) on delete cascade,
    evidence_type text,
    title text,
    source_url text,
    excerpt text,
    captured_at timestamptz,
    agent_version text,
    created_at timestamptz not null default now()
  )`,

  // ------------------------------------------------------------------
  // AI Service Intelligence agent (plan item 5). The agent is a
  // recommendation-mode, evidence-based service-discovery engine: it reads
  // approved internal data (and approved public sources only when the company
  // has granted consent), extracts evidence, maps it to catalogue services,
  // and records ai_recommendations — it never modifies a company profile and
  // never contacts a business. Every AI record carries created_at, source,
  // agent_version, confidence, review_status, reviewed_by/at and a final
  // decision. RLS mirrors the catalogue tables: sb_admin only.
  // ------------------------------------------------------------------
  `create table if not exists ai_agent_runs (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references companies(id) on delete cascade,
    trigger text not null
      check (trigger in ('profile_update','intake','uploaded_document','contract_participation','manual','manual_re-run')),
    status text not null default 'queued'
      check (status in ('queued','running','completed','failed')),
    agent_version text not null default '0.1.0',
    prompt_model text,
    started_at timestamptz,
    finished_at timestamptz,
    error text,
    run_metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists ai_recommendations (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references companies(id) on delete cascade,
    run_id uuid references ai_agent_runs(id) on delete set null,
    service_id uuid references services(id) on delete set null,
    recommendation_type text not null
      check (recommendation_type in ('service_discovery','upsell','cross-sell','profile_update')),
    status text not null default 'Suggested'
      check (status in ('Suggested','Under_Review','Approved','Rejected','Added_To_Profile','Expired')),
    confidence text not null default 'Requires_Manual_Review'
      check (confidence in ('High','Medium','Low','Requires_Manual_Review')),
    confidence_score numeric not null default 0,
    summary text not null,
    rationale text,
    source text not null default 'internal_data',
    created_at timestamptz not null default now(),
    reviewed_by uuid references users(id) on delete set null,
    reviewed_at timestamptz,
    admin_notes text
  )`,
  `create table if not exists upsell_opportunities (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references companies(id) on delete cascade,
    existing_service_id uuid references services(id) on delete set null,
    suggested_service_id uuid not null references services(id) on delete set null,
    relationship text,
    evidence text,
    confidence text not null default 'Requires_Manual_Review'
      check (confidence in ('High','Medium','Low','Requires_Manual_Review')),
    confidence_score numeric not null default 0,
    relevant_opportunities jsonb not null default '[]'::jsonb,
    suggested_message text,
    timing text,
    owner_id uuid references users(id) on delete set null,
    status text not null default 'Suggested'
      check (status in ('Suggested','Under_Review','Approved','Rejected','Awaiting_Company_Confirmation','Sent','Interested','Declined','Converted','Closed')),
    admin_notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  `create table if not exists ai_data_source_permissions (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references companies(id) on delete cascade,
    source text not null
      check (source in ('internal_data','website','public_source')),
    granted boolean not null default false,
    consent_tracking text,
    consent_ref text,
    granted_at timestamptz,
    granted_by uuid references users(id) on delete set null,
    created_at timestamptz not null default now(),
    unique (company_id, source)
  )`,
  `create table if not exists company_ai_preferences (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null unique references companies(id) on delete cascade,
    ai_discovery_enabled boolean not null default true,
    public_source_consent boolean not null default false,
    opt_out boolean not null default false,
    updated_at timestamptz not null default now()
  )`,
  `create table if not exists ai_audit_events (
    id uuid primary key default gen_random_uuid(),
    run_id uuid references ai_agent_runs(id) on delete set null,
    actor_type text not null
      check (actor_type in ('agent','admin','system')),
    actor_id text,
    action text not null,
    entity_type text,
    entity_id text,
    details jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  )`,
  // Platform-level AI data-source registry (Master Admin AI Controls). One row
  // per source kind the agent may use; admins toggle enabled on/off (audited).
  // The engine respects enabled = true when granting permissions and reading
  // public evidence. Company-level consent lives in ai_data_source_permissions
  // and company_ai_preferences - this table is the platform-wide switch.
  `create table if not exists ai_data_source_registry (
    id uuid primary key default gen_random_uuid(),
    source text not null unique
      check (source in ('internal_data','website','public_source')),
    name text not null,
    description text,
    source_url text,
    enabled boolean not null default true,
    consent_required boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,

  // ------------------------------------------------------------------
  // Indexes
  // ------------------------------------------------------------------
  // Platform-level engine rate-limit + automation settings (Master Admin AI
  // Controls Phase 2a). Single-row config (id = 1 enforced by the PK check);
  // the engine (ai-agent.ts) consults it before starting any run and audits
  // ai.run.rate_limited when a cap blocks a run. Editable only by sb_admin
  // (RLS below); every change is dual-audited (ai.control.settings_update).
  `create table if not exists ai_control_settings (
    id integer primary key default 1 check (id = 1),
    daily_run_cap integer not null default 50,
    per_company_daily_cap integer not null default 10,
    min_interval_seconds integer not null default 60,
    auto_run_enabled boolean not null default true,
    updated_by uuid references users(id) on delete set null,
    updated_at timestamptz not null default now()
  )`,
  // Phase 2a: the engine can now start runs with trigger 'retry' (Master Admin
  // retry control for failed runs) - widen the existing check constraint.
  `alter table ai_agent_runs drop constraint if exists ai_agent_runs_trigger_check`,
  `alter table ai_agent_runs add constraint ai_agent_runs_trigger_check check (
    trigger in ('profile_update','intake','uploaded_document','contract_participation','manual','manual_re-run','retry')
  )`,

  `create index if not exists sessions_token_hash_idx on sessions (token_hash)`,
  `create index if not exists ai_agent_runs_created_at_idx on ai_agent_runs (created_at desc)`,
  `create index if not exists ai_audit_events_created_at_idx on ai_audit_events (created_at desc)`,
  `create index if not exists ai_audit_events_entity_idx on ai_audit_events (entity_type, entity_id)`,
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
  `create index if not exists notifications_client_org_idx on notifications (client_org_id)`,
  `create index if not exists messages_workspace_thread_idx on messages (workspace_id, thread_key, created_at)`,
  `create index if not exists messages_thread_author_idx on messages (thread_key, author_user_id)`,
  `create index if not exists message_reads_user_idx on message_reads (user_id)`,
  `create index if not exists workspace_messages_ws_idx on workspace_messages (workspace_id, thread_key, created_at)`,
  `create index if not exists workspace_message_reads_user_idx on workspace_message_reads (user_id)`,
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
  `create index if not exists pricing_submissions_workspace_id_idx on pricing_submissions (workspace_id)`,
  `create index if not exists progress_reports_workspace_id_idx on progress_reports (workspace_id)`,
  `create index if not exists progress_reports_lead_idx on progress_reports (lead_contractor_id)`,
  `create index if not exists progress_reports_client_org_idx on progress_reports (client_org_id)`,
  `create index if not exists documents_workspace_id_idx on documents (workspace_id)`,
  `create index if not exists documents_visibility_idx on documents (visibility)`,
  `create index if not exists documents_lead_idx on documents (lead_contractor_id)`,
  `create index if not exists documents_client_org_idx on documents (client_org_id)`,
  `create index if not exists tasks_workspace_id_idx on tasks (workspace_id)`,
  `create index if not exists tasks_status_idx on tasks (status)`,

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
  `alter table tasks enable row level security`,
  `alter table pricing_submissions enable row level security`,
  `alter table company_notes enable row level security`,
  `alter table messages enable row level security`,
  `alter table message_reads enable row level security`,
  `alter table workspace_messages enable row level security`,
  `alter table workspace_message_reads enable row level security`,
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
  `alter table tasks force row level security`,
  `alter table pricing_submissions force row level security`,
  `alter table company_notes force row level security`,
  `alter table messages force row level security`,
  `alter table message_reads force row level security`,
  `alter table workspace_messages force row level security`,
  `alter table workspace_message_reads force row level security`,
  `alter table service_categories enable row level security`,
  `alter table services enable row level security`,
  `alter table company_services enable row level security`,
  `alter table service_evidence enable row level security`,
  `alter table service_categories force row level security`,
  `alter table services force row level security`,
  `alter table company_services force row level security`,
  `alter table service_evidence force row level security`,
  `alter table ai_agent_runs enable row level security`,
  `alter table ai_recommendations enable row level security`,
  `alter table upsell_opportunities enable row level security`,
  `alter table ai_data_source_permissions enable row level security`,
  `alter table company_ai_preferences enable row level security`,
  `alter table ai_audit_events enable row level security`,
  `alter table ai_agent_runs force row level security`,
  `alter table ai_recommendations force row level security`,
  `alter table upsell_opportunities force row level security`,
  `alter table ai_data_source_permissions force row level security`,
  `alter table company_ai_preferences force row level security`,
  `alter table ai_audit_events force row level security`,
  `alter table ai_control_settings enable row level security`,
  `alter table ai_control_settings force row level security`,

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

  // --- tasks (lead-contractor delivery board): the workspace lead manages;
  // any participant (invited/joined/verified) can read and contribute; only
  // the lead (or an admin) deletes. Mirrors the work_packages policy shape:
  // tasks -> contract_workspaces -> invitations -> users stays acyclic.
  `drop policy if exists tasks_select on tasks`,
  `create policy tasks_select on tasks for select using (
    ${IS_ADMIN}
    or exists (
      select 1 from contract_workspaces cw
      where cw.id = tasks.workspace_id
        and (
          cw.lead_contractor_id = ${UID}
          or exists (
            select 1 from invitations i
            where i.workspace_id = cw.id
              and i.status in ('invited','joined','verified')
              and lower(i.email) = (
                select lower(u.email) from users u where u.id = ${UID}
              )
          )
        )
    )
  )`,
  `drop policy if exists tasks_insert on tasks`,
  `create policy tasks_insert on tasks for insert with check (
    ${IS_ADMIN}
    or exists (
      select 1 from contract_workspaces cw
      where cw.id = tasks.workspace_id
        and (
          cw.lead_contractor_id = ${UID}
          or exists (
            select 1 from invitations i
            where i.workspace_id = cw.id
              and i.status in ('invited','joined','verified')
              and lower(i.email) = (
                select lower(u.email) from users u where u.id = ${UID}
              )
          )
        )
    )
  )`,
  `drop policy if exists tasks_update on tasks`,
  `create policy tasks_update on tasks for update using (
    ${IS_ADMIN}
    or exists (
      select 1 from contract_workspaces cw
      where cw.id = tasks.workspace_id
        and (
          cw.lead_contractor_id = ${UID}
          or exists (
            select 1 from invitations i
            where i.workspace_id = cw.id
              and i.status in ('invited','joined','verified')
              and lower(i.email) = (
                select lower(u.email) from users u where u.id = ${UID}
              )
          )
        )
    )
  ) with check (
    ${IS_ADMIN}
    or exists (
      select 1 from contract_workspaces cw
      where cw.id = tasks.workspace_id
        and (
          cw.lead_contractor_id = ${UID}
          or exists (
            select 1 from invitations i
            where i.workspace_id = cw.id
              and i.status in ('invited','joined','verified')
              and lower(i.email) = (
                select lower(u.email) from users u where u.id = ${UID}
              )
          )
        )
    )
  )`,
  `drop policy if exists tasks_delete on tasks`,
  `create policy tasks_delete on tasks for delete using (
    ${IS_ADMIN}
    or exists (
      select 1 from contract_workspaces cw
      where cw.id = tasks.workspace_id and cw.lead_contractor_id = ${UID}
    )
  )`,
  // --- pricing_submissions (lead-contractor commercial tab): the workspace
  // lead manages pricing; any participant (invited/joined/verified) can read
  // and contribute quotes; only the lead (or an admin) deletes. Same acyclic
  // shape as tasks: pricing_submissions -> contract_workspaces -> invitations
  // -> users.
  `drop policy if exists pricing_submissions_select on pricing_submissions`,
  `create policy pricing_submissions_select on pricing_submissions for select using (
    ${IS_ADMIN}
    or exists (
      select 1 from contract_workspaces cw
      where cw.id = pricing_submissions.workspace_id
        and (
          cw.lead_contractor_id = ${UID}
          or exists (
            select 1 from invitations i
            where i.workspace_id = cw.id
              and i.status in ('invited','joined','verified')
              and lower(i.email) = (
                select lower(u.email) from users u where u.id = ${UID}
              )
          )
        )
    )
  )`,
  `drop policy if exists pricing_submissions_insert on pricing_submissions`,
  `create policy pricing_submissions_insert on pricing_submissions for insert with check (
    ${IS_ADMIN}
    or exists (
      select 1 from contract_workspaces cw
      where cw.id = pricing_submissions.workspace_id
        and (
          cw.lead_contractor_id = ${UID}
          or exists (
            select 1 from invitations i
            where i.workspace_id = cw.id
              and i.status in ('invited','joined','verified')
              and lower(i.email) = (
                select lower(u.email) from users u where u.id = ${UID}
              )
          )
        )
    )
  )`,
  `drop policy if exists pricing_submissions_update on pricing_submissions`,
  `create policy pricing_submissions_update on pricing_submissions for update using (
    ${IS_ADMIN}
    or exists (
      select 1 from contract_workspaces cw
      where cw.id = pricing_submissions.workspace_id
        and (
          cw.lead_contractor_id = ${UID}
          or exists (
            select 1 from invitations i
            where i.workspace_id = cw.id
              and i.status in ('invited','joined','verified')
              and lower(i.email) = (
                select lower(u.email) from users u where u.id = ${UID}
              )
          )
        )
    )
  ) with check (
    ${IS_ADMIN}
    or exists (
      select 1 from contract_workspaces cw
      where cw.id = pricing_submissions.workspace_id
        and (
          cw.lead_contractor_id = ${UID}
          or exists (
            select 1 from invitations i
            where i.workspace_id = cw.id
              and i.status in ('invited','joined','verified')
              and lower(i.email) = (
                select lower(u.email) from users u where u.id = ${UID}
              )
          )
        )
    )
  )`,
  `drop policy if exists pricing_submissions_delete on pricing_submissions`,
  `create policy pricing_submissions_delete on pricing_submissions for delete using (
    ${IS_ADMIN} or exists (
      select 1 from contract_workspaces cw
      where cw.id = pricing_submissions.workspace_id and cw.lead_contractor_id = ${UID}
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
      or exists (
        -- Part C: a member of a client org linked to the workspace notifying
        -- that workspace's lead contractor (new-message notifications). The
        -- link is checked against the NEW row's workspace_id so a member can
        -- only notify the lead of a contract their org is actually client on.
        select 1 from contract_clients cc
        join client_org_members m on m.org_id = cc.client_org_id
        where cc.contract_workspaces_id = notifications.workspace_id
          and cc.lead_contractor_id = notifications.user_id
          and m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
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
  // --- messages: client<->lead contract threads. Read/write for the linked
  // client org (clientMember, acyclic via client_org_members) and the
  // workspace lead (denormalized lead_contractor_id); sb_admin sees all.
  // Inserts additionally require the row's client_org_id to be genuinely
  // linked to its workspace (clientLinked) — RLS is the final gate on top of
  // the server-side assertClientWorkspace check. Messages are immutable.
  `drop policy if exists messages_select on messages`,
  `create policy messages_select on messages for select using (
    ${IS_ADMIN}
    or messages.lead_contractor_id = ${UID}
    or ${clientMember("messages")}
  )`,
  `drop policy if exists messages_insert on messages`,
  `create policy messages_insert on messages for insert with check (
    ${IS_ADMIN}
    or messages.lead_contractor_id = ${UID}
    or (${clientMember("messages")} and ${clientLinked("messages")})
  )`,
  // --- message_reads: per-user read watermarks. Only the owning user (or an
  // admin) sees/updates their own watermark.
  `drop policy if exists message_reads_select on message_reads`,
  `create policy message_reads_select on message_reads for select using (
    message_reads.user_id = ${UID} or ${IS_ADMIN}
  )`,
  `drop policy if exists message_reads_insert on message_reads`,
  `create policy message_reads_insert on message_reads for insert with check (
    message_reads.user_id = ${UID} or ${IS_ADMIN}
  )`,
  `drop policy if exists message_reads_update on message_reads`,
  `create policy message_reads_update on message_reads for update using (
    message_reads.user_id = ${UID} or ${IS_ADMIN}
  ) with check (
    message_reads.user_id = ${UID} or ${IS_ADMIN}
  )`,
  // --- workspace_messages: workspace participant thread. Read/write for the
  // workspace lead and anyone with an invited/joined/verified invitation in
  // that workspace; sb_admin sees all. Messages are immutable. Policy edges:
  // workspace_messages -> contract_workspaces and -> invitations, both
  // acyclic (neither references workspace_messages).
  `drop policy if exists workspace_messages_select on workspace_messages`,
  `create policy workspace_messages_select on workspace_messages for select using (
    ${IS_ADMIN}
    or exists (
      select 1 from contract_workspaces cw
      where cw.id = workspace_messages.workspace_id
        and cw.lead_contractor_id = ${UID}
    )
    or exists (
      select 1 from invitations i
      where i.workspace_id = workspace_messages.workspace_id
        and i.status in ('invited','joined','verified')
        and lower(i.email) = (
          select lower(u.email) from users u where u.id = ${UID}
        )
    )
  )`,
  `drop policy if exists workspace_messages_insert on workspace_messages`,
  `create policy workspace_messages_insert on workspace_messages for insert with check (
    ${IS_ADMIN}
    or exists (
      select 1 from contract_workspaces cw
      where cw.id = workspace_messages.workspace_id
        and cw.lead_contractor_id = ${UID}
    )
    or exists (
      select 1 from invitations i
      where i.workspace_id = workspace_messages.workspace_id
        and i.status in ('invited','joined','verified')
        and lower(i.email) = (
          select lower(u.email) from users u where u.id = ${UID}
        )
    )
  )`,
  // --- workspace_message_reads: per-user read watermarks (self-only, mirrors
  // message_reads).
  `drop policy if exists workspace_message_reads_select on workspace_message_reads`,
  `create policy workspace_message_reads_select on workspace_message_reads for select using (
    workspace_message_reads.user_id = ${UID} or ${IS_ADMIN}
  )`,
  `drop policy if exists workspace_message_reads_insert on workspace_message_reads`,
  `create policy workspace_message_reads_insert on workspace_message_reads for insert with check (
    workspace_message_reads.user_id = ${UID} or ${IS_ADMIN}
  )`,
  `drop policy if exists workspace_message_reads_update on workspace_message_reads`,
  `create policy workspace_message_reads_update on workspace_message_reads for update using (
    workspace_message_reads.user_id = ${UID} or ${IS_ADMIN}
  ) with check (
    workspace_message_reads.user_id = ${UID} or ${IS_ADMIN}
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

  // --- company_notes: internal staff notes — admins only (never visible to
  // companies/clients). Author is fixed at insert; body is editable.
  `drop policy if exists company_notes_select on company_notes`,
  `create policy company_notes_select on company_notes for select using (${IS_ADMIN})`,
  `drop policy if exists company_notes_insert on company_notes`,
  `create policy company_notes_insert on company_notes for insert with check (${IS_ADMIN})`,
  `drop policy if exists company_notes_update on company_notes`,
  `create policy company_notes_update on company_notes for update using (${IS_ADMIN}) with check (${IS_ADMIN})`,
  `drop policy if exists company_notes_delete on company_notes`,
  `create policy company_notes_delete on company_notes for delete using (${IS_ADMIN})`,
  // --- catalogue tables: internal ScaleBridge data — admins only (mirrors
  // company_notes). service_categories / services / company_services /
  // service_evidence are never visible to companies or clients at the RLS
  // layer; the server decides what (if anything) later phases expose to
  // lead contractors (e.g. the participating-businesses directory).
  `drop policy if exists service_categories_select on service_categories`,
  `create policy service_categories_select on service_categories for select using (${IS_ADMIN})`,
  // Public landing page (plan item: refreshed landing site): the partner
  // directory reads the live catalogue. Category names/descriptions are public
  // marketing data; only services with a human-approved public status
  // ('Listed' / 'Verified') are exposed. Admin sessions keep the unrestricted
  // IS_ADMIN policy above (policies OR together), so admins still see every
  // row. The landing server fn runs as the scalebridge_app connection role
  // with no app.user_id / app.role context — hence `to scalebridge_app`.
  `drop policy if exists service_categories_select_public on service_categories`,
  `create policy service_categories_select_public on service_categories
     for select to scalebridge_app using (true)`,
  `drop policy if exists services_select_public on services`,
  `create policy services_select_public on services
     for select to scalebridge_app using (status in ('Listed', 'Verified'))`,
  `drop policy if exists service_categories_insert on service_categories`,
  `create policy service_categories_insert on service_categories for insert with check (${IS_ADMIN})`,
  `drop policy if exists service_categories_update on service_categories`,
  `create policy service_categories_update on service_categories for update using (${IS_ADMIN}) with check (${IS_ADMIN})`,
  `drop policy if exists service_categories_delete on service_categories`,
  `create policy service_categories_delete on service_categories for delete using (${IS_ADMIN})`,
  `drop policy if exists services_select on services`,
  `create policy services_select on services for select using (${IS_ADMIN})`,
  `drop policy if exists services_insert on services`,
  `create policy services_insert on services for insert with check (${IS_ADMIN})`,
  `drop policy if exists services_update on services`,
  `create policy services_update on services for update using (${IS_ADMIN}) with check (${IS_ADMIN})`,
  `drop policy if exists services_delete on services`,
  `create policy services_delete on services for delete using (${IS_ADMIN})`,
  `drop policy if exists company_services_select on company_services`,
  `create policy company_services_select on company_services for select using (${IS_ADMIN})`,
  `drop policy if exists company_services_insert on company_services`,
  `create policy company_services_insert on company_services for insert with check (${IS_ADMIN})`,
  `drop policy if exists company_services_update on company_services`,
  `create policy company_services_update on company_services for update using (${IS_ADMIN}) with check (${IS_ADMIN})`,
  `drop policy if exists company_services_delete on company_services`,
  `create policy company_services_delete on company_services for delete using (${IS_ADMIN})`,
  `drop policy if exists service_evidence_select on service_evidence`,
  `create policy service_evidence_select on service_evidence for select using (${IS_ADMIN})`,
  `drop policy if exists service_evidence_insert on service_evidence`,
  `create policy service_evidence_insert on service_evidence for insert with check (${IS_ADMIN})`,
  `drop policy if exists service_evidence_update on service_evidence`,
  `create policy service_evidence_update on service_evidence for update using (${IS_ADMIN}) with check (${IS_ADMIN})`,
  `drop policy if exists service_evidence_delete on service_evidence`,
  `create policy service_evidence_delete on service_evidence for delete using (${IS_ADMIN})`,
  // --- AI agent tables: internal ScaleBridge data — admins only (mirrors
  // company_notes / catalogue). ai_agent_runs / ai_recommendations /
  // upsell_opportunities / ai_data_source_permissions /
  // company_ai_preferences / ai_audit_events are never visible to companies
  // or clients at the RLS layer; the server decides what later phases expose.
  `drop policy if exists ai_agent_runs_select on ai_agent_runs`,
  `create policy ai_agent_runs_select on ai_agent_runs for select using (${IS_ADMIN})`,
  `drop policy if exists ai_agent_runs_insert on ai_agent_runs`,
  `create policy ai_agent_runs_insert on ai_agent_runs for insert with check (${IS_ADMIN})`,
  `drop policy if exists ai_agent_runs_update on ai_agent_runs`,
  `create policy ai_agent_runs_update on ai_agent_runs for update using (${IS_ADMIN}) with check (${IS_ADMIN})`,
  `drop policy if exists ai_agent_runs_delete on ai_agent_runs`,
  `create policy ai_agent_runs_delete on ai_agent_runs for delete using (${IS_ADMIN})`,
  `drop policy if exists ai_recommendations_select on ai_recommendations`,
  `create policy ai_recommendations_select on ai_recommendations for select using (${IS_ADMIN})`,
  `drop policy if exists ai_recommendations_insert on ai_recommendations`,
  `create policy ai_recommendations_insert on ai_recommendations for insert with check (${IS_ADMIN})`,
  `drop policy if exists ai_recommendations_update on ai_recommendations`,
  `create policy ai_recommendations_update on ai_recommendations for update using (${IS_ADMIN}) with check (${IS_ADMIN})`,
  `drop policy if exists ai_recommendations_delete on ai_recommendations`,
  `create policy ai_recommendations_delete on ai_recommendations for delete using (${IS_ADMIN})`,
  `drop policy if exists upsell_opportunities_select on upsell_opportunities`,
  `create policy upsell_opportunities_select on upsell_opportunities for select using (${IS_ADMIN})`,
  `drop policy if exists upsell_opportunities_insert on upsell_opportunities`,
  `create policy upsell_opportunities_insert on upsell_opportunities for insert with check (${IS_ADMIN})`,
  `drop policy if exists upsell_opportunities_update on upsell_opportunities`,
  `create policy upsell_opportunities_update on upsell_opportunities for update using (${IS_ADMIN}) with check (${IS_ADMIN})`,
  `drop policy if exists upsell_opportunities_delete on upsell_opportunities`,
  `create policy upsell_opportunities_delete on upsell_opportunities for delete using (${IS_ADMIN})`,
  `drop policy if exists ai_data_source_permissions_select on ai_data_source_permissions`,
  `create policy ai_data_source_permissions_select on ai_data_source_permissions for select using (${IS_ADMIN})`,
  `drop policy if exists ai_data_source_permissions_insert on ai_data_source_permissions`,
  `create policy ai_data_source_permissions_insert on ai_data_source_permissions for insert with check (${IS_ADMIN})`,
  `drop policy if exists ai_data_source_permissions_update on ai_data_source_permissions`,
  `create policy ai_data_source_permissions_update on ai_data_source_permissions for update using (${IS_ADMIN}) with check (${IS_ADMIN})`,
  `drop policy if exists ai_data_source_permissions_delete on ai_data_source_permissions`,
  `create policy ai_data_source_permissions_delete on ai_data_source_permissions for delete using (${IS_ADMIN})`,
  `drop policy if exists company_ai_preferences_select on company_ai_preferences`,
  `create policy company_ai_preferences_select on company_ai_preferences for select using (${IS_ADMIN})`,
  `drop policy if exists company_ai_preferences_insert on company_ai_preferences`,
  `create policy company_ai_preferences_insert on company_ai_preferences for insert with check (${IS_ADMIN})`,
  `drop policy if exists company_ai_preferences_update on company_ai_preferences`,
  `create policy company_ai_preferences_update on company_ai_preferences for update using (${IS_ADMIN}) with check (${IS_ADMIN})`,
  `drop policy if exists company_ai_preferences_delete on company_ai_preferences`,
  `create policy company_ai_preferences_delete on company_ai_preferences for delete using (${IS_ADMIN})`,
  `drop policy if exists ai_audit_events_select on ai_audit_events`,
  `create policy ai_audit_events_select on ai_audit_events for select using (${IS_ADMIN})`,
  `drop policy if exists ai_audit_events_insert on ai_audit_events`,
  `create policy ai_audit_events_insert on ai_audit_events for insert with check (${IS_ADMIN})`,
  `drop policy if exists ai_audit_events_update on ai_audit_events`,
  `create policy ai_audit_events_update on ai_audit_events for update using (${IS_ADMIN}) with check (${IS_ADMIN})`,
  `drop policy if exists ai_audit_events_delete on ai_audit_events`,
  `create policy ai_audit_events_delete on ai_audit_events for delete using (${IS_ADMIN})`,
  `drop policy if exists ai_data_source_registry_select on ai_data_source_registry`,
  `create policy ai_data_source_registry_select on ai_data_source_registry for select using (${IS_ADMIN})`,
  `drop policy if exists ai_data_source_registry_insert on ai_data_source_registry`,
  `create policy ai_data_source_registry_insert on ai_data_source_registry for insert with check (${IS_ADMIN})`,
  `drop policy if exists ai_data_source_registry_update on ai_data_source_registry`,
  `create policy ai_data_source_registry_update on ai_data_source_registry for update using (${IS_ADMIN}) with check (${IS_ADMIN})`,
  `drop policy if exists ai_data_source_registry_delete on ai_data_source_registry`,
  `create policy ai_data_source_registry_delete on ai_data_source_registry for delete using (${IS_ADMIN})`,
  // ai_control_settings: single-row engine config; sb_admin only.
  `drop policy if exists ai_control_settings_select on ai_control_settings`,
  `create policy ai_control_settings_select on ai_control_settings for select using (${IS_ADMIN})`,
  `drop policy if exists ai_control_settings_insert on ai_control_settings`,
  `create policy ai_control_settings_insert on ai_control_settings for insert with check (${IS_ADMIN})`,
  `drop policy if exists ai_control_settings_update on ai_control_settings`,
  `create policy ai_control_settings_update on ai_control_settings for update using (${IS_ADMIN}) with check (${IS_ADMIN})`,
  `drop policy if exists ai_control_settings_delete on ai_control_settings`,
  `create policy ai_control_settings_delete on ai_control_settings for delete using (${IS_ADMIN})`,
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

  // ------------------------------------------------------------------
  // Client Portal Part B (idempotent) — the delivery tables (milestones,
  // issues, variations, invoices, progress_reports, documents) already exist
  // with the client-scoped RLS policies above (SELECT for members of the row's
  // client_org; UPDATE for client_admin/client_pm/(client_finance|client_reviewer)
  // when the org is live-linked via contract_clients). Part B therefore only
  // EXTENDS the tables with the client-workflow columns + status values the
  // Client Portal needs (review/decision metadata, client-facing statuses) and
  // adds matching indexes. No new tables, no new policies — duplicating the
  // tables would orphan the Part A client dashboard/contract queries.
  // ------------------------------------------------------------------

  // --- documents (contract docs): client-visible lifecycle + sharing meta.
  `alter table documents add column if not exists file_name text`,
  `alter table documents add column if not exists shared_at timestamptz`,
  // documents predates the client portal and has no created_at/updated_at;
  // add them so client lists can sort/display consistently with the other
  // delivery tables (legacy rows default to now()).
  `alter table documents add column if not exists created_at timestamptz not null default now()`,
  `alter table documents add column if not exists updated_at timestamptz not null default now()`,
  // Client-facing lifecycle (distinct from documents.review_status, which is
  // the ScaleBridge admin compliance review). Legacy rows default 'published'.
  `alter table documents add column if not exists status text not null default 'published'`,
  `alter table documents drop constraint if exists documents_status_check`,
  `alter table documents add constraint documents_status_check check (
    status in ('draft','published','under_review','approved','needs_changes')
  )`,

  // --- milestones: client review workflow (submitted_at / reviewed_at/by).
  `alter table milestones add column if not exists submitted_at timestamptz`,
  `alter table milestones add column if not exists reviewed_at timestamptz`,
  `alter table milestones add column if not exists reviewed_by uuid references users(id) on delete set null`,
  // Client-facing statuses added alongside the legacy lead-portal ones.
  `alter table milestones drop constraint if exists milestones_status_check`,
  `alter table milestones add constraint milestones_status_check check (
    status in ('upcoming','in_progress','submitted_for_review','approved','rejected','requires_clarification','delayed','completed','planned','submitted','needs_changes')
  )`,

  // --- issues: client response channel (response text + who/when) + raiser.
  `alter table issues add column if not exists response text`,
  `alter table issues add column if not exists responded_at timestamptz`,
  `alter table issues add column if not exists responded_by uuid references users(id) on delete set null`,
  `alter table issues add column if not exists raised_by uuid references users(id) on delete set null`,
  `alter table issues drop constraint if exists issues_status_check`,
  `alter table issues add constraint issues_status_check check (
    status in ('open','under_review','action_required','waiting_client','waiting_contractor','resolved','closed','responded')
  )`,

  // --- variations: client decision workflow (amount in cents, conditions,
  // decision metadata). Client-facing statuses added alongside the legacy ones.
  `alter table variations add column if not exists work_package_id uuid references work_packages(id) on delete set null`,
  `alter table variations add column if not exists proposed_amount_cents bigint`,
  `alter table variations add column if not exists conditions text`,
  `alter table variations add column if not exists decided_at timestamptz`,
  `alter table variations add column if not exists decided_by uuid references users(id) on delete set null`,
  `alter table variations drop constraint if exists variations_status_check`,
  `alter table variations add constraint variations_status_check check (
    status in ('draft','submitted','under_client_review','clarification_requested','approved','rejected','approved_with_conditions','implemented','proposed','under_review','clarification_needed','conditions')
  )`,

  // --- invoices: client finance workflow (cents, currency, due/paid dates,
  // review notes + reviewer, issuing supplier company).
  `alter table invoices add column if not exists amount_cents bigint`,
  `alter table invoices add column if not exists currency text not null default 'GBP'`,
  `alter table invoices add column if not exists due_date date`,
  `alter table invoices add column if not exists paid_at timestamptz`,
  `alter table invoices add column if not exists review_notes text`,
  `alter table invoices add column if not exists reviewed_at timestamptz`,
  `alter table invoices add column if not exists reviewed_by uuid references users(id) on delete set null`,
  `alter table invoices add column if not exists supplier_company_id uuid references companies(id) on delete set null`,
  `alter table invoices drop constraint if exists invoices_status_check`,
  `alter table invoices add constraint invoices_status_check check (
    status in ('draft','submitted','under_review','approved','rejected','correction_required','scheduled_for_payment','paid','overdue','cancelled','corrections_requested')
  )`,

  // --- progress_reports: client-facing title / period / body (+ optional
  // milestone link). The lead-side rich fields (reporting_period,
  // overall_progress, work_package_progress, …) remain untouched.
  `alter table progress_reports add column if not exists milestone_id uuid references milestones(id) on delete set null`,
  `alter table progress_reports add column if not exists title text`,
  `alter table progress_reports add column if not exists period_start date`,
  `alter table progress_reports add column if not exists period_end date`,
  `alter table progress_reports add column if not exists body text`,

  // Part B indexes (idempotent).
  `create index if not exists documents_status_idx on documents (status)`,
  `create index if not exists milestones_submitted_at_idx on milestones (submitted_at)`,
  `create index if not exists issues_raised_by_idx on issues (raised_by)`,
  `create index if not exists variations_decided_at_idx on variations (decided_at)`,
  `create index if not exists invoices_due_date_idx on invoices (due_date)`,
  `create index if not exists invoices_supplier_company_idx on invoices (supplier_company_id)`,
  `create index if not exists progress_reports_milestone_id_idx on progress_reports (milestone_id)`,
  `create index if not exists company_notes_company_idx on company_notes (company_id, created_at desc)`,
  // Catalogue indexes (plan item 2).
  `create index if not exists services_category_idx on services (category_id)`,
  `create index if not exists services_status_idx on services (status)`,
  `create index if not exists company_services_company_idx on company_services (company_id)`,
  `create index if not exists company_services_service_idx on company_services (service_id)`,
  `create index if not exists service_evidence_company_service_idx on service_evidence (company_service_id)`,
  // AI agent indexes (plan item 5).
  `create index if not exists ai_agent_runs_company_idx on ai_agent_runs (company_id)`,
  `create index if not exists ai_agent_runs_status_idx on ai_agent_runs (status)`,
  `create index if not exists ai_recommendations_company_idx on ai_recommendations (company_id)`,
  `create index if not exists ai_recommendations_status_idx on ai_recommendations (status)`,
  `create index if not exists upsell_opportunities_company_idx on upsell_opportunities (company_id)`,
  `create index if not exists upsell_opportunities_status_idx on upsell_opportunities (status)`,
  `create index if not exists ai_audit_events_run_idx on ai_audit_events (run_id)`,
  `create index if not exists ai_audit_events_created_idx on ai_audit_events (created_at desc)`,

  // ==================================================================
  // Subscription & membership system (owner CTO spec 2026-08-12).
  // Plan-based feature entitlements (never hardcode plan names in feature
  // checks); billing-provider webhooks are the source of truth for payment
  // and subscription-state changes. RLS: the owning customer
  // (customers.user_id = app.user_id) and sb_admin can access subscription
  // data; a PUBLIC policy exposes only Active plans to the pricing window
  // (listPublishedPlans). All policy subquery chains below are acyclic:
  // X -> subscriptions -> customers -> (users — no RLS).
  // ------------------------------------------------------------------
  `create table if not exists membership_plans (
    id uuid primary key default gen_random_uuid(),
    code text not null unique,
    name text not null,
    description text,
    category text not null default 'partner' check (category in ('partner','anchor')),
    price_monthly_ael numeric(12,2),
    price_annual_ael numeric(12,2),
    billing_intervals text[] not null default array['monthly','annual'],
    sort_order int not null default 100,
    status text not null default 'Active' check (status in ('Active','Archived')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  `create table if not exists plan_entitlements (
    id uuid primary key default gen_random_uuid(),
    plan_id uuid not null references membership_plans(id) on delete cascade,
    entitlement_key text not null,
    value jsonb not null default '{"enabled":true}'::jsonb,
    created_at timestamptz not null default now(),
    unique (plan_id, entitlement_key)
  )`,
  `create table if not exists plan_features (
    id uuid primary key default gen_random_uuid(),
    plan_id uuid not null references membership_plans(id) on delete cascade,
    feature text not null,
    sort_order int not null default 0,
    created_at timestamptz not null default now(),
    unique (plan_id, feature)
  )`,
  `create table if not exists customers (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id) on delete cascade,
    company_id uuid references companies(id) on delete set null,
    provider_customer_id text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, company_id)
  )`,
  `create table if not exists subscriptions (
    id uuid primary key default gen_random_uuid(),
    customer_id uuid not null references customers(id) on delete cascade,
    plan_id uuid references membership_plans(id) on delete set null,
    provider_subscription_id text,
    status text not null default 'pending_plan_selection'
      check (status in ('pending_plan_selection','checkout_started','payment_pending','active','past_due','payment_failed','upgrade_pending','downgrade_scheduled','cancellation_requested','cancel_at_period_end','cancelled','expired','suspended')),
    billing_interval text not null default 'monthly' check (billing_interval in ('monthly','annual')),
    current_period_start timestamptz,
    current_period_end timestamptz,
    next_billing_date timestamptz,
    started_at timestamptz,
    cancelled_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  `create table if not exists subscription_items (
    id uuid primary key default gen_random_uuid(),
    subscription_id uuid not null references subscriptions(id) on delete cascade,
    plan_id uuid not null references membership_plans(id) on delete set null,
    quantity int not null default 1,
    unit_amount numeric(12,2) not null default 0,
    billing_interval text not null default 'monthly' check (billing_interval in ('monthly','annual')),
    created_at timestamptz not null default now()
  )`,
  `create table if not exists billing_cycles (
    id uuid primary key default gen_random_uuid(),
    subscription_id uuid not null references subscriptions(id) on delete cascade,
    cycle_number int not null,
    period_start timestamptz not null,
    period_end timestamptz not null,
    status text not null default 'Pending' check (status in ('Pending','Paid','Failed','Voided')),
    amount_ael numeric(12,2) not null default 0,
    paid_at timestamptz,
    created_at timestamptz not null default now(),
    unique (subscription_id, cycle_number)
  )`,
  `create table if not exists minimum_commitments (
    id uuid primary key default gen_random_uuid(),
    subscription_id uuid not null references subscriptions(id) on delete cascade,
    commitment_start_date timestamptz not null,
    commitment_end_date timestamptz not null,
    cycles_required int not null default 3,
    completed boolean not null default false,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    unique (subscription_id, commitment_start_date)
  )`,
  `create table if not exists upgrade_requests (
    id uuid primary key default gen_random_uuid(),
    subscription_id uuid not null references subscriptions(id) on delete cascade,
    from_plan_id uuid references membership_plans(id) on delete set null,
    to_plan_id uuid not null references membership_plans(id) on delete cascade,
    requested_by uuid references users(id) on delete set null,
    status text not null default 'Pending' check (status in ('Pending','Confirmed','Completed','Rejected')),
    requested_at timestamptz not null default now(),
    effective_date timestamptz,
    proration_amount_ael numeric(12,2),
    reason text,
    resolution_notes text,
    processed_at timestamptz
  )`,
  `create table if not exists downgrade_requests (
    id uuid primary key default gen_random_uuid(),
    subscription_id uuid not null references subscriptions(id) on delete cascade,
    from_plan_id uuid references membership_plans(id) on delete set null,
    to_plan_id uuid not null references membership_plans(id) on delete cascade,
    requested_by uuid references users(id) on delete set null,
    status text not null default 'Pending' check (status in ('Pending','Confirmed','Completed','Rejected')),
    requested_at timestamptz not null default now(),
    effective_date timestamptz,
    proration_amount_ael numeric(12,2),
    reason text,
    resolution_notes text,
    processed_at timestamptz
  )`,
  `create table if not exists cancellation_requests (
    id uuid primary key default gen_random_uuid(),
    subscription_id uuid not null references subscriptions(id) on delete cascade,
    requested_by uuid references users(id) on delete set null,
    status text not null default 'Pending' check (status in ('Pending','Confirmed','Completed','Rejected')),
    requested_at timestamptz not null default now(),
    effective_date timestamptz,
    mode text not null default 'end_of_period' check (mode in ('end_of_period','immediate')),
    reason text,
    resolution_notes text,
    processed_at timestamptz
  )`,
  `create table if not exists payment_methods (
    id uuid primary key default gen_random_uuid(),
    customer_id uuid not null references customers(id) on delete cascade,
    provider_payment_method_id text,
    type text not null default 'card',
    last4 text,
    brand text,
    expiry text,
    is_default boolean not null default false,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists subscription_invoices (
    id uuid primary key default gen_random_uuid(),
    customer_id uuid not null references customers(id) on delete cascade,
    subscription_id uuid references subscriptions(id) on delete set null,
    invoice_number text not null unique,
    amount_ael numeric(12,2) not null default 0,
    tax_ael numeric(12,2) not null default 0,
    total_ael numeric(12,2) not null default 0,
    status text not null default 'Draft' check (status in ('Draft','Open','Paid','Failed','Voided')),
    billing_period_start timestamptz,
    billing_period_end timestamptz,
    due_date timestamptz,
    paid_at timestamptz,
    provider_invoice_id text,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists payment_events (
    id uuid primary key default gen_random_uuid(),
    invoice_id uuid references subscription_invoices(id) on delete cascade,
    event_type text not null check (event_type in ('payment_succeeded','payment_failed','refunded')),
    amount_ael numeric(12,2),
    provider_event_id text,
    occurred_at timestamptz not null default now(),
    raw jsonb
  )`,
  `create table if not exists billing_provider_webhook_events (
    id uuid primary key default gen_random_uuid(),
    provider text not null,
    event_type text not null,
    event_id text not null unique,
    payload jsonb not null,
    received_at timestamptz not null default now(),
    processed boolean not null default false,
    processed_at timestamptz,
    processing_error text
  )`,
  `create table if not exists subscription_history (
    id uuid primary key default gen_random_uuid(),
    subscription_id uuid not null references subscriptions(id) on delete cascade,
    user_id uuid references users(id) on delete set null,
    previous_plan_id uuid references membership_plans(id) on delete set null,
    new_plan_id uuid references membership_plans(id) on delete set null,
    change_type text not null
      check (change_type in ('created','upgraded','downgraded','cancelled','resumed','expired','suspended','plan_changed')),
    effective_date timestamptz not null default now(),
    billing_amount_ael numeric(12,2),
    proration_amount_ael numeric(12,2),
    min_commitment_end_date timestamptz,
    payment_status text,
    confirmation_status text,
    source_event text,
    details jsonb,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists feature_access_records (
    id uuid primary key default gen_random_uuid(),
    company_id uuid references companies(id) on delete cascade,
    subscription_id uuid not null references subscriptions(id) on delete cascade,
    entitlement_key text not null,
    granted boolean not null default true,
    effective_from timestamptz not null default now(),
    effective_to timestamptz,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists entitlement_audit_logs (
    id uuid primary key default gen_random_uuid(),
    company_id uuid references companies(id) on delete cascade,
    subscription_id uuid not null references subscriptions(id) on delete cascade,
    actor_user_id uuid references users(id) on delete set null,
    action text not null check (action in ('granted','revoked','changed')),
    entitlement_key text not null,
    previous_value jsonb,
    new_value jsonb,
    reason text,
    created_at timestamptz not null default now()
  )`,
  // --- subscriptions RLS: owner (via customers.user_id) or sb_admin. The
  // customer subquery is acyclic (customers policies reference only users).
  `alter table membership_plans enable row level security`,
  `alter table membership_plans force row level security`,
  `alter table plan_entitlements enable row level security`,
  `alter table plan_entitlements force row level security`,
  `alter table plan_features enable row level security`,
  `alter table plan_features force row level security`,
  `alter table customers enable row level security`,
  `alter table customers force row level security`,
  `alter table subscriptions enable row level security`,
  `alter table subscriptions force row level security`,
  `alter table subscription_items enable row level security`,
  `alter table subscription_items force row level security`,
  `alter table billing_cycles enable row level security`,
  `alter table billing_cycles force row level security`,
  `alter table minimum_commitments enable row level security`,
  `alter table minimum_commitments force row level security`,
  `alter table upgrade_requests enable row level security`,
  `alter table upgrade_requests force row level security`,
  `alter table downgrade_requests enable row level security`,
  `alter table downgrade_requests force row level security`,
  `alter table cancellation_requests enable row level security`,
  `alter table cancellation_requests force row level security`,
  `alter table payment_methods enable row level security`,
  `alter table payment_methods force row level security`,
  `alter table subscription_invoices enable row level security`,
  `alter table subscription_invoices force row level security`,
  `alter table payment_events enable row level security`,
  `alter table payment_events force row level security`,
  `alter table billing_provider_webhook_events enable row level security`,
  `alter table billing_provider_webhook_events force row level security`,
  `alter table subscription_history enable row level security`,
  `alter table subscription_history force row level security`,
  `alter table feature_access_records enable row level security`,
  `alter table feature_access_records force row level security`,
  `alter table entitlement_audit_logs enable row level security`,
  `alter table entitlement_audit_logs force row level security`,
  // --- membership_plans: pricing window reads Active plans publicly (the
  // app connects as scalebridge_app); admins manage the full catalogue.
  `drop policy if exists membership_plans_select_public on membership_plans`,
  `create policy membership_plans_select_public on membership_plans
     for select to scalebridge_app using (status = 'Active')`,
  `drop policy if exists membership_plans_select on membership_plans`,
  `create policy membership_plans_select on membership_plans for select using (${IS_ADMIN})`,
  `drop policy if exists membership_plans_insert on membership_plans`,
  `create policy membership_plans_insert on membership_plans for insert with check (${IS_ADMIN})`,
  `drop policy if exists membership_plans_update on membership_plans`,
  `create policy membership_plans_update on membership_plans for update using (${IS_ADMIN}) with check (${IS_ADMIN})`,
  `drop policy if exists membership_plans_delete on membership_plans`,
  `create policy membership_plans_delete on membership_plans for delete using (${IS_ADMIN})`,
  // --- plan_entitlements / plan_features: reference data shown on pricing
  // cards — public read; admins manage.
  `drop policy if exists plan_entitlements_select_public on plan_entitlements`,
  `create policy plan_entitlements_select_public on plan_entitlements
     for select to scalebridge_app using (true)`,
  `drop policy if exists plan_entitlements_select on plan_entitlements`,
  `create policy plan_entitlements_select on plan_entitlements for select using (${IS_ADMIN})`,
  `drop policy if exists plan_entitlements_insert on plan_entitlements`,
  `create policy plan_entitlements_insert on plan_entitlements for insert with check (${IS_ADMIN})`,
  `drop policy if exists plan_entitlements_update on plan_entitlements`,
  `create policy plan_entitlements_update on plan_entitlements for update using (${IS_ADMIN}) with check (${IS_ADMIN})`,
  `drop policy if exists plan_entitlements_delete on plan_entitlements`,
  `create policy plan_entitlements_delete on plan_entitlements for delete using (${IS_ADMIN})`,
  `drop policy if exists plan_features_select_public on plan_features`,
  `create policy plan_features_select_public on plan_features
     for select to scalebridge_app using (true)`,
  `drop policy if exists plan_features_select on plan_features`,
  `create policy plan_features_select on plan_features for select using (${IS_ADMIN})`,
  `drop policy if exists plan_features_insert on plan_features`,
  `create policy plan_features_insert on plan_features for insert with check (${IS_ADMIN})`,
  `drop policy if exists plan_features_update on plan_features`,
  `create policy plan_features_update on plan_features for update using (${IS_ADMIN}) with check (${IS_ADMIN})`,
  `drop policy if exists plan_features_delete on plan_features`,
  `create policy plan_features_delete on plan_features for delete using (${IS_ADMIN})`,
  // --- customers: the owning user (or sb_admin) only. A user may only
  // create a customer row for themselves.
  `drop policy if exists customers_select on customers`,
  `create policy customers_select on customers for select using (
    user_id = ${UID} or ${IS_ADMIN}
  )`,
  `drop policy if exists customers_insert on customers`,
  `create policy customers_insert on customers for insert with check (
    user_id = ${UID} or ${IS_ADMIN}
  )`,
  `drop policy if exists customers_update on customers`,
  `create policy customers_update on customers for update using (
    user_id = ${UID} or ${IS_ADMIN}
  ) with check (
    user_id = ${UID} or ${IS_ADMIN}
  )`,
  `drop policy if exists customers_delete on customers`,
  `create policy customers_delete on customers for delete using (
    user_id = ${UID} or ${IS_ADMIN}
  )`,
  // --- subscriptions: owner via customers.user_id, or sb_admin.
  `drop policy if exists subscriptions_select on subscriptions`,
  `create policy subscriptions_select on subscriptions for select using (
    exists (select 1 from customers c where c.id = subscriptions.customer_id and c.user_id = ${UID})
    or ${IS_ADMIN}
  )`,
  `drop policy if exists subscriptions_insert on subscriptions`,
  `create policy subscriptions_insert on subscriptions for insert with check (
    exists (select 1 from customers c where c.id = subscriptions.customer_id and c.user_id = ${UID})
    or ${IS_ADMIN}
  )`,
  `drop policy if exists subscriptions_update on subscriptions`,
  `create policy subscriptions_update on subscriptions for update using (
    exists (select 1 from customers c where c.id = subscriptions.customer_id and c.user_id = ${UID})
    or ${IS_ADMIN}
  ) with check (
    exists (select 1 from customers c where c.id = subscriptions.customer_id and c.user_id = ${UID})
    or ${IS_ADMIN}
  )`,
  `drop policy if exists subscriptions_delete on subscriptions`,
  `create policy subscriptions_delete on subscriptions for delete using (
    exists (select 1 from customers c where c.id = subscriptions.customer_id and c.user_id = ${UID})
    or ${IS_ADMIN}
  )`,
  // --- child rows scoped via their subscription (acyclic chain: child ->
  // subscriptions -> customers -> users).
  `drop policy if exists subscription_items_select on subscription_items`,
  `create policy subscription_items_select on subscription_items for select using (
    exists (select 1 from subscriptions s where s.id = subscription_items.subscription_id
      and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = ${UID}))
    or ${IS_ADMIN}
  )`,
  `drop policy if exists subscription_items_insert on subscription_items`,
  `create policy subscription_items_insert on subscription_items for insert with check (
    exists (select 1 from subscriptions s where s.id = subscription_items.subscription_id
      and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = ${UID}))
    or ${IS_ADMIN}
  )`,
  `drop policy if exists subscription_items_update on subscription_items`,
  `create policy subscription_items_update on subscription_items for update using (
    exists (select 1 from subscriptions s where s.id = subscription_items.subscription_id
      and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = ${UID}))
    or ${IS_ADMIN}
  ) with check (
    exists (select 1 from subscriptions s where s.id = subscription_items.subscription_id
      and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = ${UID}))
    or ${IS_ADMIN}
  )`,
  `drop policy if exists subscription_items_delete on subscription_items`,
  `create policy subscription_items_delete on subscription_items for delete using (
    exists (select 1 from subscriptions s where s.id = subscription_items.subscription_id
      and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = ${UID}))
    or ${IS_ADMIN}
  )`,
  `drop policy if exists billing_cycles_select on billing_cycles`,
  `create policy billing_cycles_select on billing_cycles for select using (
    exists (select 1 from subscriptions s where s.id = billing_cycles.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists billing_cycles_insert on billing_cycles`,
  `create policy billing_cycles_insert on billing_cycles for insert with check (
    exists (select 1 from subscriptions s where s.id = billing_cycles.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists billing_cycles_update on billing_cycles`,
  `create policy billing_cycles_update on billing_cycles for update using (
    exists (select 1 from subscriptions s where s.id = billing_cycles.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  ) with check (
    exists (select 1 from subscriptions s where s.id = billing_cycles.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists billing_cycles_delete on billing_cycles`,
  `create policy billing_cycles_delete on billing_cycles for delete using (
    exists (select 1 from subscriptions s where s.id = billing_cycles.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists minimum_commitments_select on minimum_commitments`,
  `create policy minimum_commitments_select on minimum_commitments for select using (
    exists (select 1 from subscriptions s where s.id = minimum_commitments.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists minimum_commitments_insert on minimum_commitments`,
  `create policy minimum_commitments_insert on minimum_commitments for insert with check (
    exists (select 1 from subscriptions s where s.id = minimum_commitments.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists minimum_commitments_update on minimum_commitments`,
  `create policy minimum_commitments_update on minimum_commitments for update using (
    exists (select 1 from subscriptions s where s.id = minimum_commitments.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  ) with check (
    exists (select 1 from subscriptions s where s.id = minimum_commitments.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists minimum_commitments_delete on minimum_commitments`,
  `create policy minimum_commitments_delete on minimum_commitments for delete using (
    exists (select 1 from subscriptions s where s.id = minimum_commitments.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists upgrade_requests_select on upgrade_requests`,
  `create policy upgrade_requests_select on upgrade_requests for select using (
    exists (select 1 from subscriptions s where s.id = upgrade_requests.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists upgrade_requests_insert on upgrade_requests`,
  `create policy upgrade_requests_insert on upgrade_requests for insert with check (
    exists (select 1 from subscriptions s where s.id = upgrade_requests.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists upgrade_requests_update on upgrade_requests`,
  `create policy upgrade_requests_update on upgrade_requests for update using (
    exists (select 1 from subscriptions s where s.id = upgrade_requests.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  ) with check (
    exists (select 1 from subscriptions s where s.id = upgrade_requests.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists upgrade_requests_delete on upgrade_requests`,
  `create policy upgrade_requests_delete on upgrade_requests for delete using (
    exists (select 1 from subscriptions s where s.id = upgrade_requests.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists downgrade_requests_select on downgrade_requests`,
  `create policy downgrade_requests_select on downgrade_requests for select using (
    exists (select 1 from subscriptions s where s.id = downgrade_requests.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists downgrade_requests_insert on downgrade_requests`,
  `create policy downgrade_requests_insert on downgrade_requests for insert with check (
    exists (select 1 from subscriptions s where s.id = downgrade_requests.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists downgrade_requests_update on downgrade_requests`,
  `create policy downgrade_requests_update on downgrade_requests for update using (
    exists (select 1 from subscriptions s where s.id = downgrade_requests.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  ) with check (
    exists (select 1 from subscriptions s where s.id = downgrade_requests.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists downgrade_requests_delete on downgrade_requests`,
  `create policy downgrade_requests_delete on downgrade_requests for delete using (
    exists (select 1 from subscriptions s where s.id = downgrade_requests.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists cancellation_requests_select on cancellation_requests`,
  `create policy cancellation_requests_select on cancellation_requests for select using (
    exists (select 1 from subscriptions s where s.id = cancellation_requests.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists cancellation_requests_insert on cancellation_requests`,
  `create policy cancellation_requests_insert on cancellation_requests for insert with check (
    exists (select 1 from subscriptions s where s.id = cancellation_requests.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists cancellation_requests_update on cancellation_requests`,
  `create policy cancellation_requests_update on cancellation_requests for update using (
    exists (select 1 from subscriptions s where s.id = cancellation_requests.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  ) with check (
    exists (select 1 from subscriptions s where s.id = cancellation_requests.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists cancellation_requests_delete on cancellation_requests`,
  `create policy cancellation_requests_delete on cancellation_requests for delete using (
    exists (select 1 from subscriptions s where s.id = cancellation_requests.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists payment_methods_select on payment_methods`,
  `create policy payment_methods_select on payment_methods for select using (
    exists (select 1 from customers c where c.id = payment_methods.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid)
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists payment_methods_insert on payment_methods`,
  `create policy payment_methods_insert on payment_methods for insert with check (
    exists (select 1 from customers c where c.id = payment_methods.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid)
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists payment_methods_update on payment_methods`,
  `create policy payment_methods_update on payment_methods for update using (
    exists (select 1 from customers c where c.id = payment_methods.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid)
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  ) with check (
    exists (select 1 from customers c where c.id = payment_methods.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid)
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists payment_methods_delete on payment_methods`,
  `create policy payment_methods_delete on payment_methods for delete using (
    exists (select 1 from customers c where c.id = payment_methods.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid)
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists invoices_select on subscription_invoices`,
  `create policy invoices_select on subscription_invoices for select using (
    exists (select 1 from customers c where c.id = subscription_invoices.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid)
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists invoices_insert on subscription_invoices`,
  `create policy invoices_insert on subscription_invoices for insert with check (
    exists (select 1 from customers c where c.id = subscription_invoices.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid)
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists invoices_update on subscription_invoices`,
  `create policy invoices_update on subscription_invoices for update using (
    exists (select 1 from customers c where c.id = subscription_invoices.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid)
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  ) with check (
    exists (select 1 from customers c where c.id = subscription_invoices.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid)
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists invoices_delete on subscription_invoices`,
  `create policy invoices_delete on subscription_invoices for delete using (
    exists (select 1 from customers c where c.id = subscription_invoices.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid)
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists payment_events_select on payment_events`,
  `create policy payment_events_select on payment_events for select using (
    exists (select 1 from subscription_invoices i where i.id = payment_events.invoice_id and exists (select 1 from customers c where c.id = i.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
    or (
      payment_events.invoice_id is null
      and exists (select 1 from subscriptions s
                   where s.id = (payment_events.raw->>'subscriptionId')::uuid
                     and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    )
  )`,
  `drop policy if exists payment_events_insert on payment_events`,
  `create policy payment_events_insert on payment_events for insert with check (
    exists (select 1 from subscription_invoices i where i.id = payment_events.invoice_id and exists (select 1 from customers c where c.id = i.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
    or (
      payment_events.invoice_id is null
      and exists (select 1 from subscriptions s
                   where s.id = (payment_events.raw->>'subscriptionId')::uuid
                     and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    )
  )`,
  `drop policy if exists payment_events_update on payment_events`,
  `create policy payment_events_update on payment_events for update using (
    exists (select 1 from subscription_invoices i where i.id = payment_events.invoice_id and exists (select 1 from customers c where c.id = i.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
    or (
      payment_events.invoice_id is null
      and exists (select 1 from subscriptions s
                   where s.id = (payment_events.raw->>'subscriptionId')::uuid
                     and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    )
  ) with check (
    exists (select 1 from subscription_invoices i where i.id = payment_events.invoice_id and exists (select 1 from customers c where c.id = i.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
    or (
      payment_events.invoice_id is null
      and exists (select 1 from subscriptions s
                   where s.id = (payment_events.raw->>'subscriptionId')::uuid
                     and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    )
  )`,
  `drop policy if exists payment_events_delete on payment_events`,
  `create policy payment_events_delete on payment_events for delete using (
    exists (select 1 from subscription_invoices i where i.id = payment_events.invoice_id and exists (select 1 from customers c where c.id = i.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
    or (
      payment_events.invoice_id is null
      and exists (select 1 from subscriptions s
                   where s.id = (payment_events.raw->>'subscriptionId')::uuid
                     and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    )
  )`,
  `drop policy if exists subscription_history_select on subscription_history`,
  `create policy subscription_history_select on subscription_history for select using (
    exists (select 1 from subscriptions s where s.id = subscription_history.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists subscription_history_insert on subscription_history`,
  `create policy subscription_history_insert on subscription_history for insert with check (
    exists (select 1 from subscriptions s where s.id = subscription_history.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists subscription_history_update on subscription_history`,
  `create policy subscription_history_update on subscription_history for update using (
    exists (select 1 from subscriptions s where s.id = subscription_history.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  ) with check (
    exists (select 1 from subscriptions s where s.id = subscription_history.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists subscription_history_delete on subscription_history`,
  `create policy subscription_history_delete on subscription_history for delete using (
    exists (select 1 from subscriptions s where s.id = subscription_history.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists feature_access_records_select on feature_access_records`,
  `create policy feature_access_records_select on feature_access_records for select using (
    exists (select 1 from subscriptions s where s.id = feature_access_records.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists feature_access_records_insert on feature_access_records`,
  `create policy feature_access_records_insert on feature_access_records for insert with check (
    exists (select 1 from subscriptions s where s.id = feature_access_records.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists feature_access_records_update on feature_access_records`,
  `create policy feature_access_records_update on feature_access_records for update using (
    exists (select 1 from subscriptions s where s.id = feature_access_records.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  ) with check (
    exists (select 1 from subscriptions s where s.id = feature_access_records.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists feature_access_records_delete on feature_access_records`,
  `create policy feature_access_records_delete on feature_access_records for delete using (
    exists (select 1 from subscriptions s where s.id = feature_access_records.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists entitlement_audit_logs_select on entitlement_audit_logs`,
  `create policy entitlement_audit_logs_select on entitlement_audit_logs for select using (
    exists (select 1 from subscriptions s where s.id = entitlement_audit_logs.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists entitlement_audit_logs_insert on entitlement_audit_logs`,
  `create policy entitlement_audit_logs_insert on entitlement_audit_logs for insert with check (
    exists (select 1 from subscriptions s where s.id = entitlement_audit_logs.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists entitlement_audit_logs_update on entitlement_audit_logs`,
  `create policy entitlement_audit_logs_update on entitlement_audit_logs for update using (
    exists (select 1 from subscriptions s where s.id = entitlement_audit_logs.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  ) with check (
    exists (select 1 from subscriptions s where s.id = entitlement_audit_logs.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists entitlement_audit_logs_delete on entitlement_audit_logs`,
  `create policy entitlement_audit_logs_delete on entitlement_audit_logs for delete using (
    exists (select 1 from subscriptions s where s.id = entitlement_audit_logs.subscription_id and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,


  // --- billing_provider_webhook_events: append-only provider event log.
  // Insert is open to any authenticated server scope because the sandbox
  // webhook path runs in the acting user's RLS scope (no session exists for a
  // provider callback); the real Stripe endpoint will be admin-scoped and
  // signature-verified before anything reaches the DB. Read is sb_admin only
  // (internal events never visible to tenants).
  `drop policy if exists billing_provider_webhook_events_select on billing_provider_webhook_events`,
  `create policy billing_provider_webhook_events_select on billing_provider_webhook_events for select using (
    ${IS_ADMIN}
    or (
      billing_provider_webhook_events.payload->>'subscriptionId' is not null
      and exists (select 1 from subscriptions s
                   where s.id = (billing_provider_webhook_events.payload->>'subscriptionId')::uuid
                     and exists (select 1 from customers c where c.id = s.customer_id and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    )
  )`,
  `drop policy if exists billing_provider_webhook_events_insert on billing_provider_webhook_events`,
  `create policy billing_provider_webhook_events_insert on billing_provider_webhook_events for insert with check (true)`,
  `drop policy if exists billing_provider_webhook_events_update on billing_provider_webhook_events`,
  `create policy billing_provider_webhook_events_update on billing_provider_webhook_events for update using (true) with check (true)`,
  // --- subscription & billing indexes.
  `create index if not exists customers_user_idx on customers (user_id)`,
  `create index if not exists customers_company_idx on customers (company_id)`,
  `create index if not exists subscriptions_customer_idx on subscriptions (customer_id)`,
  `create index if not exists subscriptions_status_idx on subscriptions (status)`,
  `create index if not exists subscription_items_sub_idx on subscription_items (subscription_id)`,
  `create index if not exists billing_cycles_sub_idx on billing_cycles (subscription_id)`,
  `create index if not exists minimum_commitments_sub_idx on minimum_commitments (subscription_id)`,
  `create index if not exists upgrade_requests_sub_idx on upgrade_requests (subscription_id)`,
  `create index if not exists downgrade_requests_sub_idx on downgrade_requests (subscription_id)`,
  `create index if not exists cancellation_requests_sub_idx on cancellation_requests (subscription_id)`,
  `create index if not exists payment_methods_customer_idx on payment_methods (customer_id)`,
  `create index if not exists subscription_invoices_customer_idx on subscription_invoices (customer_id)`,
  `create index if not exists subscription_invoices_sub_idx on subscription_invoices (subscription_id)`,
  `create index if not exists payment_events_invoice_idx on payment_events (invoice_id)`,
  `create index if not exists webhook_events_received_idx on billing_provider_webhook_events (received_at desc)`,
  `create index if not exists subscription_history_sub_idx on subscription_history (subscription_id, created_at desc)`,
  `create index if not exists feature_access_sub_idx on feature_access_records (subscription_id)`,
  `create index if not exists entitlement_audit_sub_idx on entitlement_audit_logs (subscription_id)`,
  // --- commitment_overrides (Master Admin spec section 5): senior-authorised
  // exceptions to the three-month minimum commitment. Never invisible to the
  // client: the company owner can always SELECT (overrides affect their
  // account); only sb_admin can INSERT. Rows are immutable (no delete policy).
  `create table if not exists commitment_overrides (
    id uuid primary key default gen_random_uuid(),
    subscription_id uuid not null references subscriptions(id) on delete cascade,
    company_id uuid not null references companies(id) on delete cascade,
    requested_by uuid not null references users(id) on delete set null,
    senior_admin_user_id uuid not null references users(id) on delete set null,
    reason text not null check (reason in (
      'approved commercial exception','service failure','duplicate subscription',
      'billing error','regulatory requirement','client settlement',
      'internal migration','administrative correction')),
    client_request_note text,
    financial_treatment text not null,
    effective_date timestamptz not null,
    status text not null default 'active' check (status in ('active','superseded','revoked')),
    created_at timestamptz not null default now()
  )`,
  `alter table commitment_overrides enable row level security`,
  `alter table commitment_overrides force row level security`,
  `drop policy if exists commitment_overrides_select on commitment_overrides`,
  `create policy commitment_overrides_select on commitment_overrides for select using (
    nullif(current_setting('app.role', true), '') = 'sb_admin'
    or exists (select 1 from subscriptions s where s.id = commitment_overrides.subscription_id
               and exists (select 1 from customers c where c.id = s.customer_id
                           and c.user_id = nullif(current_setting('app.user_id', true), '')::uuid))
    or exists (select 1 from companies co where co.id = commitment_overrides.company_id
               and co.owner_id = nullif(current_setting('app.user_id', true), '')::uuid)
  )`,
  `drop policy if exists commitment_overrides_insert on commitment_overrides`,
  `create policy commitment_overrides_insert on commitment_overrides for insert with check (
    nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists commitment_overrides_update on commitment_overrides`,
  `create policy commitment_overrides_update on commitment_overrides for update using (
    nullif(current_setting('app.role', true), '') = 'sb_admin'
  ) with check (
    nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `create index if not exists commitment_overrides_sub_idx on commitment_overrides (subscription_id, created_at desc)`,
  `create index if not exists commitment_overrides_company_idx on commitment_overrides (company_id)`,

  // --- entitlement_grants (Master Admin spec section 7): manual, admin-issued
  // feature entitlements on top of (or in place of) plan-included features.
  // grant_type: admin_grant = permanent manual grant; promotional = marketing
  // / partnership promotion (optionally time-boxed); temporary = time-boxed
  // access with an expiry. expires_at drives the active -> expired transition
  // (the UI treats active rows with a past expires_at as Expired without a
  // background job; a maintenance sweep can also flip status directly).
  // effective_from in the future = scheduled grant (visible to the company
  // owner, not yet active). status: active | expired | revoked. Rows are
  // immutable after revocation (no delete policy). RLS: the company owner can
  // always SELECT their own grants (never hidden from the client); only
  // sb_admin can INSERT/UPDATE (the app server additionally gates on staff
  // roles operations/finance/super_admin).
  `create table if not exists entitlement_grants (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references companies(id) on delete cascade,
    subscription_id uuid references subscriptions(id) on delete set null,
    entitlement_key text not null,
    grant_type text not null default 'admin_grant'
      check (grant_type in ('admin_grant','promotional','temporary')),
    reason text not null,
    granted_by uuid not null references users(id) on delete set null,
    effective_from timestamptz not null default now(),
    expires_at timestamptz,
    status text not null default 'active' check (status in ('active','expired','revoked')),
    created_at timestamptz not null default now()
  )`,
  `alter table entitlement_grants enable row level security`,
  `alter table entitlement_grants force row level security`,
  `drop policy if exists entitlement_grants_select on entitlement_grants`,
  `create policy entitlement_grants_select on entitlement_grants for select using (
    ${IS_ADMIN}
    or exists (select 1 from companies co where co.id = entitlement_grants.company_id
               and co.owner_id = ${UID})
  )`,
  `drop policy if exists entitlement_grants_insert on entitlement_grants`,
  `create policy entitlement_grants_insert on entitlement_grants for insert with check (
    ${IS_ADMIN}
  )`,
  `drop policy if exists entitlement_grants_update on entitlement_grants`,
  `create policy entitlement_grants_update on entitlement_grants for update using (
    ${IS_ADMIN}
  ) with check (
    ${IS_ADMIN}
  )`,
  `create index if not exists entitlement_grants_company_idx on entitlement_grants (company_id, created_at desc)`,
  `create index if not exists entitlement_grants_sub_idx on entitlement_grants (subscription_id)`,
  `create index if not exists entitlement_grants_key_idx on entitlement_grants (entitlement_key, status)`,

  // --- View as Client (Master Admin spec section 4): a temporary, audited,
  // admin-scoped support session that renders the client portal for one
  // company/client org. The token is a random secret (stored hashed, like
  // sessions), expires after 20 minutes, and is invalidated on exit or expiry.
  // RLS: sb_admin only. The row is created/read/closed exclusively by admin
  // server functions running inside asUser(admin, 'sb_admin').
  `create table if not exists admin_view_sessions (
    id uuid primary key default gen_random_uuid(),
    token_hash text not null unique,
    admin_user_id uuid not null references users(id) on delete cascade,
    company_id uuid not null references companies(id) on delete cascade,
    client_org_id uuid references client_organizations(id) on delete cascade,
    reason text not null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    ended_at timestamptz
  )`,
  `alter table admin_view_sessions enable row level security`,
  `alter table admin_view_sessions force row level security`,
  `drop policy if exists admin_view_sessions_select on admin_view_sessions`,
  `create policy admin_view_sessions_select on admin_view_sessions for select using (
    nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists admin_view_sessions_insert on admin_view_sessions`,
  `create policy admin_view_sessions_insert on admin_view_sessions for insert with check (
    nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `drop policy if exists admin_view_sessions_update on admin_view_sessions`,
  `create policy admin_view_sessions_update on admin_view_sessions for update using (
    nullif(current_setting('app.role', true), '') = 'sb_admin'
  ) with check (
    nullif(current_setting('app.role', true), '') = 'sb_admin'
  )`,
  `create index if not exists admin_view_sessions_token_idx on admin_view_sessions (token_hash)`,
  `create index if not exists admin_view_sessions_admin_idx on admin_view_sessions (admin_user_id, created_at desc)`,
  // ------------------------------------------------------------------
  // Platform Settings (owner-approved scope 2026-08-12): system preferences,
  // workspace-fee tiers, success-fee caps, and landing-page content blocks.
  // Every change is written together with an immutable audit_logs row
  // (action prefix settings.*) inside one asUser batch. Public surfaces read
  // live values through the `to scalebridge_app` select policies below (same
  // pattern as membership_plans_select_public). No delete policy anywhere:
  // rows are edited/archived in place so the audit trail stays complete.
  // ------------------------------------------------------------------
  `create table if not exists platform_settings (
    key text primary key,
    value jsonb not null,
    description text,
    updated_by uuid references users(id) on delete set null,
    updated_at timestamptz not null default now()
  )`,
  `alter table platform_settings enable row level security`,
  `alter table platform_settings force row level security`,
  `drop policy if exists platform_settings_select_public on platform_settings`,
  `create policy platform_settings_select_public on platform_settings
     for select to scalebridge_app using (true)`,
  `drop policy if exists platform_settings_select on platform_settings`,
  `create policy platform_settings_select on platform_settings for select using (${IS_ADMIN})`,
  `drop policy if exists platform_settings_insert on platform_settings`,
  `create policy platform_settings_insert on platform_settings for insert with check (${IS_ADMIN})`,
  `drop policy if exists platform_settings_update on platform_settings`,
  `create policy platform_settings_update on platform_settings for update using (${IS_ADMIN}) with check (${IS_ADMIN})`,
  `create table if not exists workspace_fee_tiers (
    id uuid primary key default gen_random_uuid(),
    label text not null unique,
    min_contract_value numeric(14,2) not null,
    max_contract_value numeric(14,2),
    fee numeric(12,2),
    sort_order int not null default 100,
    status text not null default 'Active' check (status in ('Active','Archived'))
  )`,
  `alter table workspace_fee_tiers enable row level security`,
  `alter table workspace_fee_tiers force row level security`,
  `drop policy if exists workspace_fee_tiers_select_public on workspace_fee_tiers`,
  `create policy workspace_fee_tiers_select_public on workspace_fee_tiers
     for select to scalebridge_app using (true)`,
  `drop policy if exists workspace_fee_tiers_select on workspace_fee_tiers`,
  `create policy workspace_fee_tiers_select on workspace_fee_tiers for select using (${IS_ADMIN})`,
  `drop policy if exists workspace_fee_tiers_insert on workspace_fee_tiers`,
  `create policy workspace_fee_tiers_insert on workspace_fee_tiers for insert with check (${IS_ADMIN})`,
  `drop policy if exists workspace_fee_tiers_update on workspace_fee_tiers`,
  `create policy workspace_fee_tiers_update on workspace_fee_tiers for update using (${IS_ADMIN}) with check (${IS_ADMIN})`,
  `create table if not exists success_fee_caps (
    id uuid primary key default gen_random_uuid(),
    label text not null unique,
    contract_value_min numeric(14,2) not null,
    contract_value_max numeric(14,2),
    cap numeric(12,2),
    note text,
    sort_order int not null default 100,
    status text not null default 'Active' check (status in ('Active','Archived'))
  )`,
  `alter table success_fee_caps enable row level security`,
  `alter table success_fee_caps force row level security`,
  `drop policy if exists success_fee_caps_select_public on success_fee_caps`,
  `create policy success_fee_caps_select_public on success_fee_caps
     for select to scalebridge_app using (true)`,
  `drop policy if exists success_fee_caps_select on success_fee_caps`,
  `create policy success_fee_caps_select on success_fee_caps for select using (${IS_ADMIN})`,
  `drop policy if exists success_fee_caps_insert on success_fee_caps`,
  `create policy success_fee_caps_insert on success_fee_caps for insert with check (${IS_ADMIN})`,
  `drop policy if exists success_fee_caps_update on success_fee_caps`,
  `create policy success_fee_caps_update on success_fee_caps for update using (${IS_ADMIN}) with check (${IS_ADMIN})`,
  `create table if not exists landing_content (
    key text primary key,
    content jsonb not null,
    updated_by uuid references users(id) on delete set null,
    updated_at timestamptz not null default now()
  )`,
  `alter table landing_content enable row level security`,
  `alter table landing_content force row level security`,
  `drop policy if exists landing_content_select_public on landing_content`,
  `create policy landing_content_select_public on landing_content
     for select to scalebridge_app using (true)`,
  `drop policy if exists landing_content_select on landing_content`,
  `create policy landing_content_select on landing_content for select using (${IS_ADMIN})`,
  `drop policy if exists landing_content_insert on landing_content`,
  `create policy landing_content_insert on landing_content for insert with check (${IS_ADMIN})`,
  `drop policy if exists landing_content_update on landing_content`,
  `create policy landing_content_update on landing_content for update using (${IS_ADMIN}) with check (${IS_ADMIN})`,
  // Default rows so the Admin Settings editor and public surfaces have a
  // coherent starting point (idempotent; admins edit in place).
  `insert into workspace_fee_tiers (label, min_contract_value, max_contract_value, fee, sort_order) values
    ('under_250k', 0, 250000, 250, 10),
    ('250k_to_1m', 250000, 1000000, 750, 20),
    ('1m_to_5m', 1000000, 5000000, 1500, 30),
    ('5m_to_25m', 5000000, 25000000, 3500, 40),
    ('over_25m_custom', 25000000, null, null, 50)
   on conflict (label) do nothing`,
  `insert into success_fee_caps (label, contract_value_min, contract_value_max, cap, note, sort_order) values
    ('under_1m', 0, 1000000, 10000, 'Cap on success fees for ScaleBridge-facilitated partnerships under AED 1M', 10),
    ('1m_to_5m', 1000000, 5000000, 25000, 'Cap on success fees for ScaleBridge-facilitated partnerships AED 1M to 5M', 20),
    ('over_5m_negotiated', 5000000, null, null, 'Success-fee cap negotiated above AED 5M', 30)
   on conflict (label) do nothing`,
  `insert into platform_settings (key, value, description) values
    ('platform_name', '"ScaleBridge"', 'Platform display name'),
    ('support_email', '"support@scalebridge.test"', 'Support contact email'),
    ('currency_display', '"AED"', 'Currency code used for pricing display')
   on conflict (key) do nothing`,
  `insert into landing_content (key, content) values
    ('hero.headline_lead', '"Big contracts."'),
    ('hero.headline_accent', '"Open to every capable business."'),
    ('hero.supporting', '"ScaleBridge connects businesses into trusted commercial partnerships, enabling them to combine capabilities, share responsibility, and fulfil larger contracts without leaving smaller companies behind."'),
    ('pricing.intro', '{"heading":"Simple, transparent pricing","body":"Entry-level access is free, verification is affordable, and anchor partners pay for coordinated delivery. Annual billing includes two months free."}'),
    ('footer.tagline', '"ScaleBridge — The infrastructure for lasting business partnerships."')
   on conflict (key) do nothing`,
  // Master Admin AI Controls: platform-level data-source registry rows
  // (idempotent; admins toggle enabled in place, audit trails record changes).
  `insert into ai_data_source_registry (source, name, description, source_url, enabled, consent_required) values
    ('internal_data', 'Internal company data',
     'Approved internal data: company profiles, company_services relationships, service_evidence, work packages, uploaded documents and client-intake responses.',
     null, true, false),
    ('website', 'Company website',
     'Public evidence captured from a company website (service pages, capability statements, case studies). Used only when the company has granted public-source consent.',
     null, true, true),
    ('public_source', 'Public sources',
     'Public directories, registries and third-party sources with a captured source_url. Used only when the company has granted public-source consent.',
     null, true, true)
   on conflict (source) do nothing`,
  // Master Admin AI Controls Phase 2a: engine rate-limit + automation
  // defaults (single row, id = 1). Admins edit via the Engine limits card
  // on /admin/ai; every change is dual-audited.
  `insert into ai_control_settings (id, daily_run_cap, per_company_daily_cap, min_interval_seconds, auto_run_enabled)
   values (1, 50, 10, 60, true)
   on conflict (id) do nothing`,
];
