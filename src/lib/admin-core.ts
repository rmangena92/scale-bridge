/**
 * Admin Portal core — ALL server-only logic (DB access via ~/db + asUser,
 * admin authorization, audit logging). Imported exclusively from ./admin.ts
 * (server-function wrappers), so this module and its server-only imports never
 * reach the browser bundle. Do not import it from client components.
 *
 * SECURITY MODEL:
 *  - Every entry point calls loadAdminUser() (auth-core): the session user must
 *    have a row in admin_roles, otherwise the call is denied.
 *  - Queries run via asUser(admin.id, 'sb_admin', …) so RLS policies gate on
 *    current_setting('app.role') = 'sb_admin' — the same gate every existing
 *    admin policy uses.
 *  - Mutations additionally require canMutate (the staff member is not
 *    read_only) and append an audit_logs row (admin.* actions) in the same
 *    transaction as the change.
 */
import { asUser, dbConfigured, ensureSchema } from "./db";
import { auditQuery } from "./audit";
import { loadAdminUser } from "./auth-core";
import type {
  AdminCompanyDetail,
  AdminCompanySummary,
  AdminDashboardStats,
  AdminRole,
  AdminSession,
  AdminUserDetail,
  AdminUserSummary,
  AuditDetails,
  CompanyStatus,
  Role,
  UserStatus,
} from "./types";
import { ADMIN_ROLES, COMPANY_STATUSES, ROLES, USER_STATUSES } from "./types";

// ------------------------------------------------------------- result types
export type AdminSessionResult = {
  admin: AdminSession | null;
  setupRequired: boolean;
};

export type SimpleResult =
  | { ok: true }
  | { ok: false; error: string; setupRequired?: boolean };

export type DashboardResult =
  | { ok: true; stats: AdminDashboardStats }
  | { ok: false; error: string; setupRequired?: boolean };

export type UsersResult =
  | { ok: true; users: AdminUserSummary[]; total: number }
  | { ok: false; error: string; setupRequired?: boolean };

export type UserDetailResult =
  | { ok: true; detail: AdminUserDetail }
  | { ok: false; error: string; setupRequired?: boolean };

export type CompaniesResult =
  | { ok: true; companies: AdminCompanySummary[]; total: number }
  | { ok: false; error: string; setupRequired?: boolean };

export type CompanyDetailResult =
  | { ok: true; detail: AdminCompanyDetail }
  | { ok: false; error: string; setupRequired?: boolean };

// -------------------------------------------------------------- session
export async function doGetAdminSession(): Promise<AdminSessionResult> {
  if (!dbConfigured()) return { admin: null, setupRequired: true };
  try {
    await ensureSchema();
    return { admin: await loadAdminUser(), setupRequired: false };
  } catch (err) {
    console.error("getAdminSession failed:", err);
    return { admin: null, setupRequired: false };
  }
}

// ---------------------------------------------------------------- dashboard
export async function doGetAdminDashboard(): Promise<DashboardResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };

    const rows = await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select count(*)::int as n from users`,
      tx`select count(*)::int as n from companies`,
      tx`select count(*)::int as n from companies
         where verification_status in ('pending','documents_pending','under_review')`,
      tx`select count(*)::int as n from contract_workspaces where status = 'active'`,
      tx`select count(*)::int as n from contract_workspaces cw
         where exists (select 1 from invitations i where i.workspace_id = cw.id and i.status = 'invited')`,
      tx`select count(*)::int as n from contract_workspaces
         where status in ('active','in_review')`,
      tx`select count(*)::int as n from support_cases
         where status not in ('resolved','closed')`,
      tx`select count(*)::int as n from support_cases
         where status not in ('resolved','closed')
           and lower(coalesce(category,'')) like '%dispute%'`,
      tx`select count(*)::int as n from documents where review_status = 'pending'`,
      tx`select coalesce(sum(amount), 0)::numeric as total from invoices
         where status in ('submitted','under_review','approved','scheduled_for_payment','overdue')`,
      tx`select a.id, a.action, a.details, a.created_at,
                u.email as actor_email
         from audit_logs a
         left join users u on u.id = a.actor_id
         order by a.created_at desc
         limit 10`,
      tx`select d.id, d.name, d.category, d.expiry_date,
                c.name as company_name
         from documents d
         left join users u on u.id = d.uploaded_by
         left join profiles p on p.user_id = u.id
         left join companies c on c.id = p.company_id
         where d.expiry_date is not null
           and d.expiry_date between (now()::date) and (now()::date + interval '90 days')
         order by d.expiry_date asc
         limit 20`,
    ]);
    const n = (i: number) => Number((rows[i] as { n: number }[] | undefined)?.[0]?.n ?? 0);
    const payments = rows[9] as { total: string }[];
    const activity = rows[10] as {
      id: string;
      action: string;
      details: unknown;
      created_at: string;
      actor_email: string | null;
    }[];
    const licences = rows[11] as {
      id: string;
      name: string;
      category: string | null;
      expiry_date: string | null;
      company_name: string | null;
    }[];

    return {
      ok: true,
      stats: {
        totalUsers: n(0),
        totalCompanies: n(1),
        companiesAwaitingVerification: n(2),
        activeContracts: n(3),
        contractsAwaitingResponses: n(4),
        activeProjectWorkspaces: n(5),
        openSupportRequests: n(6),
        openDisputes: n(7),
        pendingDocumentReviews: n(8),
        outstandingPayments: Number(payments[0]?.total ?? 0),
        monthlyRecurringRevenue: 0, // subscriptions ship in Part B
        recentActivity: activity.map((r) => ({
          id: r.id,
          action: r.action,
          actorEmail: r.actor_email,
          details:
            typeof r.details === "string"
              ? (JSON.parse(r.details) as AuditDetails)
              : ((r.details as AuditDetails | null) ?? null),
          createdAt: String(r.created_at),
        })),
        expiringLicences: licences.map((r) => ({
          id: r.id,
          name: r.name,
          category: r.category,
          expiryDate: r.expiry_date ? String(r.expiry_date) : null,
          companyName: r.company_name,
        })),
      },
    };
  } catch (err) {
    console.error("getAdminDashboard failed:", err);
    return { ok: false, error: "Could not load dashboard statistics." };
  }
}

// ------------------------------------------------------------------- users
export async function doListUsers(input: {
  query: string;
  status: string;
  role: string;
}): Promise<UsersResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const q = (input.query ?? "").trim();
  const status = USER_STATUSES.includes(input.status as never) ? input.status : "";
  const role = ROLES.includes(input.role as never) ? input.role : "";
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };

    const pattern = `%${q}%`;
    const rows = await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select u.id, u.email, u.status, u.created_at,
                p.role as system_role, p.name, p.company_id,
                c.name as company_name,
                coalesce((select array_agg(ar.role order by ar.role)
                          from admin_roles ar where ar.user_id = u.id), '{}') as staff_roles
         from users u
         left join profiles p on p.user_id = u.id
         left join companies c on c.id = p.company_id
         where (${q} = '' or u.email ilike ${pattern} or coalesce(p.name, '') ilike ${pattern})
           and (${status} = '' or u.status = ${status})
           and (${role} = '' or p.role = ${role})
         order by u.created_at desc
         limit 200`,
    ]);
    const list = (rows[1] as unknown[]) as {
      id: string;
      email: string;
      status: UserStatus;
      created_at: string;
      system_role: Role | null;
      name: string | null;
      company_id: string | null;
      company_name: string | null;
      staff_roles: AdminRole[] | null;
    }[];
    const users: AdminUserSummary[] = list.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      systemRole: r.system_role,
      status: r.status,
      companyId: r.company_id,
      companyName: r.company_name,
      staffRoles: r.staff_roles ?? [],
      createdAt: String(r.created_at),
    }));
    return { ok: true, users, total: users.length };
  } catch (err) {
    console.error("listUsers failed:", err);
    return { ok: false, error: "Could not load users." };
  }
}

export async function doGetUserDetail(userId: string): Promise<UserDetailResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };

    const rows = await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select u.id, u.email, u.status, u.created_at, u.internal_notes,
                p.role as system_role, p.name, p.company_id,
                c.name as company_name,
                coalesce((select array_agg(ar.role order by ar.role)
                          from admin_roles ar where ar.user_id = u.id), '{}') as staff_roles
         from users u
         left join profiles p on p.user_id = u.id
         left join companies c on c.id = p.company_id
         where u.id = ${userId}`,
      tx`select id, name, type, verification_status, created_at
         from companies where owner_id = ${userId} order by created_at desc`,
      tx`select i.id, i.workspace_id, i.email, i.company_name, i.participant_role,
                i.status, i.created_at, i.responded_at,
                (select cw.title from contract_workspaces cw where cw.id = i.workspace_id) as workspace_title
         from invitations i
         where lower(i.email) = lower(
           (select u.email from users u where u.id = ${userId})
         )
         order by i.created_at desc
         limit 50`,
      tx`select id, created_at, last_used_at, expires_at
         from sessions where user_id = ${userId}
         order by created_at desc limit 20`,
      tx`select role from admin_roles where user_id = ${userId} order by role`,
    ]);
    const userRows = rows[1] as unknown[];
    const userRow = userRows[0] as {
      id: string;
      email: string;
      status: UserStatus;
      created_at: string;
      internal_notes: string[] | null;
      system_role: Role | null;
      name: string | null;
      company_id: string | null;
      company_name: string | null;
      staff_roles: AdminRole[] | null;
    };
    if (!userRow) return { ok: false, error: "User not found." };

    const companyRows = rows[2] as {
      id: string;
      name: string;
      type: string | null;
      verification_status: CompanyStatus;
      created_at: string;
    }[];
    const invRows = rows[3] as {
      id: string;
      workspace_id: string;
      workspace_title: string | null;
      email: string;
      company_name: string | null;
      participant_role: AdminUserDetail["invitations"][number]["participantRole"];
      status: AdminUserDetail["invitations"][number]["status"];
      created_at: string;
      responded_at: string | null;
    }[];
    const sessionRows = rows[4] as {
      id: string;
      created_at: string;
      last_used_at: string;
      expires_at: string;
    }[];
    const roleRows = rows[5] as { role: AdminRole }[];

    return {
      ok: true,
      detail: {
        user: {
          id: userRow.id,
          email: userRow.email,
          name: userRow.name,
          systemRole: userRow.system_role,
          status: userRow.status,
          companyId: userRow.company_id,
          companyName: userRow.company_name,
          staffRoles: userRow.staff_roles ?? [],
          createdAt: String(userRow.created_at),
        },
        companies: companyRows.map((r) => ({
          id: r.id,
          name: r.name,
          type: r.type,
          verificationStatus: r.verification_status,
          createdAt: String(r.created_at),
        })),
        invitations: invRows.map((r) => ({
          id: r.id,
          workspaceId: r.workspace_id,
          workspaceTitle: r.workspace_title,
          email: r.email,
          companyName: r.company_name,
          participantRole: r.participant_role,
          status: r.status,
          createdAt: String(r.created_at),
          respondedAt: r.responded_at ? String(r.responded_at) : null,
        })),
        sessions: sessionRows.map((r) => ({
          id: r.id,
          createdAt: String(r.created_at),
          lastUsedAt: String(r.last_used_at),
          expiresAt: String(r.expires_at),
        })),
        internalNotes: userRow.internal_notes ?? [],
      },
    };
  } catch (err) {
    console.error("getUserDetail failed:", err);
    return { ok: false, error: "Could not load the user." };
  }
}

export async function doSetUserStatus(
  userId: string,
  status: UserStatus,
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  if (!USER_STATUSES.includes(status)) {
    return { ok: false, error: "Invalid account status." };
  }
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };
    if (!admin.canMutate) return { ok: false, error: "FORBIDDEN_READ_ONLY" };
    if (userId === admin.user.id && status !== "active") {
      return { ok: false, error: "You can't suspend or deactivate your own account." };
    }

    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select status from users where id = ${userId}`,
    ]))[1] as { status: UserStatus }[];
    if (!rows[0]) return { ok: false, error: "User not found." };
    const from = rows[0].status;

    await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`update users set status = ${status} where id = ${userId}`,
      // Suspending/deactivating revokes access immediately (sessions have no
      // RLS; this is an internal auth table).
      ...(status === "suspended" || status === "deactivated"
        ? [tx`delete from sessions where user_id = ${userId}`]
        : []),
      auditQuery(tx, admin.user.id, "admin.user.status_change", {
        userId,
        from,
        to: status,
      }),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("setUserStatus failed:", err);
    return { ok: false, error: "Could not update the account status." };
  }
}

export async function doAddUserNote(
  userId: string,
  note: string,
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const clean = note.trim().slice(0, 2000);
  if (!clean) return { ok: false, error: "Note cannot be empty." };
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };
    if (!admin.canMutate) return { ok: false, error: "FORBIDDEN_READ_ONLY" };

    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select id from users where id = ${userId}`,
    ]))[1] as { id: string }[];
    if (!rows[0]) return { ok: false, error: "User not found." };

    await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`update users
         set internal_notes = array_append(coalesce(internal_notes, '{}'::text[]), ${clean})
         where id = ${userId}`,
      auditQuery(tx, admin.user.id, "admin.user.note", { userId, note: clean }),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("addUserNote failed:", err);
    return { ok: false, error: "Could not save the note." };
  }
}

export async function doSetUserSystemRole(
  userId: string,
  role: Role,
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  if (!ROLES.includes(role)) return { ok: false, error: "Invalid system role." };
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };
    if (!admin.canMutate) return { ok: false, error: "FORBIDDEN_READ_ONLY" };

    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select id from users where id = ${userId}`,
    ]))[1] as { id: string }[];
    if (!rows[0]) return { ok: false, error: "User not found." };

    await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`insert into profiles (user_id, role, name)
         values (${userId}, ${role}, null)
         on conflict (user_id) do update set role = ${role}, updated_at = now()`,
      auditQuery(tx, admin.user.id, "admin.user.role_change", { userId, role }),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("setUserSystemRole failed:", err);
    return { ok: false, error: "Could not update the system role." };
  }
}

export async function doSetAdminRoles(
  userId: string,
  roles: AdminRole[],
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const clean = [...new Set(roles)].filter((r) =>
    ADMIN_ROLES.includes(r as never),
  ) as AdminRole[];
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };
    if (!admin.canMutate) return { ok: false, error: "FORBIDDEN_READ_ONLY" };
    if (userId === admin.user.id) {
      return { ok: false, error: "You can't modify your own admin roles." };
    }

    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select id from users where id = ${userId}`,
    ]))[1] as { id: string }[];
    if (!rows[0]) return { ok: false, error: "User not found." };

    await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`delete from admin_roles where user_id = ${userId}`,
      ...clean.map((r) =>
        tx`insert into admin_roles (user_id, role) values (${userId}, ${r})`,
      ),
      // Keep profiles.role in sync so the public site shows the admin role
      // badge; default back when the staff member is fully demoted.
      tx`insert into profiles (user_id, role, name)
         values (${userId}, ${clean.length > 0 ? "sb_admin" : "lead_contractor"}, null)
         on conflict (user_id) do update set role = ${clean.length > 0 ? "sb_admin" : "lead_contractor"}, updated_at = now()`,
      auditQuery(tx, admin.user.id, "admin.user.admin_roles", { userId, roles: clean }),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("setAdminRoles failed:", err);
    return { ok: false, error: "Could not update the admin roles." };
  }
}

// --------------------------------------------------------------- companies
export async function doListCompanies(input: {
  query: string;
  status: string;
}): Promise<CompaniesResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const q = (input.query ?? "").trim();
  const status = COMPANY_STATUSES.includes(input.status as never) ? input.status : "";
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };

    const pattern = `%${q}%`;
    const rows = await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select c.id, c.name, c.type, c.verification_status, c.created_at,
                c.owner_id, u.email as owner_email
         from companies c
         left join users u on u.id = c.owner_id
         where (${q} = '' or c.name ilike ${pattern} or coalesce(u.email, '') ilike ${pattern})
           and (${status} = '' or c.verification_status = ${status})
         order by c.created_at desc
         limit 200`,
    ]);
    const list = rows[1] as unknown[];
    const companies: AdminCompanySummary[] = (list as {
      id: string;
      name: string;
      type: string | null;
      verification_status: CompanyStatus;
      created_at: string;
      owner_id: string;
      owner_email: string | null;
    }[]).map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      verificationStatus: r.verification_status,
      ownerId: r.owner_id,
      ownerEmail: r.owner_email,
      createdAt: String(r.created_at),
    }));
    return { ok: true, companies, total: companies.length };
  } catch (err) {
    console.error("listCompanies failed:", err);
    return { ok: false, error: "Could not load companies." };
  }
}

export async function doGetCompanyDetail(
  companyId: string,
): Promise<CompanyDetailResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };

    const rows = await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select c.id, c.name, c.type, c.description, c.contact_email,
                c.verification_status, c.internal_notes, c.created_at, c.updated_at,
                c.owner_id, u.email as owner_email
         from companies c
         join users u on u.id = c.owner_id
         where c.id = ${companyId}`,
      tx`select p.user_id, p.role, p.name, u.email
         from profiles p
         join users u on u.id = p.user_id
         where p.company_id = ${companyId}
         order by u.email`,
      tx`select d.id, d.name, d.category, d.visibility, d.review_status,
                d.expiry_date, d.uploaded_at
         from documents d
         where d.uploaded_by = (select owner_id from companies where id = ${companyId})
            or d.uploaded_by in (
              select p.user_id from profiles p where p.company_id = ${companyId}
            )
         order by d.uploaded_at desc
         limit 100`,
      tx`select cw.id, cw.title, cw.status, cw.created_at
         from contract_workspaces cw
         where cw.lead_contractor_id = (select owner_id from companies where id = ${companyId})
            or exists (
              select 1 from invitations i
              where i.workspace_id = cw.id and i.company_id = ${companyId}
            )
         order by cw.created_at desc
         limit 100`,
    ]);
    const companyRows = rows[1] as unknown[];
    const companyRow = companyRows[0] as {
      id: string;
      name: string;
      type: string | null;
      description: string | null;
      contact_email: string | null;
      verification_status: CompanyStatus;
      internal_notes: string[] | null;
      created_at: string;
      updated_at: string;
      owner_id: string;
      owner_email: string | null;
    };
    if (!companyRow) return { ok: false, error: "Company not found." };

    const userRows = rows[2] as {
      user_id: string;
      role: Role;
      name: string | null;
      email: string;
    }[];
    const docRows = rows[3] as {
      id: string;
      name: string;
      category: string | null;
      visibility: string;
      review_status: string;
      expiry_date: string | null;
      uploaded_at: string;
    }[];
    const wsRows = rows[4] as {
      id: string;
      title: string;
      status: AdminCompanyDetail["contracts"][number]["status"];
      created_at: string;
    }[];

    return {
      ok: true,
      detail: {
        company: {
          id: companyRow.id,
          name: companyRow.name,
          type: companyRow.type,
          description: companyRow.description,
          contactEmail: companyRow.contact_email,
          verificationStatus: companyRow.verification_status,
          ownerId: companyRow.owner_id,
          ownerEmail: companyRow.owner_email,
          internalNotes: companyRow.internal_notes ?? [],
          createdAt: String(companyRow.created_at),
          updatedAt: String(companyRow.updated_at),
        },
        users: userRows.map((r) => ({
          userId: r.user_id,
          name: r.name,
          email: r.email,
          systemRole: r.role,
        })),
        documents: docRows.map((r) => ({
          id: r.id,
          name: r.name,
          category: r.category,
          visibility: r.visibility,
          reviewStatus: r.review_status,
          expiryDate: r.expiry_date ? String(r.expiry_date) : null,
          uploadedAt: String(r.uploaded_at),
        })),
        contracts: wsRows.map((r) => ({
          id: r.id,
          title: r.title,
          status: r.status,
          createdAt: String(r.created_at),
        })),
      },
    };
  } catch (err) {
    console.error("getCompanyDetail failed:", err);
    return { ok: false, error: "Could not load the company." };
  }
}

const COMPANY_ACTION_TRANSITIONS: Record<
  "verify" | "reject" | "suspend" | "restore",
  { to: CompanyStatus; verificationStatus: CompanyStatus }
> = {
  verify: { to: "verified", verificationStatus: "verified" },
  reject: { to: "rejected", verificationStatus: "rejected" },
  suspend: { to: "suspended", verificationStatus: "suspended" },
  restore: { to: "registered", verificationStatus: "registered" },
};

export async function doSetCompanyStatus(
  companyId: string,
  action: "verify" | "reject" | "suspend" | "restore",
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const transition = COMPANY_ACTION_TRANSITIONS[action];
  if (!transition) return { ok: false, error: "Invalid action." };
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };
    if (!admin.canMutate) return { ok: false, error: "FORBIDDEN_READ_ONLY" };

    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select verification_status from companies where id = ${companyId}`,
    ]))[1] as { verification_status: CompanyStatus }[];
    if (!rows[0]) return { ok: false, error: "Company not found." };
    const from = rows[0].verification_status;

    await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`update companies
         set verification_status = ${transition.verificationStatus}, updated_at = now()
         where id = ${companyId}`,
      auditQuery(tx, admin.user.id, "admin.company.status_change", {
        companyId,
        action,
        from,
        to: transition.verificationStatus,
      }),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("setCompanyStatus failed:", err);
    return { ok: false, error: "Could not update the company status." };
  }
}

export async function doAddCompanyNote(
  companyId: string,
  note: string,
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const clean = note.trim().slice(0, 2000);
  if (!clean) return { ok: false, error: "Note cannot be empty." };
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };
    if (!admin.canMutate) return { ok: false, error: "FORBIDDEN_READ_ONLY" };

    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select id from companies where id = ${companyId}`,
    ]))[1] as { id: string }[];
    if (!rows[0]) return { ok: false, error: "Company not found." };

    await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`update companies
         set internal_notes = array_append(coalesce(internal_notes, '{}'::text[]), ${clean}),
             updated_at = now()
         where id = ${companyId}`,
      auditQuery(tx, admin.user.id, "admin.company.note", { companyId, note: clean }),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("addCompanyNote failed:", err);
    return { ok: false, error: "Could not save the note." };
  }
}
