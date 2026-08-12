import { asUser, ensureSchema } from "../src/lib/db";
import { getPg } from "../src/db";
import { auditQuery } from "../src/lib/audit";
const ADMIN_ID = "b03151a4-453c-4ed2-a9aa-02e558719f7c";
await ensureSchema();
const out = await asUser(ADMIN_ID, "sb_admin", (tx) => [
  auditQuery(tx, ADMIN_ID, "probe.audit.stringified", { hello: "world", n: 1 }),
  tx`insert into audit_logs (id, actor_id, action, details) values (gen_random_uuid(), ${ADMIN_ID}, 'probe.audit.object', ${{ hello: "world", n: 1 } as never})`,
  tx`select action, jsonb_typeof(details) as dt, details from audit_logs where action like 'probe.audit.%' order by created_at desc limit 5`,
]);
console.log(JSON.stringify(out[3], null, 1));
await getPg().end();
process.exit(0);
