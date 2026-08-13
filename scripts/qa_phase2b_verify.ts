/**
 * QA verification for AI Controls Phase 2b (engineer's delivery was cut off
 * before final verification). Covers:
 *   1. doDeleteCompanyAiData: confirm-mismatch guard, reason guard, real
 *      deletion with counts, rows actually gone, dual audit survives.
 *   2. doGetAiCostOverview: totals + byModel non-empty.
 *   3. Phase 2a blocked-run path (previously unverified): min-interval gate
 *      blocks a retry -> failed run row + ai.run.rate_limited audit.
 *   4. Settings restored to defaults; throwaway data cleaned up.
 * Usage: cd /home/team/shared/site && . /home/team/shared/.db-url.sh && bun scripts/qa_phase2b_verify.ts
 */
import { randomUUID } from "node:crypto";
import { getPg } from "../src/db";
import { asUser, ensureSchema } from "../src/lib/db";
import {
  doDeleteCompanyAiData,
  doGetAiCostOverview,
  doRetryAiRun,
  doUpdateAiControlSettings,
} from "../src/lib/admin-ai-controls-core";

const ADMIN_ID = "b03151a4-453c-4ed2-a9aa-02e558719f7c";
const FAILED_RUN = "22222222-2222-4222-8222-222222222222"; // demo failed run (company 032ba36b...)
const ADMIN_ACTOR = { id: ADMIN_ID, role: "sb_admin", staffRoles: ["super_admin"] };

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name} ${extra}`);
  }
};

async function main() {
  const pg = getPg();
  await ensureSchema();

  // Clean up any leftovers from previous interrupted runs of this script.
  await pg`delete from users where email like 'qa-del-%'`;

  const userId = randomUUID();
  const companyId = randomUUID();
  const runId = randomUUID();

  // 1. throwaway user (RLS-exempt) + company (asUser sb_admin)
  await pg`insert into users (id, email, password_hash)
    values (${userId}, ${`qa-del-${userId.slice(0, 8)}@test.local`}, 'x')`;
  await asUser(ADMIN_ID, "sb_admin", (tx) => [
    tx`insert into companies (id, owner_id, name, type, verification_status)
       values (${companyId}, ${userId}, 'QA Deletion Corp', 'contractor', 'verified')`,
  ]);
  console.log("company created:", companyId);

  // 2. seed AI data for the throwaway company
  await asUser(ADMIN_ID, "sb_admin", (tx) => [
    tx`insert into ai_agent_runs (id, company_id, trigger, status, started_at, finished_at, error, run_metadata)
       values (${runId}, ${companyId}, 'manual', 'failed',
               now() - interval '1 hour', now() - interval '59 minutes', 'qa error',
               ${ { tokens: 100, estimatedCostUsd: 0.001 } as never })`,
    tx`insert into ai_audit_events (run_id, actor_type, actor_id, action, entity_type, entity_id, details)
       values (${runId}, 'agent', 'engine', 'ai.run.failed', 'ai_agent_run', ${runId}, ${{} as never})`,
    tx`insert into ai_recommendations (company_id, run_id, recommendation_type, status, confidence, confidence_score, summary)
       values (${companyId}, ${runId}, 'upsell', 'Suggested', 'Low', 0.3, 'qa rec')`,
    tx`insert into ai_data_source_permissions (company_id, source, granted)
       values (${companyId}, 'internal_data', true)`,
    tx`insert into company_ai_preferences (company_id, ai_discovery_enabled, opt_out)
       values (${companyId}, true, false)`,
  ]);
  console.log("seeded");

  // 3. wrong typed name -> CONFIRM_MISMATCH, nothing deleted
  const mismatch = await doDeleteCompanyAiData(ADMIN_ACTOR, companyId, "WRONG NAME", "qa");
  ok("confirm mismatch rejected", mismatch.ok === false && mismatch.code === "CONFIRM_MISMATCH", JSON.stringify(mismatch).slice(0, 160));
  const [, runsBefore] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
    tx`select count(*)::int as n from ai_agent_runs where company_id = ${companyId}`,
  ])) as unknown as [unknown, { n: number }[]];
  ok("nothing deleted on mismatch", runsBefore[0].n === 1, `n=${runsBefore[0].n}`);

  // 4. missing/blank reason -> REASON_REQUIRED
  const noReason = await doDeleteCompanyAiData(ADMIN_ACTOR, companyId, "QA Deletion Corp", "   ");
  ok("reason required", noReason.ok === false && noReason.code === "REASON_REQUIRED", JSON.stringify(noReason).slice(0, 160));

  // 5. correct deletion (case-insensitive typed name)
  const del = await doDeleteCompanyAiData(ADMIN_ACTOR, companyId, "qa deletion corp", "QA verification of company AI data deletion");
  ok("deletion ok", del.ok === true, JSON.stringify(del).slice(0, 200));
  if (del.ok) {
    ok(
      "counts correct",
      del.deleted.runs === 1 &&
        del.deleted.auditEvents === 1 &&
        del.deleted.recommendations === 1 &&
        del.deleted.permissions === 1 &&
        del.deleted.preferences === 1 &&
        del.deleted.upsells === 0 &&
        del.deleted.evidence === 0,
      JSON.stringify(del.deleted),
    );
  }

  // 6. rows gone + dual audit present
  const [, after] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
    tx`select
        (select count(*)::int from ai_agent_runs where company_id = ${companyId}) as runs,
        (select count(*)::int from ai_recommendations where company_id = ${companyId}) as recs,
        (select count(*)::int from ai_data_source_permissions where company_id = ${companyId}) as perms,
        (select count(*)::int from company_ai_preferences where company_id = ${companyId}) as prefs,
        (select count(*)::int from ai_audit_events
          where entity_type = 'company' and entity_id = ${companyId}
            and action = 'ai.control.company_data_deleted') as audit_rows`,
  ])) as unknown as [unknown, { runs: number; recs: number; perms: number; prefs: number; audit_rows: number }[]];
  const a = after[0];
  ok("all rows gone", a.runs === 0 && a.recs === 0 && a.perms === 0 && a.prefs === 0, JSON.stringify(a));
  ok("ai_audit_events row survived", a.audit_rows === 1, `audit_rows=${a.audit_rows}`);
  const [, al] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
    tx`select count(*)::int as n from audit_logs
       where action = 'ai.control.company_data_deleted' and actor_id = ${ADMIN_ID}`,
  ])) as unknown as [unknown, { n: number }[]];
  ok("audit_logs entry present", al[0].n >= 1, `n=${al[0].n}`);

  // 7. cost overview (seeded completed run has backfilled cost)
  const cost = await doGetAiCostOverview(ADMIN_ACTOR);
  ok("cost overview ok", cost.ok === true, JSON.stringify(cost).slice(0, 200));
  if (cost.ok) {
    ok(
      "cost totals present",
      cost.totalTokens > 0 && cost.byModel.length > 0 && cost.runsTracked > 0,
      `tokens=${cost.totalTokens} models=${cost.byModel.length} tracked=${cost.runsTracked}`,
    );
  }

  // 8. Phase 2a blocked-run path: raise min interval -> retry -> rate-limited
  const upd = await doUpdateAiControlSettings(ADMIN_ACTOR, { minIntervalSeconds: 3600 });
  ok("settings raised", upd.ok === true, JSON.stringify(upd).slice(0, 160));
  const retry = await doRetryAiRun(ADMIN_ACTOR, FAILED_RUN);
  ok(
    "retry blocked by min interval",
    retry.ok === false && retry.error.toLowerCase().includes("rate limit"),
    JSON.stringify(retry).slice(0, 200),
  );
  const [, rl] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
    tx`select count(*)::int as n from ai_audit_events
       where action = 'ai.run.rate_limited' and created_at > now() - interval '3 minutes'`,
  ])) as unknown as [unknown, { n: number }[]];
  ok("rate_limited audit written", rl[0].n >= 1, `n=${rl[0].n}`);
  const [, rl2] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
    tx`select count(*)::int as n from audit_logs
       where action = 'ai.agent.run.rate_limited' and created_at > now() - interval '3 minutes'`,
  ])) as unknown as [unknown, { n: number }[]];
  ok("rate_limited dual audit written", rl2[0].n >= 1, `n=${rl2[0].n}`);
  const rest = await doUpdateAiControlSettings(ADMIN_ACTOR, { minIntervalSeconds: 60 });
  ok("settings restored to 60s", rest.ok === true);

  // 9. cleanup throwaway user (cascade removes the company)
  await pg`delete from users where id = ${userId}`;
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
