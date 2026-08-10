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
import { randomUUID } from "node:crypto";
import { asUser, dbConfigured, ensureSchema } from "./db";
import { auditQuery } from "./audit";
import { loadAdminUser } from "./auth-core";
import type {
  AdminApprovalEntry,
  AdminAuditLogRow,
  AdminCompanyDetail,
  AdminCompanySummary,
  AdminContractDetail,
  AdminContractSummary,
  AdminDashboardStats,
  AdminDocumentRow,
  AdminRole,
  AdminSession,
  AdminStaffMember,
  AdminSupportCaseDetail,
  AdminSupportCaseSummary,
  AdminUserDetail,
  AdminUserSummary,
  AdminVerificationCompany,
  AuditDetails,
  CompanyStatus,
  DocumentReviewAction,
  DocumentReviewStatus,
  InvitationStatus,
  ParticipantRole,
  Role,
  SupportCasePriority,
  SupportCaseStatus,
  UserStatus,
  WorkPackageStatus,
  WorkspaceStatus,
} from "./types";
import {
  ADMIN_ROLES,
  COMPANY_STATUSES,
  ROLES,
  SUPPORT_CASE_PRIORITIES,
  SUPPORT_CASE_STATUSES,
  USER_STATUSES,
  WORKSPACE_STATUSES,
} from "./types";

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
    // asUser() returns [set_config_rows, ...query_rows] — real results start at [1].
    const n = (i: number) => Number((rows[i] as { n: number }[] | undefined)?.[0]?.n ?? 0);
    const payments = rows[10] as { total: string }[];
    const activity = rows[11] as {
      id: string;
      action: string;
      details: unknown;
      created_at: string;
      actor_email: string | null;
    }[];
    const licences = rows[12] as {
      id: string;
      name: string;
      category: string | null;
      expiry_date: string | null;
      company_name: string | null;
    }[];

    return {
      ok: true,
      stats: {
        totalUsers: n(1),
        totalCompanies: n(2),
        companiesAwaitingVerification: n(3),
        activeContracts: n(4),
        contractsAwaitingResponses: n(5),
        activeProjectWorkspaces: n(6),
        openSupportRequests: n(7),
        openDisputes: n(8),
        pendingDocumentReviews: n(9),
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
                (select cw.title from contract_workspaces cw where cw.id = i.workspace_id) as workspace_title,
                (select wp.name from work_packages wp where wp.id = i.work_package_id) as work_package
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
          workPackage: r.work_package ?? null,
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

// =====================================================================
// PART B — operational screens (verification, contracts, documents,
// support cases, audit log, roles & permissions). Every entry point
// follows the Part A security model: loadAdminUser() + asUser(…,
// 'sb_admin', …) so RLS gates on app.role='sb_admin'; mutations require
// canMutate and append an audit_logs row atomically with the change.
// =====================================================================

export type VerificationQueueResult =
  | { ok: true; companies: AdminVerificationCompany[]; total: number }
  | { ok: false; error: string; setupRequired?: boolean };

export type VerificationCompanyResult =
  | { ok: true; company: AdminCompanyDetail["company"]; documents: AdminDocumentRow[]; history: AdminApprovalEntry[] }
  | { ok: false; error: string; setupRequired?: boolean };

export type AdminContractsResult =
  | { ok: true; contracts: AdminContractSummary[]; total: number; industries: string[]; locations: string[] }
  | { ok: false; error: string; setupRequired?: boolean };

export type AdminContractDetailResult =
  | { ok: true; detail: AdminContractDetail }
  | { ok: false; error: string; setupRequired?: boolean };

export type PendingDocumentsResult =
  | { ok: true; documents: AdminDocumentRow[]; total: number }
  | { ok: false; error: string; setupRequired?: boolean };

export type DocumentDetailResult =
  | { ok: true; document: AdminDocumentRow; history: AdminApprovalEntry[] }
  | { ok: false; error: string; setupRequired?: boolean };

export type SupportCasesResult =
  | { ok: true; cases: AdminSupportCaseSummary[]; total: number }
  | { ok: false; error: string; setupRequired?: boolean };

export type SupportCaseDetailResult =
  | { ok: true; detail: AdminSupportCaseDetail }
  | { ok: false; error: string; setupRequired?: boolean };

export type AuditLogResult =
  | { ok: true; entries: AdminAuditLogRow[]; total: number; page: number; pageSize: number; actions: string[] }
  | { ok: false; error: string; setupRequired?: boolean };

export type StaffListResult =
  | { ok: true; staff: AdminStaffMember[] }
  | { ok: false; error: string; setupRequired?: boolean };

// ------------------------------------------------------- verification queue
export async function doListVerificationQueue(input: {
  status: string;
}): Promise<VerificationQueueResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const status = ["documents_pending", "under_review"].includes(input.status) ? input.status : "";
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };

    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select c.id, c.name, c.type, c.verification_status, c.created_at,
                c.owner_id, u.email as owner_email,
                (select count(*) from documents d
                   where d.uploaded_by = c.owner_id
                      or d.uploaded_by in (select p.user_id from profiles p where p.company_id = c.id)) as document_count,
                (select count(*) from documents d
                   where d.review_status = 'pending'
                     and (d.uploaded_by = c.owner_id
                       or d.uploaded_by in (select p.user_id from profiles p where p.company_id = c.id))) as pending_document_count,
                (select count(*) from documents d
                   where d.expiry_date is not null
                     and d.expiry_date between (now()::date) and (now()::date + interval '90 days')
                     and (d.uploaded_by = c.owner_id
                       or d.uploaded_by in (select p.user_id from profiles p where p.company_id = c.id))) as expiring_document_count
         from companies c
         join users u on u.id = c.owner_id
         where c.verification_status in ('documents_pending','under_review')
           and (${status} = '' or c.verification_status = ${status})
         order by c.updated_at desc
         limit 100`,
    ]))[1] as unknown[];
    const companies: AdminVerificationCompany[] = (rows as {
      id: string;
      name: string;
      type: string | null;
      verification_status: CompanyStatus;
      created_at: string;
      owner_id: string;
      owner_email: string | null;
      document_count: number;
      pending_document_count: number;
      expiring_document_count: number;
    }[]).map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      verificationStatus: r.verification_status,
      ownerId: r.owner_id,
      ownerEmail: r.owner_email,
      createdAt: String(r.created_at),
      documentCount: Number(r.document_count ?? 0),
      pendingDocumentCount: Number(r.pending_document_count ?? 0),
      expiringDocumentCount: Number(r.expiring_document_count ?? 0),
    }));
    return { ok: true, companies, total: companies.length };
  } catch (err) {
    console.error("listVerificationQueue failed:", err);
    return { ok: false, error: "Could not load the verification queue." };
  }
}

export async function doGetVerificationCompany(
  companyId: string,
): Promise<VerificationCompanyResult> {
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
      tx`select d.id, d.name, d.category, d.visibility, d.review_status,
                d.review_comment, d.expiry_date, d.expiry_reminder_at,
                d.file_url, d.uploaded_at, d.workspace_id,
                (select cw.title from contract_workspaces cw where cw.id = d.workspace_id) as workspace_title,
                (select ru.email from users ru where ru.id = d.reviewed_by) as reviewed_by_email,
                d.reviewed_at
         from documents d
         where d.uploaded_by = (select owner_id from companies where id = ${companyId})
            or d.uploaded_by in (select p.user_id from profiles p where p.company_id = ${companyId})
         order by d.uploaded_at desc`,
      tx`select a.id, a.action, a.details, a.created_at, u.email as actor_email
         from audit_logs a
         left join users u on u.id = a.actor_id
         where a.details->>'companyId' = ${companyId}
            or a.details->>'company_id' = ${companyId}
         order by a.created_at desc
         limit 50`,
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

    const docRows = rows[2] as unknown[];
    const historyRows = rows[3] as unknown[];
    return {
      ok: true,
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
      documents: (docRows as Record<string, unknown>[]).map((r) => docRowToAdmin(r)),
      history: (historyRows as {
        id: string;
        action: string;
        details: unknown;
        created_at: string;
        actor_email: string | null;
      }[]).map((r) => ({
        id: r.id,
        action: r.action,
        actorEmail: r.actor_email,
        details:
          typeof r.details === "string"
            ? (JSON.parse(r.details) as AuditDetails)
            : ((r.details as AuditDetails | null) ?? null),
        createdAt: String(r.created_at),
      })),
    };
  } catch (err) {
    console.error("getVerificationCompany failed:", err);
    return { ok: false, error: "Could not load the company review." };
  }
}

/** Map a raw documents row to the shared AdminDocumentRow shape. */
function docRowToAdmin(r: Record<string, unknown>): AdminDocumentRow {
  return {
    id: String(r.id),
    name: String(r.name),
    category: r.category ? String(r.category) : null,
    visibility: String(r.visibility ?? "workspace"),
    reviewStatus: (r.review_status as DocumentReviewStatus) ?? "pending",
    reviewComment: r.review_comment ? String(r.review_comment) : null,
    reviewedByEmail: r.reviewed_by_email ? String(r.reviewed_by_email) : null,
    reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
    expiryDate: r.expiry_date ? String(r.expiry_date) : null,
    expiryReminderAt: r.expiry_reminder_at ? String(r.expiry_reminder_at) : null,
    fileUrl: r.file_url ? String(r.file_url) : null,
    uploadedAt: String(r.uploaded_at),
    companyId: r.company_id ? String(r.company_id) : null,
    companyName: r.company_name ? String(r.company_name) : null,
    workspaceId: r.workspace_id ? String(r.workspace_id) : null,
    workspaceTitle: r.workspace_title ? String(r.workspace_title) : null,
  };
}

export async function doReviewDocument(
  documentId: string,
  action: DocumentReviewAction,
  comment: string,
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const next = {
    approve: "approved",
    reject: "rejected",
    needs_replacement: "needs_replacement",
    clarification_requested: "clarification_requested",
  }[action];
  if (!next) return { ok: false, error: "Invalid review action." };
  const clean = comment.trim().slice(0, 2000);
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };
    if (!admin.canMutate) return { ok: false, error: "FORBIDDEN_READ_ONLY" };

    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select id, review_status, name, workspace_id from documents where id = ${documentId}`,
    ]))[1] as { id: string; review_status: string; name: string; workspace_id: string | null }[];
    if (!rows[0]) return { ok: false, error: "Document not found." };
    const from = rows[0].review_status;

    await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`update documents
         set review_status = ${next}, reviewed_by = ${admin.user.id},
             review_comment = ${clean || null}, reviewed_at = now()
         where id = ${documentId}`,
      auditQuery(tx, admin.user.id, "admin.document.review", {
        documentId,
        documentName: rows[0].name,
        action,
        from,
        to: next,
        comment: clean || null,
      }, rows[0].workspace_id),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("reviewDocument failed:", err);
    return { ok: false, error: "Could not record the document review." };
  }
}

export async function doSetExpiryReminder(documentId: string): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };
    if (!admin.canMutate) return { ok: false, error: "FORBIDDEN_READ_ONLY" };

    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select id, name, expiry_date, workspace_id from documents where id = ${documentId}`,
    ]))[1] as { id: string; name: string; expiry_date: string | null; workspace_id: string | null }[];
    if (!rows[0]) return { ok: false, error: "Document not found." };

    await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`update documents set expiry_reminder_at = now() where id = ${documentId}`,
      auditQuery(tx, admin.user.id, "admin.document.expiry_reminder", {
        documentId,
        documentName: rows[0].name,
        expiryDate: rows[0].expiry_date,
      }, rows[0].workspace_id),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("setExpiryReminder failed:", err);
    return { ok: false, error: "Could not set the expiry reminder." };
  }
}

// ----------------------------------------------------------------- contracts
export async function doListAdminContracts(input: {
  status: string;
  industry: string;
  location: string;
  minValue: string;
  maxValue: string;
  lead: string;
  client: string;
}): Promise<AdminContractsResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const status = WORKSPACE_STATUSES.includes(input.status as never) ? input.status : "";
  const industry = (input.industry ?? "").trim();
  const location = (input.location ?? "").trim();
  const lead = (input.lead ?? "").trim();
  const client = (input.client ?? "").trim();
  const minValue = Number(input.minValue);
  const maxValue = Number(input.maxValue);
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };

    const rows = await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select cw.id, cw.title, cw.description, cw.status, cw.industry, cw.location,
                cw.contract_value, cw.created_at, cw.updated_at,
                cw.lead_contractor_id, u.email as lead_email, p.name as lead_name,
                coalesce((select array_agg(co.name order by co.name)
                          from contract_clients cc
                          join client_organizations co on co.id = cc.client_org_id
                          where cc.contract_workspaces_id = cw.id), '{}') as client_names,
                (select count(*) from work_packages wp where wp.workspace_id = cw.id) as package_count,
                (select count(*) from invitations i where i.workspace_id = cw.id and i.status in ('joined','verified')) as participant_count
         from contract_workspaces cw
         join users u on u.id = cw.lead_contractor_id
         left join profiles p on p.user_id = cw.lead_contractor_id
         where (${status} = '' or cw.status = ${status})
           and (${industry} = '' or cw.industry = ${industry})
           and (${location} = '' or cw.location ilike ${`%${location}%`})
           and (${lead} = '' or u.email ilike ${`%${lead}%`} or coalesce(p.name, '') ilike ${`%${lead}%`})
           and (${client} = '' or exists (
             select 1 from contract_clients cc2
             join client_organizations co2 on co2.id = cc2.client_org_id
             where cc2.contract_workspaces_id = cw.id and co2.name ilike ${`%${client}%`}
           ))
           and (not (${minValue} > 0) or cw.contract_value >= ${minValue})
           and (not (${maxValue} > 0) or cw.contract_value <= ${maxValue})
         order by cw.created_at desc
         limit 200`,
      tx`select distinct coalesce(industry, '') as industry from contract_workspaces
         where industry is not null and industry <> '' order by industry`,
      tx`select distinct coalesce(location, '') as location from contract_workspaces
         where location is not null and location <> '' order by location`,
    ]);
    const list = rows[1] as unknown[];
    const contracts: AdminContractSummary[] = (list as {
      id: string;
      title: string;
      description: string | null;
      status: WorkspaceStatus;
      industry: string | null;
      location: string | null;
      contract_value: string | null;
      created_at: string;
      updated_at: string;
      lead_contractor_id: string;
      lead_email: string;
      lead_name: string | null;
      client_names: string[] | null;
      package_count: number;
      participant_count: number;
    }[]).map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      status: r.status,
      industry: r.industry,
      location: r.location,
      contractValue: r.contract_value ? Number(r.contract_value) : null,
      leadUserId: r.lead_contractor_id,
      leadName: r.lead_name,
      leadEmail: r.lead_email,
      clientNames: r.client_names ?? [],
      packageCount: Number(r.package_count ?? 0),
      participantCount: Number(r.participant_count ?? 0),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }));
    const industries = (rows[2] as { industry: string }[]).map((r) => r.industry);
    const locations = (rows[3] as { location: string }[]).map((r) => r.location);
    return { ok: true, contracts, total: contracts.length, industries, locations };
  } catch (err) {
    console.error("listAdminContracts failed:", err);
    return { ok: false, error: "Could not load contracts." };
  }
}

export async function doGetAdminContract(
  workspaceId: string,
): Promise<AdminContractDetailResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };

    const rows = await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select cw.id, cw.title, cw.description, cw.status, cw.industry, cw.location,
                cw.contract_value, cw.internal_notes, cw.internal_support_user_id,
                cw.created_at, cw.updated_at, cw.lead_contractor_id,
                u.email as lead_email, p.name as lead_name,
                (select c.name from companies c where c.owner_id = cw.lead_contractor_id) as lead_company
         from contract_workspaces cw
         join users u on u.id = cw.lead_contractor_id
         left join profiles p on p.user_id = cw.lead_contractor_id
         where cw.id = ${workspaceId}`,
      tx`select cc.client_org_id, co.name, co.contact_email
         from contract_clients cc
         join client_organizations co on co.id = cc.client_org_id
         where cc.contract_workspaces_id = ${workspaceId}
         order by co.name`,
      tx`select u.id as user_id, u.email, p.name,
                coalesce((select array_agg(ar.role order by ar.role)
                          from admin_roles ar where ar.user_id = u.id), '{}') as roles
         from users u
         left join profiles p on p.user_id = u.id
         where u.id = (select internal_support_user_id from contract_workspaces where id = ${workspaceId})`,
      tx`select wp.id, wp.name, wp.category, wp.status,
                (select count(*) from milestones m where m.work_package_id = wp.id and m.status = 'completed')::float /
                nullif((select count(*) from milestones m where m.work_package_id = wp.id), 0) * 100 as completion
         from work_packages wp
         where wp.workspace_id = ${workspaceId}
         order by wp.created_at asc`,
      tx`select i.id as invitation_id, i.company_id, i.company_name, i.email,
                i.participant_role, i.status
         from invitations i
         where i.workspace_id = ${workspaceId}
         order by i.created_at asc`,
      tx`select id, name, due_date, status from milestones
         where workspace_id = ${workspaceId}
         order by due_date asc nulls last, created_at asc
         limit 50`,
      tx`select id, title, severity, status from issues
         where workspace_id = ${workspaceId}
         order by created_at desc
         limit 50`,
      tx`select id, invoice_number, title, amount, status from invoices
         where workspace_id = ${workspaceId}
         order by created_at desc
         limit 50`,
      tx`select d.id, d.name, d.category, d.visibility, d.review_status,
                d.review_comment, d.expiry_date, d.expiry_reminder_at,
                d.file_url, d.uploaded_at, d.workspace_id,
                (select c.name from companies c
                   where c.owner_id = d.uploaded_by
                      or exists (select 1 from profiles pp where pp.user_id = d.uploaded_by and pp.company_id = c.id)) as company_name,
                (select ru.email from users ru where ru.id = d.reviewed_by) as reviewed_by_email,
                d.reviewed_at
         from documents d
         where d.workspace_id = ${workspaceId}
         order by d.uploaded_at desc
         limit 100`,
      tx`select a.id, a.action, a.details, a.created_at, u.email as actor_email
         from audit_logs a
         left join users u on u.id = a.actor_id
         where a.workspace_id = ${workspaceId}
         order by a.created_at desc
         limit 100`,
    ]);
    const wsRows = rows[1] as unknown[];
    const ws = wsRows[0] as {
      id: string;
      title: string;
      description: string | null;
      status: WorkspaceStatus;
      industry: string | null;
      location: string | null;
      contract_value: string | null;
      internal_notes: string[] | null;
      internal_support_user_id: string | null;
      created_at: string;
      updated_at: string;
      lead_contractor_id: string;
      lead_email: string;
      lead_name: string | null;
      lead_company: string | null;
    };
    if (!ws) return { ok: false, error: "Contract not found." };

    const clientRows = rows[2] as { client_org_id: string; name: string; contact_email: string | null }[];
    const staffRows = rows[3] as { user_id: string; email: string; name: string | null; roles: AdminRole[] | null }[];
    const pkgRows = rows[4] as { id: string; name: string; category: string | null; status: WorkPackageStatus; completion: number | null }[];
    const partRows = rows[5] as { invitation_id: string; company_id: string | null; company_name: string | null; email: string; participant_role: ParticipantRole; status: InvitationStatus }[];
    const milestoneRows = rows[6] as { id: string; name: string; due_date: string | null; status: string }[];
    const issueRows = rows[7] as { id: string; title: string; severity: string | null; status: string }[];
    const invoiceRows = rows[8] as { id: string; invoice_number: string; title: string | null; amount: string; status: string }[];
    const docRows = rows[9] as unknown[];
    const auditRows = rows[10] as { id: string; action: string; details: unknown; created_at: string; actor_email: string | null }[];

    return {
      ok: true,
      detail: {
        workspace: {
          id: ws.id,
          title: ws.title,
          description: ws.description,
          status: ws.status,
          industry: ws.industry,
          location: ws.location,
          contractValue: ws.contract_value ? Number(ws.contract_value) : null,
          createdAt: String(ws.created_at),
          updatedAt: String(ws.updated_at),
        },
        lead: { userId: ws.lead_contractor_id, name: ws.lead_name, email: ws.lead_email, companyName: ws.lead_company },
        clients: clientRows.map((r) => ({ orgId: r.client_org_id, name: r.name, contactEmail: r.contact_email })),
        supportAssignee: staffRows[0]
          ? { userId: staffRows[0].user_id, name: staffRows[0].name, email: staffRows[0].email, roles: staffRows[0].roles ?? [] }
          : null,
        internalNotes: ws.internal_notes ?? [],
        packages: pkgRows.map((r) => ({
          id: r.id,
          name: r.name,
          category: r.category,
          status: r.status,
          completion: Math.round(r.completion ?? 0),
        })),
        participants: partRows.map((r) => ({
          invitationId: r.invitation_id,
          companyId: r.company_id,
          companyName: r.company_name,
          email: r.email,
          participantRole: r.participant_role,
          status: r.status,
        })),
        milestones: milestoneRows.map((r) => ({ id: r.id, name: r.name, dueDate: r.due_date ? String(r.due_date) : null, status: r.status })),
        issues: issueRows.map((r) => ({ id: r.id, title: r.title, severity: r.severity, status: r.status })),
        invoices: invoiceRows.map((r) => ({ id: r.id, invoiceNumber: r.invoice_number, title: r.title, amount: Number(r.amount ?? 0), status: r.status })),
        documents: (docRows as Record<string, unknown>[]).map((r) => docRowToAdmin(r)),
        audit: auditRows.map((r) => ({
          id: r.id,
          action: r.action,
          actorEmail: r.actor_email,
          details:
            typeof r.details === "string"
              ? (JSON.parse(r.details) as AuditDetails)
              : ((r.details as AuditDetails | null) ?? null),
          createdAt: String(r.created_at),
        })),
      },
    };
  } catch (err) {
    console.error("getAdminContract failed:", err);
    return { ok: false, error: "Could not load the contract." };
  }
}

export async function doSetContractStatus(
  workspaceId: string,
  action: "suspend" | "archive" | "activate" | "complete",
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const to = { suspend: "suspended", archive: "archived", activate: "active", complete: "completed" }[action];
  if (!to) return { ok: false, error: "Invalid action." };
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };
    if (!admin.canMutate) return { ok: false, error: "FORBIDDEN_READ_ONLY" };

    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select id, title, status from contract_workspaces where id = ${workspaceId}`,
    ]))[1] as { id: string; title: string; status: string }[];
    if (!rows[0]) return { ok: false, error: "Contract not found." };
    const from = rows[0].status;

    await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`update contract_workspaces set status = ${to}, updated_at = now() where id = ${workspaceId}`,
      auditQuery(tx, admin.user.id, "admin.contract.status_change", {
        workspaceId,
        action,
        from,
        to,
      }, workspaceId),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("setContractStatus failed:", err);
    return { ok: false, error: "Could not update the contract status." };
  }
}

export async function doAssignContractSupport(
  workspaceId: string,
  staffUserId: string | null,
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };
    if (!admin.canMutate) return { ok: false, error: "FORBIDDEN_READ_ONLY" };

    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select id, title from contract_workspaces where id = ${workspaceId}`,
      staffUserId
        ? tx`select 1 as ok from admin_roles where user_id = ${staffUserId} limit 1`
        : tx`select null::int as ok where false`,
    ])) as unknown[];
    if (!(rows[1] as { id: string }[])[0]) return { ok: false, error: "Contract not found." };
    if (staffUserId && !(rows[2] as { ok: number }[])[0]) {
      return { ok: false, error: "The selected user is not a ScaleBridge staff member." };
    }

    await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`update contract_workspaces set internal_support_user_id = ${staffUserId}, updated_at = now() where id = ${workspaceId}`,
      auditQuery(tx, admin.user.id, "admin.contract.assign_staff", {
        workspaceId,
        staffUserId: staffUserId ?? null,
      }, workspaceId),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("assignContractSupport failed:", err);
    return { ok: false, error: "Could not assign support staff." };
  }
}

export async function doAddContractNote(
  workspaceId: string,
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
      tx`select id from contract_workspaces where id = ${workspaceId}`,
    ]))[1] as { id: string }[];
    if (!rows[0]) return { ok: false, error: "Contract not found." };

    await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`update contract_workspaces
         set internal_notes = array_append(coalesce(internal_notes, '{}'::text[]), ${clean}),
             updated_at = now()
         where id = ${workspaceId}`,
      auditQuery(tx, admin.user.id, "admin.contract.note", { workspaceId, note: clean }, workspaceId),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("addContractNote failed:", err);
    return { ok: false, error: "Could not save the note." };
  }
}

// ------------------------------------------------------------ document review
export async function doListPendingDocuments(): Promise<PendingDocumentsResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };

    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select d.id, d.name, d.category, d.visibility, d.review_status,
                d.review_comment, d.expiry_date, d.expiry_reminder_at,
                d.file_url, d.uploaded_at, d.workspace_id,
                (select cw.title from contract_workspaces cw where cw.id = d.workspace_id) as workspace_title,
                (select c.name from companies c
                   where c.owner_id = d.uploaded_by
                      or exists (select 1 from profiles pp where pp.user_id = d.uploaded_by and pp.company_id = c.id)) as company_name,
                (select ru.email from users ru where ru.id = d.reviewed_by) as reviewed_by_email,
                d.reviewed_at
         from documents d
         where d.review_status = 'pending'
         order by d.uploaded_at asc
         limit 200`,
    ]))[1] as unknown[];
    const documents = (rows as Record<string, unknown>[]).map((r) => docRowToAdmin(r));
    return { ok: true, documents, total: documents.length };
  } catch (err) {
    console.error("listPendingDocuments failed:", err);
    return { ok: false, error: "Could not load pending documents." };
  }
}

export async function doGetDocumentDetail(
  documentId: string,
): Promise<DocumentDetailResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };

    const rows = await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select d.id, d.name, d.category, d.visibility, d.review_status,
                d.review_comment, d.expiry_date, d.expiry_reminder_at,
                d.file_url, d.uploaded_at, d.workspace_id,
                (select cw.title from contract_workspaces cw where cw.id = d.workspace_id) as workspace_title,
                (select c.name from companies c
                   where c.owner_id = d.uploaded_by
                      or exists (select 1 from profiles pp where pp.user_id = d.uploaded_by and pp.company_id = c.id)) as company_name,
                (select ru.email from users ru where ru.id = d.reviewed_by) as reviewed_by_email,
                d.reviewed_at
         from documents d
         where d.id = ${documentId}`,
      tx`select a.id, a.action, a.details, a.created_at, u.email as actor_email
         from audit_logs a
         left join users u on u.id = a.actor_id
         where a.details->>'documentId' = ${documentId}
         order by a.created_at desc
         limit 50`,
    ]);
    const docRows = rows[1] as unknown[];
    const doc = (docRows as Record<string, unknown>[])[0];
    if (!doc) return { ok: false, error: "Document not found." };
    const historyRows = rows[2] as { id: string; action: string; details: unknown; created_at: string; actor_email: string | null }[];
    return {
      ok: true,
      document: docRowToAdmin(doc),
      history: historyRows.map((r) => ({
        id: r.id,
        action: r.action,
        actorEmail: r.actor_email,
        details:
          typeof r.details === "string"
            ? (JSON.parse(r.details) as AuditDetails)
            : ((r.details as AuditDetails | null) ?? null),
        createdAt: String(r.created_at),
      })),
    };
  } catch (err) {
    console.error("getDocumentDetail failed:", err);
    return { ok: false, error: "Could not load the document." };
  }
}

// -------------------------------------------------------------- support cases
export async function doListSupportCases(input: {
  status: string;
  priority: string;
}): Promise<SupportCasesResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const status = SUPPORT_CASE_STATUSES.includes(input.status as never) ? input.status : "";
  const priority = SUPPORT_CASE_PRIORITIES.includes(input.priority as never) ? input.priority : "";
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };

    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select sc.id, sc.case_number, sc.category, sc.description, sc.priority, sc.status,
                sc.created_at, sc.updated_at,
                ru.email as reporter_email, rp.name as reporter_name,
                c.name as company_name, au.email as assignee_email
         from support_cases sc
         join users ru on ru.id = sc.reporter_user_id
         left join profiles rp on rp.user_id = sc.reporter_user_id
         left join companies c on c.id = sc.company_id
         left join users au on au.id = sc.assignee_user_id
         where (${status} = '' or sc.status = ${status})
           and (${priority} = '' or sc.priority = ${priority})
         order by sc.created_at desc
         limit 200`,
    ]))[1] as unknown[];
    const cases: AdminSupportCaseSummary[] = (rows as {
      id: string;
      case_number: string;
      category: string;
      description: string | null;
      priority: SupportCasePriority;
      status: SupportCaseStatus;
      created_at: string;
      updated_at: string;
      reporter_email: string;
      reporter_name: string | null;
      company_name: string | null;
      assignee_email: string | null;
    }[]).map((r) => ({
      id: r.id,
      caseNumber: r.case_number,
      category: r.category,
      description: r.description,
      priority: r.priority,
      status: r.status,
      reporterEmail: r.reporter_email,
      reporterName: r.reporter_name,
      companyName: r.company_name,
      assigneeEmail: r.assignee_email,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }));
    return { ok: true, cases, total: cases.length };
  } catch (err) {
    console.error("listSupportCases failed:", err);
    return { ok: false, error: "Could not load support cases." };
  }
}

export async function doGetSupportCase(caseId: string): Promise<SupportCaseDetailResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };

    const rows = await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select sc.id, sc.case_number, sc.category, sc.description, sc.attachments,
                sc.priority, sc.status, sc.resolution, sc.closed_at, sc.created_at, sc.updated_at,
                sc.reporter_user_id, ru.email as reporter_email, rp.name as reporter_name,
                sc.company_id, c.name as company_name,
                sc.workspace_id, cw.title as workspace_title,
                sc.assignee_user_id, au.email as assignee_email, ap.name as assignee_name
         from support_cases sc
         join users ru on ru.id = sc.reporter_user_id
         left join profiles rp on rp.user_id = sc.reporter_user_id
         left join companies c on c.id = sc.company_id
         left join contract_workspaces cw on cw.id = sc.workspace_id
         left join users au on au.id = sc.assignee_user_id
         left join profiles ap on ap.user_id = sc.assignee_user_id
         where sc.id = ${caseId}`,
      tx`select cm.id, cm.body, cm.internal, cm.created_at,
                u.email as author_email, p.name as author_name
         from case_messages cm
         join users u on u.id = cm.author_user_id
         left join profiles p on p.user_id = cm.author_user_id
         where cm.case_id = ${caseId}
         order by cm.created_at asc`,
    ]);
    const caseRows = rows[1] as unknown[];
    const c = (caseRows as {
      id: string;
      case_number: string;
      category: string;
      description: string | null;
      attachments: unknown;
      priority: SupportCasePriority;
      status: SupportCaseStatus;
      resolution: string | null;
      closed_at: string | null;
      created_at: string;
      updated_at: string;
      reporter_user_id: string;
      reporter_email: string;
      reporter_name: string | null;
      company_id: string | null;
      company_name: string | null;
      workspace_id: string | null;
      workspace_title: string | null;
      assignee_user_id: string | null;
      assignee_email: string | null;
      assignee_name: string | null;
    }[])[0];
    if (!c) return { ok: false, error: "Support case not found." };

    const msgRows = rows[2] as { id: string; body: string; internal: boolean; created_at: string; author_email: string; author_name: string | null }[];
    let attachments: { name: string }[] = [];
    if (c.attachments) {
      try {
        const parsed = typeof c.attachments === "string" ? JSON.parse(c.attachments) : c.attachments;
        attachments = Array.isArray(parsed) ? (parsed as { name?: string }[]).map((a) => ({ name: a.name ?? "attachment" })) : [];
      } catch { attachments = []; }
    }
    return {
      ok: true,
      detail: {
        id: c.id,
        caseNumber: c.case_number,
        reporter: { userId: c.reporter_user_id, name: c.reporter_name, email: c.reporter_email },
        company: c.company_id && c.company_name ? { id: c.company_id, name: c.company_name } : null,
        workspace: c.workspace_id && c.workspace_title ? { id: c.workspace_id, title: c.workspace_title } : null,
        category: c.category,
        description: c.description,
        attachments,
        priority: c.priority,
        assignee: c.assignee_user_id && c.assignee_email
          ? { userId: c.assignee_user_id, name: c.assignee_name, email: c.assignee_email }
          : null,
        status: c.status,
        resolution: c.resolution,
        closedAt: c.closed_at ? String(c.closed_at) : null,
        createdAt: String(c.created_at),
        updatedAt: String(c.updated_at),
        messages: msgRows.map((m) => ({
          id: m.id,
          authorEmail: m.author_email,
          authorName: m.author_name,
          body: m.body,
          internal: m.internal,
          createdAt: String(m.created_at),
        })),
      },
    };
  } catch (err) {
    console.error("getSupportCase failed:", err);
    return { ok: false, error: "Could not load the support case." };
  }
}

export async function doCreateSupportCase(input: {
  reporterUserId: string;
  companyId?: string;
  workspaceId?: string;
  category: string;
  description: string;
  priority: SupportCasePriority;
}): Promise<{ ok: true; caseId: string; caseNumber: string } | { ok: false; error: string; setupRequired?: boolean }> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const category = input.category.trim().slice(0, 80);
  const description = input.description.trim().slice(0, 4000);
  const priority = SUPPORT_CASE_PRIORITIES.includes(input.priority) ? input.priority : "medium";
  if (!category) return { ok: false, error: "Issue category is required." };
  if (!description) return { ok: false, error: "Description is required." };
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };
    if (!admin.canMutate) return { ok: false, error: "FORBIDDEN_READ_ONLY" };

    // Reporter must be a real user.
    const repRows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select id from users where id = ${input.reporterUserId}`,
    ]))[1] as { id: string }[];
    if (!repRows[0]) return { ok: false, error: "Reporter not found." };

    const numRows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select coalesce(max(split_part(case_number, '-', 3)::int), 0) + 1 as next
         from support_cases
         where case_number like ${`SC-${new Date().getFullYear()}-%`}`,
    ]))[1] as { next: number }[];
    const caseNumber = `SC-${new Date().getFullYear()}-${String(numRows[0]?.next ?? 1).padStart(4, "0")}`;
    const caseId = randomUUID();

    await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`insert into support_cases
           (id, case_number, reporter_user_id, company_id, workspace_id, category, description, priority)
         values (${caseId}, ${caseNumber}, ${input.reporterUserId},
                 ${input.companyId ?? null}, ${input.workspaceId ?? null},
                 ${category}, ${description}, ${priority})`,
      auditQuery(tx, admin.user.id, "admin.support.create", { caseId, caseNumber, category, priority }),
    ]);
    return { ok: true, caseId, caseNumber };
  } catch (err) {
    console.error("createSupportCase failed:", err);
    return { ok: false, error: "Could not create the support case." };
  }
}

export async function doUpdateSupportCase(
  caseId: string,
  input: { status?: SupportCaseStatus; priority?: SupportCasePriority; assigneeUserId?: string | null },
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const status = input.status !== undefined && SUPPORT_CASE_STATUSES.includes(input.status)
    ? input.status : undefined;
  const priority = input.priority !== undefined && SUPPORT_CASE_PRIORITIES.includes(input.priority)
    ? input.priority : undefined;
  if (status === undefined && priority === undefined && input.assigneeUserId === undefined) {
    return { ok: false, error: "Nothing to update." };
  }
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };
    if (!admin.canMutate) return { ok: false, error: "FORBIDDEN_READ_ONLY" };

    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select id, case_number, status, priority, assignee_user_id from support_cases where id = ${caseId}`,
      input.assigneeUserId
        ? tx`select 1 as ok from admin_roles where user_id = ${input.assigneeUserId} limit 1`
        : tx`select null::int as ok where false`,
    ])) as unknown[];
    const cur = (rows[1] as { id: string; case_number: string; status: string; priority: string; assignee_user_id: string | null }[])[0];
    if (!cur) return { ok: false, error: "Support case not found." };
    if (input.assigneeUserId && !(rows[2] as { ok: number }[])[0]) {
      return { ok: false, error: "The selected user is not a ScaleBridge staff member." };
    }
    if (status !== undefined && status === "closed") {
      return { ok: false, error: "Use the close action to close a case." };
    }

    await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`update support_cases
         set status = coalesce(${status ?? cur.status}, status),
             priority = coalesce(${priority ?? cur.priority}, priority),
             assignee_user_id = coalesce(${input.assigneeUserId === undefined ? cur.assignee_user_id : input.assigneeUserId}, assignee_user_id),
             updated_at = now()
         where id = ${caseId}`,
      auditQuery(tx, admin.user.id, "admin.support.update", {
        caseId,
        caseNumber: cur.case_number,
        status: status ?? cur.status,
        priority: priority ?? cur.priority,
        assigneeUserId: input.assigneeUserId === undefined ? cur.assignee_user_id : input.assigneeUserId,
      }),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("updateSupportCase failed:", err);
    return { ok: false, error: "Could not update the support case." };
  }
}

export async function doAddCaseMessage(
  caseId: string,
  body: string,
  internal: boolean,
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const clean = body.trim().slice(0, 4000);
  if (!clean) return { ok: false, error: "Message cannot be empty." };
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };
    if (!admin.canMutate) return { ok: false, error: "FORBIDDEN_READ_ONLY" };

    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select id, case_number from support_cases where id = ${caseId}`,
    ]))[1] as { id: string; case_number: string }[];
    if (!rows[0]) return { ok: false, error: "Support case not found." };

    await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`insert into case_messages (id, case_id, author_user_id, body, internal)
         values (${randomUUID()}, ${caseId}, ${admin.user.id}, ${clean}, ${internal})`,
      tx`update support_cases set updated_at = now() where id = ${caseId}`,
      auditQuery(tx, admin.user.id, internal ? "admin.support.internal_note" : "admin.support.message", {
        caseId,
        caseNumber: rows[0].case_number,
      }),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("addCaseMessage failed:", err);
    return { ok: false, error: "Could not add the message." };
  }
}

export async function doCloseSupportCase(
  caseId: string,
  resolution: string,
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const clean = resolution.trim().slice(0, 4000);
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };
    if (!admin.canMutate) return { ok: false, error: "FORBIDDEN_READ_ONLY" };

    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select id, case_number, status from support_cases where id = ${caseId}`,
    ]))[1] as { id: string; case_number: string; status: string }[];
    if (!rows[0]) return { ok: false, error: "Support case not found." };
    const from = rows[0].status;

    await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`update support_cases
         set status = 'closed', resolution = ${clean || null},
             closed_at = now(), updated_at = now()
         where id = ${caseId}`,
      auditQuery(tx, admin.user.id, "admin.support.close", {
        caseId,
        caseNumber: rows[0].case_number,
        from,
        resolution: clean || null,
      }),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("closeSupportCase failed:", err);
    return { ok: false, error: "Could not close the support case." };
  }
}

// ------------------------------------------------------------------ audit log
export async function doListAuditLogs(input: {
  actor: string;
  action: string;
  workspace: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
}): Promise<AuditLogResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const actor = (input.actor ?? "").trim();
  const action = (input.action ?? "").trim();
  const workspace = (input.workspace ?? "").trim();
  const from = (input.from ?? "").trim();
  const to = (input.to ?? "").trim();
  const page = Math.max(1, Number(input.page) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(input.pageSize) || 25));
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };

    const rows = await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select a.id, a.action, a.details, a.created_at,
                u.email as actor_email, cw.title as workspace_title
         from audit_logs a
         left join users u on u.id = a.actor_id
         left join contract_workspaces cw on cw.id = a.workspace_id
         where (${actor} = '' or u.email ilike ${`%${actor}%`})
           and (${action} = '' or a.action = ${action})
           and (${workspace} = '' or coalesce(cw.title, '') ilike ${`%${workspace}%`})
           and (${from} = '' or a.created_at >= ${`${from} 00:00:00`}::timestamptz)
           and (${to} = '' or a.created_at < (${`${to} 23:59:59`}::timestamptz + interval '1 second'))
         order by a.created_at desc
         limit ${pageSize} offset ${(page - 1) * pageSize}`,
      tx`select count(*)::int as total from audit_logs a
         left join users u on u.id = a.actor_id
         left join contract_workspaces cw on cw.id = a.workspace_id
         where (${actor} = '' or u.email ilike ${`%${actor}%`})
           and (${action} = '' or a.action = ${action})
           and (${workspace} = '' or coalesce(cw.title, '') ilike ${`%${workspace}%`})
           and (${from} = '' or a.created_at >= ${`${from} 00:00:00`}::timestamptz)
           and (${to} = '' or a.created_at < (${`${to} 23:59:59`}::timestamptz + interval '1 second'))`,
      tx`select distinct action from audit_logs order by action`,
    ]);
    const list = rows[1] as {
      id: string;
      action: string;
      details: unknown;
      created_at: string;
      actor_email: string | null;
      workspace_title: string | null;
    }[];
    const total = (rows[2] as { total: number }[])[0]?.total ?? 0;
    const actions = (rows[3] as { action: string }[]).map((r) => r.action);
    const entries: AdminAuditLogRow[] = list.map((r) => ({
      id: r.id,
      action: r.action,
      actorEmail: r.actor_email,
      workspaceTitle: r.workspace_title,
      details:
        typeof r.details === "string"
          ? (JSON.parse(r.details) as AuditDetails)
          : ((r.details as AuditDetails | null) ?? null),
      createdAt: String(r.created_at),
    }));
    return { ok: true, entries, total, page, pageSize, actions };
  } catch (err) {
    console.error("listAuditLogs failed:", err);
    return { ok: false, error: "Could not load the audit log." };
  }
}

// ------------------------------------------------------- staff list (roles UI)
export async function doListAdminStaff(): Promise<StaffListResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };

    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select u.id as user_id, u.email, p.name,
                coalesce((select array_agg(ar.role order by ar.role)
                          from admin_roles ar where ar.user_id = u.id), '{}') as roles
         from users u
         join admin_roles a on a.user_id = u.id
         left join profiles p on p.user_id = u.id
         group by u.id, u.email, p.name
         order by u.email`,
    ]))[1] as unknown[];
    const staff: AdminStaffMember[] = (rows as {
      user_id: string;
      email: string;
      name: string | null;
      roles: AdminRole[] | null;
    }[]).map((r) => ({ userId: r.user_id, email: r.email, name: r.name, roles: r.roles ?? [] }));
    return { ok: true, staff };
  } catch (err) {
    console.error("listAdminStaff failed:", err);
    return { ok: false, error: "Could not load staff members." };
  }
}
