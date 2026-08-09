/**
 * Workspace, work package, invitation and notification core — ALL server-only
 * logic (DB access via ~/db + asUser, rate limiting). This module is imported
 * exclusively from ./workspace.ts (server-function wrappers) whose handler
 * bodies are replaced with RPC stubs in the client build, so this module and
 * its node/neon imports never reach the browser bundle. Do not import it from
 * client components.
 */
import { randomUUID } from "node:crypto";
import { asService, asUser, dbConfigured, ensureSchema } from "./db";
import { auditQuery } from "./audit";
import { loadSessionUser } from "./auth-core";
import type {
  AuditDetails,
  AuditEntry,
  InvitationResponse,
  InviteInput,
  ParticipantRole,
  PublicInvitation,
  PublicNotification,
  PublicWorkPackage,
  PublicWorkspace,
  WorkspaceInput,
  WorkspaceStatus,
} from "./types";
import { INVITATION_STATUSES } from "./types";

// ------------------------------------------------------------- result types
export type SimpleResult =
  | { ok: true }
  | { ok: false; error: string; setupRequired?: boolean };

export type WorkspacesResult =
  | { ok: true; workspaces: PublicWorkspace[] }
  | { ok: false; error: string; setupRequired?: boolean };

export type WorkspaceDetailResult =
  | {
      ok: true;
      workspace: PublicWorkspace;
      isLead: boolean;
      packages: PublicWorkPackage[];
      invitations: PublicInvitation[];
      audit: AuditEntry[];
    }
  | { ok: false; error: string; setupRequired?: boolean };

export type InvitationsResult =
  | { ok: true; invitations: PublicInvitation[] }
  | { ok: false; error: string; setupRequired?: boolean };

export type NotificationsResult =
  | { ok: true; notifications: PublicNotification[] }
  | { ok: false; error: string; setupRequired?: boolean };

export type InviteResult =
  | { ok: true; invitationId: string }
  | { ok: false; error: string; setupRequired?: boolean };

// ------------------------------------------------------------ rate limiting
// Simple per-user in-memory limiter for invitation sends (per-user max per
// 60s window). In-memory is fine for the MVP single-process server; a shared
// store (Redis/DB) becomes necessary once the app runs multiple instances.
const INVITE_LIMIT = 10;
const INVITE_WINDOW_MS = 60_000;
const inviteLog = new Map<string, number[]>();

function checkInviteRate(userId: string): number | null {
  const now = Date.now();
  const recent = (inviteLog.get(userId) ?? []).filter(
    (t) => now - t < INVITE_WINDOW_MS,
  );
  if (recent.length >= INVITE_LIMIT) {
    inviteLog.set(userId, recent);
    return Math.max(1, Math.ceil((INVITE_WINDOW_MS - (now - recent[0])) / 1000));
  }
  recent.push(now);
  inviteLog.set(userId, recent);
  return null;
}

// -------------------------------------------------------------- validation
const EMAIL_RE = /^\S+@\S+\.\S+$/;
const PARTICIPANT_ROLE_VALUES = new Set<ParticipantRole>([
  "primary_contractor",
  "subcontractor",
  "supplier",
  "consultant",
]);
const WORKSPACE_STATUS_VALUES = new Set<WorkspaceStatus>([
  "draft",
  "active",
  "in_review",
  "completed",
  "archived",
]);

function cleanText(value: string | null | undefined, maxLen: number): string {
  return (value ?? "").trim().slice(0, maxLen);
}

// ---------------------------------------------------------------- workspaces
export async function doGetWorkspaces(): Promise<WorkspacesResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  try {
    await ensureSchema();
    const user = await loadSessionUser();
    if (!user) return { ok: false, error: "UNAUTHENTICATED" };

    const rows = (await asUser(user.id, user.role, (tx) => [
      tx`select
           cw.id, cw.title, cw.description, cw.status, cw.created_at, cw.updated_at,
           (case when cw.lead_contractor_id = ${user.id} then 'lead' else 'participant' end) as access,
           (select count(*) from work_packages wp where wp.workspace_id = cw.id) as package_count,
           (select count(*) from invitations i1 where i1.workspace_id = cw.id and i1.status = 'invited') as invited_count,
           (select count(*) from invitations i2 where i2.workspace_id = cw.id and i2.status in ('joined','verified')) as joined_count
         from contract_workspaces cw
         where cw.lead_contractor_id = ${user.id}
            or exists (
              select 1 from invitations i
              where i.workspace_id = cw.id
                and i.status in ('invited','joined','verified')
                and lower(i.email) = lower(${user.email})
            )
         order by cw.created_at desc`,
    ]))[1] as {
      id: string;
      title: string;
      description: string | null;
      status: WorkspaceStatus;
      created_at: string;
      updated_at: string;
      access: "lead" | "participant";
      package_count: number;
      invited_count: number;
      joined_count: number;
    }[];

    return {
      ok: true,
      workspaces: rows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        status: r.status,
        access: r.access,
        packageCount: Number(r.package_count ?? 0),
        invitedCount: Number(r.invited_count ?? 0),
        joinedCount: Number(r.joined_count ?? 0),
        createdAt: String(r.created_at),
        updatedAt: String(r.updated_at),
      })),
    };
  } catch (err) {
    console.error("getWorkspaces failed:", err);
    return { ok: false, error: "Could not load your workspaces." };
  }
}

export async function doCreateWorkspace(input: WorkspaceInput): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const title = cleanText(input.title, 200);
  if (!title) return { ok: false, error: "Workspace title is required." };
  const status = WORKSPACE_STATUS_VALUES.has(input.status) ? input.status : "draft";
  try {
    await ensureSchema();
    const user = await loadSessionUser();
    if (!user) return { ok: false, error: "UNAUTHENTICATED" };

    const workspaceId = randomUUID();
    await asUser(user.id, user.role, (tx) => [
      tx`insert into contract_workspaces (id, lead_contractor_id, title, description, status)
         values (${workspaceId}, ${user.id}, ${title}, ${cleanText(input.description, 2000) || null}, ${status})`,
      auditQuery(tx, user.id, "workspace.create", { workspaceId, title, status }),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("createWorkspace failed:", err);
    return { ok: false, error: "Could not create the workspace." };
  }
}

export async function doUpdateWorkspace(
  workspaceId: string,
  input: WorkspaceInput,
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const title = cleanText(input.title, 200);
  if (!title) return { ok: false, error: "Workspace title is required." };
  const status = WORKSPACE_STATUS_VALUES.has(input.status) ? input.status : "draft";
  try {
    await ensureSchema();
    const user = await loadSessionUser();
    if (!user) return { ok: false, error: "UNAUTHENTICATED" };

    const rows = (await asUser(user.id, user.role, (tx) => [
      tx`select lead_contractor_id from contract_workspaces where id = ${workspaceId}`,
    ]))[1] as { lead_contractor_id: string }[];
    if (!rows[0] || rows[0].lead_contractor_id !== user.id) {
      return { ok: false, error: "Workspace not found or you don't have access." };
    }

    await asUser(user.id, user.role, (tx) => [
      tx`update contract_workspaces
         set title = ${title}, description = ${cleanText(input.description, 2000) || null},
             status = ${status}, updated_at = now()
         where id = ${workspaceId} and lead_contractor_id = ${user.id}`,
      auditQuery(tx, user.id, "workspace.update", { workspaceId, title, status }),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("updateWorkspace failed:", err);
    return { ok: false, error: "Could not update the workspace." };
  }
}

// ------------------------------------------------------------- workspace detail
export async function doGetWorkspace(workspaceId: string): Promise<WorkspaceDetailResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  try {
    await ensureSchema();
    const user = await loadSessionUser();
    if (!user) return { ok: false, error: "UNAUTHENTICATED" };

    // One batch: workspace row, its packages, and (for the lead only) the
    // full invitation pipeline + recent audit trail. Participants never see
    // other participants' invitations — the queries below are RLS-scoped AND
    // the lead-only arrays are withheld server-side for non-leads.
    // NOTE: asUser() prepends the set_config result, so real rows start at [1].
    const detailRows = await asUser(user.id, user.role, (tx) => [
      tx`select
           cw.id, cw.title, cw.description, cw.status, cw.created_at, cw.updated_at,
           cw.lead_contractor_id,
           (select count(*) from work_packages wp where wp.workspace_id = cw.id) as package_count,
           (select count(*) from invitations i1 where i1.workspace_id = cw.id and i1.status = 'invited') as invited_count,
           (select count(*) from invitations i2 where i2.workspace_id = cw.id and i2.status in ('joined','verified')) as joined_count
         from contract_workspaces cw
         where cw.id = ${workspaceId}
           and (cw.lead_contractor_id = ${user.id} or exists (
             select 1 from invitations i
             where i.workspace_id = cw.id
               and lower(i.email) = lower(${user.email})
               and i.status in ('invited','joined','verified')
           ))`,
      tx`select id, workspace_id, name, description, scope_notes, category, status, created_at, updated_at
         from work_packages where workspace_id = ${workspaceId}
           and exists (select 1 from contract_workspaces cw where cw.id = work_packages.workspace_id
             and (cw.lead_contractor_id = ${user.id} or exists (select 1 from invitations i where i.workspace_id = cw.id and lower(i.email) = lower(${user.email}) and i.status in ('invited','joined','verified'))))
         order by created_at asc`,
      tx`select id, workspace_id, email, company_name, participant_role, work_package, status, created_at, responded_at
         from invitations where workspace_id = ${workspaceId}
           and exists (select 1 from contract_workspaces cw where cw.id = invitations.workspace_id and cw.lead_contractor_id = ${user.id})
         order by created_at desc`,
      tx`select id, action, details, created_at from audit_logs
         where workspace_id = ${workspaceId}
           and exists (select 1 from contract_workspaces cw where cw.id = audit_logs.workspace_id and cw.lead_contractor_id = ${user.id})
         order by created_at desc limit 20`,
    ]);
    const wsRows = detailRows[1] as {
      id: string;
      title: string;
      description: string | null;
      status: WorkspaceStatus;
      created_at: string;
      updated_at: string;
      lead_contractor_id: string;
      package_count: number;
      invited_count: number;
      joined_count: number;
    }[];
    const pkgRows = detailRows[2] as {
      id: string;
      workspace_id: string;
      name: string;
      description: string | null;
      scope_notes: string | null;
      category: string | null;
      status: PublicWorkPackage["status"];
      created_at: string;
      updated_at: string;
    }[];
    const invRows = detailRows[3] as {
      id: string;
      workspace_id: string;
      email: string;
      company_name: string | null;
      participant_role: ParticipantRole;
      work_package: string | null;
      status: PublicInvitation["status"];
      created_at: string;
      responded_at: string | null;
    }[];
    const auditRows = detailRows[4] as {
      id: string;
      action: string;
      details: unknown;
      created_at: string;
    }[];

    const ws = wsRows[0];
    if (!ws) return { ok: false, error: "Workspace not found or you don't have access." };

    const isLead = ws.lead_contractor_id === user.id;
    const packages: PublicWorkPackage[] = pkgRows.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      name: r.name,
      description: r.description,
      scopeNotes: r.scope_notes,
      category: r.category,
      status: r.status,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }));

    const invitations: PublicInvitation[] = isLead
      ? invRows.map((r) => ({
          id: r.id,
          workspaceId: r.workspace_id,
          workspaceTitle: ws.title,
          email: r.email,
          companyName: r.company_name,
          participantRole: r.participant_role,
          workPackage: r.work_package,
          status: r.status,
          createdAt: String(r.created_at),
          respondedAt: r.responded_at ? String(r.responded_at) : null,
        }))
      : [];

    const audit: AuditEntry[] = isLead
      ? auditRows.map((r) => ({
          id: r.id,
          action: r.action,
          details:
            typeof r.details === "string"
              ? (JSON.parse(r.details) as AuditDetails)
              : ((r.details as AuditDetails | null) ?? null),
          createdAt: String(r.created_at),
        }))
      : [];

    return {
      ok: true,
      workspace: {
        id: ws.id,
        title: ws.title,
        description: ws.description,
        status: ws.status,
        access: isLead ? "lead" : "participant",
        packageCount: Number(ws.package_count ?? 0),
        invitedCount: Number(ws.invited_count ?? 0),
        joinedCount: Number(ws.joined_count ?? 0),
        createdAt: String(ws.created_at),
        updatedAt: String(ws.updated_at),
      },
      isLead,
      packages,
      invitations,
      audit,
    };
  } catch (err) {
    console.error("getWorkspace failed:", err);
    return { ok: false, error: "Could not load the workspace." };
  }
}

// -------------------------------------------------------------- work packages
export async function doCreateWorkPackage(
  workspaceId: string,
  input: { name: string; description: string; scopeNotes: string; category: string },
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const name = cleanText(input.name, 160);
  if (!name) return { ok: false, error: "Work package name is required." };
  try {
    await ensureSchema();
    const user = await loadSessionUser();
    if (!user) return { ok: false, error: "UNAUTHENTICATED" };

    const rows = (await asUser(user.id, user.role, (tx) => [
      tx`select lead_contractor_id from contract_workspaces where id = ${workspaceId}`,
    ]))[1] as { lead_contractor_id: string }[];
    if (!rows[0] || rows[0].lead_contractor_id !== user.id) {
      return { ok: false, error: "Workspace not found or you don't have access." };
    }

    const packageId = randomUUID();
    await asUser(user.id, user.role, (tx) => [
      tx`insert into work_packages
           (id, workspace_id, name, description, scope_notes, category, created_by, updated_by)
         select ${packageId}, ${workspaceId}, ${name},
                ${cleanText(input.description, 2000) || null},
                ${cleanText(input.scopeNotes, 4000) || null},
                ${cleanText(input.category, 100) || null},
                ${user.id}, ${user.id}
         where exists (select 1 from contract_workspaces cw
                       where cw.id = ${workspaceId} and cw.lead_contractor_id = ${user.id})`,
      auditQuery(tx, user.id, "work_package.create", { workspaceId, packageId, name }),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("createWorkPackage failed:", err);
    return { ok: false, error: "Could not create the work package." };
  }
}

export async function doDeleteWorkPackage(
  workspaceId: string,
  packageId: string,
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  try {
    await ensureSchema();
    const user = await loadSessionUser();
    if (!user) return { ok: false, error: "UNAUTHENTICATED" };

    const rows = (await asUser(user.id, user.role, (tx) => [
      tx`select lead_contractor_id from contract_workspaces where id = ${workspaceId}`,
    ]))[1] as { lead_contractor_id: string }[];
    if (!rows[0] || rows[0].lead_contractor_id !== user.id) {
      return { ok: false, error: "Workspace not found or you don't have access." };
    }

    await asUser(user.id, user.role, (tx) => [
      tx`delete from work_packages where id = ${packageId} and workspace_id = ${workspaceId}
           and exists (select 1 from contract_workspaces cw where cw.id = work_packages.workspace_id and cw.lead_contractor_id = ${user.id})`,
      auditQuery(tx, user.id, "work_package.delete", { workspaceId, packageId }),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("deleteWorkPackage failed:", err);
    return { ok: false, error: "Could not delete the work package." };
  }
}

// ------------------------------------------------------------------ invites
export async function doInviteCompany(
  workspaceId: string,
  input: InviteInput,
): Promise<InviteResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid email address." };
  const companyName = cleanText(input.companyName, 200);
  const participantRole = PARTICIPANT_ROLE_VALUES.has(input.participantRole)
    ? input.participantRole
    : "subcontractor";
  const workPackage = cleanText(input.workPackage, 160);

  try {
    await ensureSchema();
    const user = await loadSessionUser();
    if (!user) return { ok: false, error: "UNAUTHENTICATED" };

    const retryIn = checkInviteRate(user.id);
    if (retryIn !== null) {
      return {
        ok: false,
        error: `You're sending invitations too quickly — try again in ${retryIn}s.`,
      };
    }

    // Lead ownership check (explicit server-side authorization on top of RLS).
    const wsRows = (await asUser(user.id, user.role, (tx) => [
      tx`select lead_contractor_id, title from contract_workspaces where id = ${workspaceId}`,
    ]))[1] as { lead_contractor_id: string; title: string }[];
    if (!wsRows[0] || wsRows[0].lead_contractor_id !== user.id) {
      return { ok: false, error: "Workspace not found or you don't have access." };
    }
    const workspaceTitle = wsRows[0].title;

    // Existing invitation for this email + workspace?
    const existingRows = (await asUser(user.id, user.role, (tx) => [
      tx`select id, status from invitations
         where workspace_id = ${workspaceId} and lower(email) = ${email}`,
    ]))[1] as { id: string; status: string }[];
    const existing = existingRows[0];

    if (existing && INVITATION_STATUSES.includes(existing.status as never)) {
      const s = existing.status;
      if (s === "invited" || s === "joined" || s === "verified") {
        return { ok: false, error: `${email} has already been invited to this workspace.` };
      }
    }

    // Who (if anyone) currently owns this email — for the notification inbox.
    const ownerRows = (await asService((tx) => [
      tx`select id from users where lower(email) = ${email}`,
    ]))[0] as { id: string }[];

    let invitationId = existing?.id ?? randomUUID();
    await asUser(user.id, user.role, (tx) => [
      existing
        ? tx`update invitations set
              status = 'invited', company_name = ${companyName || null},
              participant_role = ${participantRole}, work_package = ${workPackage || null},
              responded_at = null, joined_at = null, verified_at = null,
              updated_at = now()
            where id = ${existing.id} and workspace_id = ${workspaceId}
              and exists (select 1 from contract_workspaces cw where cw.id = invitations.workspace_id and cw.lead_contractor_id = ${user.id})`
        : tx`insert into invitations
              (id, workspace_id, email, company_name, participant_role, work_package, created_by)
            values (${invitationId}, ${workspaceId}, ${email},
                    ${companyName || null}, ${participantRole}, ${workPackage || null},
                    ${user.id})
              on conflict (id) do nothing`,
      ...(ownerRows[0]
        ? [
            tx`insert into notifications (id, user_id, workspace_id, type, title, body, link)
               values (${randomUUID()}, ${ownerRows[0].id}, ${workspaceId}, 'invitation.sent',
                       ${'You\'ve been invited to join a contract workspace'},
                       ${`${user.name || user.email} invited you to “${workspaceTitle}” on ScaleBridge.`},
                       ${`/workspaces/${workspaceId}`})`,
          ]
        : []),
      auditQuery(tx, user.id, "invitation.send", {
        workspaceId,
        invitationId,
        email,
        participantRole,
        workPackage: workPackage || null,
      }),
    ]);

    return { ok: true, invitationId };
  } catch (err) {
    console.error("inviteCompany failed:", err);
    return { ok: false, error: "Could not send the invitation. Please try again." };
  }
}

// ------------------------------------------------- accept / decline / verify
export async function doRespondToInvitation(
  invitationId: string,
  response: InvitationResponse,
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  if (response !== "accept" && response !== "decline") {
    return { ok: false, error: "Invalid response." };
  }
  try {
    await ensureSchema();
    const user = await loadSessionUser();
    if (!user) return { ok: false, error: "UNAUTHENTICATED" };

    // RLS: the caller can only see invitations addressed to their own email.
    const rows = (await asUser(user.id, user.role, (tx) => [
      tx`select id, workspace_id, email, status from invitations where id = ${invitationId} and lower(email) = lower(${user.email}) and status = 'invited'`,
    ]))[1] as { id: string; workspace_id: string; email: string; status: string }[];
    const inv = rows[0];
    if (!inv) return { ok: false, error: "Invitation not found." };
    if (inv.status !== "invited") {
      return { ok: false, error: "This invitation is no longer open for a response." };
    }
    if (inv.email.toLowerCase() !== user.email.toLowerCase()) {
      return { ok: false, error: "This invitation isn't addressed to you." };
    }

    // Can't accept your own invitation (you lead the workspace).
    const wsRows = (await asUser(user.id, user.role, (tx) => [
      tx`select lead_contractor_id from contract_workspaces where id = ${inv.workspace_id}`,
    ]))[1] as { lead_contractor_id: string }[];
    if (wsRows[0]?.lead_contractor_id === user.id) {
      return { ok: false, error: "You can't respond to an invitation you sent." };
    }

    const nextStatus = response === "accept" ? "joined" : "declined";
    await asUser(user.id, user.role, (tx) => [
      tx`update invitations
         set status = ${nextStatus}, responded_at = now(),
             joined_at = ${response === "accept" ? new Date() : null},
             company_id = ${user.companyId ?? null},
             updated_at = now()
         where id = ${invitationId}
           and lower(email) = lower(${user.email}) and status = 'invited'`,
      // Notify the workspace lead (RLS notifications_insert allows this: the
      // caller's invitation is now joined/declined in this workspace, and the
      // notification's target user is that workspace's lead).
      tx`insert into notifications (id, user_id, workspace_id, type, title, body, link)
         values (${randomUUID()}, ${wsRows[0].lead_contractor_id}, ${inv.workspace_id},
                 ${response === "accept" ? "invitation.accepted" : "invitation.declined"},
                 ${response === "accept" ? "Invitation accepted" : "Invitation declined"},
                 ${`${user.name || user.email} ${response === "accept" ? "accepted" : "declined"} your invitation.`},
                 ${`/workspaces/${inv.workspace_id}?tab=companies`})`,
      auditQuery(tx, user.id, response === "accept" ? "invitation.accept" : "invitation.decline", {
        workspaceId: inv.workspace_id,
        invitationId,
        email: inv.email,
      }),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("respondToInvitation failed:", err);
    return { ok: false, error: "Could not record your response. Please try again." };
  }
}

export async function doVerifyParticipant(
  workspaceId: string,
  invitationId: string,
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  try {
    await ensureSchema();
    const user = await loadSessionUser();
    if (!user) return { ok: false, error: "UNAUTHENTICATED" };

    const wsRows = (await asUser(user.id, user.role, (tx) => [
      tx`select lead_contractor_id, title from contract_workspaces where id = ${workspaceId}`,
    ]))[1] as { lead_contractor_id: string; title: string }[];
    if (!wsRows[0] || wsRows[0].lead_contractor_id !== user.id) {
      return { ok: false, error: "Workspace not found or you don't have access." };
    }
    const workspaceTitle = wsRows[0].title;

    const rows = (await asUser(user.id, user.role, (tx) => [
      tx`select id, email from invitations
         where id = ${invitationId} and workspace_id = ${workspaceId}`,
    ]))[1] as { id: string; email: string }[];
    const inv = rows[0];
    if (!inv) return { ok: false, error: "Invitation not found in this workspace." };

    const ownerRows = (await asService((tx) => [
      tx`select id from users where lower(email) = lower(${inv.email})`,
    ]))[0] as { id: string }[];

    await asUser(user.id, user.role, (tx) => [
      // RLS: only a joined participant can be moved to verified.
      tx`update invitations set status = 'verified', verified_at = now(), updated_at = now()
         where id = ${invitationId} and status = 'joined'
           and exists (select 1 from contract_workspaces cw where cw.id = invitations.workspace_id and cw.lead_contractor_id = ${user.id})`,
      ...(ownerRows[0]
        ? [
            tx`insert into notifications (id, user_id, workspace_id, type, title, body, link)
               values (${randomUUID()}, ${ownerRows[0].id}, ${workspaceId}, 'participant.verified',
                       ${'You\'re now a verified participant'},
                       ${`You've been verified as a participant on “${workspaceTitle}”.`},
                       ${`/workspaces/${workspaceId}`})`,
          ]
        : []),
      auditQuery(tx, user.id, "invitation.verify", { workspaceId, invitationId, email: inv.email }),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("verifyParticipant failed:", err);
    return { ok: false, error: "Could not verify the participant." };
  }
}

// --------------------------------------------------------------- my things
export async function doGetMyInvitations(): Promise<InvitationsResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  try {
    await ensureSchema();
    const user = await loadSessionUser();
    if (!user) return { ok: false, error: "UNAUTHENTICATED" };

    const rows = (await asUser(user.id, user.role, (tx) => [
      tx`select i.id, i.workspace_id, i.email, i.company_name, i.participant_role,
                i.work_package, i.status, i.created_at, i.responded_at,
                (select cw.title from contract_workspaces cw where cw.id = i.workspace_id) as workspace_title
         from invitations i
         where lower(i.email) = lower(${user.email})
         order by i.created_at desc`,
    ]))[1] as {
      id: string;
      workspace_id: string;
      email: string;
      company_name: string | null;
      participant_role: ParticipantRole;
      work_package: string | null;
      status: PublicInvitation["status"];
      created_at: string;
      responded_at: string | null;
      workspace_title: string | null;
    }[];

    return {
      ok: true,
      invitations: rows.map((r) => ({
        id: r.id,
        workspaceId: r.workspace_id,
        workspaceTitle: r.workspace_title,
        email: r.email,
        companyName: r.company_name,
        participantRole: r.participant_role,
        workPackage: r.work_package,
        status: r.status,
        createdAt: String(r.created_at),
        respondedAt: r.responded_at ? String(r.responded_at) : null,
      })),
    };
  } catch (err) {
    console.error("getMyInvitations failed:", err);
    return { ok: false, error: "Could not load your invitations." };
  }
}

export async function doGetMyNotifications(): Promise<NotificationsResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  try {
    await ensureSchema();
    const user = await loadSessionUser();
    if (!user) return { ok: false, error: "UNAUTHENTICATED" };

    const rows = (await asUser(user.id, user.role, (tx) => [
      tx`select id, type, title, body, link, read_at, created_at
         from notifications where user_id = ${user.id}
         order by created_at desc limit 30`,
    ]))[1] as {
      id: string;
      type: string;
      title: string;
      body: string | null;
      link: string | null;
      read_at: string | null;
      created_at: string;
    }[];

    return {
      ok: true,
      notifications: rows.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        body: r.body,
        link: r.link,
        readAt: r.read_at ? String(r.read_at) : null,
        createdAt: String(r.created_at),
      })),
    };
  } catch (err) {
    console.error("getMyNotifications failed:", err);
    return { ok: false, error: "Could not load your notifications." };
  }
}

// ------------------------------------------------------------------ demo seed
// Realistic sample data for demonstration: a facilities-management contract
// with HVAC, cleaning and security work packages and three invited companies.
const DEMO_WORKSPACE_TITLE = "Riverside Plaza — Facilities Management";

export async function doSeedDemo(): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  try {
    await ensureSchema();
    const user = await loadSessionUser();
    if (!user) return { ok: false, error: "UNAUTHENTICATED" };

    const existing = (await asUser(user.id, user.role, (tx) => [
      tx`select id from contract_workspaces where lead_contractor_id = ${user.id} and title = ${DEMO_WORKSPACE_TITLE}`,
    ]))[1] as { id: string }[];
    if (existing[0]) {
      return { ok: false, error: "Demo data already exists for your account." };
    }

    const wsId = randomUUID();
    const pkgIds = [randomUUID(), randomUUID(), randomUUID()];
    const invIds = [randomUUID(), randomUUID(), randomUUID()];

    await asUser(user.id, user.role, (tx) => [
      tx`insert into contract_workspaces (id, lead_contractor_id, title, description, status)
         values (${wsId}, ${user.id}, ${DEMO_WORKSPACE_TITLE},
                 ${"Facilities management for a 6-storey office building: mechanical services, janitorial scope and site security. Built as demo data to walk the invite → join → verify flow."},
                 'active')`,
      tx`insert into work_packages (id, workspace_id, name, description, scope_notes, category, created_by, updated_by)
         values (${pkgIds[0]}, ${wsId}, 'HVAC — servicing & repairs',
                 ${"Planned maintenance of two rooftop AHUs, quarterly filter changes and on-call repairs."},
                 ${"AHU-1/AHU-2, BMS setpoints, response time < 24h for breakdowns."}, 'HVAC', ${user.id}, ${user.id})`,
      tx`insert into work_packages (id, workspace_id, name, description, scope_notes, category, created_by, updated_by)
         values (${pkgIds[1]}, ${wsId}, 'Cleaning — daily janitorial',
                 ${"Daily office cleaning: workstations, washrooms, common areas and weekly deep-clean of the lobby."},
                 ${"Mon–Fri before 07:30, washrooms twice daily, consumables supplied."}, 'Cleaning & facilities', ${user.id}, ${user.id})`,
      tx`insert into work_packages (id, workspace_id, name, description, scope_notes, category, created_by, updated_by)
         values (${pkgIds[2]}, ${wsId}, 'Security — site access & patrols',
                 ${"Site access control, visitor management and night patrols on a 6-storey office building."},
                 ${"Guard presence 22:00–06:00, key-holder service, incident reports within 12h."}, 'Security', ${user.id}, ${user.id})`,
      tx`insert into invitations (id, workspace_id, email, company_name, participant_role, work_package, created_by)
         values (${invIds[0]}, ${wsId}, 'bids@meridianhvac.com', 'Meridian HVAC Ltd.', 'subcontractor', 'HVAC — servicing & repairs', ${user.id})`,
      tx`insert into invitations (id, workspace_id, email, company_name, participant_role, work_package, created_by)
         values (${invIds[1]}, ${wsId}, 'ops@clearviewcleaning.com', 'Clearview Cleaning', 'subcontractor', 'Cleaning — daily janitorial', ${user.id})`,
      tx`insert into invitations (id, workspace_id, email, company_name, participant_role, work_package, created_by)
         values (${invIds[2]}, ${wsId}, 'tenders@northgatesecurity.com', 'Northgate Security', 'subcontractor', 'Security — site access & patrols', ${user.id})`,
      auditQuery(tx, user.id, "workspace.create", { workspaceId: wsId, title: DEMO_WORKSPACE_TITLE, status: "active", demo: true }),
      auditQuery(tx, user.id, "demo.seed", { workspaceId: wsId, packages: 3, invitations: 3 }),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("seedDemo failed:", err);
    return { ok: false, error: "Could not create demo data." };
  }
}
