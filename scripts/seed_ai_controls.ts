/**
 * Seed: Master Admin AI Controls demo data (idempotent - probe-before-insert).
 *
 * Usage:
 *   cd /home/team/shared/site && . /home/team/shared/.db-url.sh && bun scripts/seed_ai_controls.ts
 *
 * Seeds (for the 4 demo companies found in the DB):
 *   - company_ai_preferences rows (one company opted out, one consented to
 *     public sources) - opt-out state visible + audited in AI Controls.
 *   - ai_data_source_permissions rows per company (consent tracking + refs).
 *   - ai_agent_runs: one completed (with metadata incl. grantedPermissions),
 *     one failed (with an error log) and one queued, plus their engine audit
 *     events (ai.run.queued / started / completed / failed) so the run-history
 *     and audit-trail sections render real data.
 *   - A seeded ai.control.data_source_toggle audit event so the toggle trail
 *     shows the pattern (admins' own toggles append more).
 *
 * The ai_data_source_registry rows are seeded by ensureSchema() itself.
 * RLS: every read/write runs inside asUser(ADMIN_ID, 'sb_admin', ...).
 */
import { randomUUID } from "node:crypto";
import { getPg } from "../src/db";
import { asUser, ensureSchema } from "../src/lib/db";

const ADMIN_ID = "b03151a4-453c-4ed2-a9aa-02e558719f7c"; // admin.demo@scalebridge.test

const RUN_IDS = {
  completed: "11111111-1111-4111-8111-111111111111",
  failed: "22222222-2222-4222-8222-222222222222",
  queued: "33333333-3333-4333-8333-333333333333",
};

const pg = getPg();
await ensureSchema();
let created = 0;

// demo companies
const [, compRows] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
  tx`select id, name from companies order by name asc limit 4`,
])) as unknown as [unknown, { id: string; name: string }[]];
const companies = compRows.slice(0, 4);
if (companies.length === 0) {
  console.error("FATAL: no companies found - run the main demo seed first.");
  await pg.end();
  process.exit(1);
}
console.log(`ai-controls: companies -> ${companies.map((c) => c.name).join(", ")}`);

// company_ai_preferences (company[0] opted out; company[1] public-source consent)
const prefPlan: { optOut: boolean; discovery: boolean; consent: boolean }[] = [
  { optOut: true, discovery: false, consent: false },
  { optOut: false, discovery: true, consent: true },
  { optOut: false, discovery: true, consent: false },
  { optOut: false, discovery: true, consent: false },
];
for (let i = 0; i < companies.length; i++) {
  const c = companies[i];
  const p = prefPlan[i];
  const [, prefRows] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
    tx`select id from company_ai_preferences where company_id = ${c.id}`,
  ])) as unknown as [unknown, { id: string }[]];
  if (!prefRows[0]) {
    await asUser(ADMIN_ID, "sb_admin", (tx) => [
      tx`insert into company_ai_preferences (company_id, ai_discovery_enabled, public_source_consent, opt_out)
         values (${c.id}, ${p.discovery}, ${p.consent}, ${p.optOut})`,
      tx`insert into ai_audit_events (id, actor_type, actor_id, action, entity_type, entity_id, details)
         values (${randomUUID()}, 'admin', ${ADMIN_ID}, 'ai.preferences.updated', 'company', ${c.id},
                 ${{ from: { aiDiscoveryEnabled: true, publicSourceConsent: false, optOut: false }, to: { aiDiscoveryEnabled: p.discovery, publicSourceConsent: p.consent, optOut: p.optOut } } as never})`,
    ]);
    created++;
    console.log(`  ai-controls: prefs + (${c.name} optOut=${p.optOut} consent=${p.consent})`);
  }
}

// ai_data_source_permissions per company
const permSources = [
  { source: "internal_data", granted: true, consent: "internal_data_consent_v1" },
  { source: "website", granted: true, consent: "website_consent_v1" },
  { source: "public_source", granted: true, consent: "public_source_consent_v1" },
];
for (const c of companies) {
  for (const ps of permSources) {
    const [, permRows] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
      tx`select id from ai_data_source_permissions where company_id = ${c.id} and source = ${ps.source}`,
    ])) as unknown as [unknown, { id: string }[]];
    if (!permRows[0]) {
      await asUser(ADMIN_ID, "sb_admin", (tx) => [
        tx`insert into ai_data_source_permissions
             (company_id, source, granted, consent_tracking, consent_ref, granted_at, granted_by)
           values (${c.id}, ${ps.source}, ${ps.granted}, ${ps.consent},
                   ${`demo-consent-${c.id.slice(0, 8)}-${ps.source}`}, now(), ${ADMIN_ID})`,
      ]);
      created++;
    }
  }
}
console.log(`  ai-controls: data-source permissions + (${companies.length * permSources.length} rows)`);

// ai_agent_runs (completed / failed / queued) + engine audit events
// completed run
const [, cRun] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
  tx`select id from ai_agent_runs where id = ${RUN_IDS.completed}`,
])) as unknown as [unknown, { id: string }[]];
if (!cRun[0]) {
  const comp = companies[1];
  await asUser(ADMIN_ID, "sb_admin", (tx) => [
    tx`insert into ai_agent_runs (id, company_id, trigger, status, agent_version, prompt_model, started_at, finished_at, run_metadata)
       values (${RUN_IDS.completed}, ${comp.id}, 'manual', 'completed', '0.1.0', 'deterministic-heuristic-v1',
               now() - interval '2 days 4 hours', now() - interval '2 days 3 hours 58 minutes',
               ${{
                 trigger: "manual",
                 company: comp.name,
                 verificationStatus: "verified",
                 dryRun: false,
                 publicSourcesChecked: true,
                 grantedPermissions: ["internal_data", "website", "public_source"],
                 evidenceCount: 6,
                 internalEvidenceCount: 4,
                 publicEvidenceCount: 2,
                 recommendationsCreated: 2,
                 recommendationsPending: [
                   { type: "service_discovery", service: "Facility Management", confidence: "High" },
                   { type: "cross-sell", service: "MEP Maintenance", confidence: "Medium" },
                 ],
                 seeded: true,
               } as never})`,
    tx`insert into ai_audit_events (id, run_id, actor_type, actor_id, action, entity_type, entity_id, details)
       values (${randomUUID()}, ${RUN_IDS.completed}, 'agent', 'agent:0.1.0', 'ai.run.queued', 'ai_agent_run', ${RUN_IDS.completed}, ${{ companyId: comp.id, trigger: "manual" } as never}),
              (${randomUUID()}, ${RUN_IDS.completed}, 'agent', 'agent:0.1.0', 'ai.run.started', 'ai_agent_run', ${RUN_IDS.completed}, ${{ trigger: "manual" } as never}),
              (${randomUUID()}, ${RUN_IDS.completed}, 'agent', 'agent:0.1.0', 'ai.run.completed', 'ai_agent_run', ${RUN_IDS.completed}, ${{ evidenceCount: 6, recommendationsCreated: 2 } as never})`,
  ]);
  created++;
  console.log(`  ai-controls: run + (completed, ${comp.name})`);
}

// failed run
const [, fRun] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
  tx`select id from ai_agent_runs where id = ${RUN_IDS.failed}`,
])) as unknown as [unknown, { id: string }[]];
if (!fRun[0]) {
  const comp = companies[2];
  await asUser(ADMIN_ID, "sb_admin", (tx) => [
    tx`insert into ai_agent_runs (id, company_id, trigger, status, agent_version, prompt_model, started_at, finished_at, error, run_metadata)
       values (${RUN_IDS.failed}, ${comp.id}, 'uploaded_document', 'failed', '0.1.0', 'deterministic-heuristic-v1',
               now() - interval '1 day 2 hours', now() - interval '1 day 1 hour 59 minutes',
               'Evidence extraction failed: document scan timed out after 30s (source file oversized). No recommendations were created.',
               ${{
                 trigger: "uploaded_document",
                 company: comp.name,
                 evidenceCount: 0,
                 recommendationsCreated: 0,
                 note: "Failure occurred while extracting evidence from the uploaded document.",
                 seeded: true,
               } as never})`,
    tx`insert into ai_audit_events (id, run_id, actor_type, actor_id, action, entity_type, entity_id, details)
       values (${randomUUID()}, ${RUN_IDS.failed}, 'agent', 'agent:0.1.0', 'ai.run.queued', 'ai_agent_run', ${RUN_IDS.failed}, ${{ companyId: comp.id, trigger: "uploaded_document" } as never}),
              (${randomUUID()}, ${RUN_IDS.failed}, 'agent', 'agent:0.1.0', 'ai.run.started', 'ai_agent_run', ${RUN_IDS.failed}, ${{ trigger: "uploaded_document" } as never}),
              (${randomUUID()}, ${RUN_IDS.failed}, 'system', 'agent:0.1.0', 'ai.run.failed', 'ai_agent_run', ${RUN_IDS.failed}, ${{ error: "Evidence extraction failed: document scan timed out after 30s." } as never})`,
  ]);
  created++;
  console.log(`  ai-controls: run + (failed, ${comp.name})`);
}

// queued run
const [, qRun] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
  tx`select id from ai_agent_runs where id = ${RUN_IDS.queued}`,
])) as unknown as [unknown, { id: string }[]];
if (!qRun[0]) {
  const comp = companies[3];
  await asUser(ADMIN_ID, "sb_admin", (tx) => [
    tx`insert into ai_agent_runs (id, company_id, trigger, status, agent_version, prompt_model, run_metadata)
       values (${RUN_IDS.queued}, ${comp.id}, 'intake', 'queued', '0.1.0', 'deterministic-heuristic-v1',
               ${{
                 trigger: "intake",
                 company: comp.name,
                 intakeResponsesPresent: true,
                 seeded: true,
               } as never})`,
    tx`insert into ai_audit_events (id, run_id, actor_type, actor_id, action, entity_type, entity_id, details)
       values (${randomUUID()}, ${RUN_IDS.queued}, 'agent', 'agent:0.1.0', 'ai.run.queued', 'ai_agent_run', ${RUN_IDS.queued}, ${{ companyId: comp.id, trigger: "intake" } as never})`,
  ]);
  created++;
  console.log(`  ai-controls: run + (queued, ${comp.name})`);
}

// a seeded data-source toggle audit event (shows the trail pattern)
const [, togRows] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
  tx`select id from ai_audit_events where action = 'ai.control.data_source_toggle' limit 1`,
])) as unknown as [unknown, { id: string }[]];
if (!togRows[0]) {
  const [, regRows] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
    tx`select id, source, name from ai_data_source_registry where source = 'website' limit 1`,
  ])) as unknown as [unknown, { id: string; source: string; name: string }[]];
  if (regRows[0]) {
    await asUser(ADMIN_ID, "sb_admin", (tx) => [
      tx`insert into ai_audit_events (id, actor_type, actor_id, action, entity_type, entity_id, details)
         values (${randomUUID()}, 'admin', ${ADMIN_ID}, 'ai.control.data_source_toggle', 'ai_data_source', ${regRows[0].id},
                 ${{ source: "website", name: "Company website", enabled: true, reason: "Seeded demo event - shows the audit trail pattern." } as never})`,
    ]);
    created++;
    console.log("  ai-controls: audit + (seeded data_source_toggle event)");
  }
}

// ai_control_settings (engine limits, Phase 2a): seed defaults if absent
const [, settingsRows] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
  tx`select id from ai_control_settings where id = 1`,
])) as unknown as [unknown, { id: number }[]];
if (!settingsRows[0]) {
  await asUser(ADMIN_ID, "sb_admin", (tx) => [
    tx`insert into ai_control_settings (id, daily_run_cap, per_company_daily_cap, min_interval_seconds, auto_run_enabled)
       values (1, 50, 10, 60, true)`,
    tx`insert into ai_audit_events (id, actor_type, actor_id, action, entity_type, entity_id, details)
       values (${randomUUID()}, 'system', 'agent:0.1.0', 'ai.control.settings_update', 'ai_control_settings', '1',
               ${{ from: null, to: { dailyRunCap: 50, perCompanyDailyCap: 10, minIntervalSeconds: 60, autoRunEnabled: true } } as never})`,
  ]);
  created++;
  console.log("  ai-controls: settings + (engine limits defaults)");
} else {
  console.log("  ai-controls: settings row exists (id=1)");
}
const [, overview] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
  tx`select
      (select count(*)::int from ai_data_source_registry) as sources,
      (select count(*)::int from ai_agent_runs) as runs,
      (select count(*)::int from ai_audit_events) as audit_events,
      (select count(*)::int from company_ai_preferences where opt_out) as opted_out,
      (select count(*)::int from ai_control_settings) as settings`,
])) as unknown as [unknown, { sources: number; runs: number; audit_events: number; opted_out: number; settings: number }[]];
console.log(
  created > 0 ? `ai-controls: created ${created} new rows` : "ai-controls: nothing to create (idempotent)",
);
console.log("ai-controls: verification:", JSON.stringify(overview[0]));
await pg.end();
process.exit(0);
