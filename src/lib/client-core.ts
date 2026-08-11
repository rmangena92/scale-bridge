/**
 * Client Portal core — ALL server-only logic (DB access via ~/db + asUser,
 * client authorization, audit logging). Imported exclusively from ./client.ts
 * (server-function wrappers), so this module and its server-only imports never
 * reach the browser bundle. Do not import it from client components.
 *
 * SECURITY MODEL:
 *  - Every entry point calls loadClientUser() (auth-core): the session user
 *    must have at least one client_org_members row, otherwise the call is
 *    denied. A client user may belong to several orgs; the caller passes the
 *    selected orgId and it must be one of the user's memberships.
 *  - Queries run via asUser(client.user.id, membership.role, …) so RLS gates
 *    on current_setting('app.role') = the user's CLIENT role (client_admin /
 *    client_pm / …) — the client-portal policies added in schema.ts — plus the
 *    org-scoping predicates on client_org_id / contract_clients links.
 *  - Mutations additionally require membership.role = 'client_admin' (org
 *    profile edit, team invite, role change) and append an audit_logs row
 *    (client.* actions) in the same transaction. client_read_only is blocked
 *    from every mutation. Sensitive commercial data (participant pricing,
 *    internal notes, margins) is never selected — client views use the
 *    approved public columns only.
 */
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { asService, asUser, dbConfigured, ensureSchema } from "./db";
import { auditQuery } from "./audit";
import { loadClientUser } from "./auth-core";
import type {
  ClientContractDetail,
  ClientContractSummary,
  ClientDashboardStats,
  ClientOrgMembership,
  ClientOrgProfile,
  ClientRole,
  ClientSession,
  ClientTeamMember,
  Role,
} from "./types";
import { CLIENT_ROLES, ROLES } from "./types";

// ------------------------------------------------------------- result types
export type ClientSessionResult = {
  client: ClientSession | null;
  setupRequired: boolean;
};

export type ClientResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; setupRequired?: boolean };

export type SimpleResult =
  | { ok: true }
  | { ok: false; error: string; setupRequired?: boolean };

/** Resolve the effective org for a page (search param org, else primary). */
export function resolveClientOrg(
  client: ClientSession,
  orgId: string | undefined,
): ClientOrgMembership {
  const found = orgId ? client.orgs.find((o) => o.orgId === orgId) : undefined;
  return found ?? client.primaryOrg;
}

/** Membership of the acting user for orgId, or null (deny when null). */
async function membershipFor(
  client: ClientSession,
  orgId: string,
): Promise<ClientOrgMembership | null> {
  return client.orgs.find((o) => o.orgId === orgId) ?? null;
}

function err(msg: string, setupRequired?: boolean): { ok: false; error: string; setupRequired?: boolean } {
  return { ok: false, error: msg, setupRequired };
}

// ---------------------------------------------------------------- session
export async function doGetClientSession(): Promise<ClientSessionResult> {
  if (!dbConfigured()) return { client: null, setupRequired: true };
  try {
    await ensureSchema();
    return { client: await loadClientUser(), setupRequired: false };
  } catch (e) {
    console.error("getClientSession failed:", e);
    return { client: null, setupRequired: false };
  }
}

// --------------------------------------------------------------- dashboard
export async function doGetClientDashboard(
  orgId: string,
): Promise<ClientResult<ClientDashboardStats>> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    await ensureSchema();
    const client = await loadClientUser();
    if (!client) return err("UNAUTHENTICATED");
    const membership = await membershipFor(client, orgId);
    if (!membership) return err("FORBIDDEN");

    const rows = await asUser(client.user.id, membership.role, (tx) => [
      tx`select count(*)::int as n
         from contract_clients cc join contract_workspaces cw on cw.id = cc.contract_workspaces_id
         where cc.client_org_id = ${orgId} and cw.status = 'active'`,
      tx`select coalesce(sum(cw.contract_value), 0)::numeric as total
         from contract_clients cc join contract_workspaces cw on cw.id = cc.contract_workspaces_id
         where cc.client_org_id = ${orgId}`,
      tx`select count(*) filter (where m.status = 'completed')::int as done,
                count(*)::int as total
         from milestones m where m.client_org_id = ${orgId}`,
      tx`select m.id, m.name, m.due_date, m.status, cw.title as workspace_title
         from milestones m
         join contract_workspaces cw on cw.id = m.workspace_id
         where m.client_org_id = ${orgId}
           and m.due_date >= (now()::date)
           and m.status in ('upcoming','in_progress','submitted_for_review')
         order by m.due_date asc nulls last
         limit 6`,
      tx`select count(*)::int as n from milestones m
         where m.client_org_id = ${orgId} and m.status = 'submitted_for_review'`,
      tx`select count(*)::int as n from variations v
         where v.client_org_id = ${orgId} and v.status in ('submitted','under_client_review','clarification_requested')`,
      tx`select count(*)::int as n from documents d
         where d.client_org_id = ${orgId} and d.visibility = 'client_visible' and d.review_status = 'pending'`,
      tx`select count(*)::int as n from issues i
         where i.client_org_id = ${orgId} and i.status not in ('resolved','closed')`,
      tx`select count(*)::int as n from invoices i
         where i.client_org_id = ${orgId} and i.status in ('submitted','under_review','overdue')`,
      tx`select a.id, a.action, a.details, a.created_at, u.email as actor_email
         from audit_logs a
         left join users u on u.id = a.actor_id
         where a.client_org_id = ${orgId}
         order by a.created_at desc
         limit 8`,
      tx`select cw.id, cw.title, cw.end_date, cw.status
         from contract_clients cc join contract_workspaces cw on cw.id = cc.contract_workspaces_id
         where cc.client_org_id = ${orgId} and cw.end_date is not null
         order by cw.end_date asc`,
      tx`select name from client_organizations where id = ${orgId}`,
    ]);
    const n = (i: number) => Number((rows[i + 1] as { n: number }[] | undefined)?.[0]?.n ?? 0);
    const total = (rows[3] as { done: number; total: number }[])[0];
    const upcoming = rows[4] as {
      id: string;
      name: string;
      due_date: string | null;
      status: string;
      workspace_title: string | null;
    }[];
    const activity = rows[10] as {
      id: string;
      action: string;
      details: unknown;
      created_at: string;
      actor_email: string | null;
    }[];
    const endDates = rows[11] as {
      id: string;
      title: string;
      end_date: string | null;
      status: ClientDashboardStats["contractEndDates"][number]["status"];
    }[];
    const orgRows = rows[12] as { name: string }[];
    const valueRows = rows[2] as { total: string }[];

    return {
      ok: true,
      data: {
        orgName: orgRows[0]?.name ?? membership.orgName,
        activeContracts: n(0),
        contractValue: Number(valueRows[0]?.total ?? 0),
        completionPct:
          total && total.total > 0
            ? Math.round((total.done / total.total) * 100)
            : 0,
        upcomingMilestones: upcoming.map((m) => ({
          id: m.id,
          name: m.name,
          dueDate: m.due_date ? String(m.due_date) : null,
          status: m.status,
          workspaceTitle: m.workspace_title,
        })),
        pendingApprovals: n(4) + n(5),
        documentsAwaitingReview: n(6),
        openIssues: n(7),
        variationRequests: n(5),
        invoicesAwaitingAction: n(8),
        recentMessages: 0, // messaging ships in Part C
        recentActivity: activity.map((r) => ({
          id: r.id,
          action: r.action,
          actorEmail: r.actor_email,
          details:
            typeof r.details === "string"
              ? (JSON.parse(r.details) as Record<string, string | number | boolean | null>)
              : ((r.details as Record<string, string | number | boolean | null> | null) ?? null),
          createdAt: String(r.created_at),
        })),
        contractEndDates: endDates.map((c) => ({
          id: c.id,
          title: c.title,
          endDate: c.end_date ? String(c.end_date) : null,
          status: c.status,
        })),
      },
    };
  } catch (e) {
    console.error("getClientDashboard failed:", e);
    return err("Could not load your dashboard.");
  }
}

// ----------------------------------------------------------------- contracts
export async function doListClientContracts(
  orgId: string,
): Promise<ClientResult<ClientContractSummary[]>> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    await ensureSchema();
    const client = await loadClientUser();
    if (!client) return err("UNAUTHENTICATED");
    const membership = await membershipFor(client, orgId);
    if (!membership) return err("FORBIDDEN");

    const rows = (await asUser(client.user.id, membership.role, (tx) => [
      tx`select cw.id, cw.title, cw.description, cw.status, cw.industry, cw.location,
                cw.contract_value, cw.start_date, cw.end_date,
                u.email as lead_email, p.name as lead_name,
                (select c.name from companies c where c.owner_id = cw.lead_contractor_id) as lead_company,
                (select count(*) from work_packages wp where wp.workspace_id = cw.id)::int as package_count,
                (select count(*) from milestones m where m.workspace_id = cw.id and m.status = 'completed')::float /
                nullif((select count(*) from milestones m where m.workspace_id = cw.id)::int, 0) * 100 as completion
         from contract_clients cc
         join contract_workspaces cw on cw.id = cc.contract_workspaces_id
         left join users u on u.id = cw.lead_contractor_id
         left join profiles p on p.user_id = cw.lead_contractor_id
         where cc.client_org_id = ${orgId}
         order by cw.created_at desc`,
    ]))[1] as unknown[];
    const contracts: ClientContractSummary[] = (rows as {
      id: string;
      title: string;
      description: string | null;
      status: ClientContractSummary["status"];
      industry: string | null;
      location: string | null;
      contract_value: string | null;
      start_date: string | null;
      end_date: string | null;
      lead_email: string | null;
      lead_name: string | null;
      lead_company: string | null;
      package_count: number;
      completion: number | null;
    }[]).map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      status: r.status,
      industry: r.industry,
      location: r.location,
      contractValue: r.contract_value ? Number(r.contract_value) : null,
      startDate: r.start_date ? String(r.start_date) : null,
      endDate: r.end_date ? String(r.end_date) : null,
      leadName: r.lead_name,
      leadEmail: r.lead_email,
      leadCompany: r.lead_company,
      completionPct: Math.round(r.completion ?? 0),
      packageCount: Number(r.package_count ?? 0),
      visiblePackageCount: Number(r.package_count ?? 0), // RLS already filters to client-visible
    }));
    return { ok: true, data: contracts };
  } catch (e) {
    console.error("listClientContracts failed:", e);
    return err("Could not load your contracts.");
  }
}

export async function doGetClientContract(
  orgId: string,
  workspaceId: string,
): Promise<ClientResult<ClientContractDetail>> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    await ensureSchema();
    const client = await loadClientUser();
    if (!client) return err("UNAUTHENTICATED");
    const membership = await membershipFor(client, orgId);
    if (!membership) return err("FORBIDDEN");

    const rows = await asUser(client.user.id, membership.role, (tx) => [
      tx`select cw.id, cw.title, cw.description, cw.status, cw.industry, cw.location,
                cw.contract_value, cw.start_date, cw.end_date,
                cw.created_at, cw.updated_at,
                cw.lead_contractor_id, u.email as lead_email, p.name as lead_name
         from contract_clients cc
         join contract_workspaces cw on cw.id = cc.contract_workspaces_id
         join users u on u.id = cw.lead_contractor_id
         left join profiles p on p.user_id = cw.lead_contractor_id
         where cc.client_org_id = ${orgId} and cw.id = ${workspaceId}`,
      tx`select co.id as org_id, co.name, co.contact_email
         from contract_clients cc
         join client_organizations co on co.id = cc.client_org_id
         where cc.contract_workspaces_id = ${workspaceId} and cc.client_org_id = ${orgId}`,
      tx`select c.name from companies c
         where c.owner_id = (select lead_contractor_id from contract_workspaces where id = ${workspaceId})`,
      tx`select distinct c.id as company_id, c.name as company_name
         from work_packages wp
         join companies c on c.id = wp.company_id
         where wp.workspace_id = ${workspaceId} and wp.client_visible = true and c.id is not null
         order by c.name`,
      tx`select wp.id, wp.name, wp.description, wp.scope_notes, wp.category, wp.status,
                c.name as company_name,
                (select count(*) from milestones m where m.work_package_id = wp.id)::int as milestone_count,
                (select count(*) from milestones m where m.work_package_id = wp.id and m.status = 'completed')::int as completed_count
         from work_packages wp
         left join companies c on c.id = wp.company_id
         where wp.workspace_id = ${workspaceId} and wp.client_visible = true
         order by wp.created_at asc`,
      tx`select m.id, m.name, m.due_date, m.status,
                wp.name as work_package_name
         from milestones m
         left join work_packages wp on wp.id = m.work_package_id
         where m.workspace_id = ${workspaceId}
         order by m.due_date asc nulls last
         limit 50`,
      tx`select i.id, i.title, i.severity, i.status
         from issues i
         where i.workspace_id = ${workspaceId}
         order by i.created_at desc
         limit 20`,
      tx`select i.id, i.invoice_number, i.title, i.amount, i.status
         from invoices i
         where i.workspace_id = ${workspaceId}
         order by i.created_at desc
         limit 20`,
      tx`select d.id, d.name, d.category, d.review_status, d.uploaded_at
         from documents d
         where d.workspace_id = ${workspaceId} and d.visibility = 'client_visible'
         order by d.uploaded_at desc
         limit 50`,
      tx`select a.id, a.action, a.details, a.created_at, u.email as actor_email
         from audit_logs a
         left join users u on u.id = a.actor_id
         where a.workspace_id = ${workspaceId} and a.client_org_id = ${orgId}
         order by a.created_at desc
         limit 20`,
    ]);
    const wsRows = rows[2] as unknown[];
    const ws = wsRows[0] as {
      id: string;
      title: string;
      description: string | null;
      status: ClientContractDetail["workspace"]["status"];
      industry: string | null;
      location: string | null;
      contract_value: string | null;
      start_date: string | null;
      end_date: string | null;
      created_at: string;
      updated_at: string;
      lead_contractor_id: string;
      lead_email: string;
      lead_name: string | null;
    };
    if (!ws) return err("Contract not found.");
    const orgRows = rows[3] as {
      org_id: string;
      name: string;
      contact_email: string | null;
    }[];
    const leadCoRows = rows[4] as { name: string }[];
    const partRows = rows[5] as { company_id: string; company_name: string }[];
    const pkgRows = rows[6] as {
      id: string;
      name: string;
      description: string | null;
      scope_notes: string | null;
      category: string | null;
      status: ClientContractDetail["workPackages"][number]["status"];
      company_name: string | null;
      milestone_count: number;
      completed_count: number;
    }[];
    const milestoneRows = rows[7] as {
      id: string;
      name: string;
      due_date: string | null;
      status: string;
      work_package_name: string | null;
    }[];
    const issueRows = rows[8] as { id: string; title: string; severity: string | null; status: string }[];
    const invoiceRows = rows[9] as {
      id: string;
      invoice_number: string;
      title: string | null;
      amount: string;
      status: string;
    }[];
    const docRows = rows[10] as {
      id: string;
      name: string;
      category: string | null;
      review_status: string;
      uploaded_at: string;
    }[];
    const auditRows = rows[11] as {
      id: string;
      action: string;
      details: unknown;
      created_at: string;
      actor_email: string | null;
    }[];

    return {
      ok: true,
      data: {
        workspace: {
          id: ws.id,
          title: ws.title,
          description: ws.description,
          status: ws.status,
          industry: ws.industry,
          location: ws.location,
          contractValue: ws.contract_value ? Number(ws.contract_value) : null,
          startDate: ws.start_date ? String(ws.start_date) : null,
          endDate: ws.end_date ? String(ws.end_date) : null,
          createdAt: String(ws.created_at),
          updatedAt: String(ws.updated_at),
        },
        lead: {
          userId: ws.lead_contractor_id,
          name: ws.lead_name,
          email: ws.lead_email,
          companyName: leadCoRows[0]?.name ?? null,
        },
        clientOrg: {
          orgId: orgRows[0]?.org_id ?? orgId,
          name: orgRows[0]?.name ?? membership.orgName,
          contactEmail: orgRows[0]?.contact_email ?? null,
        },
        participants: partRows.map((r) => ({
          companyId: r.company_id,
          companyName: r.company_name,
          participantRole: null,
          status: null,
        })),
        workPackages: pkgRows.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          scopeNotes: r.scope_notes,
          category: r.category,
          status: r.status,
          companyName: r.company_name,
          milestoneCount: Number(r.milestone_count ?? 0),
          completedMilestoneCount: Number(r.completed_count ?? 0),
          completionPct:
            Number(r.milestone_count ?? 0) > 0
              ? Math.round((Number(r.completed_count ?? 0) / Number(r.milestone_count ?? 0)) * 100)
              : 0,
        })),
        milestones: milestoneRows.map((m) => ({
          id: m.id,
          name: m.name,
          dueDate: m.due_date ? String(m.due_date) : null,
          status: m.status,
          workPackageName: m.work_package_name,
        })),
        issues: issueRows.map((i) => ({
          id: i.id,
          title: i.title,
          severity: i.severity,
          status: i.status,
        })),
        invoices: invoiceRows.map((i) => ({
          id: i.id,
          invoiceNumber: i.invoice_number,
          title: i.title,
          amount: Number(i.amount ?? 0),
          status: i.status,
        })),
        documents: docRows.map((d) => ({
          id: d.id,
          name: d.name,
          category: d.category,
          reviewStatus: d.review_status,
          uploadedAt: String(d.uploaded_at),
        })),
        audit: auditRows.map((a) => ({
          id: a.id,
          action: a.action,
          actorEmail: a.actor_email,
          details:
            typeof a.details === "string"
              ? (JSON.parse(a.details) as Record<string, string | number | boolean | null>)
              : ((a.details as Record<string, string | number | boolean | null> | null) ?? null),
          createdAt: String(a.created_at),
        })),
      },
    };
  } catch (e) {
    console.error("getClientContract failed:", e);
    return err("Could not load the contract.");
  }
}

// ------------------------------------------------------------------ my org
export async function doGetClientOrg(orgId: string): Promise<ClientResult<ClientOrgProfile>> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    await ensureSchema();
    const client = await loadClientUser();
    if (!client) return err("UNAUTHENTICATED");
    const membership = await membershipFor(client, orgId);
    if (!membership) return err("FORBIDDEN");

    const rows = (await asUser(client.user.id, membership.role, (tx) => [
      tx`select id, name, registration_number, registration_country, tax_id,
                address, contact_email, contact_phone, status, created_at, updated_at
         from client_organizations where id = ${orgId}`,
    ]))[1] as unknown[];
    const row = (rows as {
      id: string;
      name: string;
      registration_number: string | null;
      registration_country: string | null;
      tax_id: string | null;
      address: string | null;
      contact_email: string | null;
      contact_phone: string | null;
      status: ClientOrgProfile["status"];
      created_at: string;
      updated_at: string;
    }[])[0];
    if (!row) return err("Organisation not found.");
    return {
      ok: true,
      data: {
        id: row.id,
        name: row.name,
        registrationNumber: row.registration_number,
        registrationCountry: row.registration_country,
        taxId: row.tax_id,
        address: row.address,
        contactEmail: row.contact_email,
        contactPhone: row.contact_phone,
        status: row.status,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      },
    };
  } catch (e) {
    console.error("getClientOrg failed:", e);
    return err("Could not load your organisation.");
  }
}

export async function doUpdateClientOrg(
  orgId: string,
  input: {
    registrationNumber: string;
    registrationCountry: string;
    taxId: string;
    address: string;
    contactEmail: string;
    contactPhone: string;
  },
): Promise<SimpleResult> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    await ensureSchema();
    const client = await loadClientUser();
    if (!client) return err("UNAUTHENTICATED");
    const membership = await membershipFor(client, orgId);
    if (!membership) return err("FORBIDDEN");
    if (membership.role !== "client_admin") return err("FORBIDDEN_READ_ONLY");

    const clean = {
      registrationNumber: input.registrationNumber.trim().slice(0, 100),
      registrationCountry: input.registrationCountry.trim().slice(0, 100),
      taxId: input.taxId.trim().slice(0, 100),
      address: input.address.trim().slice(0, 500),
      contactEmail: input.contactEmail.trim().slice(0, 200),
      contactPhone: input.contactPhone.trim().slice(0, 60),
    };

    await asUser(client.user.id, membership.role, (tx) => [
      tx`update client_organizations
         set registration_number = ${clean.registrationNumber || null},
             registration_country = ${clean.registrationCountry || null},
             tax_id = ${clean.taxId || null},
             address = ${clean.address || null},
             contact_email = ${clean.contactEmail || null},
             contact_phone = ${clean.contactPhone || null},
             updated_at = now()
         where id = ${orgId}`,
      auditQuery(tx, client.user.id, "client.org.update", { orgId, ...clean }, null, orgId),
    ]);
    return { ok: true };
  } catch (e) {
    console.error("updateClientOrg failed:", e);
    return err("Could not save the organisation profile.");
  }
}

// --------------------------------------------------------------------- team
export async function doListClientTeam(orgId: string): Promise<ClientResult<ClientTeamMember[]>> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    await ensureSchema();
    const client = await loadClientUser();
    if (!client) return err("UNAUTHENTICATED");
    const membership = await membershipFor(client, orgId);
    if (!membership) return err("FORBIDDEN");

    const rows = (await asUser(client.user.id, membership.role, (tx) => [
      tx`select u.id as user_id, u.email, u.status as user_status, p.name, m.role, m.created_at as joined_at
         from client_org_members m
         join users u on u.id = m.user_id
         left join profiles p on p.user_id = u.id
         where m.org_id = ${orgId}
         order by m.created_at asc`,
    ]))[1] as unknown[];
    const members: ClientTeamMember[] = (rows as {
      user_id: string;
      email: string;
      user_status: ClientTeamMember["userStatus"];
      name: string | null;
      role: ClientRole;
      joined_at: string;
    }[]).map((r) => ({
      userId: r.user_id,
      email: r.email,
      name: r.name,
      role: r.role,
      userStatus: r.user_status,
      joinedAt: String(r.joined_at),
      isSelf: r.user_id === client.user.id,
    }));
    return { ok: true, data: members };
  } catch (e) {
    console.error("listClientTeam failed:", e);
    return err("Could not load your team.");
  }
}

// Password hashing mirrors auth-core (scrypt, $separated) so invited members
// can sign in with the temporary password.
function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return ["scrypt", 16384, 8, 1, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function doInviteClientMember(
  orgId: string,
  input: { email: string; name: string; role: ClientRole },
): Promise<
  | { ok: true; userId: string; tempPassword: string }
  | { ok: false; error: string; setupRequired?: boolean }
> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim().slice(0, 120);
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return err("Enter a valid email address.");
  if (!name) return err("Enter the member's name.");
  if (!CLIENT_ROLES.includes(input.role)) return err("Invalid role.");
  try {
    await ensureSchema();
    const client = await loadClientUser();
    if (!client) return err("UNAUTHENTICATED");
    const membership = await membershipFor(client, orgId);
    if (!membership) return err("FORBIDDEN");
    if (membership.role !== "client_admin") return err("FORBIDDEN_READ_ONLY");

    // users is an RLS-free auth table; look the invitee up (or create).
    const existing = (await asService((tx) => [
      tx`select id from users where lower(email) = ${email}`,
    ]))[0] as { id: string }[];
    const userId = existing[0]?.id ?? randomUUID();
    const tempPassword = randomBytes(6).toString("hex");
    const systemRole: Role = "buyer"; // client staff act as buyers platform-wide

    await asUser(client.user.id, membership.role, (tx) => [
      ...(existing[0]
        ? []
        : [
            tx`insert into users (id, email, password_hash, status)
               values (${userId}, ${email}, ${hashPassword(tempPassword)}, 'active')`,
          ]),
      tx`insert into profiles (user_id, role, name)
         values (${userId}, ${systemRole}, ${name})
         on conflict (user_id) do update set name = ${name}, updated_at = now()`,
      tx`insert into client_org_members (org_id, user_id, role)
         values (${orgId}, ${userId}, ${input.role})
         on conflict (org_id, user_id) do update set role = ${input.role}`,
      auditQuery(tx, client.user.id, "client.team.invite", {
        orgId,
        userId,
        email,
        role: input.role,
        systemRole,
      }, null, orgId),
    ]);
    return { ok: true, userId, tempPassword: existing[0] ? "" : tempPassword };
  } catch (e) {
    console.error("inviteClientMember failed:", e);
    return err("Could not invite the member.");
  }
}

export async function doUpdateClientMemberRole(
  orgId: string,
  userId: string,
  role: ClientRole,
): Promise<SimpleResult> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  if (!CLIENT_ROLES.includes(role)) return err("Invalid role.");
  try {
    await ensureSchema();
    const client = await loadClientUser();
    if (!client) return err("UNAUTHENTICATED");
    const membership = await membershipFor(client, orgId);
    if (!membership) return err("FORBIDDEN");
    if (membership.role !== "client_admin") return err("FORBIDDEN_READ_ONLY");
    if (userId === client.user.id) return err("You can't change your own role.");

    const rows = (await asUser(client.user.id, membership.role, (tx) => [
      tx`select role from client_org_members where org_id = ${orgId} and user_id = ${userId}`,
    ]))[1] as { role: ClientRole }[];
    if (!rows[0]) return err("Member not found.");
    const from = rows[0].role;
    if (from === role) return { ok: true };

    await asUser(client.user.id, membership.role, (tx) => [
      tx`update client_org_members set role = ${role}
         where org_id = ${orgId} and user_id = ${userId}`,
      auditQuery(tx, client.user.id, "client.team.role_change", {
        orgId, userId, from, to: role,
      }, null, orgId),
    ]);
    return { ok: true };
  } catch (e) {
    console.error("updateClientMemberRole failed:", e);
    return err("Could not update the member role.");
  }
}

// ------------------------------------------------------------------ settings
export async function doGetClientSettings(): Promise<
  ClientResult<{
    name: string | null;
    email: string;
    systemRole: Role;
    orgs: ClientSession["orgs"];
  }>
> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    await ensureSchema();
    const client = await loadClientUser();
    if (!client) return err("UNAUTHENTICATED");
    return {
      ok: true,
      data: {
        name: client.user.name,
        email: client.user.email,
        systemRole: client.user.role,
        orgs: client.orgs,
      },
    };
  } catch (e) {
    console.error("getClientSettings failed:", e);
    return err("Could not load your settings.");
  }
}

export async function doUpdateClientProfile(
  input: { name: string },
): Promise<SimpleResult> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  const name = input.name.trim().slice(0, 120);
  if (!name) return err("Name cannot be empty.");
  try {
    await ensureSchema();
    const client = await loadClientUser();
    if (!client) return err("UNAUTHENTICATED");
    await asUser(client.user.id, client.user.role, (tx) => [
      tx`update profiles set name = ${name}, updated_at = now() where user_id = ${client.user.id}`,
      auditQuery(tx, client.user.id, "client.profile.update", { name }),
    ]);
    return { ok: true };
  } catch (e) {
    console.error("updateClientProfile failed:", e);
    return err("Could not save your profile.");
  }
}

// --------------------------------------------------------------------- misc
/** System roles available when inviting client staff (buyer is the default). */
export const CLIENT_SYSTEM_ROLES: Role[] = ROLES.filter(
  (r) => r === "buyer" || r === "project_user",
);
