/**
 * Master Admin Portal - AI Controls (backlog item: "AI agent controls UI").
 *
 * Server-only core mirroring admin-upsells-core.ts: every mutation runs inside
 * an asUser(admin.id, 'sb_admin', ...) batch (RLS: the AI tables are FORCE RLS,
 * sb_admin-only via IS_ADMIN policies) and writes its immutable audit rows
 * (audit_logs + ai_audit_events) in the SAME transaction as the change.
 *
 * What this phase covers:
 *   - Data sources: platform registry (ai_data_source_registry) with an
 *     enabled/disabled switch per source, consent status and last-run info;
 *     the toggle is audited and the engine respects it (ai-agent.ts reads the
 *     registry and treats disabled sources as not granted).
 *   - Company opt-out: read-only visibility of company_ai_preferences.opt_out
 *     (opt-out is company-controlled - admins can see and audit it but never
 *     silently re-enable it; the plan's rule).
 *   - Run history: recent ai_agent_runs with status, model/prompt version,
 *     timing and error logs; run detail with inputs/outputs and a manual
 *     re-run that calls the existing engine (analyzeCompany, trigger
 *     'manual_re-run') server-side, audited.
 *   - Audit trail: ai_audit_events reuse (same table + write pattern as
 *     ai-agent.ts).
 *
 * NOT in this phase (per plan): retry queues, rate-limit editing, cost
 * dashboards, data deletion flows - those land in the AI Controls Phase 2
 * delegation.
 *
 * Role gate: operations / compliance / super_admin staff roles may toggle
 * data sources and re-run the agent; every other staff role is read-only.
 */
import { randomUUID } from "node:crypto";
import { asUser, dbConfigured, ensureSchema } from "./db";
import type { Tx } from "./db";
import { aiAuditQuery, analyzeCompany } from "./ai-agent";
import type { AiRunMetadata } from "./ai-agent";
import type { AdminActor } from "./admin-subscriptions-actions";
import { AI_CONTROL_MUTATE_ROLES } from "./ai-control-constants";

export type AiControlResult =
  | { ok: true; message: string; id?: string }
  | { ok: false; error: string; code?: string };

export type AiDataSourceRow = {
  id: string;
  source: string;
  name: string;
  description: string | null;
  sourceUrl: string | null;
  enabled: boolean;
  consentRequired: boolean;
  grantedCompanies: number;
  consentTracked: number;
  companiesWithRows: number;
  lastRunAt: string | null;
  lastRunStatus: string | null;
};

export type AiOptOutRow = {
  companyId: string;
  companyName: string | null;
  companyType: string | null;
  verificationStatus: string | null;
  optOut: boolean;
  aiDiscoveryEnabled: boolean;
  publicSourceConsent: boolean;
  updatedAt: string | null;
};

export type AiRunListRow = {
  id: string;
  companyId: string;
  companyName: string | null;
  trigger: string;
  status: string;
  agentVersion: string;
  promptModel: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  runMetadata: AiRunMetadata;
  createdAt: string;
  durationSec: number | null;
  costUsd: number | null;
};

export type AiAuditRow = {
  id: string;
  runId: string | null;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, string | number | boolean | null>;
  createdAt: string;
};

export type AiControlsOverview =
  | {
      ok: true;
      dataSources: AiDataSourceRow[];
      optOuts: AiOptOutRow[];
      runs: AiRunListRow[];
      auditEvents: AiAuditRow[];
      totals: { runs: number; completed: number; failed: number; optedOut: number; companies: number };
    }
  | { ok: false; error: string };

export type AiRunDetailResult =
  | {
      ok: true;
      run: AiRunListRow;
      recommendations: {
        id: string;
        serviceId: string | null;
        serviceName: string | null;
        recommendationType: string;
        status: string;
        confidence: string;
        confidenceScore: number;
        summary: string;
        rationale: string | null;
        source: string;
        createdAt: string;
      }[];
      auditEvents: AiAuditRow[];
    }
  | { ok: false; error: string };

export type AiControlSettingsRow = {
  dailyRunCap: number;
  perCompanyDailyCap: number;
  minIntervalSeconds: number;
  autoRunEnabled: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
};

export type AiControlSettingsResult =
  | { ok: true; settings: AiControlSettingsRow }
  | { ok: false; error: string };

/** Result of a manual retry of a failed run. retry_blocked means the retry was
 *  refused before the engine started (opt-out or no enabled data source); the
 *  reason is audited as ai.run.retry_blocked. */
export type AiRetryResult =
  | { ok: true; message: string; id?: string }
  | { ok: false; error: string; code?: string; retryBlocked?: boolean };

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
};

function requireAiControlMutate(admin: AdminActor): string | null {
  if (
    !admin.staffRoles.some((r) => (AI_CONTROL_MUTATE_ROLES as readonly string[]).includes(r as never))
  ) {
    return "This action requires an operations, compliance or super_admin role.";
  }
  return null;
}

/** Audit helper for THIS module: binds the details object directly to the jsonb
 *  column (audit.ts's auditQuery stringifies first - the known double-encoding
 *  bug - so new rows must bind objects to stay jsonb objects). */
export function aiControlAuditQuery(
  tx: Tx,
  actorId: string,
  action: string,
  details: Record<string, unknown>,
): ReturnType<Tx> {
  return tx`insert into audit_logs (id, actor_id, action, details)
    values (${randomUUID()}, ${actorId}, ${action}, ${details as never})`;
}

// ------------------------------------------------------------- overview
export async function doGetAiControlsOverview(admin: AdminActor): Promise<AiControlsOverview> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED" };
  try {
    await ensureSchema();
    const [, sourceRows, optRows, runRows, auditRows, totalRows] = (await asUser(admin.id, "sb_admin", (tx) => [
      tx`select r.id, r.source, r.name, r.description, r.source_url, r.enabled, r.consent_required,
                (select count(*)::int from ai_data_source_permissions p
                  where p.source = r.source and p.granted) as granted_companies,
                (select count(*)::int from ai_data_source_permissions p
                  where p.source = r.source and p.consent_tracking is not null) as consent_tracked,
                (select count(*)::int from ai_data_source_permissions p
                  where p.source = r.source) as companies_with_rows,
                (select max(r2.finished_at) from ai_agent_runs r2
                  where r2.run_metadata->'grantedPermissions' ? r.source) as last_run_at,
                (select r3.status from ai_agent_runs r3
                  where r3.run_metadata->'grantedPermissions' ? r.source
                  order by r3.created_at desc limit 1) as last_run_status
         from ai_data_source_registry r
         order by r.created_at asc`,
      tx`select c.id as company_id, c.name as company_name, c.type as company_type,
                c.verification_status as verification_status,
                coalesce(p.opt_out, false) as opt_out,
                coalesce(p.ai_discovery_enabled, true) as ai_discovery_enabled,
                coalesce(p.public_source_consent, false) as public_source_consent,
                p.updated_at
         from companies c
         left join company_ai_preferences p on p.company_id = c.id
         order by opt_out desc, c.name asc
         limit 300`,
      tx`select r.id, r.company_id, c.name as company_name, r.trigger, r.status,
                r.agent_version, r.prompt_model, r.started_at, r.finished_at,
                r.error, r.run_metadata, r.created_at
         from ai_agent_runs r
         left join companies c on c.id = r.company_id
         order by r.created_at desc
         limit 25`,
      tx`select id, run_id, actor_type, actor_id, action, entity_type, entity_id, details, created_at
         from ai_audit_events
         order by created_at desc
         limit 50`,
      tx`select
                (select count(*)::int from ai_agent_runs) as runs,
                (select count(*)::int from ai_agent_runs where status = 'completed') as completed,
                (select count(*)::int from ai_agent_runs where status = 'failed') as failed,
                (select count(*)::int from company_ai_preferences where opt_out) as opted_out,
                (select count(*)::int from companies) as companies`,
    ])) as unknown as [
      unknown,
      {
        id: string; source: string; name: string; description: string | null; source_url: string | null;
        enabled: boolean; consent_required: boolean; granted_companies: number; consent_tracked: number;
        companies_with_rows: number; last_run_at: string | null; last_run_status: string | null;
      }[],
      {
        company_id: string; company_name: string | null; company_type: string | null;
        verification_status: string | null; opt_out: boolean; ai_discovery_enabled: boolean;
        public_source_consent: boolean; updated_at: string | null;
      }[],
      {
        id: string; company_id: string; company_name: string | null; trigger: string; status: string;
        agent_version: string; prompt_model: string | null; started_at: string | null;
        finished_at: string | null; error: string | null; run_metadata: Record<string, unknown> | null;
        created_at: string;
      }[],
      {
        id: string; run_id: string | null; actor_type: string; actor_id: string | null; action: string;
        entity_type: string | null; entity_id: string | null; details: unknown; created_at: string;
      }[],
      { runs: number; completed: number; failed: number; opted_out: number; companies: number },
    ];

    const dataSources: AiDataSourceRow[] = sourceRows.map((r) => ({
      id: r.id,
      source: r.source,
      name: r.name,
      description: r.description,
      sourceUrl: r.source_url,
      enabled: r.enabled,
      consentRequired: r.consent_required,
      grantedCompanies: num(r.granted_companies),
      consentTracked: num(r.consent_tracked),
      companiesWithRows: num(r.companies_with_rows),
      lastRunAt: r.last_run_at ? String(r.last_run_at) : null,
      lastRunStatus: r.last_run_status,
    }));

    const optOuts: AiOptOutRow[] = optRows.map((r) => ({
      companyId: r.company_id,
      companyName: r.company_name,
      companyType: r.company_type,
      verificationStatus: r.verification_status,
      optOut: r.opt_out,
      aiDiscoveryEnabled: r.ai_discovery_enabled,
      publicSourceConsent: r.public_source_consent,
      updatedAt: r.updated_at ? String(r.updated_at) : null,
    }));

    const runs: AiRunListRow[] = runRows.map((r) => ({
      id: r.id,
      companyId: r.company_id,
      companyName: r.company_name,
      trigger: r.trigger,
      status: r.status,
      agentVersion: r.agent_version,
      promptModel: r.prompt_model,
      startedAt: r.started_at ? String(r.started_at) : null,
      finishedAt: r.finished_at ? String(r.finished_at) : null,
      error: r.error,
      runMetadata: (r.run_metadata ?? {}) as AiRunMetadata,
      createdAt: String(r.created_at),
      durationSec:
        r.started_at && r.finished_at
          ? Math.max(0, Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000))
          : null,
      // The engine does not track per-run cost yet (Phase 2 adds cost
      // monitoring); surface the field so the UI shows it honestly as untracked.
      costUsd: null,
    }));

    const auditEvents: AiAuditRow[] = auditRows.map((a) => ({
      id: a.id,
      runId: a.run_id,
      actorType: a.actor_type,
      actorId: a.actor_id,
      action: a.action,
      entityType: a.entity_type,
      entityId: a.entity_id,
      details: (a.details ?? {}) as Record<string, string | number | boolean | null>,
      createdAt: String(a.created_at),
    }));

    return {
      ok: true,
      dataSources,
      optOuts,
      runs,
      auditEvents,
      totals: {
        runs: num(totalRows.runs),
        completed: num(totalRows.completed),
        failed: num(totalRows.failed),
        optedOut: num(totalRows.opted_out),
        companies: num(totalRows.companies),
      },
    };
  } catch (err) {
    console.error("doGetAiControlsOverview failed:", err);
    return { ok: false, error: "Could not load AI controls." };
  }
}

// ------------------------------------------------------- data-source toggle
export async function doToggleAiDataSource(
  admin: AdminActor,
  sourceId: string,
  enabled: boolean,
  reason?: string | null,
): Promise<AiControlResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED" };
  const denied = requireAiControlMutate(admin);
  if (denied) return { ok: false, error: denied, code: "ROLE_DENIED" };
  if (!sourceId) return { ok: false, error: "Data source id is required." };
  const note = (reason ?? "").trim().slice(0, 1000) || null;
  try {
    await ensureSchema();
    const rows = (await asUser(admin.id, "sb_admin", (tx) => [
      tx`update ai_data_source_registry
         set enabled = ${enabled}, updated_at = now()
         where id = ${sourceId}
         returning id, source, name, enabled`,
    ]))[1] as unknown as { id: string; source: string; name: string; enabled: boolean }[];
    const row = rows[0];
    if (!row) return { ok: false, error: "Data source not found." };

    await asUser(admin.id, "sb_admin", (tx) => [
      aiControlAuditQuery(tx, admin.id, "ai.control.data_source_toggle", {
        sourceId: row.id,
        source: row.source,
        name: row.name,
        enabled: row.enabled,
        reason: note,
      }),
      aiAuditQuery(tx, {
        actorType: "admin",
        actorId: admin.id,
        action: "ai.control.data_source_toggle",
        entityType: "ai_data_source",
        entityId: row.id,
        details: { source: row.source, name: row.name, enabled: row.enabled, reason: note },
      }),
    ]);
    return {
      ok: true,
      message: `${row.name} ${row.enabled ? "enabled" : "disabled"}.`,
      id: row.id,
    };
  } catch (err) {
    console.error("doToggleAiDataSource failed:", err);
    return { ok: false, error: "Could not update the data source." };
  }
}

// ------------------------------------------------------------- run detail
export async function doGetAiRunDetail(admin: AdminActor, runId: string): Promise<AiRunDetailResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED" };
  try {
    await ensureSchema();
    const [, runRows, recRows, auditRows] = (await asUser(admin.id, "sb_admin", (tx) => [
      tx`select r.id, r.company_id, c.name as company_name, r.trigger, r.status,
                r.agent_version, r.prompt_model, r.started_at, r.finished_at,
                r.error, r.run_metadata, r.created_at
         from ai_agent_runs r
         left join companies c on c.id = r.company_id
         where r.id = ${runId}
         limit 1`,
      tx`select rec.id, rec.service_id, s.name as service_name, rec.recommendation_type,
                rec.status, rec.confidence, rec.confidence_score, rec.summary, rec.rationale,
                rec.source, rec.created_at
         from ai_recommendations rec
         left join services s on s.id = rec.service_id
         where rec.run_id = ${runId}
         order by rec.created_at desc
         limit 100`,
      tx`select id, run_id, actor_type, actor_id, action, entity_type, entity_id, details, created_at
         from ai_audit_events
         where run_id = ${runId} or (entity_type = 'ai_agent_run' and entity_id = ${runId})
         order by created_at desc
         limit 100`,
    ])) as unknown as [
      unknown,
      {
        id: string; company_id: string; company_name: string | null; trigger: string; status: string;
        agent_version: string; prompt_model: string | null; started_at: string | null;
        finished_at: string | null; error: string | null; run_metadata: Record<string, unknown> | null;
        created_at: string;
      }[],
      {
        id: string; service_id: string | null; service_name: string | null; recommendation_type: string;
        status: string; confidence: string; confidence_score: number; summary: string;
        rationale: string | null; source: string; created_at: string;
      }[],
      {
        id: string; run_id: string | null; actor_type: string; actor_id: string | null; action: string;
        entity_type: string | null; entity_id: string | null; details: unknown; created_at: string;
      }[],
    ];
    const r = runRows[0];
    if (!r) return { ok: false, error: "AI run not found." };
    return {
      ok: true,
      run: {
        id: r.id,
        companyId: r.company_id,
        companyName: r.company_name,
        trigger: r.trigger,
        status: r.status,
        agentVersion: r.agent_version,
        promptModel: r.prompt_model,
        startedAt: r.started_at ? String(r.started_at) : null,
        finishedAt: r.finished_at ? String(r.finished_at) : null,
        error: r.error,
        runMetadata: (r.run_metadata ?? {}) as AiRunMetadata,
        createdAt: String(r.created_at),
        durationSec:
          r.started_at && r.finished_at
            ? Math.max(0, Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000))
            : null,
        costUsd: null,
      },
      recommendations: recRows.map((rec) => ({
        id: rec.id,
        serviceId: rec.service_id,
        serviceName: rec.service_name,
        recommendationType: rec.recommendation_type,
        status: rec.status,
        confidence: rec.confidence,
        confidenceScore: num(rec.confidence_score),
        summary: rec.summary,
        rationale: rec.rationale,
        source: rec.source,
        createdAt: String(rec.created_at),
      })),
      auditEvents: auditRows.map((a) => ({
        id: a.id,
        runId: a.run_id,
        actorType: a.actor_type,
        actorId: a.actor_id,
        action: a.action,
        entityType: a.entity_type,
        entityId: a.entity_id,
        details: (a.details ?? {}) as Record<string, string | number | boolean | null>,
        createdAt: String(a.created_at),
      })),
    };
  } catch (err) {
    console.error("doGetAiRunDetail failed:", err);
    return { ok: false, error: "Could not load the AI run." };
  }
}

// ------------------------------------------------------- manual re-run
export async function doReRunAiAnalysis(
  admin: AdminActor,
  runId: string,
): Promise<AiControlResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED" };
  const denied = requireAiControlMutate(admin);
  if (denied) return { ok: false, error: denied, code: "ROLE_DENIED" };
  if (!runId) return { ok: false, error: "Run id is required." };
  try {
    await ensureSchema();
    const rows = (await asUser(admin.id, "sb_admin", (tx) => [
      tx`select id, company_id, trigger, status from ai_agent_runs where id = ${runId} limit 1`,
    ]))[1] as unknown as { id: string; company_id: string; trigger: string; status: string }[];
    const run = rows[0];
    if (!run) return { ok: false, error: "AI run not found." };

    // Calls the existing engine server-side (recommendation mode only). The
    // engine itself writes ai.run.queued / started / completed audit rows.
    const result = await analyzeCompany(admin.id, run.company_id, "manual_re-run");

    if (!result.ok || !result.runId) {
      return { ok: false, error: result.error ?? "Re-run failed." };
    }
    // Extra admin audit row tying the manual re-run to its source run.
    await asUser(admin.id, "sb_admin", (tx) => [
      aiControlAuditQuery(tx, admin.id, "ai.control.manual_rerun", {
        sourceRunId: runId,
        sourceStatus: run.status,
        companyId: run.company_id,
        newRunId: result.runId,
      }),
      aiAuditQuery(tx, {
        actorType: "admin",
        actorId: admin.id,
        action: "ai.control.manual_rerun",
        entityType: "ai_agent_run",
        entityId: result.runId,
        details: { sourceRunId: runId, companyId: run.company_id, newRunId: result.runId },
      }),
    ]);
    return {
      ok: true,
      message: "Analysis re-run queued for this company.",
      id: result.runId,
    };
  } catch (err) {
    console.error("doReRunAiAnalysis failed:", err);
    return { ok: false, error: "Could not re-run the analysis." };
  }
}


// ------------------------------------------------------- retry failed run
/** Retry a failed AI run: allowed only when the run is 'failed' (or a stale
 *  'queued' with no started_at). Engine-gate first: an opted-out company or a
 *  platform state with no enabled data source refuses the retry (retry_blocked,
 *  audited) instead of running the engine. Otherwise queues + executes a new
 *  run through the existing engine path (trigger 'retry') — the engine applies
 *  the rate-limit caps and writes the run lifecycle audit events itself. */
export async function doRetryAiRun(admin: AdminActor, runId: string): Promise<AiRetryResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED" };
  const denied = requireAiControlMutate(admin);
  if (denied) return { ok: false, error: denied, code: "ROLE_DENIED" };
  if (!runId) return { ok: false, error: "Run id is required." };
  try {
    await ensureSchema();
    const [, runRows, prefRows, sourceRows] = (await asUser(admin.id, "sb_admin", (tx) => [
      tx`select id, company_id, trigger, status, started_at from ai_agent_runs where id = ${runId} limit 1`,
      tx`select coalesce(opt_out, false) as opt_out
         from company_ai_preferences where company_id = (select company_id from ai_agent_runs where id = ${runId})`,
      tx`select count(*)::int as n from ai_data_source_registry where enabled = true`,
    ])) as unknown as [
      unknown,
      { id: string; company_id: string; trigger: string; status: string; started_at: string | null }[],
      { opt_out: boolean }[],
      { n: number }[],
    ];
    const run = runRows[0];
    if (!run) return { ok: false, error: "AI run not found." };
    const retryable = run.status === "failed" || (run.status === "queued" && !run.started_at);
    if (!retryable) {
      return {
        ok: false,
        error: `Only failed runs can be retried (this run is ${run.status}).`,
        code: "NOT_RETRYABLE",
      };
    }

    // Engine gate: opt-out or no enabled data source -> refuse + audit.
    const optOut = prefRows[0]?.opt_out ?? false;
    const enabledSources = sourceRows[0]?.n ?? 0;
    let blockedReason: string | null = null;
    if (optOut) blockedReason = "the company has opted out of AI analysis";
    else if (enabledSources === 0) blockedReason = "no data sources are enabled at platform level";
    if (blockedReason) {
      await asUser(admin.id, "sb_admin", (tx) => [
        aiControlAuditQuery(tx, admin.id, "ai.control.retry_blocked", {
          runId,
          companyId: run.company_id,
          sourceStatus: run.status,
          reason: blockedReason,
        }),
        aiAuditQuery(tx, {
          actorType: "admin",
          actorId: admin.id,
          action: "ai.run.retry_blocked",
          entityType: "ai_agent_run",
          entityId: runId,
          details: { companyId: run.company_id, sourceStatus: run.status, reason: blockedReason },
        }),
      ]);
      return { ok: false, error: `Retry blocked: ${blockedReason}.`, code: "RETRY_BLOCKED", retryBlocked: true };
    }

    // Same engine path as the manual re-run; the engine audits its own
    // queued/started/completed|failed lifecycle and applies rate limits.
    const result = await analyzeCompany(admin.id, run.company_id, "retry");
    if (!result.ok || !result.runId) {
      return { ok: false, error: result.error ?? "Retry failed." };
    }
    // Admin audit tying the retry to its source run (dual, immutable).
    await asUser(admin.id, "sb_admin", (tx) => [
      aiControlAuditQuery(tx, admin.id, "ai.control.retry", {
        sourceRunId: runId,
        sourceStatus: run.status,
        companyId: run.company_id,
        newRunId: result.runId,
      }),
      aiAuditQuery(tx, {
        actorType: "admin",
        actorId: admin.id,
        action: "ai.run.retry",
        entityType: "ai_agent_run",
        entityId: result.runId,
        details: { sourceRunId: runId, companyId: run.company_id, newRunId: result.runId },
      }),
    ]);
    return {
      ok: true,
      message: "Retry queued — the analysis is running for this company.",
      id: result.runId,
    };
  } catch (err) {
    console.error("doRetryAiRun failed:", err);
    return { ok: false, error: "Could not retry the analysis." };
  }
}

// --------------------------------------------------- engine limit settings
const SETTINGS_DEFAULTS = {
  dailyRunCap: 50,
  perCompanyDailyCap: 10,
  minIntervalSeconds: 60,
  autoRunEnabled: true,
};

export async function doGetAiControlSettings(admin: AdminActor): Promise<AiControlSettingsResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED" };
  try {
    await ensureSchema();
    const rows = (await asUser(admin.id, "sb_admin", (tx) => [
      tx`select daily_run_cap, per_company_daily_cap, min_interval_seconds,
                auto_run_enabled, updated_by, updated_at
         from ai_control_settings where id = 1 limit 1`,
    ]))[1] as {
      daily_run_cap: number;
      per_company_daily_cap: number;
      min_interval_seconds: number;
      auto_run_enabled: boolean;
      updated_by: string | null;
      updated_at: string | null;
    }[];
    const r = rows[0];
    return {
      ok: true,
      settings: r
        ? {
            dailyRunCap: num(r.daily_run_cap),
            perCompanyDailyCap: num(r.per_company_daily_cap),
            minIntervalSeconds: num(r.min_interval_seconds),
            autoRunEnabled: r.auto_run_enabled,
            updatedBy: r.updated_by,
            updatedAt: r.updated_at ? String(r.updated_at) : null,
          }
        : { ...SETTINGS_DEFAULTS, updatedBy: null, updatedAt: null },
    };
  } catch (err) {
    console.error("doGetAiControlSettings failed:", err);
    return { ok: false, error: "Could not load the AI engine limits." };
  }
}

/** Update the single-row engine-control settings. Validates ints >= 0, keeps
 *  unspecified fields, and dual-audits old -> new values in the same
 *  transaction. Role-gated via requireAiControlMutate. */
export async function doUpdateAiControlSettings(
  admin: AdminActor,
  input: {
    dailyRunCap?: number | null;
    perCompanyDailyCap?: number | null;
    minIntervalSeconds?: number | null;
    autoRunEnabled?: boolean | null;
  },
): Promise<AiControlResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED" };
  const denied = requireAiControlMutate(admin);
  if (denied) return { ok: false, error: denied, code: "ROLE_DENIED" };
  try {
    await ensureSchema();
    const current = (await asUser(admin.id, "sb_admin", (tx) => [
      tx`select daily_run_cap, per_company_daily_cap, min_interval_seconds, auto_run_enabled
         from ai_control_settings where id = 1 limit 1`,
    ]))[1] as {
      daily_run_cap: number;
      per_company_daily_cap: number;
      min_interval_seconds: number;
      auto_run_enabled: boolean;
    }[];
    const cur = current[0] ?? { ...SETTINGS_DEFAULTS };

    const toInt = (v: number | null | undefined, fallback: number, label: string): number => {
      if (v === null || v === undefined) return fallback;
      const n = Math.floor(Number(v));
      if (!Number.isFinite(n) || n < 0) {
        throw new Error(`${label} must be a whole number of 0 or more.`);
      }
      return n;
    };
    const next = {
      dailyRunCap: toInt(input.dailyRunCap, num(cur.daily_run_cap), "Daily run cap"),
      perCompanyDailyCap: toInt(input.perCompanyDailyCap, num(cur.per_company_daily_cap), "Per-company daily cap"),
      minIntervalSeconds: toInt(input.minIntervalSeconds, num(cur.min_interval_seconds), "Minimum interval"),
      autoRunEnabled: input.autoRunEnabled === null || input.autoRunEnabled === undefined
        ? cur.auto_run_enabled
        : Boolean(input.autoRunEnabled),
    };
    const from = {
      dailyRunCap: num(cur.daily_run_cap),
      perCompanyDailyCap: num(cur.per_company_daily_cap),
      minIntervalSeconds: num(cur.min_interval_seconds),
      autoRunEnabled: cur.auto_run_enabled,
    };
    if (JSON.stringify(from) === JSON.stringify(next)) {
      return { ok: false, error: "No changes to save." };
    }

    await asUser(admin.id, "sb_admin", (tx) => [
      tx`insert into ai_control_settings (id, daily_run_cap, per_company_daily_cap, min_interval_seconds, auto_run_enabled, updated_by, updated_at)
         values (1, ${next.dailyRunCap}, ${next.perCompanyDailyCap}, ${next.minIntervalSeconds},
                 ${next.autoRunEnabled}, ${admin.id}, now())
         on conflict (id) do update set
           daily_run_cap = excluded.daily_run_cap,
           per_company_daily_cap = excluded.per_company_daily_cap,
           min_interval_seconds = excluded.min_interval_seconds,
           auto_run_enabled = excluded.auto_run_enabled,
           updated_by = excluded.updated_by,
           updated_at = now()`,
      aiControlAuditQuery(tx, admin.id, "ai.control.settings_update", { from, to: next }),
      aiAuditQuery(tx, {
        actorType: "admin",
        actorId: admin.id,
        action: "ai.control.settings_update",
        entityType: "ai_control_settings",
        entityId: "1",
        details: { from, to: next },
      }),
    ]);
    return { ok: true, message: "Engine limits saved." };
  } catch (err) {
    console.error("doUpdateAiControlSettings failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : "Could not save the engine limits." };
  }
}