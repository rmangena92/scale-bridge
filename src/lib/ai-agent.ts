/**
 * AI Service Intelligence agent — server-only evidence-based discovery engine
 * (plan item 5).
 *
 * The agent runs in RECOMMENDATION MODE ONLY. It reads approved internal data
 * (company profile fields, company_services relationships, service_evidence,
 * contract participation via work_packages, uploaded documents, client intake
 * notes) and — only when the company has granted public-source consent —
 * previously captured public-source evidence (evidence rows carrying a
 * source_url from a public source type). It extracts evidence, maps it to
 * catalogue services, checks active usage, and records ai_recommendations
 * rows in status 'Suggested'. It NEVER modifies a company profile, NEVER
 * contacts a business, NEVER invents services, NEVER claims certification
 * without evidence, NEVER promises work or pricing, and NEVER creates
 * contracts. Every recommendation requires real evidence (service page,
 * capability statement, case study, client-intake response, contract scope,
 * uploaded document) — keyword hits alone never confirm a service.
 *
 * Confidence model (deterministic, evidence-driven):
 *   High                     — explicit evidence from a primary source (the
 *                               service name appears in a capability
 *                               statement / service page / contract scope /
 *                               case study / uploaded doc / intake response).
 *   Medium                   — strong indirect evidence (multiple keyword
 *                               overlaps from a primary source, or the service
 *                               name in non-primary text like a profile note).
 *   Low                      — weak/indirect evidence (a couple of keyword
 *                               overlaps from a secondary mention).
 *   Requires_Manual_Review   — ambiguous (a single keyword hit; the only
 *                               signal is a generic mention).
 *
 * The engine is intentionally pure/heuristic (no external model calls in this
 * build): every score is a deterministic function of stored evidence. A later
 * delegation may plug in an LLM extractor behind the same evidence/approval
 * contract; the hard rules above are enforced by this module regardless.
 *
 * SECURITY: every read/write runs through asUser(actorId, 'sb_admin', …) — the
 * AI tables mirror the catalogue tables and are sb_admin-only at the RLS
 * layer. Auth/RBAC is enforced by the caller (src/lib/ai.ts server functions)
 * via loadAdminUser(); this module never does its own auth.
 */
import { randomUUID } from "node:crypto";
import { asUser, ensureSchema } from "./db";
import type { Tx } from "./db";
import { auditQuery } from "./audit";

// ------------------------------------------------------------------ constants
export const AGENT_VERSION = "0.1.0";
export const PROMPT_MODEL = "deterministic-heuristic-v1";

export const AI_RUN_TRIGGERS = [
  "profile_update",
  "intake",
  "uploaded_document",
  "contract_participation",
  "manual",
  "manual_re-run",
] as const;
export type AiRunTrigger = (typeof AI_RUN_TRIGGERS)[number];

export const AI_RUN_STATUSES = ["queued", "running", "completed", "failed"] as const;
export type AiRunStatus = (typeof AI_RUN_STATUSES)[number];

export const AI_RECOMMENDATION_TYPES = [
  "service_discovery",
  "upsell",
  "cross-sell",
  "profile_update",
] as const;
export type AiRecommendationType = (typeof AI_RECOMMENDATION_TYPES)[number];

export const AI_RECOMMENDATION_STATUSES = [
  "Suggested",
  "Under_Review",
  "Approved",
  "Rejected",
  "Added_To_Profile",
  "Expired",
] as const;
export type AiRecommendationStatus = (typeof AI_RECOMMENDATION_STATUSES)[number];

export const AI_CONFIDENCES = ["High", "Medium", "Low", "Requires_Manual_Review"] as const;
export type AiConfidence = (typeof AI_CONFIDENCES)[number];

export const UPSELL_STATUSES = [
  "Suggested",
  "Under_Review",
  "Approved",
  "Rejected",
  "Awaiting_Company_Confirmation",
  "Sent",
  "Interested",
  "Declined",
  "Converted",
  "Closed",
] as const;
export type UpsellStatus = (typeof UPSELL_STATUSES)[number];

/** Evidence types considered PRIMARY (explicit proof of a delivered service).
 *  These map to the plan's evidence list: service page, capability statement,
 *  case study, client-intake response, contract scope, uploaded document. */
const PRIMARY_EVIDENCE_TYPES = new Set([
  "website_service_page",
  "service_page",
  "capability_statement",
  "case_study",
  "contract_scope",
  "client_intake_response",
  "uploaded_document",
]);

/** Evidence types that were captured from PUBLIC sources. Using these as
 *  evidence requires company_ai_preferences.public_source_consent = true. */
const PUBLIC_EVIDENCE_TYPES = new Set([
  "website_service_page",
  "service_page",
  "capability_statement",
  "case_study",
  "public_source",
]);

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "our", "your", "its", "his", "her",
  "are", "was", "were", "has", "have", "had", "will", "would", "shall",
  "this", "that", "these", "those", "into", "onto", "over", "under", "about",
  "across", "within", "including", "included", "such", "also", "can", "may",
  "must", "not", "all", "any", "per", "via", "using", "used", "plus", "per",
  "site", "sites", "commercial", "business", "businesses", "company",
  "services", "service", "solutions", "system", "systems", "work", "works",
  "workspace", "management", "maintenance", "maintaining", "provide",
  "provides", "providing", "deliver", "delivers", "delivering", "offer",
  "offers", "offering", "support", "supports", "supporting", "specialist",
  "specialists", "professional", "program", "programs", "programme",
  "facility", "facilities", "building", "buildings", "contract", "contracts",
  "operation", "operations", "operational", "ongoing", "including", "covers",
]);

/** Generic tokens that can never by themselves confirm a service. */
const GENERIC_TOKENS = new Set([
  "services", "service", "solutions", "systems", "system", "management",
  "maintenance", "works", "work", "support", "program", "specialist",
]);

// ------------------------------------------------------------------- types
export type EvidenceItem = {
  text: string;
  sourceUrl?: string | null;
  sourceKind: "company_profile" | "internal_notes" | "company_services" | "service_evidence" | "document" | "work_package" | "client_intake";
  evidenceType?: string | null;
  primary: boolean;
  public?: boolean;
};

export type ServiceCandidate = {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string | null;
  status: string;
  upsellServiceIds: string[];
  relatedServiceIds: string[];
};

export type ScoredMatch = {
  service: ServiceCandidate;
  evidence: EvidenceItem;
  rawScore: number;
  nameHit: boolean;
  confidence: AiConfidence;
  confidenceScore: number;
};

/** Concrete JSON shape of ai_agent_runs.run_metadata (serializable across the
 *  serverFn boundary; the DB jsonb is cast to this shape). */
export type AiRunMetadata = {
  trigger?: string;
  company?: string;
  verificationStatus?: string;
  dryRun?: boolean;
  publicSourcesChecked?: boolean;
  grantedPermissions?: string[];
  evidenceCount?: number;
  internalEvidenceCount?: number;
  publicEvidenceCount?: number;
  intakeResponsesPresent?: boolean;
  matches?: { service: string; rawScore: number; confidence: string }[];
  recommendationsCreated?: number;
  recommendationsPending?: { type: string; service: string; confidence: string }[];
  skipped?: string;
  seeded?: boolean;
  note?: string;
};

/** Concrete JSON shape of upsell_opportunities.relevant_opportunities items. */
export type RelevantOpportunity = {
  service?: string | null;
  note?: string | null;
  suggested_service?: string | null;
};

export type AiRunRow = {
  id: string;
  companyId: string;
  companyName: string | null;
  trigger: string;
  status: AiRunStatus;
  agentVersion: string;
  promptModel: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  runMetadata: AiRunMetadata;
  createdAt: string;
};

export type AiRecommendationRow = {
  id: string;
  companyId: string;
  companyName: string | null;
  runId: string | null;
  serviceId: string | null;
  serviceName: string | null;
  recommendationType: AiRecommendationType;
  status: AiRecommendationStatus;
  confidence: AiConfidence;
  confidenceScore: number;
  summary: string;
  rationale: string | null;
  source: string;
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  adminNotes: string | null;
};

export type UpsellOpportunityRow = {
  id: string;
  companyId: string;
  companyName: string | null;
  existingServiceId: string | null;
  existingServiceName: string | null;
  suggestedServiceId: string;
  suggestedServiceName: string;
  relationship: string | null;
  evidence: string | null;
  confidence: AiConfidence;
  confidenceScore: number;
  relevantOpportunities: RelevantOpportunity[];
  suggestedMessage: string | null;
  timing: string | null;
  ownerId: string | null;
  status: UpsellStatus;
  adminNotes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AnalysisResult = {
  ok: boolean;
  runId?: string;
  error?: string;
  companyId?: string;
  skipped?: string;
  evidenceCount?: number;
  recommendationsCreated?: number;
  matches?: ScoredMatch[];
  dryRun?: boolean;
};

// ------------------------------------------------------------------ helpers
/** Insert an AI audit event row. Append to any asUser() batch. */
export function aiAuditQuery(
  tx: Tx,
  input: {
    runId?: string | null;
    actorType: "agent" | "admin" | "system";
    actorId?: string | null;
    action: string;
    entityType?: string | null;
    entityId?: string | null;
    details?: Record<string, unknown>;
  },
): ReturnType<Tx> {
  return tx`insert into ai_audit_events (id, run_id, actor_type, actor_id, action, entity_type, entity_id, details)
    values (${randomUUID()}, ${input.runId ?? null}, ${input.actorType},
            ${input.actorId ?? null}, ${input.action},
            ${input.entityType ?? null}, ${input.entityId ?? null},
            ${(input.details ?? {}) as never})`;
}

/** Deterministic tokenizer: lowercase, alphanumerics only, drop stopwords and
 *  short tokens. Pure — no DB access. */
export function tokenize(text: string): string[] {
  const raw = text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
  return [...new Set(raw.filter((t) => !STOPWORDS.has(t)))];
}

/** Score one evidence text against one service. Pure.
 *  Returns null when the match is below the recommendation threshold. */
export function scoreEvidence(
  evidence: EvidenceItem,
  service: ServiceCandidate,
): ScoredMatch | null {
  const evTokens = new Set(tokenize(evidence.text));
  const nameTokens = tokenize(service.name).filter((t) => !GENERIC_TOKENS.has(t));
  const categoryTokens = tokenize(service.category);
  const descTokens = tokenize(service.description ?? "").filter((t) => !GENERIC_TOKENS.has(t));

  const nameHit = nameTokens.filter((t) => evTokens.has(t));
  const catHits = categoryTokens.filter((t) => evTokens.has(t));
  const descHits = descTokens.filter((t) => evTokens.has(t)).slice(0, 5);

  const rawScore =
    nameHit.length * 5 + catHits.length * 2 + descHits.length * 1;
  if (rawScore < 1) return null;

  // Gating: keyword hits alone never confirm a service. A match is only
  // recommendable when the service name appears, OR there is real overlap
  // (>=2 points) backed by a primary evidence source.
  const primary = evidence.primary || PRIMARY_EVIDENCE_TYPES.has(evidence.evidenceType ?? "");
  const recommendable =
    nameHit.length > 0 ||
    (primary && rawScore >= 2) ||
    (rawScore >= 2 && catHits.length > 0);
  if (!recommendable) return null;

  let confidence: AiConfidence;
  if (primary && nameHit.length > 0 && rawScore >= 5) {
    confidence = "High"; // explicit evidence from a primary source
  } else if ((primary && rawScore >= 3) || (nameHit.length > 0 && rawScore >= 3)) {
    confidence = "Medium"; // strong indirect evidence
  } else if (rawScore >= 2) {
    confidence = "Low"; // weak/indirect evidence
  } else {
    confidence = "Requires_Manual_Review"; // ambiguous single hit
  }
  const confidenceScore = Math.min(100, rawScore * 10);

  return { service, evidence, rawScore, nameHit: nameHit.length > 0, confidence, confidenceScore };
}

/** Catalogue-link confidence: how strong is the existing relationship that
 *  anchors an upsell/cross-sell suggestion? */
export function relationshipConfidence(
  existingVerification: string,
  existingActive: boolean,
): { confidence: AiConfidence; confidenceScore: number } {
  if (existingVerification === "Verified" && existingActive) {
    return { confidence: "High", confidenceScore: 80 };
  }
  if (existingVerification === "Verified" || existingActive) {
    return { confidence: "Medium", confidenceScore: 60 };
  }
  return { confidence: "Low", confidenceScore: 40 };
}

// ------------------------------------------------------------------ engine
async function loadRun(actorId: string, runId: string) {
  const rows = (await asUser(actorId, "sb_admin", (tx) => [
    tx`select id, company_id, trigger, status, agent_version, prompt_model
       from ai_agent_runs where id = ${runId}`,
  ]))[1] as {
    id: string;
    company_id: string;
    trigger: string;
    status: string;
    agent_version: string;
    prompt_model: string | null;
  }[];
  return rows[0] ?? null;
}

/** Run the full analysis pipeline for one queued run row. Shared by
 *  analyzeCompany() (manual trigger) and runAnalysisQueue(). */
async function processRun(actorId: string, runId: string, dryRun: boolean): Promise<AnalysisResult> {
  const run = await loadRun(actorId, runId);
  if (!run) return { ok: false, error: "Run not found." };
  if (run.status !== "queued") return { ok: false, error: `Run is not queued (status=${run.status}).` };

  const base: AnalysisResult = { ok: true, runId, companyId: run.company_id, dryRun };

  // 1. mark running ------------------------------------------------------
  await asUser(actorId, "sb_admin", (tx) => [
    tx`update ai_agent_runs set status = 'running', started_at = now()
       where id = ${runId}`,
    aiAuditQuery(tx, {
      runId,
      actorType: "agent",
      actorId: `agent:${AGENT_VERSION}`,
      action: "ai.run.started",
      entityType: "ai_agent_run",
      entityId: runId,
      details: { trigger: run.trigger, dryRun },
    }),
    auditQuery(tx, actorId, "ai.agent.run.started", { runId, companyId: run.company_id, trigger: run.trigger, dryRun }),
  ]);

  try {
    // 2. company + preferences --------------------------------------------
    const [, company, prefs, perms, enabledSources] = (await asUser(actorId, "sb_admin", (tx) => [
      tx`select id, name, type, description, internal_notes, verification_status
         from companies where id = ${run.company_id}`,
      tx`select ai_discovery_enabled, public_source_consent, opt_out
         from company_ai_preferences where company_id = ${run.company_id}`,
      tx`select source, granted, consent_ref from ai_data_source_permissions
         where company_id = ${run.company_id}`,
      tx`select source from ai_data_source_registry where enabled = true`,
    ])) as unknown as [
      unknown,
      { id: string; name: string; type: string | null; description: string | null; internal_notes: string[] | null; verification_status: string }[],
      { ai_discovery_enabled: boolean; public_source_consent: boolean; opt_out: boolean }[],
      { source: string; granted: boolean; consent_ref: string | null }[],
      { source: string }[],
    ];
    const comp = company[0];
    if (!comp) {
      await failRun(actorId, runId, "Company not found.", dryRun);
      return { ...base, ok: false, error: "Company not found." };
    }
    const pref = prefs[0] ?? { ai_discovery_enabled: true, public_source_consent: false, opt_out: false };
    const enabledSet = new Set(enabledSources.map((e) => e.source));
    // Platform-level switch (Master Admin AI Controls): a source the admin has
    // disabled is treated as not granted, even when the company consented.
    const grantedPerms = perms.filter((p) => p.granted && enabledSet.has(p.source)).map((p) => p.source);

    if (pref.opt_out) {
      await completeRun(actorId, runId, { skipped: "opt_out", company: comp.name }, dryRun);
      return { ...base, skipped: "opt_out", evidenceCount: 0, recommendationsCreated: 0 };
    }
    if (!pref.ai_discovery_enabled) {
      await completeRun(actorId, runId, { skipped: "ai_discovery_disabled", company: comp.name }, dryRun);
      return { ...base, skipped: "ai_discovery_disabled", evidenceCount: 0, recommendationsCreated: 0 };
    }

    // 3. gather approved internal data -------------------------------------
    const evidence: EvidenceItem[] = [];
    if (comp.description) {
      evidence.push({
        text: comp.description,
        sourceKind: "company_profile",
        primary: false,
      });
    }
    if (comp.type) {
      evidence.push({ text: comp.type, sourceKind: "company_profile", primary: false });
    }
    if (comp.internal_notes && comp.internal_notes.length > 0) {
      evidence.push({
        text: comp.internal_notes.join(". "),
        sourceKind: "internal_notes",
        primary: false,
      });
    }

    const [, rels, wpRows, docRows] = (await asUser(actorId, "sb_admin", (tx) => [
      tx`select cs.id as rel_id, cs.service_id, cs.source, cs.confidence,
                cs.verification_status, cs.active_with_scalebridge,
                cs.evidence_summary, cs.upsell_recommended
         from company_services cs
         where cs.company_id = ${run.company_id}`,
      tx`select wp.name, wp.description, wp.scope_notes
         from work_packages wp
         where wp.company_id = ${run.company_id}`,
      tx`select d.name, d.category
         from documents d
         where d.workspace_id in (
           select wp2.workspace_id from work_packages wp2 where wp2.company_id = ${run.company_id}
         )`,
    ])) as unknown as [
      unknown,
      { rel_id: string; service_id: string; source: string; confidence: string; verification_status: string; active_with_scalebridge: boolean; evidence_summary: string | null; upsell_recommended: boolean }[],
      { name: string; description: string | null; scope_notes: string | null }[],
      { name: string; category: string | null }[],
    ];
    const relsById = new Map(rels.map((r) => [r.rel_id, r]));
    const existingServiceIds = new Set(rels.map((r) => r.service_id));

    // service_evidence rows (approved evidence) — public-typed rows only with consent
    const evRows = (await asUser(actorId, "sb_admin", (tx) => [
      tx`select se.company_service_id, se.evidence_type, se.title, se.source_url, se.excerpt
         from service_evidence se
         where se.company_service_id in (
           select cs2.id from company_services cs2 where cs2.company_id = ${run.company_id}
         )`,
    ]))[1] as {
      company_service_id: string;
      evidence_type: string | null;
      title: string | null;
      source_url: string | null;
      excerpt: string | null;
    }[];
    for (const e of evRows) {
      const isPublic = PUBLIC_EVIDENCE_TYPES.has(e.evidence_type ?? "");
      if (isPublic && !pref.public_source_consent) continue; // consent gate
      if (isPublic && !enabledSet.has("website") && !enabledSet.has("public_source")) continue; // platform switch
      const rel = relsById.get(e.company_service_id);
      if (!rel) continue;
      const text = [e.title, e.excerpt].filter(Boolean).join(". ");
      if (!text) continue;
      evidence.push({
        text,
        sourceUrl: e.source_url,
        sourceKind: "service_evidence",
        evidenceType: e.evidence_type,
        primary: PRIMARY_EVIDENCE_TYPES.has(e.evidence_type ?? ""),
        public: isPublic,
      });
    }
    // relationship evidence summaries (internal catalogue data — always approved)
    for (const r of rels) {
      if (r.evidence_summary) {
        evidence.push({
          text: r.evidence_summary,
          sourceKind: "company_services",
          evidenceType: r.source === "client intake form" ? "client_intake_response" : null,
          primary: r.source === "contract participation" || r.source === "client intake form",
        });
      }
    }
    // contract participation
    for (const w of wpRows) {
      const text = [w.name, w.description, w.scope_notes].filter(Boolean).join(". ");
      if (text) {
        evidence.push({ text, sourceKind: "work_package", evidenceType: "contract_scope", primary: true });
      }
    }
    // uploaded documents (names/categories only — never file contents)
    for (const d of docRows) {
      const text = [d.name, d.category].filter(Boolean).join(" — ");
      if (text) {
        evidence.push({ text, sourceKind: "document", evidenceType: "uploaded_document", primary: true });
      }
    }
    // client intake responses: relationships sourced from the intake form already
    // carry their evidence_summary above; record presence in run metadata.

    const publicCount = evidence.filter((e) => e.public).length;

    // 4. catalogue + mapping -------------------------------------------------
    type ServiceDbRow = {
      id: string;
      name: string;
      slug: string;
      category: string;
      description: string | null;
      status: string;
      upsell_service_ids: string[] | null;
      related_service_ids: string[] | null;
    };
    const svcRows = (await asUser(actorId, "sb_admin", (tx) => [
      tx`select s.id, s.name, s.slug, sc.name as category, s.description, s.status,
                s.upsell_service_ids, s.related_service_ids
         from services s
         join service_categories sc on sc.id = s.category_id
         where s.status not in ('Rejected','Archived')
         order by s.name`,
    ]))[1] as ServiceDbRow[];
    const candidates: ServiceCandidate[] = svcRows.map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      category: s.category,
      description: s.description,
      status: s.status,
      upsellServiceIds: s.upsell_service_ids ?? [],
      relatedServiceIds: s.related_service_ids ?? [],
    }));

    // map evidence → services (aggregate best match per service)
    const bestByService = new Map<string, ScoredMatch>();
    for (const ev of evidence) {
      for (const svc of candidates) {
        const match = scoreEvidence(ev, svc);
        if (!match) continue;
        const cur = bestByService.get(svc.id);
        if (!cur || match.rawScore > cur.rawScore) bestByService.set(svc.id, match);
      }
    }

    // 5. check active usage → identify unused/underused -----------------------
    const recommendations: {
      type: AiRecommendationType;
      serviceId: string;
      summary: string;
      rationale: string;
      source: string;
      confidence: AiConfidence;
      confidenceScore: number;
    }[] = [];

    for (const match of bestByService.values()) {
      const { service, evidence: ev, confidence, confidenceScore, rawScore } = match;
      const known = existingServiceIds.has(service.id);
      const sourceLabel = ev.public ? "public_source" : "internal_data";
      if (!known) {
        // unused service the company demonstrably provides → discovery
        recommendations.push({
          type: "service_discovery",
          serviceId: service.id,
          summary: `${service.name} matched for ${comp.name}`,
          rationale: `Evidence (${ev.sourceKind}${ev.sourceUrl ? `, ${ev.sourceUrl}` : ""}): “${ev.text.slice(0, 280)}”. Match score ${rawScore} (confidence ${confidence}); the service is not yet listed in the company's profile.`,
          source: sourceLabel,
          confidence,
          confidenceScore,
        });
      } else if (confidence === "High") {
        // known but unverified service with explicit evidence → profile update
        const rel = rels.find((r) => r.service_id === service.id);
        if (rel && rel.verification_status !== "Verified") {
          recommendations.push({
            type: "profile_update",
            serviceId: service.id,
            summary: `Verify ${service.name} for ${comp.name}`,
            rationale: `Evidence (${ev.sourceKind}): “${ev.text.slice(0, 280)}”. The service is already listed (${rel.source}/${rel.verification_status}) but has not been verified; the evidence supports verification.`,
            source: sourceLabel,
            confidence,
            confidenceScore,
          });
        }
      }
    }

    // 6. upsell / cross-sell from catalogue links -----------------------------
    const svcMeta = new Map(candidates.map((s) => [s.id, s]));
    for (const rel of rels) {
      const svc = svcMeta.get(rel.service_id);
      if (!svc) continue;
      const { confidence, confidenceScore } = relationshipConfidence(
        rel.verification_status,
        rel.active_with_scalebridge,
      );
      const linkIds = [
        ...(svc.upsellServiceIds ?? []).map((id: string) => ({ id, kind: "upsell" as const })),
        ...(svc.relatedServiceIds ?? []).map((id: string) => ({ id, kind: "cross-sell" as const })),
      ];
      const seen = new Set<string>();
      for (const link of linkIds) {
        if (seen.has(link.id)) continue;
        seen.add(link.id);
        if (existingServiceIds.has(link.id)) continue;
        const target = svcMeta.get(link.id);
        if (!target) continue;
        recommendations.push({
          type: link.kind,
          serviceId: target.id,
          summary: `${link.kind === "upsell" ? "Upsell" : "Cross-sell"}: ${target.name} to ${comp.name}`,
          rationale: `${comp.name} delivers ${svc.name} (${rel.source}, ${rel.verification_status}, active_with_scalebridge=${rel.active_with_scalebridge}); the catalogue links ${svc.name} → ${target.name}. Suggested ${link.kind} opportunity.`,
          source: "catalogue_link",
          confidence,
          confidenceScore,
        });
      }
    }

    // 7. persist recommendations (skipped in dryRun/shadow mode) ---------------
    let created = 0;
    if (!dryRun && recommendations.length > 0) {
      await asUser(actorId, "sb_admin", (tx) => [
        ...recommendations.map((r) =>
          tx`insert into ai_recommendations (
                company_id, run_id, service_id, recommendation_type, status,
                confidence, confidence_score, summary, rationale, source)
             values (${run.company_id}, ${runId}, ${r.serviceId}, ${r.type},
                     'Suggested', ${r.confidence}, ${r.confidenceScore},
                     ${r.summary}, ${r.rationale}, ${r.source})`),
      ]);
      created = recommendations.length;
    }

    // 8. complete run + audit --------------------------------------------------
    const metadata = {
      trigger: run.trigger,
      company: comp.name,
      verificationStatus: comp.verification_status,
      dryRun,
      publicSourcesChecked: pref.public_source_consent,
      grantedPermissions: grantedPerms,
      evidenceCount: evidence.length,
      internalEvidenceCount: evidence.length - publicCount,
      publicEvidenceCount: publicCount,
      intakeResponsesPresent: rels.some((r) => r.source === "client intake form"),
      matches: [...bestByService.values()].map((m) => ({
        service: m.service.name,
        rawScore: m.rawScore,
        confidence: m.confidence,
      })),
      recommendationsCreated: created,
      recommendationsPending: recommendations.map((r) => ({
        type: r.type,
        service: svcMeta.get(r.serviceId)?.name ?? r.serviceId,
        confidence: r.confidence,
      })),
    };
    await completeRun(actorId, runId, metadata, dryRun);
    return { ...base, evidenceCount: evidence.length, recommendationsCreated: created };
  } catch (err) {
    console.error("ai agent processRun failed:", err);
    const msg = err instanceof Error ? err.message : String(err);
    await failRun(actorId, runId, msg, dryRun);
    return { ...base, ok: false, error: msg };
  }
}

async function completeRun(
  actorId: string,
  runId: string,
  metadata: Record<string, unknown>,
  dryRun: boolean,
): Promise<void> {
  await asUser(actorId, "sb_admin", (tx) => [
    tx`update ai_agent_runs
       set status = 'completed', finished_at = now(), run_metadata = ${metadata as never}
       where id = ${runId}`,
    aiAuditQuery(tx, {
      runId,
      actorType: "agent",
      actorId: `agent:${AGENT_VERSION}`,
      action: "ai.run.completed",
      entityType: "ai_agent_run",
      entityId: runId,
      details: metadata,
    }),
    auditQuery(tx, actorId, "ai.agent.run.completed", { runId, dryRun, ...metadata }),
  ]);
}

async function failRun(
  actorId: string,
  runId: string,
  error: string,
  dryRun: boolean,
): Promise<void> {
  await asUser(actorId, "sb_admin", (tx) => [
    tx`update ai_agent_runs
       set status = 'failed', finished_at = now(), error = ${error.slice(0, 2000)}
       where id = ${runId}`,
    aiAuditQuery(tx, {
      runId,
      actorType: "system",
      actorId: `agent:${AGENT_VERSION}`,
      action: "ai.run.failed",
      entityType: "ai_agent_run",
      entityId: runId,
      details: { error: error.slice(0, 500), dryRun },
    }),
    auditQuery(tx, actorId, "ai.agent.run.failed", { runId, error: error.slice(0, 500), dryRun }),
  ]);
}

/** Public API: queue a run for a company and (optionally) execute it now.
 *  dryRun=true (shadow mode) runs the same pipeline but writes only the run
 *  row + audit events — no recommendations — for safe verification. */
export async function analyzeCompany(
  actorId: string,
  companyId: string,
  trigger: AiRunTrigger | string,
  opts: { dryRun?: boolean } = {},
): Promise<AnalysisResult> {
  await ensureSchema();
  const dryRun = Boolean(opts.dryRun);
  const t = AI_RUN_TRIGGERS.includes(trigger as AiRunTrigger) ? (trigger as AiRunTrigger) : "manual";

  const rows = (await asUser(actorId, "sb_admin", (tx) => [
    tx`select id from companies where id = ${companyId}`,
  ]))[1] as { id: string }[];
  if (!rows[0]) return { ok: false, error: "Company not found." };

  const inserted = (await asUser(actorId, "sb_admin", (tx) => [
    tx`insert into ai_agent_runs (company_id, trigger, status, agent_version, prompt_model)
       values (${companyId}, ${t}, 'queued', ${AGENT_VERSION}, ${PROMPT_MODEL})
       returning id`,
    aiAuditQuery(tx, {
      actorType: "agent",
      actorId: `agent:${AGENT_VERSION}`,
      action: "ai.run.queued",
      entityType: "ai_agent_run",
      details: { companyId, trigger: t, dryRun },
    }),
    auditQuery(tx, actorId, "ai.agent.run.queued", { companyId, trigger: t, dryRun }),
  ])) as unknown[];
  const runId = (inserted[1] as { id: string }[])[0]?.id;
  if (!runId) return { ok: false, error: "Could not queue the analysis run." };

  return await processRun(actorId, runId, dryRun);
}

/** Process all queued runs (callable manually; no cron in this build). */
export async function runAnalysisQueue(
  actorId: string,
  opts: { limit?: number; dryRun?: boolean } = {},
): Promise<{ ok: boolean; processed: number; results: AnalysisResult[]; error?: string }> {
  await ensureSchema();
  const limit = Math.min(Math.max(Number(opts.limit) || 10, 1), 50);
  const rows = (await asUser(actorId, "sb_admin", (tx) => [
    tx`select id from ai_agent_runs where status = 'queued' order by created_at asc limit ${limit}`,
  ]))[1] as { id: string }[];
  const results: AnalysisResult[] = [];
  for (const r of rows) {
    results.push(await processRun(actorId, r.id, Boolean(opts.dryRun)));
  }
  return { ok: true, processed: results.length, results };
}

// ---------------------------------------------------------------- reads
export async function listAgentRuns(
  actorId: string,
  companyId?: string,
): Promise<{ ok: boolean; runs: AiRunRow[]; error?: string }> {
  try {
    await ensureSchema();
    const rows = (await asUser(actorId, "sb_admin", (tx) => [
      tx`select r.id, r.company_id, c.name as company_name, r.trigger, r.status,
                r.agent_version, r.prompt_model, r.started_at, r.finished_at,
                r.error, r.run_metadata, r.created_at
         from ai_agent_runs r
         left join companies c on c.id = r.company_id
         where ${companyId ?? null}::uuid is null or r.company_id = ${companyId ?? null}::uuid
         order by r.created_at desc
         limit 200`,
    ]))[1] as {
      id: string; company_id: string; company_name: string | null; trigger: string;
      status: string; agent_version: string; prompt_model: string | null;
      started_at: string | null; finished_at: string | null; error: string | null;
      run_metadata: Record<string, unknown> | null; created_at: string;
    }[];
    const runs: AiRunRow[] = rows.map((r) => ({
      id: r.id,
      companyId: r.company_id,
      companyName: r.company_name,
      trigger: r.trigger,
      status: r.status as AiRunStatus,
      agentVersion: r.agent_version,
      promptModel: r.prompt_model,
      startedAt: r.started_at ? String(r.started_at) : null,
      finishedAt: r.finished_at ? String(r.finished_at) : null,
      error: r.error,
      runMetadata: (r.run_metadata ?? {}) as AiRunMetadata,
      createdAt: String(r.created_at),
    }));
    return { ok: true, runs };
  } catch (err) {
    console.error("listAgentRuns failed:", err);
    return { ok: false, runs: [], error: "Could not load AI agent runs." };
  }
}

export async function listRecommendations(
  actorId: string,
  companyId?: string,
): Promise<{ ok: boolean; recommendations: AiRecommendationRow[]; error?: string }> {
  try {
    await ensureSchema();
    const rows = (await asUser(actorId, "sb_admin", (tx) => [
      tx`select rec.id, rec.company_id, c.name as company_name, rec.run_id,
                rec.service_id, s.name as service_name, rec.recommendation_type,
                rec.status, rec.confidence, rec.confidence_score, rec.summary,
                rec.rationale, rec.source, rec.created_at, rec.reviewed_by,
                rec.reviewed_at, rec.admin_notes
         from ai_recommendations rec
         left join companies c on c.id = rec.company_id
         left join services s on s.id = rec.service_id
         where ${companyId ?? null}::uuid is null or rec.company_id = ${companyId ?? null}::uuid
         order by rec.created_at desc
         limit 500`,
    ]))[1] as {
      id: string; company_id: string; company_name: string | null; run_id: string | null;
      service_id: string | null; service_name: string | null; recommendation_type: string;
      status: string; confidence: string; confidence_score: number; summary: string;
      rationale: string | null; source: string; created_at: string;
      reviewed_by: string | null; reviewed_at: string | null; admin_notes: string | null;
    }[];
    const recommendations: AiRecommendationRow[] = rows.map((r) => ({
      id: r.id,
      companyId: r.company_id,
      companyName: r.company_name,
      runId: r.run_id,
      serviceId: r.service_id,
      serviceName: r.service_name,
      recommendationType: r.recommendation_type as AiRecommendationType,
      status: r.status as AiRecommendationStatus,
      confidence: r.confidence as AiConfidence,
      confidenceScore: Number(r.confidence_score ?? 0),
      summary: r.summary,
      rationale: r.rationale,
      source: r.source,
      createdAt: String(r.created_at),
      reviewedBy: r.reviewed_by,
      reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
      adminNotes: r.admin_notes,
    }));
    return { ok: true, recommendations };
  } catch (err) {
    console.error("listRecommendations failed:", err);
    return { ok: false, recommendations: [], error: "Could not load AI recommendations." };
  }
}

export async function listUpsellOpportunities(
  actorId: string,
  companyId?: string,
): Promise<{ ok: boolean; opportunities: UpsellOpportunityRow[]; error?: string }> {
  try {
    await ensureSchema();
    const rows = (await asUser(actorId, "sb_admin", (tx) => [
      tx`select u.id, u.company_id, c.name as company_name,
                u.existing_service_id, es.name as existing_service_name,
                u.suggested_service_id, ss.name as suggested_service_name,
                u.relationship, u.evidence, u.confidence, u.confidence_score,
                u.relevant_opportunities, u.suggested_message, u.timing,
                u.owner_id, u.status, u.admin_notes, u.created_at, u.updated_at
         from upsell_opportunities u
         left join companies c on c.id = u.company_id
         left join services es on es.id = u.existing_service_id
         left join services ss on ss.id = u.suggested_service_id
         where ${companyId ?? null}::uuid is null or u.company_id = ${companyId ?? null}::uuid
         order by u.created_at desc
         limit 500`,
    ]))[1] as {
      id: string; company_id: string; company_name: string | null;
      existing_service_id: string | null; existing_service_name: string | null;
      suggested_service_id: string; suggested_service_name: string | null;
      relationship: string | null; evidence: string | null; confidence: string;
      confidence_score: number; relevant_opportunities: unknown[] | null;
      suggested_message: string | null; timing: string | null; owner_id: string | null;
      status: string; admin_notes: string | null; created_at: string; updated_at: string;
    }[];
    const opportunities: UpsellOpportunityRow[] = rows.map((r) => ({
      id: r.id,
      companyId: r.company_id,
      companyName: r.company_name,
      existingServiceId: r.existing_service_id,
      existingServiceName: r.existing_service_name,
      suggestedServiceId: r.suggested_service_id,
      suggestedServiceName: r.suggested_service_name ?? "",
      relationship: r.relationship,
      evidence: r.evidence,
      confidence: r.confidence as AiConfidence,
      confidenceScore: Number(r.confidence_score ?? 0),
      relevantOpportunities: (r.relevant_opportunities ?? []) as RelevantOpportunity[],
      suggestedMessage: r.suggested_message,
      timing: r.timing,
      ownerId: r.owner_id,
      status: r.status as UpsellStatus,
      adminNotes: r.admin_notes,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }));
    return { ok: true, opportunities };
  } catch (err) {
    console.error("listUpsellOpportunities failed:", err);
    return { ok: false, opportunities: [], error: "Could not load upsell opportunities." };
  }
}

// ------------------------------------------------------------- review flow
const CONFIDENCE_TO_COMPANY_SERVICE: Record<AiConfidence, string> = {
  High: "High",
  Medium: "Medium",
  Low: "Low",
  Requires_Manual_Review: "Requires manual review",
};

/** Admin decision on a recommendation. Approved → the service is added to
 *  company_services (source 'AI discovery') with a service_evidence row and
 *  review fields set; Rejected → status set with the reason recorded. */
export async function reviewRecommendation(
  actorId: string,
  recommendationId: string,
  decision: "Approved" | "Rejected",
  adminNotes?: string,
): Promise<{ ok: boolean; error?: string; recommendationId?: string }> {
  try {
    await ensureSchema();
    if (decision !== "Approved" && decision !== "Rejected") {
      return { ok: false, error: "Decision must be Approved or Rejected." };
    }
    const rows = (await asUser(actorId, "sb_admin", (tx) => [
      tx`select rec.id, rec.company_id, rec.service_id, rec.status, rec.confidence,
                rec.summary, rec.rationale, rec.run_id,
                r.agent_version
         from ai_recommendations rec
         left join ai_agent_runs r on r.id = rec.run_id
         where rec.id = ${recommendationId}`,
    ]))[1] as {
      id: string; company_id: string; service_id: string | null; status: string;
      confidence: string; summary: string; rationale: string | null; run_id: string | null;
      agent_version: string | null;
    }[];
    const rec = rows[0];
    if (!rec) return { ok: false, error: "Recommendation not found." };
    if (rec.status !== "Suggested" && rec.status !== "Under_Review") {
      return { ok: false, error: `Recommendation is already ${rec.status}.` };
    }
    const notes = adminNotes?.trim().slice(0, 2000) ?? null;
    const reviewedAt = new Date();

    if (decision === "Approved" && rec.service_id) {
      // Add the service to the company profile (AI discovery) + evidence row.
      const agentVersion = rec.agent_version ?? AGENT_VERSION;
      const inserted = (await asUser(actorId, "sb_admin", (tx) => [
        tx`insert into company_services (
              company_id, service_id, source, confidence, verification_status,
              evidence_summary, discovered_at, active_with_scalebridge,
              upsell_recommended, admin_decision, notes, reviewed_by, reviewed_at)
           values (${rec.company_id}, ${rec.service_id}, 'AI discovery',
                   ${CONFIDENCE_TO_COMPANY_SERVICE[rec.confidence as AiConfidence] ?? "Requires manual review"},
                   'Pending', ${rec.summary.slice(0, 2000)}, ${reviewedAt},
                   false, false, 'Approved', ${notes}, ${actorId}, ${reviewedAt})
           on conflict (company_id, service_id) do update set
             source = excluded.source,
             confidence = excluded.confidence,
             verification_status = excluded.verification_status,
             evidence_summary = excluded.evidence_summary,
             discovered_at = excluded.discovered_at,
             upsell_recommended = excluded.upsell_recommended,
             admin_decision = excluded.admin_decision,
             notes = excluded.notes,
             reviewed_by = excluded.reviewed_by,
             reviewed_at = excluded.reviewed_at
           returning id`,
      ])) as unknown[];
      const relId = (inserted[1] as { id: string }[])[0]?.id;
      if (relId) {
        await asUser(actorId, "sb_admin", (tx) => [
          tx`insert into service_evidence (
                company_service_id, evidence_type, title, source_url, excerpt,
                captured_at, agent_version)
             values (${relId}, 'ai_discovery', ${rec.summary.slice(0, 300)},
                     null, ${(rec.rationale ?? rec.summary).slice(0, 3000)},
                     ${reviewedAt}, ${agentVersion})`,
        ]);
      }
    }

    const newStatus = decision === "Approved" ? "Added_To_Profile" : "Rejected";
    await asUser(actorId, "sb_admin", (tx) => [
      tx`update ai_recommendations
         set status = ${newStatus}, reviewed_by = ${actorId},
             reviewed_at = ${reviewedAt}, admin_notes = ${notes}
         where id = ${recommendationId}`,
      aiAuditQuery(tx, {
        runId: rec.run_id,
        actorType: "admin",
        actorId,
        action: `ai.recommendation.${decision === "Approved" ? "approved" : "rejected"}`,
        entityType: "ai_recommendation",
        entityId: recommendationId,
        details: {
          companyId: rec.company_id,
          serviceId: rec.service_id,
          confidence: rec.confidence,
          adminNotes: notes,
          outcome: newStatus,
        },
      }),
      auditQuery(tx, actorId, "ai.recommendation.review", {
        recommendationId,
        companyId: rec.company_id,
        serviceId: rec.service_id,
        decision,
        outcome: newStatus,
        adminNotes: notes,
      }),
    ]);
    return { ok: true, recommendationId };
  } catch (err) {
    console.error("reviewRecommendation failed:", err);
    return { ok: false, error: "Could not review the recommendation." };
  }
}

// ---------------------------------------------------------------- upsells
export type UpsellOpportunityInput = {
  companyId: string;
  existingServiceId?: string | null;
  suggestedServiceId: string;
  relationship?: string | null;
  evidence?: string | null;
  confidence?: AiConfidence;
  confidenceScore?: number;
  relevantOpportunities?: unknown[];
  suggestedMessage?: string | null;
  timing?: string | null;
  ownerId?: string | null;
};

export async function createUpsellOpportunity(
  actorId: string,
  input: UpsellOpportunityInput,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  try {
    await ensureSchema();
    const companyId = (input.companyId ?? "").trim();
    const suggestedServiceId = (input.suggestedServiceId ?? "").trim();
    if (!companyId || !suggestedServiceId) {
      return { ok: false, error: "Company and suggested service are required." };
    }
    const confidence: AiConfidence =
      input.confidence && AI_CONFIDENCES.includes(input.confidence) ? input.confidence : "Requires_Manual_Review";
    const confidenceScore = Number.isFinite(input.confidenceScore)
      ? Math.max(0, Math.min(100, Number(input.confidenceScore)))
      : confidence === "High" ? 80 : confidence === "Medium" ? 60 : confidence === "Low" ? 40 : 30;

    const inserted = (await asUser(actorId, "sb_admin", (tx) => [
      tx`insert into upsell_opportunities (
            company_id, existing_service_id, suggested_service_id, relationship,
            evidence, confidence, confidence_score, relevant_opportunities,
            suggested_message, timing, owner_id, status)
         values (${companyId}, ${input.existingServiceId ?? null},
                 ${suggestedServiceId}, ${input.relationship?.trim().slice(0, 500) ?? null},
                 ${input.evidence?.trim().slice(0, 3000) ?? null},
                 ${confidence}, ${confidenceScore},
                 ${(input.relevantOpportunities ?? []) as never},
                 ${input.suggestedMessage?.trim().slice(0, 1000) ?? null},
                 ${input.timing?.trim().slice(0, 300) ?? null},
                 ${input.ownerId ?? null}, 'Suggested')
         returning id`,
      aiAuditQuery(tx, {
        actorType: "admin",
        actorId,
        action: "ai.upsell.created",
        entityType: "upsell_opportunity",
        details: {
          companyId,
          existingServiceId: input.existingServiceId ?? null,
          suggestedServiceId,
          confidence,
          confidenceScore,
        },
      }),
      auditQuery(tx, actorId, "ai.upsell.create", {
        companyId,
        existingServiceId: input.existingServiceId ?? null,
        suggestedServiceId,
        confidence,
      }),
    ])) as unknown[];
    return { ok: true, id: (inserted[1] as { id: string }[])[0]?.id };
  } catch (err) {
    console.error("createUpsellOpportunity failed:", err);
    return { ok: false, error: "Could not create the upsell opportunity." };
  }
}

/** Status transitions for the upsell workflow. Nothing is Sent/Converted
 *  without an admin action — this function is only reachable through the
 *  admin-guarded server function. */
export async function updateUpsellOpportunityStatus(
  actorId: string,
  opportunityId: string,
  status: UpsellStatus,
  adminNotes?: string,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  try {
    await ensureSchema();
    if (!UPSELL_STATUSES.includes(status as never)) {
      return { ok: false, error: "Invalid upsell status." };
    }
    const rows = (await asUser(actorId, "sb_admin", (tx) => [
      tx`select id, company_id, suggested_service_id, status
         from upsell_opportunities where id = ${opportunityId}`,
    ]))[1] as { id: string; company_id: string; suggested_service_id: string; status: string }[];
    const opp = rows[0];
    if (!opp) return { ok: false, error: "Upsell opportunity not found." };
    const from = opp.status;

    await asUser(actorId, "sb_admin", (tx) => [
      tx`update upsell_opportunities
         set status = ${status},
             admin_notes = coalesce(${adminNotes?.trim().slice(0, 2000) ?? null}, admin_notes),
             updated_at = now()
         where id = ${opportunityId}`,
      aiAuditQuery(tx, {
        actorType: "admin",
        actorId,
        action: "ai.upsell.status_change",
        entityType: "upsell_opportunity",
        entityId: opportunityId,
        details: { companyId: opp.company_id, suggestedServiceId: opp.suggested_service_id, from, to: status, adminNotes },
      }),
      auditQuery(tx, actorId, "ai.upsell.status_change", {
        opportunityId,
        companyId: opp.company_id,
        from,
        to: status,
        adminNotes,
      }),
    ]);
    return { ok: true, id: opportunityId };
  } catch (err) {
    console.error("updateUpsellOpportunityStatus failed:", err);
    return { ok: false, error: "Could not update the upsell opportunity." };
  }
}

// ------------------------------------------------------- company preferences
export async function getCompanyAiPreferences(
  actorId: string,
  companyId: string,
): Promise<{
  ok: boolean;
  error?: string;
  preferences?: {
    aiDiscoveryEnabled: boolean;
    publicSourceConsent: boolean;
    optOut: boolean;
    updatedAt: string | null;
  };
  permissions?: { source: string; granted: boolean; consentRef: string | null; grantedAt: string | null }[];
}> {
  try {
    await ensureSchema();
    const rows = (await asUser(actorId, "sb_admin", (tx) => [
      tx`select id from companies where id = ${companyId}`,
      tx`select ai_discovery_enabled, public_source_consent, opt_out, updated_at
         from company_ai_preferences where company_id = ${companyId}`,
      tx`select source, granted, consent_ref, granted_at
         from ai_data_source_permissions where company_id = ${companyId} order by source`,
    ])) as unknown as [
      unknown,
      { id: string }[],
      { ai_discovery_enabled: boolean; public_source_consent: boolean; opt_out: boolean; updated_at: string }[],
      { source: string; granted: boolean; consent_ref: string | null; granted_at: string | null }[],
    ];
    if (!(rows[1] as { id: string }[])[0]) return { ok: false, error: "Company not found." };
    const pref = rows[2][0] ?? null;
    return {
      ok: true,
      preferences: pref
        ? {
            aiDiscoveryEnabled: pref.ai_discovery_enabled,
            publicSourceConsent: pref.public_source_consent,
            optOut: pref.opt_out,
            updatedAt: String(pref.updated_at),
          }
        : { aiDiscoveryEnabled: true, publicSourceConsent: false, optOut: false, updatedAt: null },
      permissions: rows[3].map((p) => ({
        source: p.source,
        granted: p.granted,
        consentRef: p.consent_ref,
        grantedAt: p.granted_at ? String(p.granted_at) : null,
      })),
    };
  } catch (err) {
    console.error("getCompanyAiPreferences failed:", err);
    return { ok: false, error: "Could not load AI preferences." };
  }
}

export async function updateCompanyAiPreferences(
  actorId: string,
  companyId: string,
  input: {
    aiDiscoveryEnabled?: boolean;
    publicSourceConsent?: boolean;
    optOut?: boolean;
  },
): Promise<{ ok: boolean; error?: string }> {
  try {
    await ensureSchema();
    const rows = (await asUser(actorId, "sb_admin", (tx) => [
      tx`select id from companies where id = ${companyId}`,
    ]))[1] as { id: string }[];
    if (!rows[0]) return { ok: false, error: "Company not found." };

    const current = (await asUser(actorId, "sb_admin", (tx) => [
      tx`select ai_discovery_enabled, public_source_consent, opt_out
         from company_ai_preferences where company_id = ${companyId}`,
    ]))[1] as { ai_discovery_enabled: boolean; public_source_consent: boolean; opt_out: boolean }[];
    const cur = current[0] ?? { ai_discovery_enabled: true, public_source_consent: false, opt_out: false };
    const next = {
      aiDiscoveryEnabled: input.aiDiscoveryEnabled ?? cur.ai_discovery_enabled,
      publicSourceConsent: input.publicSourceConsent ?? cur.public_source_consent,
      optOut: input.optOut ?? cur.opt_out,
    };

    await asUser(actorId, "sb_admin", (tx) => [
      tx`insert into company_ai_preferences (company_id, ai_discovery_enabled, public_source_consent, opt_out)
         values (${companyId}, ${next.aiDiscoveryEnabled}, ${next.publicSourceConsent}, ${next.optOut})
         on conflict (company_id) do update set
           ai_discovery_enabled = excluded.ai_discovery_enabled,
           public_source_consent = excluded.public_source_consent,
           opt_out = excluded.opt_out,
           updated_at = now()`,
      aiAuditQuery(tx, {
        actorType: "admin",
        actorId,
        action: "ai.preferences.updated",
        entityType: "company",
        entityId: companyId,
        details: { from: cur, to: next },
      }),
      auditQuery(tx, actorId, "ai.preferences.update", { companyId, from: cur, to: next }),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("updateCompanyAiPreferences failed:", err);
    return { ok: false, error: "Could not update AI preferences." };
  }
}
