import { asUser, ensureSchema } from "../src/lib/db";
import { getPg } from "../src/db";
const ADMIN_ID = "b03151a4-453c-4ed2-a9aa-02e558719f7c";
await ensureSchema();
const [roles, ups, companies, ntypes, svcs, ev] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
  tx`select role from admin_roles where user_id = ${ADMIN_ID} order by role`,
  tx`select uo.id, uo.company_id, uo.status, uo.confidence, c.name as cn, s.name as sn from upsell_opportunities uo left join companies c on c.id=uo.company_id left join services s on s.id=uo.suggested_service_id limit 20`,
  tx`select id, name, owner_id from companies order by name`,
  tx`select type, count(*)::int as n from notifications group by type order by n desc`,
  tx`select id, name from services order by name`,
  tx`select se.id, se.title, se.source_url from service_evidence se limit 5`,
])) as any;
console.log("ADMIN_ROLES:", JSON.stringify(roles));
console.log("UPSELLS:", JSON.stringify(ups));
console.log("COMPANIES:", JSON.stringify(companies.map((c:any)=>({id:c.id,name:c.name,owner:c.owner_id}))));
console.log("NTYPES:", JSON.stringify(ntypes));
console.log("SERVICES:", JSON.stringify(svcs.map((s:any)=>s.name)));
console.log("EVIDENCE:", JSON.stringify(ev));
await getPg().end();
process.exit(0);
