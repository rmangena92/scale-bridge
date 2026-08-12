/**
 * Seed: Noor Contracting - a demo company whose three-month minimum commitment
 * has COMPLETED, so the Master Admin eligible-downgrade path can be
 * demonstrated live (Stage 3 part 1).
 *
 * Usage:
 *   cd /home/team/shared/site && . /home/team/shared/.db-url.sh && bun scripts/seed_noor.ts
 *
 * Seeds (idempotent - probe-before-insert everywhere):
 *   - User   owner@noor.test / demo-password  (role company_user)
 *   - Company "Noor Contracting LLC" (owner_id = that user)
 *   - Customer + Active Verified Partner subscription (monthly, AED 149),
 *     started 12 May 2026; current period 12 Aug 2026 -> 12 Sep 2026.
 *   - Minimum commitment 12 May 2026 -> 12 Aug 2026, cycles_required 3,
 *     COMPLETED (completed_at 12 Aug 2026) - downgrade eligible.
 *   - 3 paid billing cycles + 3 paid invoices + card payment method.
 *
 * RLS: every read/write runs inside asUser(ADMIN_ID, 'sb_admin', ...).
 */
import { getPg } from "../src/db";
import { asUser, ensureSchema } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth-core";

const ADMIN_ID = "b03151a4-453c-4ed2-a9aa-02e558719f7c"; // admin.demo@scalebridge.test
const OWNER_EMAIL = "owner@noor.test";
const COMPANY_NAME = "Noor Contracting LLC";

const D1 = new Date("2026-05-12T00:00:00Z"); // commitment start / sub start
const D2 = new Date("2026-08-12T00:00:00Z"); // commitment end (completed)
const D3 = new Date("2026-09-12T00:00:00Z"); // current period end / next billing

const pg = getPg();
await ensureSchema();

let created = 0;

// plan id (Verified Partner, monthly 149)
const [, planRows] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
  tx`select id, name from membership_plans where code = 'verified'`,
])) as unknown as [unknown, { id: string; name: string }[]];
const planId = planRows[0]?.id;
if (!planId) {
  console.error("FATAL: Verified Partner plan not found - run seed_subscriptions.ts first.");
  await pg.end();
  process.exit(1);
}

// user
const [, userRows] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
  tx`select id from users where email = ${OWNER_EMAIL}`,
])) as unknown as [unknown, { id: string }[]];
let ownerId = userRows[0]?.id;
if (!ownerId) {
  const [, u2] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
    tx`insert into users (id, email, password_hash, status)
         values (gen_random_uuid(), ${OWNER_EMAIL}, ${hashPassword("demo-password")}, 'active')
         returning id`,
  ])) as unknown as [unknown, { id: string }[]];
  ownerId = u2[0].id;
  created++;
  console.log(`  noor: user + (${OWNER_EMAIL} / demo-password)`);
}

// company
const [, compRows] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
  tx`select id from companies where name = ${COMPANY_NAME}`,
])) as unknown as [unknown, { id: string }[]];
let companyId = compRows[0]?.id;
if (!companyId) {
  const [, c2] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
    tx`insert into companies (id, owner_id, name, type, description, contact_email, verification_status)
         values (gen_random_uuid(), ${ownerId}, ${COMPANY_NAME}, 'general_contracting',
                 'General contracting and fit-out services.', ${OWNER_EMAIL}, 'verified')
         returning id`,
  ])) as unknown as [unknown, { id: string }[]];
  companyId = c2[0].id;
  created++;
  console.log("  noor: company + (verified)");
}

// profile
const [, profRows] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
  tx`select user_id from profiles where user_id = ${ownerId}`,
])) as unknown as [unknown, { user_id: string }[]];
if (!profRows[0]) {
  await asUser(ADMIN_ID, "sb_admin", (tx) => [
    tx`insert into profiles (user_id, role, name, company_id)
         values (${ownerId}, 'company_user', 'Noor Contracting Admin', ${companyId})`,
  ]);
  created++;
  console.log("  noor: profile +");
}

// customer
const [, custRows] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
  tx`select id from customers where user_id = ${ownerId} and company_id = ${companyId}`,
])) as unknown as [unknown, { id: string }[]];
let customerId = custRows[0]?.id;
if (!customerId) {
  const [, c2] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
    tx`insert into customers (id, user_id, company_id, provider_customer_id)
         values (gen_random_uuid(), ${ownerId}, ${companyId}, 'sandbox_cus_noor') returning id`,
  ])) as unknown as [unknown, { id: string }[]];
  customerId = c2[0].id;
  created++;
  console.log("  noor: customer +");
}

// subscription
const [, subRows] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
  tx`select id from subscriptions where provider_subscription_id = 'sandbox_seed_verified_noor'`,
])) as unknown as [unknown, { id: string }[]];
let subId = subRows[0]?.id;
if (!subId) {
  const [, s2] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
    tx`insert into subscriptions
         (id, customer_id, plan_id, provider_subscription_id, status, billing_interval,
          current_period_start, current_period_end, next_billing_date, started_at)
       values (gen_random_uuid(), ${customerId}, ${planId}, 'sandbox_seed_verified_noor', 'active', 'monthly',
               ${D2}, ${D3}, ${D3}, ${D1})
       returning id`,
  ])) as unknown as [unknown, { id: string }[]];
  subId = s2[0].id;
  created++;
  console.log("  noor: subscription + (active, Verified Partner)");
}

// subscription item
const [, itemRows] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
  tx`select id from subscription_items where subscription_id = ${subId}`,
])) as unknown as [unknown, { id: string }[]];
if (!itemRows[0]) {
  await asUser(ADMIN_ID, "sb_admin", (tx) => [
    tx`insert into subscription_items (id, subscription_id, plan_id, quantity, unit_amount, billing_interval)
         values (gen_random_uuid(), ${subId}, ${planId}, 1, 149, 'monthly')`,
  ]);
  created++;
  console.log("  noor: subscription_item +");
}

// minimum commitment - COMPLETED (12 May 2026 -> 12 Aug 2026)
const [, mcRows] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
  tx`select id from minimum_commitments where subscription_id = ${subId} and commitment_start_date = ${D1}`,
])) as unknown as [unknown, { id: string }[]];
if (!mcRows[0]) {
  await asUser(ADMIN_ID, "sb_admin", (tx) => [
    tx`insert into minimum_commitments
         (id, subscription_id, commitment_start_date, commitment_end_date, cycles_required, completed, completed_at)
       values (gen_random_uuid(), ${subId}, ${D1}, ${D2}, 3, true, ${D2})`,
  ]);
  created++;
  console.log("  noor: minimum_commitment + (COMPLETED 12 May 2026 -> 12 Aug 2026)");
} else {
  // keep completed in sync in case an earlier run created it incomplete
  await asUser(ADMIN_ID, "sb_admin", (tx) => [
    tx`update minimum_commitments set completed = true, completed_at = ${D2}
         where subscription_id = ${subId} and commitment_start_date = ${D1}`,
  ]);
}

// billing cycles (3 paid)
const cycles = [
  { n: 1, start: "2026-05-12T00:00:00Z", end: "2026-06-12T00:00:00Z" },
  { n: 2, start: "2026-06-12T00:00:00Z", end: "2026-07-12T00:00:00Z" },
  { n: 3, start: "2026-07-12T00:00:00Z", end: "2026-08-12T00:00:00Z" },
];
for (const c of cycles) {
  const [, cr] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
    tx`select id from billing_cycles where subscription_id = ${subId} and cycle_number = ${c.n}`,
  ])) as unknown as [unknown, { id: string }[]];
  if (!cr[0]) {
    await asUser(ADMIN_ID, "sb_admin", (tx) => [
      tx`insert into billing_cycles
           (id, subscription_id, cycle_number, period_start, period_end, status, amount_ael, paid_at)
         values (gen_random_uuid(), ${subId}, ${c.n}, ${new Date(c.start)}, ${new Date(c.end)}, 'Paid', 149, ${new Date(c.start)})`,
    ]);
    created++;
  }
}

// invoices (3 paid)
const invPeriods = [
  { n: "INV-2026-0101", start: "2026-05-12T00:00:00Z", end: "2026-06-12T00:00:00Z" },
  { n: "INV-2026-0102", start: "2026-06-12T00:00:00Z", end: "2026-07-12T00:00:00Z" },
  { n: "INV-2026-0103", start: "2026-07-12T00:00:00Z", end: "2026-08-12T00:00:00Z" },
];
for (const i of invPeriods) {
  const [, ir] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
    tx`select id from subscription_invoices where invoice_number = ${i.n}`,
  ])) as unknown as [unknown, { id: string }[]];
  if (!ir[0]) {
    await asUser(ADMIN_ID, "sb_admin", (tx) => [
      tx`insert into subscription_invoices
           (id, customer_id, subscription_id, invoice_number, amount_ael, tax_ael, total_ael, status,
            billing_period_start, billing_period_end, due_date, paid_at, provider_invoice_id)
         values (gen_random_uuid(), ${customerId}, ${subId}, ${i.n}, 149, 0, 149, 'Paid',
                 ${new Date(i.start)}, ${new Date(i.end)}, ${new Date(i.end)}, ${new Date(i.start)}, ${"sandbox_inv_" + i.n})`,
    ]);
    created++;
  }
}

// payment method (card)
const [, pmRows] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
  tx`select id from payment_methods where customer_id = ${customerId}`,
])) as unknown as [unknown, { id: string }[]];
if (!pmRows[0]) {
  await asUser(ADMIN_ID, "sb_admin", (tx) => [
    tx`insert into payment_methods (id, customer_id, provider_payment_method_id, type, last4, brand, expiry, is_default)
         values (gen_random_uuid(), ${customerId}, 'sandbox_pm_noor', 'card', '4242', 'Visa', '12/28', true)`,
  ]);
  created++;
  console.log("  noor: payment_method + (Visa •••• 4242)");
}

console.log(created > 0 ? `noor: created ${created} new rows` : "noor: nothing to create (idempotent)");
const [, counts] = (await asUser(ADMIN_ID, "sb_admin", (tx) => [
  tx`select (select name from companies where id = ${companyId}) as company,
            (select status from subscriptions where id = ${subId}) as sub_status,
            (select completed from minimum_commitments where subscription_id = ${subId} order by commitment_start_date desc limit 1) as commitment_done`,
])) as unknown as [unknown, { company: string; sub_status: string; commitment_done: boolean }[]];
console.log("noor: verification:", JSON.stringify(counts[0]));
await pg.end();
process.exit(0);
