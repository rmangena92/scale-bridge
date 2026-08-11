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
import type { Tx, TxQuery } from "./db";
import { auditQuery } from "./audit";
import { loadClientUser } from "./auth-core";
import type {
  ClientApprovals,
  ClientContractDetail,
  ClientContractSummary,
  ClientConversation,
  ClientDashboardStats,
  ClientDocument,
  ClientDocumentCategory,
  ClientDocumentReviewDecision,
  ClientInvoice,
  ClientInvoiceDecision,
  ClientIssue,
  ClientIssueSeverity,
  ClientMessage,
  ClientMessageThreadType,
  ClientMilestone,
  ClientMilestoneReviewDecision,
  ClientNotification,
  ClientOrgMembership,
  ClientOrgProfile,
  ClientProgressReport,
  ClientRole,
  ClientSession,
  ClientTeamMember,
  ClientThread,
  ClientVariation,
  ClientVariationDecision,
  Role,
} from "./types";
import { CLIENT_MESSAGE_THREAD_TYPES, CLIENT_NOTIFICATION_TYPES, CLIENT_ROLES, ROLES } from "./types";

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

// ================================================================== Part B
// Client/Buyer Portal Part B: contract documents, milestones, progress
// reports, issues, variations, invoices + the approvals hub.
//
// SECURITY: every entry point re-verifies the org membership server-side
// (membershipFor), and every mutation additionally verifies the workspace is
// actually linked to the acting org (assertClientWorkspace) before touching a
// row. Updates are always scoped by id AND workspace_id AND client_org_id, and
// RLS (the Part A client policies on these tables) is the final gate. Client
// role gates mirror the RLS update policies: client_admin/client_reviewer for
// documents, client_admin/client_pm/client_reviewer for milestones,
// client_admin/client_pm for issues + variations, client_finance/client_admin
// for invoices.
//
// The client-facing status enums are a projection of the DB statuses: legacy
// lead-portal values are mapped to the client vocabulary so every row the
// client can see has one of the typed statuses below.

// ------------------------------------------------------- status projections
function mapDocumentStatus(s: string): ClientDocument["status"] {
  return s as ClientDocument["status"];
}

function mapMilestoneStatus(s: string): ClientMilestone["status"] {
  switch (s) {
    case "upcoming":
    case "in_progress":
    case "delayed":
      return "in_progress";
    case "submitted_for_review":
    case "submitted":
      return "submitted";
    case "rejected":
    case "requires_clarification":
    case "needs_changes":
      return "needs_changes";
    default:
      return s as ClientMilestone["status"]; // planned / approved / completed
  }
}

function mapIssueStatus(s: string): ClientIssue["status"] {
  switch (s) {
    case "under_review":
    case "action_required":
    case "waiting_client":
    case "waiting_contractor":
      return "under_review";
    case "responded":
      return "responded";
    case "resolved":
    case "closed":
      return "closed";
    default:
      return s as ClientIssue["status"]; // open
  }
}

function mapVariationStatus(s: string): ClientVariation["status"] {
  switch (s) {
    case "submitted":
    case "under_client_review":
    case "under_review":
      return "under_review";
    case "clarification_requested":
    case "clarification_needed":
      return "clarification_needed";
    case "approved_with_conditions":
    case "conditions":
      return "conditions";
    case "implemented":
      return "approved";
    default:
      return s as ClientVariation["status"]; // proposed / approved / rejected
  }
}

function mapInvoiceStatus(s: string): ClientInvoice["status"] {
  switch (s) {
    case "under_review":
    case "overdue":
      return "under_review";
    case "correction_required":
    case "corrections_requested":
      return "corrections_requested";
    case "scheduled_for_payment":
    case "paid":
      return "paid";
    default:
      return s as ClientInvoice["status"]; // submitted / approved / rejected
  }
}

// ------------------------------------------------------------ access helper
/**
 * Verify (server-side, inside RLS as the acting user) that `workspaceId` is
 * linked to `orgId` via contract_clients. Returns the workspace's lead
 * contractor id (needed to denormalize lead_contractor_id on inserts) or null
 * when the link does not exist. Mutations call this BEFORE their UPDATE/INSERT
 * so a client-supplied workspaceId can never be trusted on its own.
 */
async function assertClientWorkspace(
  userId: string,
  role: string,
  orgId: string,
  workspaceId: string,
): Promise<{ leadContractorId: string; workspaceTitle: string | null } | null> {
  const rows = (await asUser(userId, role, (tx) => [
    tx`select cc.lead_contractor_id, cw.title as workspace_title
       from contract_clients cc
       join contract_workspaces cw on cw.id = cc.contract_workspaces_id
       where cc.contract_workspaces_id = ${workspaceId} and cc.client_org_id = ${orgId}`,
  ]))[1] as { lead_contractor_id: string; workspace_title: string | null }[];
  return rows[0]
    ? { leadContractorId: rows[0].lead_contractor_id, workspaceTitle: rows[0].workspace_title }
    : null;
}

// -------------------------------------------------------------- documents
export async function doListClientDocuments(
  orgId: string,
  workspaceId?: string,
): Promise<ClientResult<ClientDocument[]>> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    await ensureSchema();
    const client = await loadClientUser();
    if (!client) return err("UNAUTHENTICATED");
    const membership = await membershipFor(client, orgId);
    if (!membership) return err("FORBIDDEN");

    const rows = (await asUser(client.user.id, membership.role, (tx) => [
      tx`select d.id, d.workspace_id, cw.title as workspace_title, d.name as title,
                d.file_name, d.category, d.status, d.uploaded_by,
                u.email as uploaded_by_email, d.shared_at, d.created_at, d.updated_at
         from documents d
         join contract_workspaces cw on cw.id = d.workspace_id
         left join users u on u.id = d.uploaded_by
         where d.client_org_id = ${orgId} and d.visibility = 'client_visible'
           ${workspaceId ? tx`and d.workspace_id = ${workspaceId}` : tx``}
         order by d.shared_at desc nulls last, d.created_at desc
         limit 100`,
    ]))[1] as unknown[];

    const docs: ClientDocument[] = (rows as {
      id: string;
      workspace_id: string;
      workspace_title: string | null;
      title: string;
      file_name: string | null;
      category: ClientDocumentCategory | null;
      status: string;
      uploaded_by: string | null;
      uploaded_by_email: string | null;
      shared_at: string | Date | null;
      created_at: string | Date;
      updated_at: string | Date;
    }[]).map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      workspaceTitle: r.workspace_title,
      title: r.title,
      fileName: r.file_name,
      category: r.category,
      status: mapDocumentStatus(r.status),
      uploadedByUserId: r.uploaded_by,
      uploadedByEmail: r.uploaded_by_email,
      sharedAt: r.shared_at ? String(r.shared_at) : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }));
    return { ok: true, data: docs };
  } catch (e) {
    console.error("listClientDocuments failed:", e);
    return err("Could not load the contract documents.");
  }
}

export async function doReviewClientDocument(input: {
  orgId: string;
  workspaceId: string;
  documentId: string;
  decision: ClientDocumentReviewDecision;
  comment?: string;
}): Promise<SimpleResult> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  if (input.decision !== "approved" && input.decision !== "needs_changes") {
    return err("Invalid review decision.");
  }
  try {
    await ensureSchema();
    const client = await loadClientUser();
    if (!client) return err("UNAUTHENTICATED");
    const membership = await membershipFor(client, input.orgId);
    if (!membership) return err("FORBIDDEN");
    if (membership.role !== "client_admin" && membership.role !== "client_reviewer") {
      return err("FORBIDDEN_READ_ONLY");
    }
    if (!(await assertClientWorkspace(client.user.id, membership.role, input.orgId, input.workspaceId))) {
      return err("FORBIDDEN");
    }

    const comment = input.comment?.trim().slice(0, 1000) || null;
    const rows = await asUser(client.user.id, membership.role, (tx) => [
      tx`update documents
         set status = ${input.decision}, reviewed_by = ${client.user.id},
             review_comment = ${comment}, reviewed_at = now(), updated_at = now()
         where id = ${input.documentId}
           and workspace_id = ${input.workspaceId}
           and client_org_id = ${input.orgId}`,
      auditQuery(tx, client.user.id, "client.document.review", {
        orgId: input.orgId,
        workspaceId: input.workspaceId,
        documentId: input.documentId,
        decision: input.decision,
        comment,
      }, input.workspaceId, input.orgId),
    ]);
    if ((rows[1] as { count: number }).count !== 1) return err("Document not found.");
    return { ok: true };
  } catch (e) {
    console.error("reviewClientDocument failed:", e);
    return err("Could not save the document review.");
  }
}

// -------------------------------------------------------------- milestones
export async function doListClientMilestones(
  orgId: string,
  workspaceId?: string,
): Promise<ClientResult<ClientMilestone[]>> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    await ensureSchema();
    const client = await loadClientUser();
    if (!client) return err("UNAUTHENTICATED");
    const membership = await membershipFor(client, orgId);
    if (!membership) return err("FORBIDDEN");

    const rows = (await asUser(client.user.id, membership.role, (tx) => [
      tx`select m.id, m.workspace_id, cw.title as workspace_title, m.work_package_id,
                wp.name as work_package_name, m.name as title, m.description, m.due_date,
                m.status, m.submitted_at, m.reviewed_at, m.reviewed_by,
                ru.email as reviewed_by_email, m.created_at
         from milestones m
         join contract_workspaces cw on cw.id = m.workspace_id
         left join work_packages wp on wp.id = m.work_package_id
         left join users ru on ru.id = m.reviewed_by
         where m.client_org_id = ${orgId}
           ${workspaceId ? tx`and m.workspace_id = ${workspaceId}` : tx``}
         order by m.due_date asc nulls last, m.created_at desc
         limit 200`,
    ]))[1] as unknown[];

    const milestones: ClientMilestone[] = (rows as {
      id: string;
      workspace_id: string;
      workspace_title: string | null;
      work_package_id: string | null;
      work_package_name: string | null;
      title: string;
      description: string | null;
      due_date: string | Date | null;
      status: string;
      submitted_at: string | Date | null;
      reviewed_at: string | Date | null;
      reviewed_by: string | null;
      reviewed_by_email: string | null;
      created_at: string | Date;
    }[]).map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      workspaceTitle: r.workspace_title,
      workPackageId: r.work_package_id,
      workPackageName: r.work_package_name,
      title: r.title,
      description: r.description,
      dueDate: r.due_date ? String(r.due_date) : null,
      status: mapMilestoneStatus(r.status),
      submittedAt: r.submitted_at ? String(r.submitted_at) : null,
      reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
      reviewedByUserId: r.reviewed_by,
      reviewedByEmail: r.reviewed_by_email,
      createdAt: String(r.created_at),
    }));
    return { ok: true, data: milestones };
  } catch (e) {
    console.error("listClientMilestones failed:", e);
    return err("Could not load the milestones.");
  }
}

export async function doReviewClientMilestone(input: {
  orgId: string;
  workspaceId: string;
  milestoneId: string;
  decision: ClientMilestoneReviewDecision;
  comment?: string;
}): Promise<SimpleResult> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  if (input.decision !== "approved" && input.decision !== "needs_changes") {
    return err("Invalid review decision.");
  }
  try {
    await ensureSchema();
    const client = await loadClientUser();
    if (!client) return err("UNAUTHENTICATED");
    const membership = await membershipFor(client, input.orgId);
    if (!membership) return err("FORBIDDEN");
    if (
      membership.role !== "client_admin" &&
      membership.role !== "client_pm" &&
      membership.role !== "client_reviewer"
    ) {
      return err("FORBIDDEN_READ_ONLY");
    }
    if (!(await assertClientWorkspace(client.user.id, membership.role, input.orgId, input.workspaceId))) {
      return err("FORBIDDEN");
    }

    const comment = input.comment?.trim().slice(0, 1000) || null;
    const rows = await asUser(client.user.id, membership.role, (tx) => [
      tx`update milestones
         set status = ${input.decision}, reviewed_at = now(), reviewed_by = ${client.user.id},
             updated_at = now()
         where id = ${input.milestoneId}
           and workspace_id = ${input.workspaceId}
           and client_org_id = ${input.orgId}`,
      auditQuery(tx, client.user.id, "client.milestone.review", {
        orgId: input.orgId,
        workspaceId: input.workspaceId,
        milestoneId: input.milestoneId,
        decision: input.decision,
        comment,
      }, input.workspaceId, input.orgId),
    ]);
    if ((rows[1] as { count: number }).count !== 1) return err("Milestone not found.");
    return { ok: true };
  } catch (e) {
    console.error("reviewClientMilestone failed:", e);
    return err("Could not save the milestone review.");
  }
}

// ---------------------------------------------------------- progress reports
export async function doListClientProgressReports(
  orgId: string,
  workspaceId?: string,
): Promise<ClientResult<ClientProgressReport[]>> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    await ensureSchema();
    const client = await loadClientUser();
    if (!client) return err("UNAUTHENTICATED");
    const membership = await membershipFor(client, orgId);
    if (!membership) return err("FORBIDDEN");

    const rows = (await asUser(client.user.id, membership.role, (tx) => [
      tx`select r.id, r.workspace_id, cw.title as workspace_title, r.milestone_id,
                m.name as milestone_title, r.title, r.period_start, r.period_end,
                r.body, r.submitted_by, u.email as submitted_by_email, r.created_at
         from progress_reports r
         join contract_workspaces cw on cw.id = r.workspace_id
         left join milestones m on m.id = r.milestone_id
         left join users u on u.id = r.submitted_by
         where r.client_org_id = ${orgId}
           ${workspaceId ? tx`and r.workspace_id = ${workspaceId}` : tx``}
         order by r.period_end desc nulls last, r.created_at desc
         limit 100`,
    ]))[1] as unknown[];

    const reports: ClientProgressReport[] = (rows as {
      id: string;
      workspace_id: string;
      workspace_title: string | null;
      milestone_id: string | null;
      milestone_title: string | null;
      title: string | null;
      period_start: string | Date | null;
      period_end: string | Date | null;
      body: string | null;
      submitted_by: string | null;
      submitted_by_email: string | null;
      created_at: string | Date;
    }[]).map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      workspaceTitle: r.workspace_title,
      milestoneId: r.milestone_id,
      milestoneTitle: r.milestone_title,
      title: r.title,
      periodStart: r.period_start ? String(r.period_start) : null,
      periodEnd: r.period_end ? String(r.period_end) : null,
      body: r.body,
      submittedByUserId: r.submitted_by,
      submittedByEmail: r.submitted_by_email,
      createdAt: String(r.created_at),
    }));
    return { ok: true, data: reports };
  } catch (e) {
    console.error("listClientProgressReports failed:", e);
    return err("Could not load the progress reports.");
  }
}

export async function doGetClientProgressReport(input: {
  orgId: string;
  workspaceId: string;
  reportId: string;
}): Promise<ClientResult<ClientProgressReport>> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    await ensureSchema();
    const client = await loadClientUser();
    if (!client) return err("UNAUTHENTICATED");
    const membership = await membershipFor(client, input.orgId);
    if (!membership) return err("FORBIDDEN");

    const rows = (await asUser(client.user.id, membership.role, (tx) => [
      tx`select r.id, r.workspace_id, cw.title as workspace_title, r.milestone_id,
                m.name as milestone_title, r.title, r.period_start, r.period_end,
                r.body, r.submitted_by, u.email as submitted_by_email, r.created_at
         from progress_reports r
         join contract_workspaces cw on cw.id = r.workspace_id
         left join milestones m on m.id = r.milestone_id
         left join users u on u.id = r.submitted_by
         where r.client_org_id = ${input.orgId}
           and r.workspace_id = ${input.workspaceId}
           and r.id = ${input.reportId}`,
    ]))[1] as unknown[];
    const r = (rows as {
      id: string;
      workspace_id: string;
      workspace_title: string | null;
      milestone_id: string | null;
      milestone_title: string | null;
      title: string | null;
      period_start: string | Date | null;
      period_end: string | Date | null;
      body: string | null;
      submitted_by: string | null;
      submitted_by_email: string | null;
      created_at: string | Date;
    }[])[0];
    if (!r) return err("Progress report not found.");
    return {
      ok: true,
      data: {
        id: r.id,
        workspaceId: r.workspace_id,
        workspaceTitle: r.workspace_title,
        milestoneId: r.milestone_id,
        milestoneTitle: r.milestone_title,
        title: r.title,
        periodStart: r.period_start ? String(r.period_start) : null,
        periodEnd: r.period_end ? String(r.period_end) : null,
        body: r.body,
        submittedByUserId: r.submitted_by,
        submittedByEmail: r.submitted_by_email,
        createdAt: String(r.created_at),
      },
    };
  } catch (e) {
    console.error("getClientProgressReport failed:", e);
    return err("Could not load the progress report.");
  }
}

// ------------------------------------------------------------------- issues
export async function doListClientIssues(
  orgId: string,
  workspaceId?: string,
): Promise<ClientResult<ClientIssue[]>> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    await ensureSchema();
    const client = await loadClientUser();
    if (!client) return err("UNAUTHENTICATED");
    const membership = await membershipFor(client, orgId);
    if (!membership) return err("FORBIDDEN");

    const rows = (await asUser(client.user.id, membership.role, (tx) => [
      tx`select i.id, i.workspace_id, cw.title as workspace_title, i.work_package_id,
                wp.name as work_package_name, i.title, i.description, i.severity, i.status,
                i.response, i.responded_at, i.responded_by,
                ru.email as responded_by_email, i.raised_by,
                rby.email as raised_by_email, i.created_at
         from issues i
         join contract_workspaces cw on cw.id = i.workspace_id
         left join work_packages wp on wp.id = i.work_package_id
         left join users ru on ru.id = i.responded_by
         left join users rby on rby.id = i.raised_by
         where i.client_org_id = ${orgId}
           ${workspaceId ? tx`and i.workspace_id = ${workspaceId}` : tx``}
         order by i.created_at desc
         limit 200`,
    ]))[1] as unknown[];

    const issues: ClientIssue[] = (rows as {
      id: string;
      workspace_id: string;
      workspace_title: string | null;
      work_package_id: string | null;
      work_package_name: string | null;
      title: string;
      description: string | null;
      severity: ClientIssueSeverity | null;
      status: string;
      response: string | null;
      responded_at: string | Date | null;
      responded_by: string | null;
      responded_by_email: string | null;
      raised_by: string | null;
      raised_by_email: string | null;
      created_at: string | Date;
    }[]).map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      workspaceTitle: r.workspace_title,
      workPackageId: r.work_package_id,
      workPackageName: r.work_package_name,
      title: r.title,
      description: r.description,
      severity: r.severity,
      status: mapIssueStatus(r.status),
      response: r.response,
      respondedAt: r.responded_at ? String(r.responded_at) : null,
      respondedByUserId: r.responded_by,
      respondedByEmail: r.responded_by_email,
      raisedByUserId: r.raised_by,
      raisedByEmail: r.raised_by_email,
      createdAt: String(r.created_at),
    }));
    return { ok: true, data: issues };
  } catch (e) {
    console.error("listClientIssues failed:", e);
    return err("Could not load the issues.");
  }
}

export async function doRaiseClientIssue(input: {
  orgId: string;
  workspaceId: string;
  workPackageId?: string | null;
  title: string;
  description: string;
  severity: ClientIssueSeverity;
}): Promise<SimpleResult> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  const title = input.title.trim().slice(0, 200);
  const description = input.description.trim().slice(0, 4000);
  if (!title) return err("Enter a title for the issue.");
  if (!description) return err("Describe the issue.");
  if (input.severity !== "low" && input.severity !== "medium" && input.severity !== "high") {
    return err("Invalid severity.");
  }
  try {
    await ensureSchema();
    const client = await loadClientUser();
    if (!client) return err("UNAUTHENTICATED");
    const membership = await membershipFor(client, input.orgId);
    if (!membership) return err("FORBIDDEN");
    if (membership.role !== "client_admin" && membership.role !== "client_pm") {
      return err("FORBIDDEN_READ_ONLY");
    }
    const link = await assertClientWorkspace(client.user.id, membership.role, input.orgId, input.workspaceId);
    if (!link) return err("FORBIDDEN");

    await asUser(client.user.id, membership.role, (tx) => [
      tx`insert into issues (workspace_id, work_package_id, lead_contractor_id, client_org_id,
                            title, description, severity, status, raised_by, created_at)
         values (${input.workspaceId}, ${input.workPackageId ?? null}, ${link.leadContractorId},
                 ${input.orgId}, ${title}, ${description}, ${input.severity}, 'open',
                 ${client.user.id}, now())`,
      auditQuery(tx, client.user.id, "client.issue.raise", {
        orgId: input.orgId,
        workspaceId: input.workspaceId,
        workPackageId: input.workPackageId ?? null,
        title,
        severity: input.severity,
      }, input.workspaceId, input.orgId),
    ]);
    return { ok: true };
  } catch (e) {
    console.error("raiseClientIssue failed:", e);
    return err("Could not raise the issue.");
  }
}

// --------------------------------------------------------------- variations
export async function doListClientVariations(
  orgId: string,
  workspaceId?: string,
): Promise<ClientResult<ClientVariation[]>> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    await ensureSchema();
    const client = await loadClientUser();
    if (!client) return err("UNAUTHENTICATED");
    const membership = await membershipFor(client, orgId);
    if (!membership) return err("FORBIDDEN");

    const rows = (await asUser(client.user.id, membership.role, (tx) => [
      tx`select v.id, v.workspace_id, cw.title as workspace_title, v.work_package_id,
                wp.name as work_package_name, v.title, v.description, v.reason,
                v.proposed_amount_cents, v.status, v.conditions, v.decided_at,
                v.decided_by, du.email as decided_by_email, v.created_at
         from variations v
         join contract_workspaces cw on cw.id = v.workspace_id
         left join work_packages wp on wp.id = v.work_package_id
         left join users du on du.id = v.decided_by
         where v.client_org_id = ${orgId} and v.status <> 'draft'
           ${workspaceId ? tx`and v.workspace_id = ${workspaceId}` : tx``}
         order by v.created_at desc
         limit 200`,
    ]))[1] as unknown[];

    const variations: ClientVariation[] = (rows as {
      id: string;
      workspace_id: string;
      workspace_title: string | null;
      work_package_id: string | null;
      work_package_name: string | null;
      title: string;
      description: string | null;
      reason: string | null;
      proposed_amount_cents: string | number | null;
      status: string;
      conditions: string | null;
      decided_at: string | Date | null;
      decided_by: string | null;
      decided_by_email: string | null;
      created_at: string | Date;
    }[]).map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      workspaceTitle: r.workspace_title,
      workPackageId: r.work_package_id,
      workPackageName: r.work_package_name,
      title: r.title,
      description: r.description,
      reason: r.reason,
      proposedAmountCents: r.proposed_amount_cents != null ? Number(r.proposed_amount_cents) : null,
      status: mapVariationStatus(r.status),
      conditions: r.conditions,
      decidedAt: r.decided_at ? String(r.decided_at) : null,
      decidedByUserId: r.decided_by,
      decidedByEmail: r.decided_by_email,
      createdAt: String(r.created_at),
    }));
    return { ok: true, data: variations };
  } catch (e) {
    console.error("listClientVariations failed:", e);
    return err("Could not load the variations.");
  }
}

export async function doReviewClientVariation(input: {
  orgId: string;
  workspaceId: string;
  variationId: string;
  decision: ClientVariationDecision;
  conditions?: string;
  reason?: string;
}): Promise<SimpleResult> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  const decisions: ClientVariationDecision[] = [
    "approved", "rejected", "clarification_needed", "conditions",
  ];
  if (!decisions.includes(input.decision)) return err("Invalid decision.");
  if (input.decision === "conditions" && !input.conditions?.trim()) {
    return err("Enter the conditions for approval.");
  }
  try {
    await ensureSchema();
    const client = await loadClientUser();
    if (!client) return err("UNAUTHENTICATED");
    const membership = await membershipFor(client, input.orgId);
    if (!membership) return err("FORBIDDEN");
    if (membership.role !== "client_admin" && membership.role !== "client_pm") {
      return err("FORBIDDEN_READ_ONLY");
    }
    if (!(await assertClientWorkspace(client.user.id, membership.role, input.orgId, input.workspaceId))) {
      return err("FORBIDDEN");
    }

    const conditions =
      input.decision === "conditions" ? input.conditions!.trim().slice(0, 2000) : null;
    const reason = input.reason?.trim().slice(0, 1000) || null;
    const rows = await asUser(client.user.id, membership.role, (tx) => [
      tx`update variations
         set status = ${input.decision}, conditions = ${conditions},
             decided_at = now(), decided_by = ${client.user.id}, updated_at = now()
         where id = ${input.variationId}
           and workspace_id = ${input.workspaceId}
           and client_org_id = ${input.orgId}`,
      auditQuery(tx, client.user.id, "client.variation.review", {
        orgId: input.orgId,
        workspaceId: input.workspaceId,
        variationId: input.variationId,
        decision: input.decision,
        conditions,
        reason,
      }, input.workspaceId, input.orgId),
    ]);
    if ((rows[1] as { count: number }).count !== 1) return err("Variation not found.");
    return { ok: true };
  } catch (e) {
    console.error("reviewClientVariation failed:", e);
    return err("Could not save the variation decision.");
  }
}

// ----------------------------------------------------------------- invoices
export async function doListClientInvoices(
  orgId: string,
  workspaceId?: string,
): Promise<ClientResult<ClientInvoice[]>> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    await ensureSchema();
    const client = await loadClientUser();
    if (!client) return err("UNAUTHENTICATED");
    const membership = await membershipFor(client, orgId);
    if (!membership) return err("FORBIDDEN");

    const rows = (await asUser(client.user.id, membership.role, (tx) => [
      tx`select i.id, i.workspace_id, cw.title as workspace_title, i.work_package_id,
                wp.name as work_package_name, i.invoice_number, i.title,
                coalesce(i.amount_cents, (i.amount * 100)::bigint) as amount_cents,
                i.currency, i.status, i.due_date, i.paid_at, i.review_notes,
                i.reviewed_at, i.reviewed_by, rv.email as reviewed_by_email,
                i.supplier_company_id, sc.name as supplier_company_name, i.created_at
         from invoices i
         join contract_workspaces cw on cw.id = i.workspace_id
         left join work_packages wp on wp.id = i.work_package_id
         left join users rv on rv.id = i.reviewed_by
         left join companies sc on sc.id = i.supplier_company_id
         where i.client_org_id = ${orgId} and i.status not in ('draft','cancelled')
           ${workspaceId ? tx`and i.workspace_id = ${workspaceId}` : tx``}
         order by i.created_at desc
         limit 200`,
    ]))[1] as unknown[];

    const invoices: ClientInvoice[] = (rows as {
      id: string;
      workspace_id: string;
      workspace_title: string | null;
      work_package_id: string | null;
      work_package_name: string | null;
      invoice_number: string;
      title: string | null;
      amount_cents: string | number | null;
      currency: string;
      status: string;
      due_date: string | Date | null;
      paid_at: string | Date | null;
      review_notes: string | null;
      reviewed_at: string | Date | null;
      reviewed_by: string | null;
      reviewed_by_email: string | null;
      supplier_company_id: string | null;
      supplier_company_name: string | null;
      created_at: string | Date;
    }[]).map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      workspaceTitle: r.workspace_title,
      workPackageId: r.work_package_id,
      workPackageName: r.work_package_name,
      invoiceNumber: r.invoice_number,
      title: r.title,
      amountCents: r.amount_cents != null ? Number(r.amount_cents) : 0,
      currency: r.currency,
      status: mapInvoiceStatus(r.status),
      dueDate: r.due_date ? String(r.due_date) : null,
      paidAt: r.paid_at ? String(r.paid_at) : null,
      reviewNotes: r.review_notes,
      reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
      reviewedByUserId: r.reviewed_by,
      reviewedByEmail: r.reviewed_by_email,
      supplierCompanyId: r.supplier_company_id,
      supplierCompanyName: r.supplier_company_name,
      createdAt: String(r.created_at),
    }));
    return { ok: true, data: invoices };
  } catch (e) {
    console.error("listClientInvoices failed:", e);
    return err("Could not load the invoices.");
  }
}

export async function doReviewClientInvoice(input: {
  orgId: string;
  workspaceId: string;
  invoiceId: string;
  decision: ClientInvoiceDecision;
  reviewNotes?: string;
}): Promise<SimpleResult> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  const decisions: ClientInvoiceDecision[] = ["approved", "rejected", "corrections_requested"];
  if (!decisions.includes(input.decision)) return err("Invalid decision.");
  try {
    await ensureSchema();
    const client = await loadClientUser();
    if (!client) return err("UNAUTHENTICATED");
    const membership = await membershipFor(client, input.orgId);
    if (!membership) return err("FORBIDDEN");
    // Invoice decisions are a finance responsibility (client_admin overrides).
    if (membership.role !== "client_finance" && membership.role !== "client_admin") {
      return err("Only finance users can review invoices.");
    }
    if (!(await assertClientWorkspace(client.user.id, membership.role, input.orgId, input.workspaceId))) {
      return err("FORBIDDEN");
    }

    const reviewNotes = input.reviewNotes?.trim().slice(0, 2000) || null;
    const rows = await asUser(client.user.id, membership.role, (tx) => [
      tx`update invoices
         set status = ${input.decision}, review_notes = ${reviewNotes},
             reviewed_at = now(), reviewed_by = ${client.user.id}, updated_at = now()
         where id = ${input.invoiceId}
           and workspace_id = ${input.workspaceId}
           and client_org_id = ${input.orgId}`,
      auditQuery(tx, client.user.id, "client.invoice.review", {
        orgId: input.orgId,
        workspaceId: input.workspaceId,
        invoiceId: input.invoiceId,
        decision: input.decision,
        reviewNotes,
      }, input.workspaceId, input.orgId),
    ]);
    if ((rows[1] as { count: number }).count !== 1) return err("Invoice not found.");
    return { ok: true };
  } catch (e) {
    console.error("reviewClientInvoice failed:", e);
    return err("Could not save the invoice review.");
  }
}

// ------------------------------------------------------- approvals hub
export async function doGetClientApprovals(orgId: string): Promise<ClientResult<ClientApprovals>> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    await ensureSchema();
    const client = await loadClientUser();
    if (!client) return err("UNAUTHENTICATED");
    const membership = await membershipFor(client, orgId);
    if (!membership) return err("FORBIDDEN");

    const rows = await asUser(client.user.id, membership.role, (tx) => [
      tx`select count(*)::int as n from variations v
         where v.client_org_id = ${orgId} and v.status in ('submitted','under_client_review','under_review')`,
      tx`select count(*)::int as n from invoices i
         where i.client_org_id = ${orgId} and i.status = 'under_review'`,
      tx`select count(*)::int as n from milestones m
         where m.client_org_id = ${orgId} and m.status in ('submitted','submitted_for_review')`,
      tx`select count(*)::int as n from documents d
         where d.client_org_id = ${orgId} and d.visibility = 'client_visible' and d.status = 'under_review'`,
      tx`select count(*)::int as n from issues i
         where i.client_org_id = ${orgId} and i.status = 'open'`,
      tx`select v.id, v.workspace_id, cw.title as workspace_title, v.work_package_id,
                wp.name as work_package_name, v.title, v.description, v.reason,
                v.proposed_amount_cents, v.status, v.conditions, v.decided_at,
                v.decided_by, du.email as decided_by_email, v.created_at
         from variations v
         join contract_workspaces cw on cw.id = v.workspace_id
         left join work_packages wp on wp.id = v.work_package_id
         left join users du on du.id = v.decided_by
         where v.client_org_id = ${orgId} and v.status in ('submitted','under_client_review','under_review')
         order by v.created_at desc limit 20`,
      tx`select i.id, i.workspace_id, cw.title as workspace_title, i.work_package_id,
                wp.name as work_package_name, i.invoice_number, i.title,
                coalesce(i.amount_cents, (i.amount * 100)::bigint) as amount_cents,
                i.currency, i.status, i.due_date, i.paid_at, i.review_notes,
                i.reviewed_at, i.reviewed_by, rv.email as reviewed_by_email,
                i.supplier_company_id, sc.name as supplier_company_name, i.created_at
         from invoices i
         join contract_workspaces cw on cw.id = i.workspace_id
         left join work_packages wp on wp.id = i.work_package_id
         left join users rv on rv.id = i.reviewed_by
         left join companies sc on sc.id = i.supplier_company_id
         where i.client_org_id = ${orgId} and i.status = 'under_review'
         order by i.created_at desc limit 20`,
      tx`select m.id, m.workspace_id, cw.title as workspace_title, m.work_package_id,
                wp.name as work_package_name, m.name as title, m.description, m.due_date,
                m.status, m.submitted_at, m.reviewed_at, m.reviewed_by,
                ru.email as reviewed_by_email, m.created_at
         from milestones m
         join contract_workspaces cw on cw.id = m.workspace_id
         left join work_packages wp on wp.id = m.work_package_id
         left join users ru on ru.id = m.reviewed_by
         where m.client_org_id = ${orgId} and m.status in ('submitted','submitted_for_review')
         order by m.created_at desc limit 20`,
      tx`select d.id, d.workspace_id, cw.title as workspace_title, d.name as title,
                d.file_name, d.category, d.status, d.uploaded_by,
                u.email as uploaded_by_email, d.shared_at, d.created_at, d.updated_at
         from documents d
         join contract_workspaces cw on cw.id = d.workspace_id
         left join users u on u.id = d.uploaded_by
         where d.client_org_id = ${orgId} and d.visibility = 'client_visible' and d.status = 'under_review'
         order by d.shared_at desc nulls last, d.created_at desc limit 20`,
      tx`select i.id, i.workspace_id, cw.title as workspace_title, i.work_package_id,
                wp.name as work_package_name, i.title, i.description, i.severity, i.status,
                i.response, i.responded_at, i.responded_by,
                ru.email as responded_by_email, i.raised_by,
                rby.email as raised_by_email, i.created_at
         from issues i
         join contract_workspaces cw on cw.id = i.workspace_id
         left join work_packages wp on wp.id = i.work_package_id
         left join users ru on ru.id = i.responded_by
         left join users rby on rby.id = i.raised_by
         where i.client_org_id = ${orgId} and i.status = 'open'
         order by i.created_at desc limit 20`,
    ]);

    const n = (i: number) => Number((rows[i + 1] as { n: number }[])[0]?.n ?? 0);

    return {
      ok: true,
      data: {
        counts: {
          variations: n(0),
          invoices: n(1),
          milestones: n(2),
          documents: n(3),
          issues: n(4),
        },
        variations: (rows[6] as Parameters<typeof mapVariationRow>[0][]).map(mapVariationRow),
        invoices: (rows[7] as Parameters<typeof mapInvoiceRow>[0][]).map(mapInvoiceRow),
        milestones: (rows[8] as Parameters<typeof mapMilestoneRow>[0][]).map(mapMilestoneRow),
        documents: (rows[9] as Parameters<typeof mapDocumentRow>[0][]).map(mapDocumentRow),
        issues: (rows[10] as Parameters<typeof mapIssueRow>[0][]).map(mapIssueRow),
      },
    };
  } catch (e) {
    console.error("getClientApprovals failed:", e);
    return err("Could not load your approvals.");
  }
}


// -------------------------------------------------- Part C: messaging + notifications
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGE_BODY_MAX = 4000;
function threadKeyOf(
  type: ClientMessageThreadType,
  entityId?: string | null,
): string {
  return type === "general" ? "general" : `${type}:${entityId ?? ""}`;
}
function parseThreadKey(
  key: string,
): { type: ClientMessageThreadType; entityId: string | null } {
  const idx = key.indexOf(":");
  if (idx === -1) {
    return {
      type: (CLIENT_MESSAGE_THREAD_TYPES as readonly string[]).includes(key)
        ? (key as ClientMessageThreadType)
        : "general",
      entityId: null,
    };
  }
  const type = key.slice(0, idx);
  const id = key.slice(idx + 1);
  return {
    type: (CLIENT_MESSAGE_THREAD_TYPES as readonly string[]).includes(type)
      ? (type as ClientMessageThreadType)
      : "general",
    entityId: id || null,
  };
}
/**
 * Org-scoped notification predicate (bound fragment, so orgId is always a
 * parameter). Matches rows denormalized to the org (client_org_id) and legacy
 * rows whose workspace is linked to the org via contract_clients.
 */
function notifScope(tx: Tx, orgId: string) {
  return tx`(
    n.client_org_id = ${orgId}
    or (n.client_org_id is null and n.workspace_id is not null and exists (
      select 1 from contract_clients cc
      where cc.contract_workspaces_id = n.workspace_id and cc.client_org_id = ${orgId}
    ))
  )`;
}
export async function doListClientConversations(
  orgId: string,
): Promise<ClientResult<ClientConversation[]>> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    await ensureSchema();
    const client = await loadClientUser();
    if (!client) return err("UNAUTHENTICATED");
    const membership = await membershipFor(client, orgId);
    if (!membership) return err("FORBIDDEN");
    const [, wsRows, threadRows, lastRows] = (await asUser(
      client.user.id,
      membership.role,
      (tx) => [
        tx`select cw.id as workspace_id, cw.title as workspace_title,
                  u.email as lead_email, p.name as lead_name,
                  (select c.name from companies c where c.owner_id = cw.lead_contractor_id) as lead_company
           from contract_clients cc
           join contract_workspaces cw on cw.id = cc.contract_workspaces_id
           left join users u on u.id = cw.lead_contractor_id
           left join profiles p on p.user_id = cw.lead_contractor_id
           where cc.client_org_id = ${orgId} and cw.status <> 'archived'
           order by cw.title`,
        tx`select m.workspace_id, m.thread_key,
                  count(*) filter (where r.last_read_at is null or m.created_at > r.last_read_at)::int as unread
           from messages m
           left join message_reads r
             on r.workspace_id = m.workspace_id and r.thread_key = m.thread_key
            and r.user_id = ${client.user.id}
           where m.client_org_id = ${orgId}
           group by m.workspace_id, m.thread_key`,
        tx`select distinct on (m.workspace_id, m.thread_key)
                  m.workspace_id, m.thread_key, m.body as last_body,
                  u.email as last_author_email, p.name as last_author_name,
                  (m.author_user_id = m.lead_contractor_id) as from_lead,
                  m.created_at as last_at
           from messages m
           left join users u on u.id = m.author_user_id
           left join profiles p on p.user_id = m.author_user_id
           where m.client_org_id = ${orgId}
           order by m.workspace_id, m.thread_key, m.created_at desc`,
      ],
    )) as unknown as [
      unknown,
      {
        workspace_id: string;
        workspace_title: string | null;
        lead_email: string | null;
        lead_name: string | null;
        lead_company: string | null;
      }[],
      { workspace_id: string; thread_key: string; unread: number }[],
      {
        workspace_id: string;
        thread_key: string;
        last_body: string;
        last_author_email: string | null;
        last_author_name: string | null;
        from_lead: boolean;
        last_at: string | Date;
      }[],
    ];
    // Resolve entity display titles for non-general threads.
    const idsByType = new Map<ClientMessageThreadType, string[]>();
    for (const t of threadRows) {
      const { type, entityId } = parseThreadKey(t.thread_key);
      if (type !== "general" && entityId) {
        const list = idsByType.get(type) ?? [];
        list.push(entityId);
        idsByType.set(type, list);
      }
    }
    const entityTitles = new Map<string, string>();
    if (idsByType.size > 0) {
      const entitySelects: ((tx: Tx) => TxQuery)[] = [];
      for (const [type, ids] of idsByType) {
        const uniq = [...new Set(ids)];
        if (type === "milestone")
          entitySelects.push((tx) => tx`select id, name as title from milestones where id = any(${uniq})`);
        if (type === "document")
          entitySelects.push((tx) => tx`select id, name as title from documents where id = any(${uniq})`);
        if (type === "issue")
          entitySelects.push((tx) => tx`select id, title from issues where id = any(${uniq})`);
        if (type === "variation")
          entitySelects.push((tx) => tx`select id, title from variations where id = any(${uniq})`);
        if (type === "invoice")
          entitySelects.push((tx) => tx`select id, invoice_number as title from invoices where id = any(${uniq})`);
        if (type === "report")
          entitySelects.push((tx) => tx`select id, title from progress_reports where id = any(${uniq})`);
        if (type === "package")
          entitySelects.push((tx) => tx`select id, name as title from work_packages where id = any(${uniq})`);
      }
      if (entitySelects.length > 0) {
        const [, ...res] = (await asUser(client.user.id, membership.role, (tx) =>
          entitySelects.map((build) => build(tx)),
        )) as unknown[];
        for (const r of res) {
          for (const row of r as { id: string; title: string | null }[]) {
            if (row.title) entityTitles.set(row.id, row.title);
          }
        }
      }
    }
    const lastByKey = new Map(
      lastRows.map((r) => [`${r.workspace_id}::${r.thread_key}`, r]),
    );
    const unreadByKey = new Map(
      threadRows.map((r) => [`${r.workspace_id}::${r.thread_key}`, r.unread]),
    );
    const conversations: ClientConversation[] = [];
    for (const w of wsRows) {
      const pushThread = (
        threadKey: string,
        type: ClientMessageThreadType,
        entityId: string | null,
        unread: number,
      ) => {
        const last = lastByKey.get(`${w.workspace_id}::${threadKey}`);
        conversations.push({
          workspaceId: w.workspace_id,
          workspaceTitle: w.workspace_title ?? "Contract",
          leadName: w.lead_name,
          leadEmail: w.lead_email,
          leadCompany: w.lead_company,
          threadKey,
          threadType: type,
          entityId,
          entityTitle: entityId ? (entityTitles.get(entityId) ?? null) : null,
          lastBody: last?.last_body ?? null,
          lastAuthorName: last?.last_author_name ?? null,
          lastAuthorSide: last ? (last.from_lead ? "lead" : "client") : null,
          lastMessageAt: last ? String(last.last_at) : null,
          unread,
        });
      };
      // Default client<->lead channel always present per contract.
      pushThread("general", "general", null, unreadByKey.get(`${w.workspace_id}::general`) ?? 0);
      for (const t of threadRows) {
        if (t.workspace_id !== w.workspace_id || t.thread_key === "general") continue;
        const { type, entityId } = parseThreadKey(t.thread_key);
        pushThread(t.thread_key, type, entityId, t.unread);
      }
    }
    conversations.sort((a, b) => {
      const aAt = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bAt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return bAt - aAt || a.workspaceTitle.localeCompare(b.workspaceTitle);
    });
    return { ok: true, data: conversations };
  } catch (e) {
    console.error("listClientConversations failed:", e);
    return err("Could not load your conversations.");
  }
}
export async function doListClientMessages(input: {
  orgId: string;
  workspaceId: string;
  threadKey: string;
}): Promise<ClientResult<ClientThread>> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    await ensureSchema();
    const client = await loadClientUser();
    if (!client) return err("UNAUTHENTICATED");
    const membership = await membershipFor(client, input.orgId);
    if (!membership) return err("FORBIDDEN");
    const link = await assertClientWorkspace(
      client.user.id,
      membership.role,
      input.orgId,
      input.workspaceId,
    );
    if (!link) return err("FORBIDDEN");
    const { type, entityId } = parseThreadKey(input.threadKey);
    const queries: ((tx: Tx) => TxQuery)[] = [
      (tx) => tx`select m.id, m.author_user_id, m.thread_key, m.thread_type, m.body,
                u.email as author_email, p.name as author_name,
                (m.author_user_id = m.lead_contractor_id) as from_lead, m.created_at
         from messages m
         left join users u on u.id = m.author_user_id
         left join profiles p on p.user_id = m.author_user_id
         where m.workspace_id = ${input.workspaceId} and m.thread_key = ${input.threadKey}
           and m.client_org_id = ${input.orgId}
         order by m.created_at asc, m.id asc`,
      (tx) => tx`select last_read_at from message_reads
         where workspace_id = ${input.workspaceId} and thread_key = ${input.threadKey}
           and user_id = ${client.user.id}`,
      (tx) => tx`select cw.title as workspace_title, u.email as lead_email, p.name as lead_name,
                (select c.name from companies c where c.owner_id = cw.lead_contractor_id) as lead_company
         from contract_workspaces cw
         left join users u on u.id = cw.lead_contractor_id
         left join profiles p on p.user_id = cw.lead_contractor_id
         where cw.id = ${input.workspaceId}`,
    ];
    if (type !== "general" && entityId) {
      if (type === "milestone")
        queries.push((tx) => tx`select name as title from milestones where id = ${entityId}`);
      if (type === "document")
        queries.push((tx) => tx`select name as title from documents where id = ${entityId}`);
      if (type === "issue")
        queries.push((tx) => tx`select title from issues where id = ${entityId}`);
      if (type === "variation")
        queries.push((tx) => tx`select title from variations where id = ${entityId}`);
      if (type === "invoice")
        queries.push((tx) => tx`select invoice_number as title from invoices where id = ${entityId}`);
      if (type === "report")
        queries.push((tx) => tx`select title from progress_reports where id = ${entityId}`);
      if (type === "package")
        queries.push((tx) => tx`select name as title from work_packages where id = ${entityId}`);
    }
    const [, msgRows, readRows, wsRow, ...entityRows] = (await asUser(
      client.user.id,
      membership.role,
      (tx) => queries.map((build) => build(tx)),
    )) as unknown[];
    const lastReadAt = (readRows as { last_read_at: string | Date | null }[])[0]?.last_read_at ?? null;
    const lastReadMs = lastReadAt ? new Date(lastReadAt).getTime() : 0;
    const messages: ClientMessage[] = (msgRows as {
      id: string;
      author_user_id: string;
      thread_key: string;
      thread_type: string;
      body: string;
      author_email: string;
      author_name: string | null;
      from_lead: boolean;
      created_at: string | Date;
    }[]).map((r) => ({
      id: r.id,
      workspaceId: input.workspaceId,
      threadKey: r.thread_key,
      threadType: (CLIENT_MESSAGE_THREAD_TYPES as readonly string[]).includes(r.thread_type)
        ? (r.thread_type as ClientMessageThreadType)
        : "general",
      body: r.body,
      authorUserId: r.author_user_id,
      authorName: r.author_name,
      authorEmail: r.author_email,
      authorSide: r.from_lead ? "lead" : "client",
      createdAt: String(r.created_at),
      read: lastReadMs > 0 && new Date(r.created_at).getTime() <= lastReadMs,
    }));
    const ws = (wsRow as {
      workspace_title: string | null;
      lead_email: string | null;
      lead_name: string | null;
      lead_company: string | null;
    }[])[0];
    const entityTitle = entityRows.length > 0
      ? String((entityRows[0] as { title: string | null }[])[0]?.title ?? "").trim() || null
      : null;
    return {
      ok: true,
      data: {
        workspaceId: input.workspaceId,
        workspaceTitle: ws?.workspace_title ?? "Contract",
        leadName: ws?.lead_name ?? null,
        leadEmail: ws?.lead_email ?? null,
        leadCompany: ws?.lead_company ?? null,
        threadKey: input.threadKey,
        threadType: type,
        entityId,
        entityTitle,
        messages,
        lastReadAt: lastReadAt ? String(lastReadAt) : null,
        unread: messages.filter((m) => !m.read).length,
      },
    };
  } catch (e) {
    console.error("listClientMessages failed:", e);
    return err("Could not load the conversation.");
  }
}
export async function doSendClientMessage(input: {
  orgId: string;
  workspaceId: string;
  threadType: ClientMessageThreadType;
  threadEntityId?: string | null;
  body: string;
}): Promise<SimpleResult> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  const body = input.body.trim().slice(0, MESSAGE_BODY_MAX);
  if (!body) return err("Message cannot be empty.");
  if (!(CLIENT_MESSAGE_THREAD_TYPES as readonly string[]).includes(input.threadType)) {
    return err("Invalid thread type.");
  }
  let entityId: string | null = input.threadEntityId ?? null;
  if (input.threadType !== "general") {
    if (!entityId || !UUID_RE.test(entityId)) return err("Thread entity missing.");
  } else {
    entityId = null;
  }
  const threadKey = threadKeyOf(input.threadType, entityId);
  try {
    await ensureSchema();
    const client = await loadClientUser();
    if (!client) return err("UNAUTHENTICATED");
    const membership = await membershipFor(client, input.orgId);
    if (!membership) return err("FORBIDDEN");
    const link = await assertClientWorkspace(
      client.user.id,
      membership.role,
      input.orgId,
      input.workspaceId,
    );
    if (!link) return err("FORBIDDEN");
    const title = link.workspaceTitle ?? "your contract";
    const linkHref = `/client/messages?org=${input.orgId}&ws=${input.workspaceId}&thread=${threadKey}`;
    await asUser(client.user.id, membership.role, (tx) => [
      tx`insert into messages (workspace_id, client_org_id, lead_contractor_id, thread_key, thread_type, author_user_id, body)
         values (${input.workspaceId}, ${input.orgId}, ${link.leadContractorId}, ${threadKey}, ${input.threadType}, ${client.user.id}, ${body})`,
      tx`insert into message_reads (workspace_id, client_org_id, lead_contractor_id, thread_key, user_id, last_read_at)
         values (${input.workspaceId}, ${input.orgId}, ${link.leadContractorId}, ${threadKey}, ${client.user.id}, now())
         on conflict (workspace_id, thread_key, user_id) do update set last_read_at = now()`,
      tx`insert into notifications (user_id, workspace_id, client_org_id, type, title, body, link)
         values (${link.leadContractorId}, ${input.workspaceId}, ${input.orgId}, 'new_message',
                 ${`New message on ${title}`}, ${body.slice(0, 120)}, ${linkHref})`,
      auditQuery(tx, client.user.id, "client.message.send", {
        orgId: input.orgId,
        workspaceId: input.workspaceId,
        threadKey,
        threadType: input.threadType,
      }, input.workspaceId, input.orgId),
    ]);
    return { ok: true };
  } catch (e) {
    console.error("sendClientMessage failed:", e);
    return err("Could not send the message.");
  }
}
export async function doMarkClientMessagesRead(input: {
  orgId: string;
  workspaceId: string;
  threadKey: string;
}): Promise<SimpleResult> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    await ensureSchema();
    const client = await loadClientUser();
    if (!client) return err("UNAUTHENTICATED");
    const membership = await membershipFor(client, input.orgId);
    if (!membership) return err("FORBIDDEN");
    const link = await assertClientWorkspace(
      client.user.id,
      membership.role,
      input.orgId,
      input.workspaceId,
    );
    if (!link) return err("FORBIDDEN");
    await asUser(client.user.id, membership.role, (tx) => [
      tx`insert into message_reads (workspace_id, client_org_id, lead_contractor_id, thread_key, user_id, last_read_at)
         values (${input.workspaceId}, ${input.orgId}, ${link.leadContractorId}, ${input.threadKey}, ${client.user.id}, now())
         on conflict (workspace_id, thread_key, user_id) do update set last_read_at = now()`,
      auditQuery(tx, client.user.id, "client.message.mark_read", {
        orgId: input.orgId,
        workspaceId: input.workspaceId,
        threadKey: input.threadKey,
      }, input.workspaceId, input.orgId),
    ]);
    return { ok: true };
  } catch (e) {
    console.error("markClientMessagesRead failed:", e);
    return err("Could not update read state.");
  }
}
export async function doListClientNotifications(
  orgId: string,
): Promise<ClientResult<{ notifications: ClientNotification[]; unreadCount: number }>> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    await ensureSchema();
    const client = await loadClientUser();
    if (!client) return err("UNAUTHENTICATED");
    const membership = await membershipFor(client, orgId);
    if (!membership) return err("FORBIDDEN");
    const [, rows, counts] = (await asUser(client.user.id, membership.role, (tx) => [
      tx`select n.id, n.type, n.title, n.body, n.link, n.workspace_id,
                cw.title as workspace_title, n.read_at, n.created_at
         from notifications n
         left join contract_workspaces cw on cw.id = n.workspace_id
         where n.user_id = ${client.user.id} and ${notifScope(tx, orgId)}
         order by n.created_at desc limit 100`,
      tx`select count(*) filter (where read_at is null)::int as unread,
                count(*)::int as total
         from notifications n
         where n.user_id = ${client.user.id} and ${notifScope(tx, orgId)}`,
    ])) as unknown as [
      unknown,
      {
        id: string;
        type: string;
        title: string;
        body: string | null;
        link: string | null;
        workspace_id: string | null;
        workspace_title: string | null;
        read_at: string | Date | null;
        created_at: string | Date;
      }[],
      { unread: number; total: number }[],
    ];
    const notifications: ClientNotification[] = rows.map((r) => ({
      id: r.id,
      type: (CLIENT_NOTIFICATION_TYPES as readonly string[]).includes(r.type)
        ? (r.type as ClientNotification["type"])
        : "system",
      title: r.title,
      body: r.body,
      link: r.link,
      workspaceId: r.workspace_id,
      workspaceTitle: r.workspace_title,
      read: r.read_at !== null,
      createdAt: String(r.created_at),
    }));
    return {
      ok: true,
      data: {
        notifications,
        unreadCount: Number(counts[0]?.unread ?? 0),
      },
    };
  } catch (e) {
    console.error("listClientNotifications failed:", e);
    return err("Could not load your notifications.");
  }
}
export async function doMarkClientNotificationRead(input: {
  orgId: string;
  notificationId: string;
}): Promise<SimpleResult> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    await ensureSchema();
    const client = await loadClientUser();
    if (!client) return err("UNAUTHENTICATED");
    const membership = await membershipFor(client, input.orgId);
    if (!membership) return err("FORBIDDEN");
    const rows = await asUser(client.user.id, membership.role, (tx) => [
      tx`update notifications n set read_at = now()
         where n.id = ${input.notificationId} and n.user_id = ${client.user.id}
           and ${notifScope(tx, input.orgId)}`,
      auditQuery(tx, client.user.id, "client.notification.read", {
        orgId: input.orgId,
        notificationId: input.notificationId,
      }, null, input.orgId),
    ]);
    if ((rows[1] as { count: number }).count !== 1) return err("Notification not found.");
    return { ok: true };
  } catch (e) {
    console.error("markClientNotificationRead failed:", e);
    return err("Could not update the notification.");
  }
}
export async function doMarkAllClientNotificationsRead(
  orgId: string,
): Promise<SimpleResult> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    await ensureSchema();
    const client = await loadClientUser();
    if (!client) return err("UNAUTHENTICATED");
    const membership = await membershipFor(client, orgId);
    if (!membership) return err("FORBIDDEN");
    await asUser(client.user.id, membership.role, (tx) => [
      tx`update notifications n set read_at = now()
         where n.user_id = ${client.user.id} and n.read_at is null
           and ${notifScope(tx, orgId)}`,
      auditQuery(tx, client.user.id, "client.notification.mark_all_read", {
        orgId,
      }, null, orgId),
    ]);
    return { ok: true };
  } catch (e) {
    console.error("markAllClientNotificationsRead failed:", e);
    return err("Could not update your notifications.");
  }
}
// ------------------------------------------------ shared row mappers (Part B)
function mapDocumentRow(r: {
  id: string;
  workspace_id: string;
  workspace_title: string | null;
  title: string;
  file_name: string | null;
  category: ClientDocumentCategory | null;
  status: string;
  uploaded_by: string | null;
  uploaded_by_email: string | null;
  shared_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}): ClientDocument {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    workspaceTitle: r.workspace_title,
    title: r.title,
    fileName: r.file_name,
    category: r.category,
    status: mapDocumentStatus(r.status),
    uploadedByUserId: r.uploaded_by,
    uploadedByEmail: r.uploaded_by_email,
    sharedAt: r.shared_at ? String(r.shared_at) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function mapMilestoneRow(r: {
  id: string;
  workspace_id: string;
  workspace_title: string | null;
  work_package_id: string | null;
  work_package_name: string | null;
  title: string;
  description: string | null;
  due_date: string | Date | null;
  status: string;
  submitted_at: string | Date | null;
  reviewed_at: string | Date | null;
  reviewed_by: string | null;
  reviewed_by_email: string | null;
  created_at: string | Date;
}): ClientMilestone {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    workspaceTitle: r.workspace_title,
    workPackageId: r.work_package_id,
    workPackageName: r.work_package_name,
    title: r.title,
    description: r.description,
    dueDate: r.due_date ? String(r.due_date) : null,
    status: mapMilestoneStatus(r.status),
    submittedAt: r.submitted_at ? String(r.submitted_at) : null,
    reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
    reviewedByUserId: r.reviewed_by,
    reviewedByEmail: r.reviewed_by_email,
    createdAt: String(r.created_at),
  };
}

function mapIssueRow(r: {
  id: string;
  workspace_id: string;
  workspace_title: string | null;
  work_package_id: string | null;
  work_package_name: string | null;
  title: string;
  description: string | null;
  severity: ClientIssueSeverity | null;
  status: string;
  response: string | null;
  responded_at: string | Date | null;
  responded_by: string | null;
  responded_by_email: string | null;
  raised_by: string | null;
  raised_by_email: string | null;
  created_at: string | Date;
}): ClientIssue {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    workspaceTitle: r.workspace_title,
    workPackageId: r.work_package_id,
    workPackageName: r.work_package_name,
    title: r.title,
    description: r.description,
    severity: r.severity,
    status: mapIssueStatus(r.status),
    response: r.response,
    respondedAt: r.responded_at ? String(r.responded_at) : null,
    respondedByUserId: r.responded_by,
    respondedByEmail: r.responded_by_email,
    raisedByUserId: r.raised_by,
    raisedByEmail: r.raised_by_email,
    createdAt: String(r.created_at),
  };
}

function mapVariationRow(r: {
  id: string;
  workspace_id: string;
  workspace_title: string | null;
  work_package_id: string | null;
  work_package_name: string | null;
  title: string;
  description: string | null;
  reason: string | null;
  proposed_amount_cents: string | number | null;
  status: string;
  conditions: string | null;
  decided_at: string | Date | null;
  decided_by: string | null;
  decided_by_email: string | null;
  created_at: string | Date;
}): ClientVariation {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    workspaceTitle: r.workspace_title,
    workPackageId: r.work_package_id,
    workPackageName: r.work_package_name,
    title: r.title,
    description: r.description,
    reason: r.reason,
    proposedAmountCents: r.proposed_amount_cents != null ? Number(r.proposed_amount_cents) : null,
    status: mapVariationStatus(r.status),
    conditions: r.conditions,
    decidedAt: r.decided_at ? String(r.decided_at) : null,
    decidedByUserId: r.decided_by,
    decidedByEmail: r.decided_by_email,
    createdAt: String(r.created_at),
  };
}

function mapInvoiceRow(r: {
  id: string;
  workspace_id: string;
  workspace_title: string | null;
  work_package_id: string | null;
  work_package_name: string | null;
  invoice_number: string;
  title: string | null;
  amount_cents: string | number | null;
  currency: string;
  status: string;
  due_date: string | Date | null;
  paid_at: string | Date | null;
  review_notes: string | null;
  reviewed_at: string | Date | null;
  reviewed_by: string | null;
  reviewed_by_email: string | null;
  supplier_company_id: string | null;
  supplier_company_name: string | null;
  created_at: string | Date;
}): ClientInvoice {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    workspaceTitle: r.workspace_title,
    workPackageId: r.work_package_id,
    workPackageName: r.work_package_name,
    invoiceNumber: r.invoice_number,
    title: r.title,
    amountCents: r.amount_cents != null ? Number(r.amount_cents) : 0,
    currency: r.currency,
    status: mapInvoiceStatus(r.status),
    dueDate: r.due_date ? String(r.due_date) : null,
    paidAt: r.paid_at ? String(r.paid_at) : null,
    reviewNotes: r.review_notes,
    reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
    reviewedByUserId: r.reviewed_by,
    reviewedByEmail: r.reviewed_by_email,
    supplierCompanyId: r.supplier_company_id,
    supplierCompanyName: r.supplier_company_name,
    createdAt: String(r.created_at),
  };
}
