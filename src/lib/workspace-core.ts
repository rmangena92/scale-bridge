/**
 * Workspace, work package, invitation and notification core — ALL server-only
 * logic (DB access via ~/db + asUser, rate limiting). This module is imported
 * exclusively from ./workspace.ts (server-function wrappers) whose handler
 * bodies are replaced with RPC stubs in the client build, so this module and
 * its server-only imports (node:crypto, postgres.js) never reach the browser
 * bundle. Do not import it from
 * client components.
 */
import { randomUUID } from "node:crypto";
import { asService, asUser, dbConfigured, ensureSchema } from "./db";
import type { Tx, TxQuery } from "./db";
import { auditQuery } from "./audit";
import { hashPassword, loadSessionUser } from "./auth-core";
import type {
  AuditDetails,
  AuditEntry,
  CompanyVerificationStatus,
  DocumentInput,
  DocumentVisibility,
  InvitationResponse,
  InvitationStatus,
  InviteInput,
  MilestoneStatus,
  ParticipantRole,
  ParticipantVerification,
  PublicDocument,
  PublicInvitation,
  PublicInvoice,
  PublicMilestone,
  PublicNotification,
  PublicPricingSubmission,
  PublicTask,
  PublicVariation,
  PublicWorkPackage,
  PublicWorkspace,
  TaskInput,
  TaskStatus,
  VerificationDocument,
  WorkspaceCompany,
  WorkspaceInput,
  WorkspaceStatus,
} from "./types";
import {
  INVOICE_LEAD_STATUSES,
  INVITATION_STATUSES,
  MILESTONE_LEAD_STATUSES,
  TASK_STATUSES,
  VARIATION_LEAD_STATUSES,
} from "./types";

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
      documents: PublicDocument[];
      tasks: PublicTask[];
      milestones: PublicMilestone[];
      companies: WorkspaceCompany[];
      pricingSubmissions: PublicPricingSubmission[];
      invoices: PublicInvoice[];
      variations: PublicVariation[];
      participantVerifications: ParticipantVerification[];
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

/** Map the participant pipeline (invited → joined → verified) onto the
 * platform's company verification vocabulary for display in the workspace:
 * invited → unverified, joined → pending, verified → verified. Declined stays
 * unverified (with the declined invite badge shown in the UI). */
function deriveVerificationStatus(status: InvitationStatus): CompanyVerificationStatus {
  switch (status) {
    case "verified":
      return "verified";
    case "joined":
      return "pending";
    default:
      return "unverified";
  }
}

// ------------------------------------------------------------- workspace detail
export async function doGetWorkspace(workspaceId: string): Promise<WorkspaceDetailResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  try {
    await ensureSchema();
    const user = await loadSessionUser();
    if (!user) return { ok: false, error: "UNAUTHENTICATED" };

    // One batch: workspace row, its packages, invitations (lead only),
    // the full audit trail (lead only), plus the delivery-tab data —
    // documents, tasks, milestones and the participating companies (for the
    // task assignee picker). RLS scopes every query to the caller; the
    // explicit workspace-access predicates are defense-in-depth. Participants
    // never see other participants' invitations, and non-leads get no audit
    // trail — those arrays are withheld server-side too.
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
      tx`select al.id, al.action, al.details, al.created_at, u.email as actor_email
         from audit_logs al
         left join users u on u.id = al.actor_id
         where al.workspace_id = ${workspaceId}
           and exists (select 1 from contract_workspaces cw where cw.id = al.workspace_id and cw.lead_contractor_id = ${user.id})
         order by al.created_at desc`,
      tx`select d.id, d.workspace_id, d.name, d.category, d.visibility, d.status,
                d.file_url, d.uploaded_by, d.uploaded_at, d.created_at,
                u.email as uploaded_by_email
         from documents d
         left join users u on u.id = d.uploaded_by
         where d.workspace_id = ${workspaceId}
           and exists (select 1 from contract_workspaces cw where cw.id = d.workspace_id
             and (cw.lead_contractor_id = ${user.id} or exists (select 1 from invitations i where i.workspace_id = cw.id and lower(i.email) = lower(${user.email}) and i.status in ('invited','joined','verified'))))
         order by d.created_at desc`,
      tx`select t.id, t.workspace_id, t.work_package_id, t.title, t.description, t.status,
                t.assignee_company_id, t.due_date, t.created_by, t.created_at, t.updated_at,
                wp.name as work_package_name, c.name as assignee_company_name
         from tasks t
         left join work_packages wp on wp.id = t.work_package_id
         left join companies c on c.id = t.assignee_company_id
         where t.workspace_id = ${workspaceId}
           and exists (select 1 from contract_workspaces cw where cw.id = t.workspace_id
             and (cw.lead_contractor_id = ${user.id} or exists (select 1 from invitations i where i.workspace_id = cw.id and lower(i.email) = lower(${user.email}) and i.status in ('invited','joined','verified'))))
         order by t.created_at desc`,
      tx`select m.id, m.workspace_id, m.work_package_id, m.name, m.description, m.status,
                m.due_date, m.completed_at, m.created_at, m.updated_at,
                wp.name as work_package_name
         from milestones m
         left join work_packages wp on wp.id = m.work_package_id
         where m.workspace_id = ${workspaceId}
           and exists (select 1 from contract_workspaces cw where cw.id = m.workspace_id
             and (cw.lead_contractor_id = ${user.id} or exists (select 1 from invitations i where i.workspace_id = cw.id and lower(i.email) = lower(${user.email}) and i.status in ('invited','joined','verified'))))
         order by m.due_date asc nulls last, m.created_at asc`,
      tx`select distinct c.id, c.name
         from invitations i
         join companies c on c.id = i.company_id
         where i.workspace_id = ${workspaceId}
           and i.status in ('joined','verified')
         order by c.name asc`,
      tx`select ps.id, ps.workspace_id, ps.work_package_id, ps.company_id,
                ps.amount, ps.currency, ps.description, ps.status,
                ps.submitted_by, ps.submitted_at, ps.reviewed_by, ps.reviewed_at,
                ps.created_at, ps.updated_at,
                wp.name as work_package_name, c.name as company_name,
                su.email as submitted_by_email, ru.email as reviewed_by_email
         from pricing_submissions ps
         left join work_packages wp on wp.id = ps.work_package_id
         left join companies c on c.id = ps.company_id
         left join users su on su.id = ps.submitted_by
         left join users ru on ru.id = ps.reviewed_by
         where ps.workspace_id = ${workspaceId}
           and exists (select 1 from contract_workspaces cw where cw.id = ps.workspace_id
             and (cw.lead_contractor_id = ${user.id} or exists (select 1 from invitations i where i.workspace_id = cw.id and lower(i.email) = lower(${user.email}) and i.status in ('invited','joined','verified'))))
         order by ps.created_at desc`,
      tx`select i.id, i.workspace_id, i.work_package_id, i.invoice_number, i.title,
                i.amount, i.currency, i.status, i.due_date,
                i.submitted_by, i.submitted_at, i.reviewed_by, i.reviewed_at,
                i.payment_recorded_at, i.created_at, i.updated_at,
                wp.name as work_package_name,
                su.email as submitted_by_email, ru.email as reviewed_by_email
         from invoices i
         left join work_packages wp on wp.id = i.work_package_id
         left join users su on su.id = i.submitted_by
         left join users ru on ru.id = i.reviewed_by
         where i.workspace_id = ${workspaceId}
           and exists (select 1 from contract_workspaces cw where cw.id = i.workspace_id
             and (cw.lead_contractor_id = ${user.id} or exists (select 1 from invitations i2 where i2.workspace_id = cw.id and lower(i2.email) = lower(${user.email}) and i2.status in ('invited','joined','verified'))))
         order by i.created_at desc`,
      tx`select v.id, v.workspace_id, v.work_package_id, v.title, v.reason, v.description,
                v.cost_impact, v.proposed_amount_cents, v.time_impact, v.status,
                v.recommended_decision, v.conditions, v.submitted_by, v.submitted_at,
                v.decided_by, v.decided_at, v.created_at, v.updated_at,
                wp.name as work_package_name,
                su.email as submitted_by_email, du.email as decided_by_email
         from variations v
         left join work_packages wp on wp.id = v.work_package_id
         left join users su on su.id = v.submitted_by
         left join users du on du.id = v.decided_by
         where v.workspace_id = ${workspaceId}
           and exists (select 1 from contract_workspaces cw where cw.id = v.workspace_id
             and (cw.lead_contractor_id = ${user.id} or exists (select 1 from invitations i3 where i3.workspace_id = cw.id and lower(i3.email) = lower(${user.email}) and i3.status in ('invited','joined','verified'))))
         order by v.created_at desc`,
      // Participant verification: every invitation in the workspace with the
      // caller's own row included for participants (so a company user can see
      // their own verification status). The lead sees all; RLS scopes the rest.
      tx`select i.id as invitation_id, i.email, i.company_name, i.participant_role,
                i.work_package, i.status as invite_status, i.company_id,
                i.responded_at, i.verified_at
         from invitations i
         where i.workspace_id = ${workspaceId}
           and (exists (select 1 from contract_workspaces cw where cw.id = i.workspace_id and cw.lead_contractor_id = ${user.id})
                or lower(i.email) = lower(${user.email}))
         order by i.created_at desc`,
      // Verification documents (category 'verification') in the workspace: the
      // lead sees all; a participant sees the ones they uploaded. No companies
      // join — the lead cannot read unverified companies (RLS) so documents are
      // linked to participants by uploader email instead.
      tx`select d.id, d.name, d.status, d.file_url, d.review_comment,
                d.uploaded_at, d.uploaded_by, u.email as uploaded_by_email
         from documents d
         left join users u on u.id = d.uploaded_by
         where d.workspace_id = ${workspaceId} and d.category = 'verification'
           and (exists (select 1 from contract_workspaces cw where cw.id = d.workspace_id and cw.lead_contractor_id = ${user.id})
                or d.uploaded_by = ${user.id})
         order by d.created_at asc`,
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
      actor_email: string | null;
    }[];
    const docRows = detailRows[5] as {
      id: string;
      workspace_id: string;
      name: string;
      category: string | null;
      visibility: PublicDocument["visibility"];
      status: string;
      file_url: string | null;
      uploaded_by: string | null;
      uploaded_at: string;
      created_at: string;
      uploaded_by_email: string | null;
    }[];
    const taskRows = detailRows[6] as {
      id: string;
      workspace_id: string;
      work_package_id: string | null;
      title: string;
      description: string | null;
      status: TaskStatus;
      assignee_company_id: string | null;
      due_date: string | null;
      created_by: string | null;
      created_at: string;
      updated_at: string;
      work_package_name: string | null;
      assignee_company_name: string | null;
    }[];
    const milestoneRows = detailRows[7] as {
      id: string;
      workspace_id: string;
      work_package_id: string | null;
      name: string;
      description: string | null;
      status: MilestoneStatus;
      due_date: string | null;
      completed_at: string | null;
      created_at: string;
      updated_at: string;
      work_package_name: string | null;
    }[];
    const companyRows = detailRows[8] as {
      id: string;
      name: string;
    }[];
    const pricingRows = detailRows[9] as {
      id: string;
      workspace_id: string;
      work_package_id: string | null;
      company_id: string | null;
      amount: string | number;
      currency: string;
      description: string | null;
      status: PublicPricingSubmission["status"];
      submitted_by: string | null;
      submitted_at: string | null;
      reviewed_by: string | null;
      reviewed_at: string | null;
      created_at: string;
      updated_at: string;
      work_package_name: string | null;
      company_name: string | null;
      submitted_by_email: string | null;
      reviewed_by_email: string | null;
    }[];
    const invoiceRows = detailRows[10] as {
      id: string;
      workspace_id: string;
      work_package_id: string | null;
      invoice_number: string;
      title: string | null;
      amount: string | number;
      currency: string;
      status: PublicInvoice["status"];
      due_date: string | null;
      submitted_by: string | null;
      submitted_at: string | null;
      reviewed_by: string | null;
      reviewed_at: string | null;
      payment_recorded_at: string | null;
      created_at: string;
      updated_at: string;
      work_package_name: string | null;
      submitted_by_email: string | null;
      reviewed_by_email: string | null;
    }[];
    const variationRows = detailRows[11] as {
      id: string;
      workspace_id: string;
      work_package_id: string | null;
      title: string;
      reason: string | null;
      description: string | null;
      cost_impact: string | number | null;
      proposed_amount_cents: string | number | null;
      time_impact: string | null;
      status: PublicVariation["status"];
      recommended_decision: string | null;
      conditions: string | null;
      submitted_by: string | null;
      submitted_at: string | null;
      decided_by: string | null;
      decided_at: string | null;
      created_at: string;
      updated_at: string;
      work_package_name: string | null;
      submitted_by_email: string | null;
      decided_by_email: string | null;
    }[];

    const participantInvRows = detailRows[12] as {
      invitation_id: string;
      email: string;
      company_name: string | null;
      participant_role: ParticipantRole;
      work_package: string | null;
      invite_status: InvitationStatus;
      company_id: string | null;
      responded_at: string | null;
      verified_at: string | null;
    }[];
    const verificationDocRows = detailRows[13] as {
      id: string;
      name: string;
      status: string;
      file_url: string | null;
      review_comment: string | null;
      uploaded_at: string;
      uploaded_by: string | null;
      uploaded_by_email: string | null;
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
          actorEmail: r.actor_email ?? null,
        }))
      : [];

    const documents: PublicDocument[] = docRows.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      name: r.name,
      category: r.category,
      visibility: r.visibility,
      status: r.status,
      fileUrl: r.file_url,
      uploadedByUserId: r.uploaded_by,
      uploadedByEmail: r.uploaded_by_email,
      uploadedAt: String(r.uploaded_at),
      createdAt: String(r.created_at),
    }));

    const tasks: PublicTask[] = taskRows.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      workPackageId: r.work_package_id,
      workPackageName: r.work_package_name,
      title: r.title,
      description: r.description,
      status: r.status,
      assigneeCompanyId: r.assignee_company_id,
      assigneeCompanyName: r.assignee_company_name,
      dueDate: r.due_date ? String(r.due_date) : null,
      createdByUserId: r.created_by,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }));

    const milestones: PublicMilestone[] = milestoneRows.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      workPackageId: r.work_package_id,
      workPackageName: r.work_package_name,
      name: r.name,
      description: r.description,
      status: r.status,
      dueDate: r.due_date ? String(r.due_date) : null,
      completedAt: r.completed_at ? String(r.completed_at) : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }));

    const companies: WorkspaceCompany[] = companyRows.map((r) => ({
      id: r.id,
      name: r.name,
    }));

    // Commercial tabs are lead-only: pricing, invoices and variations are
    // withheld from participants entirely (commercial data stays private to
    // the lead contractor).
    const pricingSubmissions: PublicPricingSubmission[] = isLead
      ? pricingRows.map((r) => ({
          id: r.id,
          workspaceId: r.workspace_id,
          workPackageId: r.work_package_id,
          workPackageName: r.work_package_name,
          companyId: r.company_id,
          companyName: r.company_name,
          amount: Number(r.amount ?? 0),
          currency: r.currency,
          description: r.description,
          status: r.status,
          submittedByUserId: r.submitted_by,
          submittedByEmail: r.submitted_by_email,
          submittedAt: r.submitted_at ? String(r.submitted_at) : null,
          reviewedByUserId: r.reviewed_by,
          reviewedByEmail: r.reviewed_by_email,
          reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
          createdAt: String(r.created_at),
          updatedAt: String(r.updated_at),
        }))
      : [];

    const invoices: PublicInvoice[] = isLead
      ? invoiceRows.map((r) => ({
          id: r.id,
          workspaceId: r.workspace_id,
          workPackageId: r.work_package_id,
          workPackageName: r.work_package_name,
          invoiceNumber: r.invoice_number,
          title: r.title,
          amount: Number(r.amount ?? 0),
          currency: r.currency,
          status: r.status,
          dueDate: r.due_date ? String(r.due_date) : null,
          submittedByUserId: r.submitted_by,
          submittedByEmail: r.submitted_by_email,
          submittedAt: r.submitted_at ? String(r.submitted_at) : null,
          reviewedByUserId: r.reviewed_by,
          reviewedByEmail: r.reviewed_by_email,
          reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
          paymentRecordedAt: r.payment_recorded_at ? String(r.payment_recorded_at) : null,
          createdAt: String(r.created_at),
          updatedAt: String(r.updated_at),
        }))
      : [];

    const variations: PublicVariation[] = isLead
      ? variationRows.map((r) => ({
          id: r.id,
          workspaceId: r.workspace_id,
          workPackageId: r.work_package_id,
          workPackageName: r.work_package_name,
          title: r.title,
          reason: r.reason,
          description: r.description,
          costImpact: r.cost_impact != null ? Number(r.cost_impact) : null,
          proposedAmountCents: r.proposed_amount_cents != null ? Number(r.proposed_amount_cents) : null,
          timeImpact: r.time_impact,
          status: r.status,
          recommendedDecision: r.recommended_decision,
          conditions: r.conditions,
          submittedByUserId: r.submitted_by,
          submittedByEmail: r.submitted_by_email,
          submittedAt: r.submitted_at ? String(r.submitted_at) : null,
          decidedByUserId: r.decided_by,
          decidedByEmail: r.decided_by_email,
          decidedAt: r.decided_at ? String(r.decided_at) : null,
          createdAt: String(r.created_at),
          updatedAt: String(r.updated_at),
        }))
      : [];

    // Participant verification (lead view): every invitation with its derived
    // verification status (invited → unverified, joined → pending, verified →
    // verified) plus the verification documents the company submitted, linked
    // by uploader email. Participants only ever see their own row.
    const verificationDocs: VerificationDocument[] = verificationDocRows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      fileUrl: r.file_url,
      reviewComment: r.review_comment,
      uploadedByEmail: r.uploaded_by_email,
      uploadedAt: String(r.uploaded_at),
    }));
    const participantVerifications: ParticipantVerification[] = participantInvRows.map(
      (r) => ({
        invitationId: r.invitation_id,
        email: r.email,
        companyName: r.company_name,
        participantRole: r.participant_role,
        workPackage: r.work_package,
        inviteStatus: r.invite_status,
        respondedAt: r.responded_at ? String(r.responded_at) : null,
        verifiedAt: r.verified_at ? String(r.verified_at) : null,
        companyId: r.company_id,
        verificationStatus: deriveVerificationStatus(r.invite_status),
        verificationDocuments: verificationDocs.filter(
          (d) =>
            d.uploadedByEmail != null &&
            d.uploadedByEmail.toLowerCase() === r.email.toLowerCase(),
        ),
      }),
    );

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
      documents,
      tasks,
      milestones,
      companies,
      pricingSubmissions,
      invoices,
      variations,
      participantVerifications,
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
              lead_contractor_id = ${user.id},
              responded_at = null, joined_at = null, verified_at = null,
              updated_at = now()
            where id = ${existing.id} and workspace_id = ${workspaceId}
              and exists (select 1 from contract_workspaces cw where cw.id = invitations.workspace_id and cw.lead_contractor_id = ${user.id})`
        : tx`insert into invitations
              (id, workspace_id, lead_contractor_id, email, company_name, participant_role, work_package, created_by)
            values (${invitationId}, ${workspaceId}, ${user.id}, ${email},
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

export type VerificationReviewDecision = "approved" | "needs_changes";

/**
 * Lead review of a participating company's verification document: approve it
 * (company moves toward verified) or request changes (status back to
 * 'needs_changes' with a note). Lead-only. Writes documents.status +
 * review metadata, audits, and notifies the submitting company user.
 */
export async function doReviewVerificationDocument(
  workspaceId: string,
  documentId: string,
  decision: VerificationReviewDecision,
  note: string,
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  if (decision !== "approved" && decision !== "needs_changes") {
    return { ok: false, error: "Invalid review decision." };
  }
  try {
    await ensureSchema();
    const user = await loadSessionUser();
    if (!user) return { ok: false, error: "UNAUTHENTICATED" };

    const ws = await loadWorkspaceAccess(user, workspaceId);
    if (!ws) return { ok: false, error: "Workspace not found or you don't have access." };
    if (ws.leadContractorId !== user.id) {
      return { ok: false, error: "Only the workspace lead can review verification documents." };
    }

    const rows = (await asUser(user.id, user.role, (tx) => [
      tx`select d.id, d.name, d.status, d.uploaded_by
         from documents d
         where d.id = ${documentId} and d.workspace_id = ${workspaceId}
           and d.category = 'verification'`,
    ]))[1] as { id: string; name: string; status: string; uploaded_by: string | null }[];
    const doc = rows[0];
    if (!doc) {
      return { ok: false, error: "Verification document not found in this workspace." };
    }
    if (doc.status === decision) {
      return { ok: false, error: `This document is already ${decision === "approved" ? "approved" : "marked as needing changes"}.` };
    }

    const cleanNote = cleanText(note, 2000);
    await asUser(user.id, user.role, (tx) => [
      tx`update documents
         set status = ${decision},
             review_comment = ${cleanNote || null},
             reviewed_by = ${user.id},
             reviewed_at = now(),
             updated_at = now()
         where id = ${documentId} and workspace_id = ${workspaceId}
           and exists (select 1 from contract_workspaces cw
                       where cw.id = documents.workspace_id and cw.lead_contractor_id = ${user.id})`,
      // Notify the submitting company user (if a different user than the lead).
      ...(doc.uploaded_by && doc.uploaded_by !== user.id
        ? [
            notifyQuery(
              tx,
              doc.uploaded_by,
              workspaceId,
              "verification.review",
              decision === "approved"
                ? "Verification document approved"
                : "Verification document needs changes",
              `Your document “${doc.name}” on “${ws.title}” was ${
                decision === "approved" ? "approved" : "marked as needing changes"
              }.${cleanNote ? ` Note: ${cleanNote}` : ""}`,
              `/workspaces/${workspaceId}?tab=companies`,
            ),
          ]
        : []),
      auditQuery(tx, user.id, "document.review", {
        workspaceId,
        documentId,
        name: doc.name,
        decision,
        note: cleanNote || null,
        previousStatus: doc.status,
      }),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("reviewVerificationDocument failed:", err);
    return { ok: false, error: "Could not review the verification document." };
  }
}

// ----------------------------------------------------------- delivery tabs
// Documents / tasks / milestones for the lead-contractor workspace tabs.
// Every function: verify the actor can access the workspace (lead or an
// invited/joined/verified participant), then write + audit in one batch.

/** Workspace the actor can access (lead or participant), or null. */
async function loadWorkspaceAccess(
  user: { id: string; email: string; role: string },
  workspaceId: string,
): Promise<{ leadContractorId: string; title: string } | null> {
  const rows = (await asUser(user.id, user.role, (tx) => [
    tx`select cw.lead_contractor_id, cw.title from contract_workspaces cw
       where cw.id = ${workspaceId}
         and (cw.lead_contractor_id = ${user.id} or exists (
           select 1 from invitations i
           where i.workspace_id = cw.id
             and lower(i.email) = lower(${user.email})
             and i.status in ('invited','joined','verified')
         ))`,
  ]))[1] as { lead_contractor_id: string; title: string }[];
  return rows[0]
    ? { leadContractorId: rows[0].lead_contractor_id, title: rows[0].title }
    : null;
}

const DOC_VISIBILITY_VALUES = new Set<DocumentVisibility>([
  "workspace",
  "client_visible",
  "company_only",
]);

export async function doAddDocument(
  workspaceId: string,
  input: DocumentInput,
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const name = cleanText(input.name, 200);
  if (!name) return { ok: false, error: "Document title is required." };
  const category = cleanText(input.category, 100) || null;
  const url = cleanText(input.url, 1000) || null;
  const description = cleanText(input.description, 2000) || null;
  const accessNote = cleanText(input.accessNote, 500) || null;
  const visibility = DOC_VISIBILITY_VALUES.has(input.visibility)
    ? input.visibility
    : "workspace";
  try {
    await ensureSchema();
    const user = await loadSessionUser();
    if (!user) return { ok: false, error: "UNAUTHENTICATED" };

    const ws = await loadWorkspaceAccess(user, workspaceId);
    if (!ws) return { ok: false, error: "Workspace not found or you don't have access." };

    // Only the lead may share a document with the client org (client_visible)
    // or mark it company_only; participant uploads stay workspace-private.
    const effectiveVisibility: DocumentVisibility =
      user.id === ws.leadContractorId ? visibility : "workspace";

    const documentId = randomUUID();
    // Verification documents submitted by a participating company start
    // 'under_review' (the lead reviews them in the Companies tab); everything
    // else (including lead uploads) is 'published'.
    const isVerification = category === "verification";
    const status =
      isVerification && user.id !== ws.leadContractorId ? "under_review" : "published";
    await asUser(user.id, user.role, (tx) => [
      tx`insert into documents
           (id, workspace_id, lead_contractor_id, name, category, visibility, file_url, uploaded_by, status, created_at, updated_at)
         values (${documentId}, ${workspaceId}, ${ws.leadContractorId}, ${name}, ${category},
                 ${effectiveVisibility}, ${url}, ${user.id}, ${status}, now(), now())`,
      // Submitting a verification document nudges the company's own profile
      // from unverified → pending (owner-scoped update; RLS allows the owner).
      ...(isVerification && user.id !== ws.leadContractorId
        ? [
            tx`update companies
               set verification_status = 'pending', updated_at = now()
               where owner_id = ${user.id} and verification_status = 'unverified'`,
          ]
        : []),
      auditQuery(tx, user.id, "document.create", {
        workspaceId,
        documentId,
        name,
        category: category ?? null,
        visibility: effectiveVisibility,
        url: url ?? null,
        description: description ?? null,
        accessNote: accessNote ?? null,
        verification: isVerification || null,
        status,
      }),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("addDocument failed:", err);
    return { ok: false, error: "Could not add the document." };
  }
}

export async function doCreateTask(
  workspaceId: string,
  input: TaskInput,
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const title = cleanText(input.title, 200);
  if (!title) return { ok: false, error: "Task title is required." };
  const description = cleanText(input.description, 2000) || null;
  const workPackageId = cleanText(input.workPackageId, 36) || null;
  const assigneeCompanyId = cleanText(input.assigneeCompanyId, 36) || null;
  // Bind a real Date (postgres.js never gets a raw string next to a
  // timestamptz column). <input type="date"> yields yyyy-mm-dd.
  let dueDate: Date | null = null;
  const dd = (input.dueDate ?? "").trim();
  if (dd) {
    const parsed = new Date(`${dd}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) dueDate = parsed;
  }
  try {
    await ensureSchema();
    const user = await loadSessionUser();
    if (!user) return { ok: false, error: "UNAUTHENTICATED" };

    const ws = await loadWorkspaceAccess(user, workspaceId);
    if (!ws) return { ok: false, error: "Workspace not found or you don't have access." };

    const taskId = randomUUID();
    await asUser(user.id, user.role, (tx) => [
      tx`insert into tasks
           (id, workspace_id, work_package_id, title, description, status, assignee_company_id, due_date, created_by, created_at, updated_at)
         values (${taskId}, ${workspaceId}, ${workPackageId}, ${title}, ${description},
                 'todo', ${assigneeCompanyId}, ${dueDate}, ${user.id}, now(), now())`,
      auditQuery(tx, user.id, "task.create", {
        workspaceId,
        taskId,
        title,
        workPackageId: workPackageId ?? null,
        assigneeCompanyId: assigneeCompanyId ?? null,
        dueDate: dueDate ? dueDate.toISOString().slice(0, 10) : null,
      }),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("createTask failed:", err);
    return { ok: false, error: "Could not create the task." };
  }
}

export async function doUpdateTaskStatus(
  workspaceId: string,
  taskId: string,
  status: TaskStatus,
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  if (!TASK_STATUSES.includes(status)) {
    return { ok: false, error: "Invalid task status." };
  }
  try {
    await ensureSchema();
    const user = await loadSessionUser();
    if (!user) return { ok: false, error: "UNAUTHENTICATED" };

    const ws = await loadWorkspaceAccess(user, workspaceId);
    if (!ws) return { ok: false, error: "Workspace not found or you don't have access." };

    const rows = (await asUser(user.id, user.role, (tx) => [
      tx`select status from tasks where id = ${taskId} and workspace_id = ${workspaceId}`,
    ]))[1] as { status: string }[];
    if (!rows[0]) return { ok: false, error: "Task not found in this workspace." };
    const previousStatus = rows[0].status;

    await asUser(user.id, user.role, (tx) => [
      tx`update tasks set status = ${status}, updated_at = now()
         where id = ${taskId} and workspace_id = ${workspaceId}`,
      auditQuery(tx, user.id, "task.update", {
        workspaceId,
        taskId,
        status,
        previousStatus,
      }),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("updateTaskStatus failed:", err);
    return { ok: false, error: "Could not update the task." };
  }
}

export async function doUpdateMilestoneStatus(
  workspaceId: string,
  milestoneId: string,
  status: MilestoneStatus,
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  if (!(MILESTONE_LEAD_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: "Invalid milestone status." };
  }
  try {
    await ensureSchema();
    const user = await loadSessionUser();
    if (!user) return { ok: false, error: "UNAUTHENTICATED" };

    const ws = await loadWorkspaceAccess(user, workspaceId);
    if (!ws) return { ok: false, error: "Workspace not found or you don't have access." };
    if (ws.leadContractorId !== user.id) {
      return { ok: false, error: "Only the workspace lead can update milestone statuses." };
    }

    const rows = (await asUser(user.id, user.role, (tx) => [
      tx`select status from milestones where id = ${milestoneId} and workspace_id = ${workspaceId}`,
    ]))[1] as { status: string }[];
    if (!rows[0]) return { ok: false, error: "Milestone not found in this workspace." };
    const previousStatus = rows[0].status;

    await asUser(user.id, user.role, (tx) => [
      tx`update milestones
         set status = ${status},
             completed_at = ${status === "completed" ? new Date() : null},
             updated_at = now()
         where id = ${milestoneId} and workspace_id = ${workspaceId}
           and exists (select 1 from contract_workspaces cw
                       where cw.id = milestones.workspace_id and cw.lead_contractor_id = ${user.id})`,
      auditQuery(tx, user.id, "milestone.update", {
        workspaceId,
        milestoneId,
        status,
        previousStatus,
      }),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("updateMilestoneStatus failed:", err);
    return { ok: false, error: "Could not update the milestone." };
  }
}

// ------------------------------------------- commercial tabs (pricing /
// invoices / approvals / variations). All four tabs are lead-only in the UI;
// RLS still permits participants to read pricing (mirroring tasks) but the
// server withholds the arrays from non-leads in doGetWorkspace.
// A notification row helper: works within the asUser() scope — the insert
// policy allows a lead to notify someone they invited into their workspace,
// and self-notification (used by the demo seed).
function notifyQuery(
  tx: Tx,
  userId: string,
  workspaceId: string,
  type: string,
  title: string,
  body: string,
  link: string | null,
): ReturnType<Tx> {
  return tx`insert into notifications (user_id, workspace_id, type, title, body, link)
    values (${userId}, ${workspaceId}, ${type}, ${title}, ${body}, ${link})`;
}

// --------------------------------------------------------------- pricing
export type PricingInput = {
  workPackageId: string;
  amount: string;
  currency: string;
  description: string;
  /** true = the lead's own reference baseline (accepted immediately). */
  baseline: boolean;
};
export async function doSubmitPricing(
  workspaceId: string,
  input: PricingInput,
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const amountNum = Number((input.amount ?? "").toString().trim());
  if (!Number.isFinite(amountNum) || amountNum < 0) {
    return { ok: false, error: "Enter a valid amount." };
  }
  const currency = cleanText(input.currency, 3).toUpperCase() || "GBP";
  const description = cleanText(input.description, 2000) || null;
  const workPackageId = cleanText(input.workPackageId, 36) || null;
  try {
    await ensureSchema();
    const user = await loadSessionUser();
    if (!user) return { ok: false, error: "UNAUTHENTICATED" };

    const ws = await loadWorkspaceAccess(user, workspaceId);
    if (!ws) return { ok: false, error: "Workspace not found or you don't have access." };
    if (ws.leadContractorId !== user.id) {
      return { ok: false, error: "Only the workspace lead can record pricing." };
    }
    if (workPackageId) {
      const pkgRows = (await asUser(user.id, user.role, (tx) => [
        tx`select id from work_packages where id = ${workPackageId} and workspace_id = ${workspaceId}`,
      ]))[1] as { id: string }[];
      if (!pkgRows[0]) return { ok: false, error: "Work package not found in this workspace." };
    }

    const submissionId = randomUUID();
    // The lead's own baseline is accepted immediately (it is the reference
    // price); quotes submitted for review start as 'submitted'.
    const status = input.baseline ? "accepted" : "submitted";
    await asUser(user.id, user.role, (tx) => [
      tx`insert into pricing_submissions
           (id, workspace_id, work_package_id, amount, currency, description, status,
            submitted_by, submitted_at, reviewed_by, reviewed_at, created_at, updated_at)
         values (${submissionId}, ${workspaceId}, ${workPackageId}, ${amountNum}, ${currency},
                 ${description}, ${status}, ${user.id}, now(),
                 ${status === "accepted" ? user.id : null},
                 ${status === "accepted" ? new Date() : null}, now(), now())`,
      auditQuery(tx, user.id, "pricing.submit", {
        workspaceId,
        submissionId,
        workPackageId: workPackageId ?? null,
        amount: amountNum,
        currency,
        baseline: Boolean(input.baseline),
        status,
      }),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("submitPricing failed:", err);
    return { ok: false, error: "Could not record the pricing." };
  }
}

export async function doReviewPricing(
  workspaceId: string,
  submissionId: string,
  decision: "accepted" | "rejected",
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  try {
    await ensureSchema();
    const user = await loadSessionUser();
    if (!user) return { ok: false, error: "UNAUTHENTICATED" };

    const ws = await loadWorkspaceAccess(user, workspaceId);
    if (!ws) return { ok: false, error: "Workspace not found or you don't have access." };
    if (ws.leadContractorId !== user.id) {
      return { ok: false, error: "Only the workspace lead can review pricing." };
    }

    const rows = (await asUser(user.id, user.role, (tx) => [
      tx`select ps.status, ps.submitted_by, ps.work_package_id, ps.amount, ps.currency
         from pricing_submissions ps
         where ps.id = ${submissionId} and ps.workspace_id = ${workspaceId}`,
    ]))[1] as {
      status: string;
      submitted_by: string | null;
      work_package_id: string | null;
      amount: string | number;
      currency: string;
    }[];
    const row = rows[0];
    if (!row) return { ok: false, error: "Pricing submission not found in this workspace." };
    if (row.status === "accepted" || row.status === "rejected") {
      return { ok: false, error: "This pricing submission has already been reviewed." };
    }

    await asUser(user.id, user.role, (tx) => [
      tx`update pricing_submissions
         set status = ${decision}, reviewed_by = ${user.id}, reviewed_at = now(), updated_at = now()
         where id = ${submissionId} and workspace_id = ${workspaceId}`,
      auditQuery(tx, user.id, "pricing.review", {
        workspaceId,
        submissionId,
        decision,
        previousStatus: row.status,
        amount: Number(row.amount ?? 0),
        currency: row.currency,
      }),
      // Notify the submitter (if a different user) that their pricing was
      // decided — the notifications insert policy allows the lead to notify
      // anyone they invited into the workspace.
      ...(row.submitted_by && row.submitted_by !== user.id
        ? [
            notifyQuery(
              tx,
              row.submitted_by,
              workspaceId,
              "pricing.reviewed",
              decision === "accepted" ? "Pricing accepted" : "Pricing rejected",
              `Your pricing for a work package on “${ws.title}” was ${
                decision === "accepted" ? "accepted" : "rejected"
              }.`,
              `/workspaces/${workspaceId}?tab=pricing`,
            ),
          ]
        : []),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("reviewPricing failed:", err);
    return { ok: false, error: "Could not review the pricing." };
  }
}

// ----------------------------------------------------------------- invoices
export type InvoiceInput = {
  workPackageId: string;
  invoiceNumber: string;
  title: string;
  amount: string;
  currency: string;
  dueDate: string; // yyyy-mm-dd or ''
};
export async function doCreateInvoice(
  workspaceId: string,
  input: InvoiceInput,
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const invoiceNumber = cleanText(input.invoiceNumber, 50);
  if (!invoiceNumber) return { ok: false, error: "Invoice number is required." };
  const amountNum = Number((input.amount ?? "").toString().trim());
  if (!Number.isFinite(amountNum) || amountNum < 0) {
    return { ok: false, error: "Enter a valid amount." };
  }
  const currency = cleanText(input.currency, 3).toUpperCase() || "GBP";
  const title = cleanText(input.title, 200) || null;
  const workPackageId = cleanText(input.workPackageId, 36) || null;
  let dueDate: Date | null = null;
  const dd = (input.dueDate ?? "").trim();
  if (dd) {
    const parsed = new Date(`${dd}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) dueDate = parsed;
  }
  try {
    await ensureSchema();
    const user = await loadSessionUser();
    if (!user) return { ok: false, error: "UNAUTHENTICATED" };

    const ws = await loadWorkspaceAccess(user, workspaceId);
    if (!ws) return { ok: false, error: "Workspace not found or you don't have access." };
    if (ws.leadContractorId !== user.id) {
      return { ok: false, error: "Only the workspace lead can create invoices." };
    }
    if (workPackageId) {
      const pkgRows = (await asUser(user.id, user.role, (tx) => [
        tx`select id from work_packages where id = ${workPackageId} and workspace_id = ${workspaceId}`,
      ]))[1] as { id: string }[];
      if (!pkgRows[0]) return { ok: false, error: "Work package not found in this workspace." };
    }

    const invoiceId = randomUUID();
    await asUser(user.id, user.role, (tx) => [
      tx`insert into invoices
           (id, workspace_id, work_package_id, lead_contractor_id, invoice_number, title,
            amount, currency, status, submitted_by, submitted_at, created_at, updated_at)
         values (${invoiceId}, ${workspaceId}, ${workPackageId}, ${ws.leadContractorId},
                 ${invoiceNumber}, ${title}, ${amountNum}, ${currency}, 'draft',
                 ${user.id}, now(), now(), now())`,
      auditQuery(tx, user.id, "invoice.create", {
        workspaceId,
        invoiceId,
        invoiceNumber,
        workPackageId: workPackageId ?? null,
        title: title ?? null,
        amount: amountNum,
        currency,
        dueDate: dueDate ? dueDate.toISOString().slice(0, 10) : null,
      }),
    ]);
    return { ok: true };
  } catch (err) {
    const e = err as { code?: string };
    if (e && e.code === "23505") {
      return { ok: false, error: "An invoice with that number already exists." };
    }
    console.error("createInvoice failed:", err);
    return { ok: false, error: "Could not create the invoice." };
  }
}

export async function doUpdateInvoiceStatus(
  workspaceId: string,
  invoiceId: string,
  status: string,
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  if (!(INVOICE_LEAD_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: "Invalid invoice status." };
  }
  try {
    await ensureSchema();
    const user = await loadSessionUser();
    if (!user) return { ok: false, error: "UNAUTHENTICATED" };

    const ws = await loadWorkspaceAccess(user, workspaceId);
    if (!ws) return { ok: false, error: "Workspace not found or you don't have access." };
    if (ws.leadContractorId !== user.id) {
      return { ok: false, error: "Only the workspace lead can update invoices." };
    }

    const rows = (await asUser(user.id, user.role, (tx) => [
      tx`select status, invoice_number from invoices where id = ${invoiceId} and workspace_id = ${workspaceId}`,
    ]))[1] as { status: string; invoice_number: string }[];
    if (!rows[0]) return { ok: false, error: "Invoice not found in this workspace." };
    const previousStatus = rows[0].status;

    await asUser(user.id, user.role, (tx) => [
      tx`update invoices
         set status = ${status},
             payment_recorded_at = ${status === "paid" ? new Date() : null},
             paid_at = ${status === "paid" ? new Date() : null},
             updated_at = now()
         where id = ${invoiceId} and workspace_id = ${workspaceId}`,
      auditQuery(tx, user.id, "invoice.update", {
        workspaceId,
        invoiceId,
        invoiceNumber: rows[0].invoice_number,
        status,
        previousStatus,
      }),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("updateInvoiceStatus failed:", err);
    return { ok: false, error: "Could not update the invoice." };
  }
}

// ---------------------------------------------------------------- variations
export type VariationInput = {
  title: string;
  reason: string;
  description: string;
  costImpact: string;
  timeImpact: string;
  workPackageId: string;
};
export async function doCreateVariation(
  workspaceId: string,
  input: VariationInput,
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const title = cleanText(input.title, 200);
  if (!title) return { ok: false, error: "Variation title is required." };
  const reason = cleanText(input.reason, 1000) || null;
  const description = cleanText(input.description, 2000) || null;
  const timeImpact = cleanText(input.timeImpact, 500) || null;
  const workPackageId = cleanText(input.workPackageId, 36) || null;
  let costImpact: number | null = null;
  const ci = (input.costImpact ?? "").toString().trim();
  if (ci) {
    const n = Number(ci);
    if (!Number.isFinite(n)) return { ok: false, error: "Cost impact must be a number." };
    costImpact = n;
  }
  try {
    await ensureSchema();
    const user = await loadSessionUser();
    if (!user) return { ok: false, error: "UNAUTHENTICATED" };

    const ws = await loadWorkspaceAccess(user, workspaceId);
    if (!ws) return { ok: false, error: "Workspace not found or you don't have access." };
    if (ws.leadContractorId !== user.id) {
      return { ok: false, error: "Only the workspace lead can raise variations." };
    }
    if (workPackageId) {
      const pkgRows = (await asUser(user.id, user.role, (tx) => [
        tx`select id from work_packages where id = ${workPackageId} and workspace_id = ${workspaceId}`,
      ]))[1] as { id: string }[];
      if (!pkgRows[0]) return { ok: false, error: "Work package not found in this workspace." };
    }

    const variationId = randomUUID();
    await asUser(user.id, user.role, (tx) => [
      tx`insert into variations
           (id, workspace_id, lead_contractor_id, work_package_id, title, reason, description,
            cost_impact, time_impact, status, submitted_by, created_at, updated_at)
         values (${variationId}, ${workspaceId}, ${ws.leadContractorId}, ${workPackageId},
                 ${title}, ${reason}, ${description}, ${costImpact}, ${timeImpact},
                 'draft', ${user.id}, now(), now())`,
      auditQuery(tx, user.id, "variation.create", {
        workspaceId,
        variationId,
        title,
        workPackageId: workPackageId ?? null,
        costImpact: costImpact ?? null,
      }),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("createVariation failed:", err);
    return { ok: false, error: "Could not raise the variation." };
  }
}

export async function doUpdateVariationStatus(
  workspaceId: string,
  variationId: string,
  status: string,
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  if (!(VARIATION_LEAD_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: "Invalid variation status." };
  }
  try {
    await ensureSchema();
    const user = await loadSessionUser();
    if (!user) return { ok: false, error: "UNAUTHENTICATED" };

    const ws = await loadWorkspaceAccess(user, workspaceId);
    if (!ws) return { ok: false, error: "Workspace not found or you don't have access." };
    if (ws.leadContractorId !== user.id) {
      return { ok: false, error: "Only the workspace lead can update variations." };
    }

    const rows = (await asUser(user.id, user.role, (tx) => [
      tx`select status, title from variations where id = ${variationId} and workspace_id = ${workspaceId}`,
    ]))[1] as { status: string; title: string }[];
    if (!rows[0]) return { ok: false, error: "Variation not found in this workspace." };
    const previousStatus = rows[0].status;

    // Guard the transitions the lead is allowed to make: draft -> submitted
    // (send to the client for review) and approved / approved_with_conditions
    // -> implemented (record that the change has been delivered).
    if (status === "submitted" && previousStatus !== "draft") {
      return { ok: false, error: "Only a draft variation can be submitted for client review." };
    }
    if (status === "implemented" && !["approved", "approved_with_conditions"].includes(previousStatus)) {
      return { ok: false, error: "A variation can only be marked implemented after the client approves it." };
    }
    if (status === "draft" && previousStatus !== "submitted") {
      return { ok: false, error: "Only a submitted variation can be returned to draft." };
    }

    await asUser(user.id, user.role, (tx) => [
      tx`update variations
         set status = ${status},
             submitted_at = ${status === "submitted" ? new Date() : null},
             updated_at = now()
         where id = ${variationId} and workspace_id = ${workspaceId}`,
      auditQuery(tx, user.id, "variation.update", {
        workspaceId,
        variationId,
        title: rows[0].title,
        status,
        previousStatus,
      }),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("updateVariationStatus failed:", err);
    return { ok: false, error: "Could not update the variation." };
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
// Verification demo block: three participating companies for the demo
// workspace, one per verification stage — Meridian (verified, approved
// document), Clearview (pending, document awaiting review), Northgate
// (unverified, no documents). Participant user accounts are created so the
// company side is genuinely demoable (login password: demo-password).
const DEMO_PARTICIPANT_PASSWORD = "demo-password";
const DEMO_PARTICIPANTS: {
  email: string;
  companyName: string;
  inviteStatus: "invited" | "joined" | "verified";
  companyVerificationStatus: CompanyVerificationStatus;
  document: { name: string; status: string; comment: string | null } | null;
}[] = [
  {
    email: "bids@meridianhvac.com",
    companyName: "Meridian HVAC Ltd.",
    inviteStatus: "verified",
    companyVerificationStatus: "verified",
    document: {
      name: "HVAC Contractor Licence — 2026",
      status: "approved",
      comment: "Current licence verified for the Riverside Plaza HVAC package.",
    },
  },
  {
    email: "ops@clearviewcleaning.com",
    companyName: "Clearview Cleaning",
    inviteStatus: "joined",
    companyVerificationStatus: "pending",
    document: {
      name: "Cleaning Licence (BICSc) — 2026",
      status: "under_review",
      comment: null,
    },
  },
  {
    email: "tenders@northgatesecurity.com",
    companyName: "Northgate Security",
    inviteStatus: "invited",
    companyVerificationStatus: "unverified",
    document: null,
  },
];

/**
 * Idempotent demo block: participant companies with verification statuses +
 * verification documents for the demo workspace. Creates the participant user
 * accounts (users is RLS-exempt), then their profile + company via an
 * owner-scoped asUser (so the RLS insert/update policies pass), then links and
 * advances the invitations and seeds the documents as the workspace lead.
 * Runs only when the workspace has no verification documents yet.
 */
async function ensureVerificationDemo(
  lead: { id: string; role: string },
  wsId: string,
): Promise<void> {
  const probe = (await asUser(lead.id, lead.role, (tx) => [
    tx`select count(*)::int as n from documents
       where workspace_id = ${wsId} and category = 'verification'`,
  ]))[1] as { n: number }[];
  if ((probe[0]?.n ?? 0) > 0) return; // already seeded

  for (const p of DEMO_PARTICIPANTS) {
    // 1. Participant user account (RLS-exempt users table, like signup).
    const userId = randomUUID();
    await asService((tx) => [
      tx`insert into users (id, email, password_hash)
         values (${userId}, ${p.email}, ${hashPassword(DEMO_PARTICIPANT_PASSWORD)})
         on conflict (email) do nothing`,
    ]);
    const userRows = (await asService((tx) => [
      tx`select id from users where lower(email) = lower(${p.email})`,
    ]))[0] as { id: string }[];
    const participantId = userRows[0].id;

    // 2. Profile + company, scoped AS the participant so RLS passes (they own
    // their profile and company; the owner may also set verification_status).
    const companyId = randomUUID();
    await asUser(participantId, "company_user", (tx) => [
      tx`insert into profiles (user_id, role, name)
         values (${participantId}, 'company_user', ${p.companyName})
         on conflict (user_id) do nothing`,
      tx`insert into companies (id, owner_id, name, verification_status)
         values (${companyId}, ${participantId}, ${p.companyName}, ${p.companyVerificationStatus})
         on conflict (owner_id) do nothing`,
      tx`update companies
         set verification_status = ${p.companyVerificationStatus}, updated_at = now()
         where owner_id = ${participantId}`,
    ]);

    // 3. Link + advance the invitation, seed the verification document, all as
    // the workspace lead (lead-owned invitation/document writes).
    await asUser(lead.id, lead.role, (tx) => {
      const qs: TxQuery[] = [];
      // Remove stray duplicate invitations for this email that already carry a
      // company link (legacy demo leftovers) — keep one canonical row.
      qs.push(tx`delete from invitations
                 where workspace_id = ${wsId}
                   and lower(email) = lower(${p.email})
                   and company_id is not null
                   and status = 'invited'`);
      qs.push(tx`update invitations
                 set company_id = ${companyId},
                     status = ${p.inviteStatus},
                     responded_at = ${p.inviteStatus === "invited" ? null : new Date()},
                     joined_at = ${p.inviteStatus === "joined" || p.inviteStatus === "verified" ? new Date() : null},
                     verified_at = ${p.inviteStatus === "verified" ? new Date() : null},
                     updated_at = now()
                 where workspace_id = ${wsId} and lower(email) = lower(${p.email})`);
      if (p.document) {
        qs.push(tx`insert into documents
             (id, workspace_id, lead_contractor_id, name, category, visibility, file_url,
              uploaded_by, status, review_comment, reviewed_by, reviewed_at, created_at, updated_at)
           values (${randomUUID()}, ${wsId}, ${lead.id}, ${p.document.name}, 'verification',
                   'company_only',
                   ${"https://demo.scalebridge.local/docs/" + p.document.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")},
                   ${participantId}, ${p.document.status}, ${p.document.comment},
                   ${p.document.status === "approved" ? lead.id : null},
                   ${p.document.status === "approved" ? new Date() : null}, now(), now())`);
      }
      qs.push(auditQuery(tx, lead.id, "demo.seed", {
        workspaceId: wsId,
        verification: true,
        participant: p.email,
        companyVerificationStatus: p.companyVerificationStatus,
        invitationStatus: p.inviteStatus,
        document: p.document?.name ?? null,
      }));
      return qs;
    });
  }
}


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
      // The demo workspace already exists (e.g. the page was re-opened after a
      // prior seed) — idempotently add the commercial demo rows (pricing
      // submissions, one invoice, one variation) only if none exist yet.
      const wsId = existing[0].id;
      // Verification demo block (idempotent — skips once verification docs exist).
      await ensureVerificationDemo(user, wsId);
      const probe = (await asUser(user.id, user.role, (tx) => [
        tx`select id, name from work_packages where workspace_id = ${wsId} order by created_at asc`,
        tx`select id from pricing_submissions where workspace_id = ${wsId} limit 1`,
        tx`select id from invoices where workspace_id = ${wsId} limit 1`,
        tx`select id from variations where workspace_id = ${wsId} limit 1`,
      ])) as unknown[];
      const packages = probe[1] as { id: string; name: string }[];
      const hasPricing = (probe[2] as { id: string }[]).length > 0;
      const hasInvoice = (probe[3] as { id: string }[]).length > 0;
      const hasVariation = (probe[4] as { id: string }[]).length > 0;
      if (hasPricing && hasInvoice && hasVariation) return { ok: true };
      const hVAC = packages.find((p) => p.name.startsWith("HVAC"));
      const cleaning = packages.find((p) => p.name.startsWith("Cleaning"));
      const security = packages.find((p) => p.name.startsWith("Security"));
      await asUser(user.id, user.role, (tx) => {
        const qs: TxQuery[] = [];
        if (!hasPricing) {
          if (hVAC) {
            qs.push(tx`insert into pricing_submissions
                 (id, workspace_id, work_package_id, amount, currency, description, status,
                  submitted_by, submitted_at, reviewed_by, reviewed_at, created_at, updated_at)
               values (${randomUUID()}, ${wsId}, ${hVAC.id}, ${18450}, 'GBP',
                       ${"Reference baseline: quarterly servicing + on-call repairs."},
                       'accepted', ${user.id}, now(), ${user.id}, now(), now(), now())`);
          }
          if (cleaning) {
            qs.push(tx`insert into pricing_submissions
                 (id, workspace_id, work_package_id, amount, currency, description, status,
                  submitted_by, submitted_at, created_at, updated_at)
               values (${randomUUID()}, ${wsId}, ${cleaning.id}, ${12200}, 'GBP',
                       ${"Annual quote: daily janitorial + lobby deep-cleans."},
                       'submitted', ${user.id}, now(), now(), now())`);
          }
        }
        if (!hasInvoice && hVAC) {
          qs.push(tx`insert into invoices
               (id, workspace_id, work_package_id, lead_contractor_id, invoice_number, title,
                amount, currency, status, submitted_by, submitted_at, created_at, updated_at)
             values (${randomUUID()}, ${wsId}, ${hVAC.id}, ${user.id}, 'INV-2026-0001',
                     ${"Q3 HVAC servicing"}, ${6150}, 'GBP', 'submitted',
                     ${user.id}, now(), now(), now())`);
        }
        if (!hasVariation && security) {
          qs.push(tx`insert into variations
               (id, workspace_id, lead_contractor_id, work_package_id, title, reason,
                description, cost_impact, time_impact, status, submitted_by,
                submitted_at, created_at, updated_at)
             values (${randomUUID()}, ${wsId}, ${user.id}, ${security.id},
                     ${"Extra bank-holiday patrol cover"},
                     ${"Client requested additional public-holiday patrols for the Q4 events programme."},
                     ${"Two extra night patrols on each of the three bank holidays in Q4 (4h each)."},
                     ${780}, ${"+3 weeks (patrol rota update)"}, 'submitted',
                     ${user.id}, now(), now(), now())`);
        }
        qs.push(auditQuery(tx, user.id, "demo.seed", {
          workspaceId: wsId,
          commercial: true,
          pricing: hasPricing ? 0 : 2,
          invoices: hasInvoice ? 0 : 1,
          variations: hasVariation ? 0 : 1,
        }));
        return qs;
      });
      return { ok: true };
    }

    // Fresh seed: full demo workspace (packages, invitations, delivery tabs)
    // plus the commercial rows (pricing / invoice / variation).
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
      tx`insert into invitations (id, workspace_id, lead_contractor_id, email, company_name, participant_role, work_package, created_by)
         values (${invIds[0]}, ${wsId}, ${user.id}, 'bids@meridianhvac.com', 'Meridian HVAC Ltd.', 'subcontractor', 'HVAC — servicing & repairs', ${user.id})`,
      tx`insert into invitations (id, workspace_id, lead_contractor_id, email, company_name, participant_role, work_package, created_by)
         values (${invIds[1]}, ${wsId}, ${user.id}, 'ops@clearviewcleaning.com', 'Clearview Cleaning', 'subcontractor', 'Cleaning — daily janitorial', ${user.id})`,
      tx`insert into invitations (id, workspace_id, lead_contractor_id, email, company_name, participant_role, work_package, created_by)
         values (${invIds[2]}, ${wsId}, ${user.id}, 'tenders@northgatesecurity.com', 'Northgate Security', 'subcontractor', 'Security — site access & patrols', ${user.id})`,
      // Delivery-tab demo rows: a small task board (one per package) and a
      // couple of workspace documents, so the Documents/Tasks tabs show real
      // data on a fresh demo account.
      tx`insert into tasks (id, workspace_id, work_package_id, title, description, status, due_date, created_by, created_at, updated_at)
         values (${randomUUID()}, ${wsId}, ${pkgIds[0]}, 'Quarterly AHU filter change',
                 ${"Replace filters on AHU-1 and AHU-2, log pressure drops on the BMS."},
                 'in_progress', ${new Date("2026-09-30T00:00:00Z")}, ${user.id}, now(), now())`,
      tx`insert into tasks (id, workspace_id, work_package_id, title, description, status, due_date, created_by, created_at, updated_at)
         values (${randomUUID()}, ${wsId}, ${pkgIds[1]}, 'Draft Q4 cleaning rota',
                 ${"Set the October–December rota for lobby deep-cleans and washroom coverage."},
                 'todo', ${new Date("2026-09-25T00:00:00Z")}, ${user.id}, now(), now())`,
      tx`insert into tasks (id, workspace_id, work_package_id, title, description, status, due_date, created_by, created_at, updated_at)
         values (${randomUUID()}, ${wsId}, ${pkgIds[2]}, 'Renew security guard licences',
                 ${"Collect updated SIA licence copies before the Q4 patrol rota sign-off."},
                 'blocked', ${new Date("2026-10-10T00:00:00Z")}, ${user.id}, now(), now())`,
      tx`insert into documents (id, workspace_id, lead_contractor_id, name, category, visibility, uploaded_by, status, created_at, updated_at)
         values (${randomUUID()}, ${wsId}, ${user.id}, 'Cleaning Rota — Q3', 'report', 'workspace', ${user.id}, 'published', now(), now())`,
      tx`insert into documents (id, workspace_id, lead_contractor_id, name, category, visibility, uploaded_by, status, created_at, updated_at)
         values (${randomUUID()}, ${wsId}, ${user.id}, 'Security Incident Log Template', 'other', 'workspace', ${user.id}, 'published', now(), now())`,
      // Commercial demo rows: HVAC baseline (accepted), cleaning quote
      // (submitted — awaits lead review), an issued invoice referencing the
      // HVAC package, and a pending variation on the security package.
      tx`insert into pricing_submissions
           (id, workspace_id, work_package_id, amount, currency, description, status,
            submitted_by, submitted_at, reviewed_by, reviewed_at, created_at, updated_at)
         values (${randomUUID()}, ${wsId}, ${pkgIds[0]}, ${18450}, 'GBP',
                 ${"Reference baseline: quarterly servicing + on-call repairs."},
                 'accepted', ${user.id}, now(), ${user.id}, now(), now(), now())`,
      tx`insert into pricing_submissions
           (id, workspace_id, work_package_id, amount, currency, description, status,
            submitted_by, submitted_at, created_at, updated_at)
         values (${randomUUID()}, ${wsId}, ${pkgIds[1]}, ${12200}, 'GBP',
                 ${"Annual quote: daily janitorial + lobby deep-cleans."},
                 'submitted', ${user.id}, now(), now(), now())`,
      tx`insert into invoices
           (id, workspace_id, work_package_id, lead_contractor_id, invoice_number, title,
            amount, currency, status, submitted_by, submitted_at, created_at, updated_at)
         values (${randomUUID()}, ${wsId}, ${pkgIds[0]}, ${user.id}, 'INV-2026-0001',
                 ${"Q3 HVAC servicing"}, ${6150}, 'GBP', 'submitted',
                 ${user.id}, now(), now(), now())`,
      tx`insert into variations
           (id, workspace_id, lead_contractor_id, work_package_id, title, reason,
            description, cost_impact, time_impact, status, submitted_by,
            submitted_at, created_at, updated_at)
         values (${randomUUID()}, ${wsId}, ${user.id}, ${pkgIds[2]},
                 ${"Extra bank-holiday patrol cover"},
                 ${"Client requested additional public-holiday patrols for the Q4 events programme."},
                 ${"Two extra night patrols on each of the three bank holidays in Q4 (4h each)."},
                 ${780}, ${"+3 weeks (patrol rota update)"}, 'submitted',
                 ${user.id}, now(), now(), now())`,
      auditQuery(tx, user.id, "workspace.create", { workspaceId: wsId, title: DEMO_WORKSPACE_TITLE, status: "active", demo: true }),
      auditQuery(tx, user.id, "demo.seed", { workspaceId: wsId, packages: 3, invitations: 3, tasks: 3, documents: 2, pricing: 2, invoices: 1, variations: 1 }),
    ]);
    // Verification demo block (idempotent — skips once verification docs exist).
    await ensureVerificationDemo(user, wsId);
    return { ok: true };
  } catch (err) {
    console.error("seedDemo failed:", err);
    return { ok: false, error: "Could not create demo data." };
  }
}
