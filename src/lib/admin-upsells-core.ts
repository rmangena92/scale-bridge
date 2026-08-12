/**
 * Master Admin Portal - AI upsell & cross-sell workflow (backlog item).
 *
 * Server-only core mirroring admin-settings-core.ts: every mutation runs inside
 * an asUser(admin.id, 'sb_admin', ...) batch (RLS: upsell_opportunities and
 * friends are FORCE RLS, admin-only via IS_ADMIN policies) and writes its
 * immutable audit rows in the SAME transaction as the change.
 *
 * Status workflow (DB values use underscores):
 *   Suggested -> Under_Review -> Approved -> Sent -> Interested -> Converted
 *                            \-> Rejected      \-> Declined -> Closed
 *                                 \-> Awaiting_Company_Confirmation -> Sent
 *
 * HUMAN APPROVAL GATE: nothing is sent externally unless an admin has approved
 * the opportunity. "Sent" is only reachable from Approved or
 * Awaiting_Company_Confirmation, and Awaiting_Company_Confirmation is only
 * reachable from Approved - so every send path has passed through Approved.
 * The send is recorded in the audit trail (ai.upsell.send) and the company
 * owner receives a notifications row (type 'upsell').
 *
 * Audit actions follow the AI engine's existing family (ai-agent.ts writes
 * ai.upsell.created / ai.upsell.status_change to both audit_logs and
 * ai_audit_events): we keep the same action names and ALSO write the same
 * rows to ai_audit_events. Unlike audit.ts's auditQuery (which JSON.stringify's
 * details - the known double-encoding bug), this module binds the details
 * OBJECT directly so jsonb_typeof(details) = 'object'.
 *
 * Role gate: operations / compliance / super_admin staff roles may change
 * status, approve, send and edit notes; every other staff role is read-only.
 */
import { randomUUID } from "node:crypto";
import { asUser, dbConfigured, ensureSchema } from "./db";
import type { Tx } from "./db";
import { aiAuditQuery } from "./ai-agent";
import type { AdminActor } from "./admin-subscriptions-actions";
import {
  UPSELL_MUTATE_ROLES,
  UPSELL_STATUSES,
  UPSELL_STATUS_LABELS,
  UPSELL_TRANSITIONS,
} from "./upsell-constants";
import type { UpsellWorkflowStatus } from "./upsell-constants";
export type { UpsellWorkflowStatus } from "./upsell-constants";



export type UpsellListFilters = {
  status?: string | null;
  companyId?: string | null;
  suggestedServiceId?: string | null;
  minConfidence?: number | null;
  maxConfidence?: number | null;
};

export type UpsellListRow = {
  id: string;
  companyId: string;
  companyName: string | null;
  companyType: string | null;
  existingServiceName: string | null;
  suggestedServiceId: string;
  suggestedServiceName: string | null;
  confidence: string;
  confidenceScore: number;
  evidenceCount: number;
  status: UpsellWorkflowStatus;
  ownerId: string | null;
  ownerName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpsellListResult =
  | { ok: true; opportunities: UpsellListRow[]; companies: { id: string; name: string }[]; services: { id: string; name: string }[] }
  | { ok: false; error: string };

export type UpsellEvidenceItem = {
  id: string;
  title: string | null;
  sourceUrl: string | null;
  excerpt: string | null;
  evidenceType: string | null;
  capturedAt: string | null;
  confidence: string | null;
};

export type UpsellRelevantOpportunity = {
  serviceId?: string;
  serviceName?: string;
  reason?: string;
  confidence?: string;
};

export type UpsellDetailRow = {
  id: string;
  companyId: string;
  companyName: string | null;
  companyType: string | null;
  companyStatus: string | null;
  companyOwnerId: string | null;
  companyOwnerName: string | null;
  companyOwnerEmail: string | null;
  existingServiceId: string | null;
  existingServiceName: string | null;
  suggestedServiceId: string;
  suggestedServiceName: string | null;
  relationship: string | null;
  evidence: string | null;
  confidence: string;
  confidenceScore: number;
  relevantOpportunities: UpsellRelevantOpportunity[];
  suggestedMessage: string | null;
  timing: string | null;
  ownerId: string | null;
  ownerName: string | null;
  status: UpsellWorkflowStatus;
  adminNotes: string | null;
  createdAt: string;
  updatedAt: string;
  existingRelationships: { id: string; serviceName: string; source: string; confidence: string; verificationStatus: string }[];
  evidenceItems: UpsellEvidenceItem[];
  history: {
    id: string;
    action: string;
    actorType: string;
    actorId: string | null;
    details: Record<string, string | number | boolean | null>;
    createdAt: string;
  }[];
};

export type UpsellActionResult =
  | { ok: true; message: string; id?: string }
  | { ok: false; error: string; code?: string };

export type UpsellDetailResult =
  | { ok: true; opportunity: UpsellDetailRow }
  | { ok: false; error: string };

export type UpsellCreateInput = {
  companyId: string;
  existingServiceId?: string | null;
  suggestedServiceId: string;
  relationship?: string | null;
  evidence?: string | null;
  confidence: string;
  confidenceScore?: number | null;
  relevantOpportunities?: unknown[] | null;
  suggestedMessage?: string | null;
  timing?: string | null;
  ownerId?: string | null;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
};

function requireUpsellMutate(admin: AdminActor): string | null {
  if (
    !admin.staffRoles.some((r) => (UPSELL_MUTATE_ROLES as readonly string[]).includes(r as never))
  ) {
    return "This action requires an operations, compliance or super_admin role.";
  }
  return null;
}

/**
 * Audit helper for THIS module: binds the details object directly to the jsonb
 * column (audit.ts's auditQuery stringifies first - the known double-encoding
 * bug - so new rows must bind objects to stay jsonb objects).
 */
export function upsellAuditQuery(
  tx: Tx,
  actorId: string,
  action: string,
  details: Record<string, unknown>,
): ReturnType<Tx> {
  return tx`insert into audit_logs (id, actor_id, action, details)
    values (${randomUUID()}, ${actorId}, ${action}, ${details as never})`;
}

// ------------------------------------------------------------------ list
export async function doListUpsellOpportunities(
  admin: AdminActor,
  filters: UpsellListFilters,
): Promise<UpsellListResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED" };
  try {
    await ensureSchema();
    const status = (filters.status ?? "").trim() || null;
    const companyId = (filters.companyId ?? "").trim() || null;
    const serviceId = (filters.suggestedServiceId ?? "").trim() || null;
    const minScore = filters.minConfidence === null || filters.minConfidence === undefined
      ? 0
      : Number(filters.minConfidence);
    const maxScore = filters.maxConfidence === null || filters.maxConfidence === undefined
      ? 100
      : Number(filters.maxConfidence);
    const [, oppRows, companyRows, serviceRows] = (await asUser(admin.id, "sb_admin", (tx) => [
      tx`select uo.id, uo.company_id, c.name as company_name, c.type as company_type,
                es.name as existing_service_name,
                uo.suggested_service_id, ss.name as suggested_service_name,
                uo.confidence, uo.confidence_score, uo.status,
                uo.owner_id, pr.name as owner_name, uo.created_at, uo.updated_at,
                (select count(*)::int from service_evidence se
                   join company_services csr on csr.id = se.company_service_id
                   where csr.company_id = uo.company_id)
                + (case when uo.evidence is not null and uo.evidence <> '' then 1 else 0 end)
                  as evidence_count
         from upsell_opportunities uo
         left join companies c on c.id = uo.company_id
         left join services es on es.id = uo.existing_service_id
         left join services ss on ss.id = uo.suggested_service_id
         left join profiles pr on pr.user_id = uo.owner_id
         where (${status}::text is null or uo.status = ${status})
           and (${companyId}::uuid is null or uo.company_id = ${companyId})
           and (${serviceId}::uuid is null or uo.suggested_service_id = ${serviceId})
           and uo.confidence_score >= ${minScore}
           and uo.confidence_score <= ${maxScore}
         order by uo.created_at desc
         limit 500`,
      tx`select distinct c.id, c.name
         from upsell_opportunities uo join companies c on c.id = uo.company_id
         order by c.name asc`,
      tx`select distinct s.id, s.name
         from upsell_opportunities uo join services s on s.id = uo.suggested_service_id
         order by s.name asc`,
    ])) as unknown as [
      unknown,
      {
        id: string; company_id: string; company_name: string | null; company_type: string | null;
        existing_service_name: string | null; suggested_service_id: string;
        suggested_service_name: string | null; confidence: string; confidence_score: number;
        status: string; owner_id: string | null; owner_name: string | null;
        created_at: string; updated_at: string; evidence_count: number;
      }[],
      { id: string; name: string }[],
      { id: string; name: string }[],
    ];
    return {
      ok: true,
      opportunities: oppRows.map((r) => ({
        id: r.id,
        companyId: r.company_id,
        companyName: r.company_name,
        companyType: r.company_type,
        existingServiceName: r.existing_service_name,
        suggestedServiceId: r.suggested_service_id,
        suggestedServiceName: r.suggested_service_name,
        confidence: r.confidence,
        confidenceScore: num(r.confidence_score),
        evidenceCount: num(r.evidence_count),
        status: r.status as UpsellWorkflowStatus,
        ownerId: r.owner_id,
        ownerName: r.owner_name,
        createdAt: String(r.created_at),
        updatedAt: String(r.updated_at),
      })),
      companies: companyRows.map((c) => ({ id: c.id, name: c.name })),
      services: serviceRows.map((s) => ({ id: s.id, name: s.name })),
    };
  } catch (err) {
    console.error("doListUpsellOpportunities failed:", err);
    return { ok: false, error: "Could not load upsell opportunities." };
  }
}

// ------------------------------------------------------------------ detail
export async function doGetUpsellOpportunity(
  admin: AdminActor,
  opportunityId: string,
): Promise<UpsellDetailResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED" };
  try {
    await ensureSchema();
    const [, opp, rels, evidence, history] = (await asUser(admin.id, "sb_admin", (tx) => [
      tx`select uo.id, uo.company_id, c.name as company_name, c.type as company_type,
                c.verification_status as company_status, c.owner_id as company_owner_id,
                co.email as company_owner_email, cop.name as company_owner_name,
                uo.existing_service_id, es.name as existing_service_name,
                uo.suggested_service_id, ss.name as suggested_service_name,
                uo.relationship, uo.evidence, uo.confidence, uo.confidence_score,
                uo.relevant_opportunities, uo.suggested_message, uo.timing,
                uo.owner_id, pr.name as owner_name, uo.status, uo.admin_notes,
                uo.created_at, uo.updated_at
         from upsell_opportunities uo
         left join companies c on c.id = uo.company_id
         left join users co on co.id = c.owner_id
         left join profiles cop on cop.user_id = c.owner_id
         left join services es on es.id = uo.existing_service_id
         left join services ss on ss.id = uo.suggested_service_id
         left join profiles pr on pr.user_id = uo.owner_id
         where uo.id = ${opportunityId}
         limit 1`,
      tx`select cs.id, s.name as service_name, cs.source, cs.confidence, cs.verification_status
         from company_services cs
         join services s on s.id = cs.service_id
         where cs.company_id in (
           select company_id from upsell_opportunities where id = ${opportunityId}
         )
         order by s.name asc`,
      tx`select se.id, se.title, se.source_url, se.excerpt, se.evidence_type, se.captured_at,
                cs.confidence
         from service_evidence se
         join company_services cs on cs.id = se.company_service_id
         where cs.company_id in (
           select company_id from upsell_opportunities where id = ${opportunityId}
         )
         order by se.created_at desc`,
      tx`select id, action, actor_type, actor_id, details, created_at
         from ai_audit_events
         where entity_type = 'upsell_opportunity' and entity_id = ${opportunityId}
         order by created_at desc
         limit 100`,
    ])) as unknown as [
      unknown,
      {
        id: string; company_id: string; company_name: string | null; company_type: string | null;
        company_status: string | null; company_owner_id: string | null;
        company_owner_name: string | null; company_owner_email: string | null;
        existing_service_id: string | null; existing_service_name: string | null;
        suggested_service_id: string; suggested_service_name: string | null;
        relationship: string | null; evidence: string | null; confidence: string;
        confidence_score: number; relevant_opportunities: unknown[] | null;
        suggested_message: string | null; timing: string | null; owner_id: string | null;
        owner_name: string | null; status: string; admin_notes: string | null;
        created_at: string; updated_at: string;
      }[],
      {
        id: string; service_name: string; source: string; confidence: string | null;
        verification_status: string | null;
      }[],
      {
        id: string; title: string | null; source_url: string | null; excerpt: string | null;
        evidence_type: string | null; captured_at: string | null; confidence: string | null;
      }[],
      {
        id: string; action: string; actor_type: string; actor_id: string | null;
        details: unknown; created_at: string;
      }[],
    ];
    const row = opp[0];
    if (!row) return { ok: false, error: "Upsell opportunity not found." };
    return {
      ok: true,
      opportunity: {
        id: row.id,
        companyId: row.company_id,
        companyName: row.company_name,
        companyType: row.company_type,
        companyStatus: row.company_status,
        companyOwnerId: row.company_owner_id,
        companyOwnerName: row.company_owner_name,
        companyOwnerEmail: row.company_owner_email,
        existingServiceId: row.existing_service_id,
        existingServiceName: row.existing_service_name,
        suggestedServiceId: row.suggested_service_id,
        suggestedServiceName: row.suggested_service_name,
        relationship: row.relationship,
        evidence: row.evidence,
        confidence: row.confidence,
        confidenceScore: num(row.confidence_score),
        relevantOpportunities: (row.relevant_opportunities ?? []) as UpsellRelevantOpportunity[],
        suggestedMessage: row.suggested_message,
        timing: row.timing,
        ownerId: row.owner_id,
        ownerName: row.owner_name,
        status: row.status as UpsellWorkflowStatus,
        adminNotes: row.admin_notes,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        existingRelationships: rels.map((r) => ({
          id: r.id,
          serviceName: r.service_name,
          source: r.source,
          confidence: r.confidence ?? "Requires_Manual_Review",
          verificationStatus: r.verification_status ?? "unverified",
        })),
        evidenceItems: evidence.map((e) => ({
          id: e.id,
          title: e.title,
          sourceUrl: e.source_url,
          excerpt: e.excerpt,
          evidenceType: e.evidence_type,
          capturedAt: e.captured_at ? String(e.captured_at) : null,
          confidence: e.confidence,
        })),
        history: history.map((h) => ({
          id: h.id,
          action: h.action,
          actorType: h.actor_type,
          actorId: h.actor_id,
          details: (h.details ?? {}) as Record<string, string | number | boolean | null>,
          createdAt: String(h.created_at),
        })),
      },
    };
  } catch (err) {
    console.error("doGetUpsellOpportunity failed:", err);
    return { ok: false, error: "Could not load the upsell opportunity." };
  }
}

// ------------------------------------------------------------------ create
export async function doCreateUpsellOpportunity(
  admin: AdminActor,
  input: UpsellCreateInput,
): Promise<UpsellActionResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED" };
  const denied = requireUpsellMutate(admin);
  if (denied) return { ok: false, error: denied, code: "ROLE_DENIED" };
  const companyId = (input.companyId ?? "").trim();
  const suggestedServiceId = (input.suggestedServiceId ?? "").trim();
  if (!companyId || !suggestedServiceId) {
    return { ok: false, error: "Company and suggested service are required." };
  }
  const confidence = (input.confidence ?? "Requires_Manual_Review").trim();
  if (!["High", "Medium", "Low", "Requires_Manual_Review"].includes(confidence)) {
    return { ok: false, error: "Invalid confidence value." };
  }
  const confidenceScore = Number.isNaN(Number(input.confidenceScore)) ? 0 : Number(input.confidenceScore);
  try {
    await ensureSchema();
    const inserted = (await asUser(admin.id, "sb_admin", (tx) => [
      tx`insert into upsell_opportunities (
            company_id, existing_service_id, suggested_service_id, relationship,
            evidence, confidence, confidence_score, relevant_opportunities,
            suggested_message, timing, owner_id, status)
         values (${companyId}, ${(input.existingServiceId ?? "").trim() || null},
                 ${suggestedServiceId}, ${input.relationship?.trim().slice(0, 500) || null},
                 ${input.evidence?.trim().slice(0, 3000) || null},
                 ${confidence}, ${confidenceScore},
                 ${(input.relevantOpportunities ?? []) as never},
                 ${input.suggestedMessage?.trim().slice(0, 1000) || null},
                 ${input.timing?.trim().slice(0, 300) || null},
                 ${(input.ownerId ?? "").trim() || null}, 'Suggested')
         returning id`,
      upsellAuditQuery(tx, admin.id, "ai.upsell.created", {
        opportunityId: undefined,
        companyId,
        existingServiceId: (input.existingServiceId ?? "").trim() || null,
        suggestedServiceId,
        confidence,
        confidenceScore,
      }),
      aiAuditQuery(tx, {
        actorType: "admin",
        actorId: admin.id,
        action: "ai.upsell.created",
        entityType: "upsell_opportunity",
        details: {
          companyId,
          existingServiceId: (input.existingServiceId ?? "").trim() || null,
          suggestedServiceId,
          confidence,
          confidenceScore,
        },
      }),
    ])) as unknown[];
    const id = (inserted[1] as { id: string }[])[0]?.id;
    if (!id) return { ok: false, error: "Could not create the upsell opportunity." };
    return { ok: true, message: "Upsell opportunity created.", id };
  } catch (err) {
    console.error("doCreateUpsellOpportunity failed:", err);
    return { ok: false, error: "Could not create the upsell opportunity." };
  }
}

// ------------------------------------------------------------ status changes
/**
 * Role-gated status transition with the human-approval gate. Every transition
 * writes audit_logs + ai_audit_events rows in the same transaction; sending
 * (-> Sent) additionally records ai.upsell.send and notifies the company
 * owner (notifications row, type 'upsell').
 */
export async function doUpdateUpsellStatus(
  admin: AdminActor,
  opportunityId: string,
  to: string,
  notes?: string | null,
): Promise<UpsellActionResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED" };
  const denied = requireUpsellMutate(admin);
  if (denied) return { ok: false, error: denied, code: "ROLE_DENIED" };
  if (!(UPSELL_STATUSES as readonly string[]).includes(to)) {
    return { ok: false, error: "Invalid upsell status." };
  }
  const target = to as UpsellWorkflowStatus;
  const noteText = notes?.trim().slice(0, 2000) || null;
  try {
    await ensureSchema();
    const rows = (await asUser(admin.id, "sb_admin", (tx) => [
      tx`select uo.id, uo.company_id, uo.suggested_service_id, uo.status,
                c.owner_id as company_owner_id, c.name as company_name
         from upsell_opportunities uo
         left join companies c on c.id = uo.company_id
         where uo.id = ${opportunityId}
         limit 1`,
    ]))[1] as unknown as {
      id: string; company_id: string; suggested_service_id: string; status: string;
      company_owner_id: string | null; company_name: string | null;
    }[];
    const opp = rows[0];
    if (!opp) return { ok: false, error: "Upsell opportunity not found." };
    const from = opp.status as UpsellWorkflowStatus;
    if (from === target) return { ok: true, message: "Opportunity is already in that status." };
    const allowed = UPSELL_TRANSITIONS[from] ?? [];
    if (!(allowed as readonly string[]).includes(target)) {
      return {
        ok: false,
        error: `Cannot move from ${UPSELL_STATUS_LABELS[from]} to ${UPSELL_STATUS_LABELS[target]}.`,
      };
    }
    const isSend = target === "Sent";
    await asUser(admin.id, "sb_admin", (tx) => {
      const batch: ReturnType<Tx>[] = [
        tx`update upsell_opportunities
           set status = ${target},
               admin_notes = coalesce(${noteText}, admin_notes),
               updated_at = now()
           where id = ${opportunityId}`,
        upsellAuditQuery(tx, admin.id, "ai.upsell.status_change", {
          opportunityId,
          companyId: opp.company_id,
          from,
          to: target,
          adminNotes: noteText,
        }),
        aiAuditQuery(tx, {
          actorType: "admin",
          actorId: admin.id,
          action: "ai.upsell.status_change",
          entityType: "upsell_opportunity",
          entityId: opportunityId,
          details: {
            companyId: opp.company_id,
            suggestedServiceId: opp.suggested_service_id,
            from,
            to: target,
            adminNotes: noteText,
          },
        }),
      ];
      if (isSend) {
        batch.push(
          upsellAuditQuery(tx, admin.id, "ai.upsell.send", {
            opportunityId,
            companyId: opp.company_id,
            companyName: opp.company_name,
            from,
            to: "Sent",
          }),
          aiAuditQuery(tx, {
            actorType: "admin",
            actorId: admin.id,
            action: "ai.upsell.send",
            entityType: "upsell_opportunity",
            entityId: opportunityId,
            details: { companyId: opp.company_id, from, to: "Sent" },
          }),
        );
        if (opp.company_owner_id) {
          batch.push(
            tx`insert into notifications (id, user_id, type, title, body, link)
              values (${randomUUID()}, ${opp.company_owner_id}, 'upsell',
                      'Partnership recommendation shared',
                      'A ScaleBridge Partnership Intelligence recommendation has been approved and shared with you.',
                      '/app/notifications')`,
          );
        }
      }
      return batch;
    });
    return {
      ok: true,
      message:
        isSend
          ? "Opportunity sent (approval gate satisfied). Company owner notified."
          : `Status updated to ${UPSELL_STATUS_LABELS[target]}.`,
    };
  } catch (err) {
    console.error("doUpdateUpsellStatus failed:", err);
    return { ok: false, error: "Could not update the upsell status." };
  }
}

// ------------------------------------------------------------------ notes
export async function doUpdateUpsellNotes(
  admin: AdminActor,
  opportunityId: string,
  notes: string,
): Promise<UpsellActionResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED" };
  const denied = requireUpsellMutate(admin);
  if (denied) return { ok: false, error: denied, code: "ROLE_DENIED" };
  const noteText = (notes ?? "").trim().slice(0, 2000);
  if (!noteText) return { ok: false, error: "Notes cannot be empty." };
  try {
    await ensureSchema();
    const rows = (await asUser(admin.id, "sb_admin", (tx) => [
      tx`select id, company_id from upsell_opportunities where id = ${opportunityId} limit 1`,
    ]))[1] as unknown as { id: string; company_id: string }[];
    if (!rows[0]) return { ok: false, error: "Upsell opportunity not found." };
    await asUser(admin.id, "sb_admin", (tx) => [
      tx`update upsell_opportunities
         set admin_notes = ${noteText}, updated_at = now()
         where id = ${opportunityId}`,
      upsellAuditQuery(tx, admin.id, "ai.upsell.notes", {
        opportunityId,
        companyId: rows[0].company_id,
        notes: noteText,
      }),
      aiAuditQuery(tx, {
        actorType: "admin",
        actorId: admin.id,
        action: "ai.upsell.notes",
        entityType: "upsell_opportunity",
        entityId: opportunityId,
        details: { companyId: rows[0].company_id, notes: noteText },
      }),
    ]);
    return { ok: true, message: "Notes updated." };
  } catch (err) {
    console.error("doUpdateUpsellNotes failed:", err);
    return { ok: false, error: "Could not update the notes." };
  }
}
