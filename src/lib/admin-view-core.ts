/**
 * View as Client core — ALL server-only logic for the Master Admin "View as
 * Client" support mode (Master Admin spec section 4).
 *
 * SECURITY MODEL:
 *  - Every entry point calls loadAdminUser(): the session user must hold a row
 *    in admin_roles, otherwise the call is denied. The acting role passed to
 *    asUser() is always the admin's forced 'sb_admin' role — we NEVER switch
 *    identity or create a fake client session. All reads run under the admin's
 *    own RLS scope (sb_admin policies see all rows), not the client's.
 *  - A temporary session is recorded in admin_view_sessions (token stored
 *    hashed, 20 minute expiry, ended_at tombstone). The token travels in an
 *    HttpOnly cookie so it never appears in URLs or browser history.
 *  - Every view data call re-validates the token and asserts the requested
 *    client_org_id matches the session's bound org — access to data outside
 *    the selected company is impossible even if the URL is forged.
 *  - Every enter / exit / auto-expiry writes an immutable audit_logs row with
 *    company_id + reason + admin actor + timestamps + duration, scoped to the
 *    client org (client_org_id) so the org's own activity trail shows a named
 *    administrator, never a fake client identity.
 *  - View mode is strictly read-only: no write server functions are exposed.
 *
 * This module is imported exclusively from ./admin-view.ts (server-function
 * wrappers) so it never reaches the browser bundle.
 */
import { createHash, randomBytes } from "node:crypto";
import { getCookie, setResponseHeader } from "@tanstack/react-start/server";
import { asUser, dbConfigured, ensureSchema } from "./db";
import { auditQuery } from "./audit";
import { loadAdminUser } from "./auth-core";
import type {
  ClientConversation,
  ClientDashboardStats,
  ClientNotification,
  ClientOrgProfile,
  ClientTeamMember,
} from "./types";

export const VIEW_COOKIE = "sb_view_as_client";
const VIEW_TTL_MINUTES = 20;
const VIEW_TTL_MS = VIEW_TTL_MINUTES * 60 * 1000;
const MIN_REASON_LENGTH = 3;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function viewCookie(token: string): string {
  return `${VIEW_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${VIEW_TTL_MINUTES * 60}`;
}

const clearViewCookie = () => `${VIEW_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

// ------------------------------------------------------------- result types
export type ViewAsClientSessionInfo = {
  companyId: string;
  companyName: string;
  orgId: string;
  orgName: string;
  reason: string;
  adminName: string | null;
  adminEmail: string;
  adminRoles: string[];
  expiresAt: string;
  secondsLeft: number;
};

export type ViewAsClientResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; setupRequired?: boolean };

export type ViewAsClientSessionResult =
  | { ok: true; session: ViewAsClientSessionInfo }
  | { ok: false; error: string; setupRequired?: boolean };

export type ViewAsClientEnterResult =
  | { ok: true; session: ViewAsClientSessionInfo }
  | { ok: false; error: string; setupRequired?: boolean };

function err(msg: string, setupRequired?: boolean): { ok: false; error: string; setupRequired?: boolean } {
  return { ok: false, error: msg, setupRequired };
}

/** Active view-session row + admin, validated for the current request. */
type ActiveView = {
  id: string;
  token: string;
  companyId: string;
  companyName: string;
  orgId: string;
  orgName: string;
  reason: string;
  createdAt: Date;
  expiresAt: Date;
};

/**
 * Resolve the active View as Client session for this request.
 *
 * Validates: authenticated admin, cookie present, token matches a row,
 * session not ended, not expired, and the row belongs to the acting admin.
 * On expiry it tombstones the row, writes the auto-expiry audit entry and
 * clears the cookie once, then reports "expired" so the caller redirects.
 */
async function loadActiveView(
  orgId?: string,
): Promise<{ view: ActiveView | null; error: string | null; expired: boolean }> {
  if (!dbConfigured()) return { view: null, error: "SETUP_REQUIRED", expired: false };
  await ensureSchema();
  const admin = await loadAdminUser();
  if (!admin) return { view: null, error: "UNAUTHENTICATED", expired: false };
  const token = getCookie(VIEW_COOKIE);
  if (!token) return { view: null, error: "NO_VIEW_SESSION", expired: false };
  const tokenHash = sha256Hex(token);

  const rows = await asUser(admin.user.id, admin.user.role, (tx) => [
    tx`select v.id, v.company_id, v.client_org_id, v.reason, v.created_at, v.expires_at, v.ended_at,
              c.name as company_name, o.name as org_name
       from admin_view_sessions v
       join companies c on c.id = v.company_id
       left join client_organizations o on o.id = v.client_org_id
       where v.token_hash = ${tokenHash} and v.admin_user_id = ${admin.user.id}`,
  ]);
  const row = (rows[1] as {
    id: string;
    company_id: string;
    client_org_id: string | null;
    reason: string;
    created_at: string;
    expires_at: string;
    ended_at: string | null;
    company_name: string;
    org_name: string | null;
  }[])[0];
  if (!row) return { view: null, error: "NO_VIEW_SESSION", expired: false };
  if (row.ended_at) return { view: null, error: "NO_VIEW_SESSION", expired: false };
  if (orgId && row.client_org_id !== orgId) {
    return { view: null, error: "FORBIDDEN", expired: false };
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    // Tombstone + audit the auto-expiry (once) and clear the cookie.
    const durationSecs = Math.max(
      0,
      Math.round((new Date().getTime() - new Date(row.created_at).getTime()) / 1000),
    );
    await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`update admin_view_sessions set ended_at = now() where id = ${row.id} and ended_at is null`,
      auditQuery(
        tx,
        admin.user.id,
        "admin.view_as_client.expired",
        {
          companyId: row.company_id,
          companyName: row.company_name,
          clientOrgId: row.client_org_id,
          clientOrgName: row.org_name,
          reason: row.reason,
          durationSecs,
          expiresAt: String(row.expires_at),
        },
        null,
        row.client_org_id,
      ),
    ]);
    setResponseHeader("Set-Cookie", clearViewCookie());
    return { view: null, error: "EXPIRED", expired: true };
  }
  return {
    view: {
      id: row.id,
      token,
      companyId: row.company_id,
      companyName: row.company_name,
      orgId: row.client_org_id ?? "",
      orgName: row.org_name ?? "",
      reason: row.reason,
      createdAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
    },
    error: null,
    expired: false,
  };
}

// ---------------------------------------------------------------- enter / exit
/**
 * Open a View as Client session for a company.
 *  - validates the acting admin
 *  - resolves the company + its linked client orgs (workspaces owned by or
 *    inviting the company, via contract_clients — same edges as the company
 *    detail Client Portals tab)
 *  - records audit_logs admin.view_as_client.enter (company id, reason, admin,
 *    timestamp, org scope)
 *  - stores the token (hashed) with a 20-minute expiry and sets the HttpOnly
 *    cookie
 */
export async function doEnterViewAsClient(input: {
  companyId: string;
  reason: string;
  orgId?: string | null;
}): Promise<ViewAsClientEnterResult> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  const reason = (input.reason ?? "").trim();
  if (reason.length < MIN_REASON_LENGTH) {
    return err("Please enter a reason (at least a few words) for viewing as client.");
  }
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return err("UNAUTHENTICATED");

    const rows = await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select id, name from companies where id = ${input.companyId}`,
      tx`select distinct o.id, o.name
         from client_organizations o
         where o.id in (
           select cc.client_org_id from contract_clients cc
           where cc.contract_workspaces_id in (
             select cw.id from contract_workspaces cw
             where cw.lead_contractor_id = (select owner_id from companies where id = ${input.companyId})
                or exists (select 1 from invitations i2
                           where i2.workspace_id = cw.id and i2.company_id = ${input.companyId})
           )
         )
         order by o.name`,
    ]);
    const companyRows = rows[1] as { id: string; name: string }[];
    const company = companyRows[0];
    if (!company) return err("Company not found.");
    const orgRows = rows[2] as { id: string; name: string }[];
    let org = orgRows.find((o) => o.id === input.orgId) ?? null;
    if (!org && input.orgId) {
      // An orgId was requested but it is not linked to this company.
      return err("That client portal is not linked to this company.");
    }
    if (!org) org = orgRows[0] ?? null;
    if (!org) {
      return err("This company has no linked client portal. View as Client needs a buying organisation linked to one of its contract workspaces.");
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + VIEW_TTL_MS);
    await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`insert into admin_view_sessions (token_hash, admin_user_id, company_id, client_org_id, reason, expires_at)
         values (${sha256Hex(token)}, ${admin.user.id}, ${company.id}, ${org.id}, ${reason}, ${expiresAt.toISOString()})`,
      auditQuery(
        tx,
        admin.user.id,
        "admin.view_as_client.enter",
        {
          companyId: company.id,
          companyName: company.name,
          clientOrgId: org.id,
          clientOrgName: org.name,
          reason,
          expiresAt: expiresAt.toISOString(),
        },
        null,
        org.id,
      ),
    ]);
    setResponseHeader("Set-Cookie", viewCookie(token));

    return {
      ok: true,
      session: {
        companyId: company.id,
        companyName: company.name,
        orgId: org.id,
        orgName: org.name,
        reason,
        adminName: admin.user.name,
        adminEmail: admin.user.email,
        adminRoles: admin.staffRoles,
        expiresAt: expiresAt.toISOString(),
        secondsLeft: VIEW_TTL_MINUTES * 60,
      },
    };
  } catch (e) {
    console.error("enterViewAsClient failed:", e);
    return err("Could not open the client view. Please try again.");
  }
}

/** Resolve the active session (route loader / banner). */
export async function doGetViewAsClientSession(): Promise<ViewAsClientSessionResult> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    const admin = await loadAdminUser();
    if (!admin) return err("UNAUTHENTICATED");
    const { view, error } = await loadActiveView();
    if (!view || error) return err(error ?? "NO_VIEW_SESSION");
    return {
      ok: true,
      session: {
        companyId: view.companyId,
        companyName: view.companyName,
        orgId: view.orgId,
        orgName: view.orgName,
        reason: view.reason,
        adminName: admin.user.name,
        adminEmail: admin.user.email,
        adminRoles: admin.staffRoles,
        expiresAt: view.expiresAt.toISOString(),
        secondsLeft: Math.max(0, Math.round((view.expiresAt.getTime() - Date.now()) / 1000)),
      },
    };
  } catch (e) {
    console.error("getViewAsClientSession failed:", e);
    return err("Could not load the client view session.");
  }
}

/** End the session: audit exit with duration, tombstone, clear cookie. */
export async function doExitViewAsClient(): Promise<ViewAsClientResult<{ ended: boolean }>> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    const admin = await loadAdminUser();
    if (!admin) return err("UNAUTHENTICATED");
    const { view } = await loadActiveView();
    if (!view) {
      // Nothing active: still clear the cookie so a stale flag cannot linger.
      setResponseHeader("Set-Cookie", clearViewCookie());
      return { ok: true, data: { ended: false } };
    }
    const durationSecs = Math.max(
      0,
      Math.round((Date.now() - view.createdAt.getTime()) / 1000),
    );
    await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`update admin_view_sessions set ended_at = now() where id = ${view.id} and ended_at is null`,
      auditQuery(
        tx,
        admin.user.id,
        "admin.view_as_client.exit",
        {
          companyId: view.companyId,
          companyName: view.companyName,
          clientOrgId: view.orgId,
          clientOrgName: view.orgName,
          reason: view.reason,
          durationSecs,
        },
        null,
        view.orgId,
      ),
    ]);
    setResponseHeader("Set-Cookie", clearViewCookie());
    return { ok: true, data: { ended: true } };
  } catch (e) {
    console.error("exitViewAsClient failed:", e);
    return err("Could not exit the client view.");
  }
}

// ------------------------------------------------------------- view data fns
/**
 * Every view data function resolves the active session, then runs the SAME
 * query the client portal runs for that org — but under asUser(admin.id,
 * 'sb_admin', ...). The admin's own RLS scope sees the full record set (the
 * client's row-level restrictions do not apply), which is the intended admin
 * privilege; the org bound is still enforced so a forged orgId cannot read
 * another company's data.
 */

export async function doGetViewAsClientDashboard(
  orgId: string,
): Promise<ViewAsClientResult<ClientDashboardStats>> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return err("UNAUTHENTICATED");
    const { view, error } = await loadActiveView(orgId);
    if (!view || error) return err(error ?? "NO_VIEW_SESSION");

    const rows = await asUser(admin.user.id, admin.user.role, (tx) => [
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
        orgName: orgRows[0]?.name ?? view.orgName,
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
        recentMessages: 0,
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
    console.error("getViewAsClientDashboard failed:", e);
    return err("Could not load the client dashboard.");
  }
}

// ------------------------------------------------------------------ contracts
export async function doGetViewAsClientContracts(
  orgId: string,
): Promise<ViewAsClientResult<import("./types").ClientContractSummary[]>> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return err("UNAUTHENTICATED");
    const { view, error } = await loadActiveView(orgId);
    if (!view || error) return err(error ?? "NO_VIEW_SESSION");

    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
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
    const contracts: import("./types").ClientContractSummary[] = (rows as {
      id: string;
      title: string;
      description: string | null;
      status: import("./types").ClientContractSummary["status"];
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
      packageCount: Number(r.package_count ?? 0),
      completionPct: r.completion === null ? null : Math.round(r.completion),
      visiblePackageCount: Number(r.package_count ?? 0),
    })) as import("./types").ClientContractSummary[];
    return { ok: true, data: contracts };
  } catch (e) {
    console.error("getViewAsClientContracts failed:", e);
    return err("Could not load the client contracts.");
  }
}

export async function doGetViewAsClientContract(
  orgId: string,
  workspaceId: string,
): Promise<ViewAsClientResult<import("./types").ClientContractDetail>> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return err("UNAUTHENTICATED");
    const { view, error } = await loadActiveView(orgId);
    if (!view || error) return err(error ?? "NO_VIEW_SESSION");

    const rows = await asUser(admin.user.id, admin.user.role, (tx) => [
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
      status: import("./types").ClientContractDetail["workspace"]["status"];
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
    const orgRows = rows[3] as { org_id: string; name: string; contact_email: string | null }[];
    const leadCoRows = rows[4] as { name: string }[];
    const partRows = rows[5] as { company_id: string; company_name: string }[];
    const pkgRows = rows[6] as {
      id: string;
      name: string;
      description: string | null;
      scope_notes: string | null;
      category: string | null;
      status: import("./types").ClientContractDetail["workPackages"][number]["status"];
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
          name: orgRows[0]?.name ?? view.orgName,
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
    console.error("getViewAsClientContract failed:", e);
    return err("Could not load the contract.");
  }
}

// ------------------------------------------------------------- organisation
export async function doGetViewAsClientOrg(
  orgId: string,
): Promise<ViewAsClientResult<ClientOrgProfile>> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return err("UNAUTHENTICATED");
    const { view, error } = await loadActiveView(orgId);
    if (!view || error) return err(error ?? "NO_VIEW_SESSION");

    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
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
    console.error("getViewAsClientOrg failed:", e);
    return err("Could not load the organisation profile.");
  }
}

// ---------------------------------------------------------------------- team
export async function doListViewAsClientTeam(
  orgId: string,
): Promise<ViewAsClientResult<ClientTeamMember[]>> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return err("UNAUTHENTICATED");
    const { view, error } = await loadActiveView(orgId);
    if (!view || error) return err(error ?? "NO_VIEW_SESSION");

    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select m.user_id, u.email, p.name, m.role, m.created_at
         from client_org_members m
         join users u on u.id = m.user_id
         left join profiles p on p.user_id = m.user_id
         where m.org_id = ${orgId}
         order by m.role, p.name nulls last, u.email`,
    ]))[1] as unknown[];
    const team: ClientTeamMember[] = (rows as {
      user_id: string;
      email: string;
      name: string | null;
      role: ClientTeamMember["role"];
      created_at: string;
    }[]).map((r) => ({
      userId: r.user_id,
      email: r.email,
      name: r.name,
      role: r.role,
      userStatus: "active" as const,
      isSelf: false,
      joinedAt: String(r.created_at),
    }));
    return { ok: true, data: team };
  } catch (e) {
    console.error("listViewAsClientTeam failed:", e);
    return err("Could not load the team.");
  }
}

// ------------------------------------------------------------- notifications
export async function doListViewAsClientNotifications(
  orgId: string,
): Promise<ViewAsClientResult<{ notifications: ClientNotification[]; unreadCount: number }>> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return err("UNAUTHENTICATED");
    const { view, error } = await loadActiveView(orgId);
    if (!view || error) return err(error ?? "NO_VIEW_SESSION");

    // Org-scoped notifications: the admin sees every notification raised for
    // this client org (the client's own list is per-user and would hide
    // notifications addressed to colleagues). Read-only.
    const [, rows] = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select n.id, n.type, n.title, n.body, n.link, n.workspace_id,
                cw.title as workspace_title, n.read_at, n.created_at
         from notifications n
         left join contract_workspaces cw on cw.id = n.workspace_id
         where n.client_org_id = ${orgId}
         order by n.created_at desc limit 100`,
      tx`select count(*) filter (where read_at is null)::int as unread,
                count(*)::int as total
         from notifications n
         where n.client_org_id = ${orgId}`,
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
      type: (["invitation","approval_needed","new_message","milestone","document","issue","variation","invoice","report","system"] as const).includes(r.type as never)
        ? (r.type as import("./types").ClientNotification["type"])
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
      data: { notifications, unreadCount: notifications.filter((x) => !x.read).length },
    };
  } catch (e) {
    console.error("listViewAsClientNotifications failed:", e);
    return err("Could not load the notifications.");
  }
}

// ---------------------------------------------------------------- messages
export async function doListViewAsClientConversations(
  orgId: string,
): Promise<ViewAsClientResult<ClientConversation[]>> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return err("UNAUTHENTICATED");
    const { view, error } = await loadActiveView(orgId);
    if (!view || error) return err(error ?? "NO_VIEW_SESSION");

    const [, wsRows, threadRows, lastRows] = (await asUser(
      admin.user.id,
      admin.user.role,
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
                  count(*)::int as total
           from messages m
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
      { workspace_id: string; thread_key: string; total: number }[],
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
    const lastByKey = new Map(
      lastRows.map((r) => [`${r.workspace_id}::${r.thread_key}`, r]),
    );
    const totalByKey = new Map(
      threadRows.map((r) => [`${r.workspace_id}::${r.thread_key}`, r.total]),
    );
    const conversations: ClientConversation[] = [];
    for (const w of wsRows) {
      const pushThread = (threadKey: string, type: string, entityId: string | null) => {
        const last = lastByKey.get(`${w.workspace_id}::${threadKey}`);
        conversations.push({
          workspaceId: w.workspace_id,
          workspaceTitle: w.workspace_title ?? "Contract",
          leadName: w.lead_name,
          leadEmail: w.lead_email,
          leadCompany: w.lead_company,
          threadKey,
          threadType: (["general", "milestone", "document", "issue", "variation", "invoice", "report", "package"] as const).includes(type as never)
            ? (type as ClientConversation["threadType"])
            : "general",
          entityId,
          entityTitle: null,
          lastBody: last?.last_body ?? null,
          lastAuthorName: last?.last_author_name ?? null,
          lastAuthorSide: last ? (last.from_lead ? "lead" : "client") : null,
          lastMessageAt: last ? String(last.last_at) : null,
          unread: 0,
        });
      };
      pushThread("general", "general", null);
      for (const t of threadRows) {
        if (t.workspace_id !== w.workspace_id || t.thread_key === "general") continue;
        const [type, entityId] = parseThreadKey(t.thread_key);
        pushThread(t.thread_key, type, entityId);
      }
    }
    conversations.sort((a, b) => {
      const aAt = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bAt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return bAt - aAt || a.workspaceTitle.localeCompare(b.workspaceTitle);
    });
    return { ok: true, data: conversations };
  } catch (e) {
    console.error("listViewAsClientConversations failed:", e);
    return err("Could not load the conversations.");
  }
}

export async function doListViewAsClientMessages(input: {
  orgId: string;
  workspaceId: string;
  threadKey: string;
}): Promise<ViewAsClientResult<import("./types").ClientThread>> {
  if (!dbConfigured()) return err("SETUP_REQUIRED", true);
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return err("UNAUTHENTICATED");
    const { view, error } = await loadActiveView(input.orgId);
    if (!view || error) return err(error ?? "NO_VIEW_SESSION");

    const [type, entityId] = parseThreadKey(input.threadKey);
    const queries: ((tx: import("./db").Tx) => import("./db").TxQuery)[] = [
      (tx) => tx`select m.id, m.author_user_id, m.thread_key, m.thread_type, m.body,
                u.email as author_email, p.name as author_name,
                (m.author_user_id = m.lead_contractor_id) as from_lead, m.created_at
         from messages m
         left join users u on u.id = m.author_user_id
         left join profiles p on p.user_id = m.author_user_id
         where m.workspace_id = ${input.workspaceId} and m.thread_key = ${input.threadKey}
           and m.client_org_id = ${input.orgId}
         order by m.created_at asc, m.id asc`,
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
    const [, msgRows, wsRow, ...entityRows] = (await asUser(
      admin.user.id,
      admin.user.role,
      (tx) => queries.map((build) => build(tx)),
    )) as unknown[];
    const ws = (wsRow as {
      workspace_title: string | null;
      lead_email: string | null;
      lead_name: string | null;
      lead_company: string | null;
    }[])[0];
    const messages = (msgRows as {
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
      threadType: (["general", "milestone", "document", "issue", "variation", "invoice", "report", "package"] as const).includes(r.thread_type as never)
        ? (r.thread_type as import("./types").ClientMessage["threadType"])
        : "general",
      body: r.body,
      authorUserId: r.author_user_id,
      authorName: r.author_name,
      authorEmail: r.author_email,
      authorSide: r.from_lead ? "lead" : "client",
      createdAt: String(r.created_at),
      read: true,
    })) as import("./types").ClientMessage[];
    const entityTitle =
      type !== "general" && entityId
        ? (entityRows[0] as { title: string | null }[] | undefined)?.[0]?.title ?? null
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
        threadType: (["general", "milestone", "document", "issue", "variation", "invoice", "report", "package"] as const).includes(type as never)
          ? (type as import("./types").ClientMessage["threadType"])
          : "general",
        entityTitle,
        messages,
        lastReadAt: null,
        unread: 0,
      },
    };
  } catch (e) {
    console.error("listViewAsClientMessages failed:", e);
    return err("Could not load the messages.");
  }
}

/** Parse a thread key "type:entityId" (mirrors client-core). */
function parseThreadKey(threadKey: string): [string, string | null] {
  const idx = threadKey.indexOf(":");
  if (idx === -1) return [threadKey, null];
  return [threadKey.slice(0, idx), threadKey.slice(idx + 1) || null];
}
