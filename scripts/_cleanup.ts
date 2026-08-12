import { asUser, ensureSchema } from "../src/lib/db";
import { getPg } from "../src/db";
const ADMIN_ID = "b03151a4-453c-4ed2-a9aa-02e558719f7c";
await ensureSchema();
await asUser(ADMIN_ID, "sb_admin", (tx) => [
  tx`delete from audit_logs where action like 'probe.audit.%'`,
  tx`select type, count(*)::int as n from notifications group by type order by n desc`,
]);
const [, nt] = await asUser(ADMIN_ID, "sb_admin", (tx) => [tx`select 1`, tx`select type, count(*)::int as n from notifications group by type order by n desc`]);
console.log("NTYPES:", JSON.stringify(nt));
const [, up] = await asUser(ADMIN_ID, "sb_admin", (tx) => [tx`select 1`, tx`select uo.id, uo.status, uo.company_id, uo.suggested_service_id from upsell_opportunities uo`]);
console.log("UPSELLS:", JSON.stringify(up));
await getPg().end();
process.exit(0);
