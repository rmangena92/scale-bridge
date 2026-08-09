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
  // Indexes
  // ------------------------------------------------------------------
  `create index if not exists sessions_token_hash_idx on sessions (token_hash)`,
  `create index if not exists sessions_user_id_idx on sessions (user_id)`,
  `create index if not exists profiles_company_id_idx on profiles (company_id)`,
  `create index if not exists contract_workspaces_lead_idx on contract_workspaces (lead_contractor_id)`,
  `create index if not exists invitations_workspace_id_idx on invitations (workspace_id)`,
  `create index if not exists invitations_company_id_idx on invitations (company_id)`,
  `create index if not exists invitations_email_idx on invitations (lower(email))`,
  `create index if not exists work_packages_workspace_id_idx on work_packages (workspace_id)`,
  `create index if not exists notifications_user_id_idx on notifications (user_id, created_at desc)`,
  `create index if not exists audit_logs_workspace_id_idx on audit_logs (workspace_id)`,
  `create index if not exists audit_logs_actor_id_idx on audit_logs (actor_id)`,

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

  // --- invitations: the workspace lead sees/manages all; the invited
  // company's members see theirs; the person invited by email sees theirs;
  // admins see all. invitations_respond lets the invited user move an OPEN
  // invitation to joined/declined (and only that — the new row must still
  // carry their own email and a response status).
  `drop policy if exists invitations_select on invitations`,
  `create policy invitations_select on invitations for select using (
    nullif(current_setting('app.role', true), '') = 'sb_admin'
    or exists (
      select 1 from contract_workspaces cw
      where cw.id = invitations.workspace_id
        and cw.lead_contractor_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
    or exists (
      select 1 from profiles p
      where p.user_id = nullif(current_setting('app.user_id', true), '')::uuid
        and p.company_id = invitations.company_id
    )
    or lower(invitations.email) = (
      select lower(u.email) from users u
      where u.id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )`,
  `drop policy if exists invitations_insert on invitations`,
  `create policy invitations_insert on invitations for insert with check (
    nullif(current_setting('app.role', true), '') = 'sb_admin'
    or exists (
      select 1 from contract_workspaces cw
      where cw.id = invitations.workspace_id
        and cw.lead_contractor_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )`,
  `drop policy if exists invitations_update on invitations`,
  `create policy invitations_update on invitations for update using (
    nullif(current_setting('app.role', true), '') = 'sb_admin'
    or exists (
      select 1 from contract_workspaces cw
      where cw.id = invitations.workspace_id
        and cw.lead_contractor_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  ) with check (
    nullif(current_setting('app.role', true), '') = 'sb_admin'
    or exists (
      select 1 from contract_workspaces cw
      where cw.id = invitations.workspace_id
        and cw.lead_contractor_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
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
    or exists (
      select 1 from contract_workspaces cw
      where cw.id = invitations.workspace_id
        and cw.lead_contractor_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
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
  )`,
];
