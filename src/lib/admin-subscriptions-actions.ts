/**
 * Master Admin Portal - Stage 3 part 1: subscription management actions (server-only core).
 *
 * Company-scoped billing panel (spec section 6), manual upgrade / downgrade /
 * commitment-override / cancellation workflows (spec section 5), full audit
 * (section 10) and client notifications (section 11 templates).
 *
 * Every state change reuses the existing subscription state machine in
 * ./subscriptions.ts (requestUpgrade / confirmUpgrade / requestDowngrade /
 * confirmDowngrade / requestCancellation / confirmCancellation) executed under
 * the COMPANY OWNER's identity - those functions are user-scoped (customers.
 * user_id = actor). The admin writes its own audit rows with the admin as
 * actor and inserts the client notification, so the spec §10 trail names the
 * real operator while the provider/state-machine history records the owner.
 *
 * Senior gate (spec §5): doAdminImmediateDowngrade and doAdminCommitmentOverride
 * require the acting admin to hold 'super_admin' in admin_roles.
 *
 * RLS: every read/write runs through asUser(adminId, 'sb_admin', ...) so
 * app.user_id / app.role policies apply (sb_admin may read/write all).
 */
import { randomUUID } from "node:crypto";
import { asUser, dbConfigured, ensureSchema } from "./db";
import type { Tx, TxQuery } from "./db";
import { auditQuery } from "./audit";
import {
  commitmentEnd,
  confirmCancellation,
  confirmDowngrade,
  confirmUpgrade,
  requestCancellation,
  requestDowngrade,
  requestUpgrade,
} from "./subscriptions";
import type { BillingInterval, SubscriptionStatus } from "./subscriptions";

export type AdminActor = { id: string; role: string; staffRoles: string[] };

export const COMMITMENT_OVERRIDE_REASONS = [
  "approved commercial exception",
  "service failure",
  "duplicate subscription",
  "billing error",
  "regulatory requirement",
  "client settlement",
  "internal migration",
  "administrative correction",
] as const;

const num = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);
const str = (v: unknown): string => String(v);
const fmtDate = (v: Date | string | null | undefined): string | null =>
  v ? String(v).slice(0, 10) : null;

export type AdminBillingPanel = {
  company: { id: string; name: string; ownerId: string | null; ownerEmail: string | null };
  subscription: {
    id: string;
    status: SubscriptionStatus;
    billingInterval: BillingInterval;
    startedAt: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    nextBillingDate: string | null;
    cancelledAt: string | null;
    providerSubscriptionId: string | null;
  } | null;
  customer: { id: string; providerCustomerId: string | null; userId: string | null } | null;
  plan: {
    id: string | null;
    code: string | null;
    name: string | null;
    category: string | null;
    priceAel: number;
    interval: BillingInterval;
    features: string[];
    entitlements: { key: string; value: Record<string, string | number | boolean | null> }[];
  } | null;
  minCommitment: {
    commitmentStart: string;
    commitmentEnd: string;
    cyclesRequired: number;
    completed: boolean;
    completedAt: string | null;
    downgradeEligibleDate: string;
    downgradeLocked: boolean;
  } | null;
  paymentMethod: {
    type: string;
    last4: string | null;
    brand: string | null;
    expiry: string | null;
    isDefault: boolean;
  } | null;
  outstandingBalanceAel: number;
  failedPayment: boolean;
  pendingUpgrade: { id: string; status: string; toPlanName: string | null; effectiveDate: string | null } | null;
  pendingDowngrade: { id: string; status: string; toPlanName: string | null; effectiveDate: string | null } | null;
  cancellation: { id: string; mode: string; status: string; effectiveDate: string | null } | null;
  invoices: {
    id: string;
    invoiceNumber: string;
    totalAel: number;
    status: string;
    billingPeriodStart: string | null;
    billingPeriodEnd: string | null;
    dueDate: string | null;
    paidAt: string | null;
  }[];
  paymentEvents: {
    id: string;
    eventType: string;
    amountAel: number | null;
    occurredAt: string;
  }[];
  webhooks: {
    id: string;
    provider: string;
    eventType: string;
    eventId: string;
    processed: boolean;
    receivedAt: string;
  }[];
  overrides: {
    id: string;
    reason: string;
    financialTreatment: string;
    effectiveDate: string;
    status: string;
    requestedBy: string | null;
    seniorAdminName: string | null;
    createdAt: string;
  }[];
  availablePlans: {
    id: string;
    code: string;
    name: string;
    category: string;
    priceMonthlyAel: number | null;
    priceAnnualAel: number | null;
    sortOrder: number;
  }[];
};

export type UpgradePreview = {
  currentPlan: string;
  newPlan: string;
  newPlanId: string;
  priceDiffAel: number;
  prorationAmountAel: number;
  effectiveDate: string;
  newCommitmentEnd: string;
  nextInvoiceAmountAel: number;
  interval: BillingInterval;
  newEntitlements: string[];
  currentEntitlements: string[];
};

export type DowngradePreview = {
  currentPlan: string;
  newPlan: string;
  newPlanId: string;
  futureBillingAmountAel: number;
  effectiveDate: string;
  locked: boolean;
  eligibleDate: string | null;
  featuresRemoved: string[];
};

export type AdminBillingActionResult =
  | { ok: true; message: string; effectiveDate?: string; requestId?: string; overrideId?: string }
  | { ok: false; error: string; code?: string; eligibleDate?: string };

// ------------------------------------------------------------ company scoping
/** The company's subscription (by customers.company_id) - admin scope. */
async function loadCompanySubscription(adminId: string, companyId: string) {
  const rows = (await asUser(adminId, "sb_admin", (tx) => [
    tx`select s.id, s.customer_id, s.plan_id, s.provider_subscription_id, s.status,
              s.billing_interval, s.current_period_start, s.current_period_end,
              s.next_billing_date, s.started_at, s.cancelled_at, s.created_at,
              c.id as c_id, c.user_id as c_user_id, c.provider_customer_id as c_provider_customer_id
         from subscriptions s
         join customers c on c.id = s.customer_id
        where c.company_id = ${companyId}
        order by s.created_at desc
        limit 1`,
  ]))[1] as {
    id: string;
    customer_id: string;
    plan_id: string | null;
    provider_subscription_id: string | null;
    status: SubscriptionStatus;
    billing_interval: BillingInterval;
    current_period_start: Date | null;
    current_period_end: Date | null;
    next_billing_date: Date | null;
    started_at: Date | null;
    cancelled_at: Date | null;
    created_at: Date;
    c_id: string;
    c_user_id: string;
    c_provider_customer_id: string | null;
  }[];
  return rows[0] ?? null;
}

/** The company row + owner profile (owner user id, email, role). */
async function loadCompanyAndOwner(adminId: string, companyId: string) {
  const rows = (await asUser(adminId, "sb_admin", (tx) => [
    tx`select c.id, c.name, c.owner_id, u.email as owner_email, p.role as owner_role
         from companies c
         left join users u on u.id = c.owner_id
         left join profiles p on p.user_id = c.owner_id
        where c.id = ${companyId}`,
  ]))[1] as {
    id: string;
    name: string;
    owner_id: string;
    owner_email: string | null;
    owner_role: string;
  }[];
  return rows[0] ?? null;
}

async function loadPlanById(adminId: string, planId: string | null) {
  if (!planId) return null;
  const rows = (await asUser(adminId, "sb_admin", (tx) => [
    tx`select id, code, name, category, price_monthly_ael, price_annual_ael, sort_order
         from membership_plans where id = ${planId}`,
  ]))[1] as {
    id: string;
    code: string;
    name: string;
    category: string;
    price_monthly_ael: string | number | null;
    price_annual_ael: string | number | null;
    sort_order: number;
  }[];
  return rows[0] ?? null;
}

function planPrice(p: { price_monthly_ael: string | number | null; price_annual_ael: string | number | null } | null, interval: BillingInterval): number {
  if (!p) return 0;
  return num(interval === "annual" ? p.price_annual_ael : p.price_monthly_ael) ?? 0;
}

const addMonths = (d: Date, months: number): Date => {
  const out = new Date(d.getTime());
  const day = out.getDate();
  out.setDate(1);
  out.setMonth(out.getMonth() + months);
  const last = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
  out.setDate(Math.min(day, last));
  return out;
};

/** Insert a client notification (spec section 11) inside an asUser batch. */
function notifyQuery(
  tx: Tx,
  ownerUserId: string | null,
  type: string,
  title: string,
  body: string,
): TxQuery | null {
  if (!ownerUserId) return null;
  return tx`insert into notifications (id, user_id, type, title, body, link)
    values (${randomUUID()}, ${ownerUserId}, ${type}, ${title}, ${body}, '/app/notifications')`;
}

/** Spec §5 senior gate: super_admin among admin_roles. */
function requireSuperAdmin(admin: AdminActor): string | null {
  if (!admin.staffRoles.includes("super_admin")) {
    return "This action requires senior authorisation (super_admin role).";
  }
  return null;
}

// ------------------------------------------------------------------ panel
export async function doAdminGetBillingPanel(
  admin: AdminActor,
  companyId: string,
): Promise<{ ok: true; panel: AdminBillingPanel } | { ok: false; error: string }> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED" };
  try {
    await ensureSchema();
    const company = await loadCompanyAndOwner(admin.id, companyId);
    if (!company) return { ok: false, error: "Company not found." };
    const sub = await loadCompanySubscription(admin.id, companyId);
    const plan = sub ? await loadPlanById(admin.id, sub.plan_id) : null;
    let minCommitment: AdminBillingPanel["minCommitment"] = null;
    let paymentMethod: AdminBillingPanel["paymentMethod"] = null;
    let outstanding = 0;
    let failedPayment = false;
    const invoices: AdminBillingPanel["invoices"] = [];
    const paymentEvents: AdminBillingPanel["paymentEvents"] = [];
    const webhooks: AdminBillingPanel["webhooks"] = [];
    const overrides: AdminBillingPanel["overrides"] = [];
    let pendingUpgrade: AdminBillingPanel["pendingUpgrade"] = null;
    let pendingDowngrade: AdminBillingPanel["pendingDowngrade"] = null;
    let cancellation: AdminBillingPanel["cancellation"] = null;
    const availablePlans: AdminBillingPanel["availablePlans"] = [];
    let features: string[] = [];
    let entitlements: { key: string; value: unknown }[] = [];
    if (sub) {
      const [, mcRows, pmRows, invRows, evRows, whRows, ovRows, upRows, dnRows, cxRows, plans, feats, ents] =
        (await asUser(admin.id, "sb_admin", (tx) => [
          tx`select commitment_start_date, commitment_end_date, cycles_required, completed, completed_at
               from minimum_commitments where subscription_id = ${sub.id}
               order by commitment_start_date desc limit 1`,
          tx`select type, last4, brand, expiry, is_default from payment_methods
               where customer_id = ${sub.customer_id} order by created_at desc limit 1`,
          tx`select id, invoice_number, total_ael, status, billing_period_start, billing_period_end, due_date, paid_at
               from subscription_invoices where customer_id = ${sub.customer_id}
               order by created_at desc limit 25`,
          tx`select id, event_type, amount_ael, occurred_at from payment_events
               where invoice_id in (select id from subscription_invoices where customer_id = ${sub.customer_id})
               order by occurred_at desc limit 25`,
          tx`select id, provider, event_type, event_id, processed, received_at
               from billing_provider_webhook_events
               where payload->>'subscriptionId' = ${sub.id}
               order by received_at desc limit 25`,
          tx`select o.id, o.reason, o.financial_treatment, o.effective_date, o.status,
                    o.requested_by, p.name as senior_name, o.created_at
               from commitment_overrides o
               left join profiles p on p.user_id = o.senior_admin_user_id
               where o.subscription_id = ${sub.id}
               order by o.created_at desc limit 20`,
          tx`select u.id, u.status, u.effective_date, pl.name as plan_name
               from upgrade_requests u left join membership_plans pl on pl.id = u.to_plan_id
               where u.subscription_id = ${sub.id} and u.status in ('Pending','Confirmed')
               order by u.requested_at desc limit 1`,
          tx`select d.id, d.status, d.effective_date, pl.name as plan_name
               from downgrade_requests d left join membership_plans pl on pl.id = d.to_plan_id
               where d.subscription_id = ${sub.id} and d.status in ('Pending','Confirmed')
               order by d.requested_at desc limit 1`,
          tx`select id, mode, status, effective_date from cancellation_requests
               where subscription_id = ${sub.id} and status in ('Pending','Confirmed')
               order by requested_at desc limit 1`,
          tx`select id, code, name, category, price_monthly_ael, price_annual_ael, sort_order
               from membership_plans where status = 'Active' order by sort_order`,
          tx`select feature from plan_features where plan_id = ${sub.plan_id ?? null} order by sort_order`,
          tx`select entitlement_key, value from plan_entitlements where plan_id = ${sub.plan_id ?? null}`,
        ])) as unknown as [
          unknown,
          {
            commitment_start_date: Date; commitment_end_date: Date; cycles_required: number;
            completed: boolean; completed_at: Date | null;
          }[],
          { type: string; last4: string | null; brand: string | null; expiry: string | null; is_default: boolean }[],
          {
            id: string; invoice_number: string; total_ael: string | number; status: string;
            billing_period_start: Date | null; billing_period_end: Date | null; due_date: Date | null; paid_at: Date | null;
          }[],
          { id: string; event_type: string; amount_ael: string | number | null; occurred_at: Date }[],
          { id: string; provider: string; event_type: string; event_id: string; processed: boolean; received_at: Date }[],
          {
            id: string; reason: string; financial_treatment: string; effective_date: Date; status: string;
            requested_by: string; senior_name: string | null; created_at: Date;
          }[],
          { id: string; status: string; effective_date: Date | null; plan_name: string | null }[],
          { id: string; status: string; effective_date: Date | null; plan_name: string | null }[],
          { id: string; mode: string; status: string; effective_date: Date | null }[],
          {
            id: string; code: string; name: string; category: string;
            price_monthly_ael: string | number | null; price_annual_ael: string | number | null; sort_order: number;
          }[],
          { feature: string }[],
          { entitlement_key: string; value: unknown }[],
        ];
      const mc = mcRows[0];
      if (mc) {
        const done = mc.completed || mc.commitment_end_date.getTime() <= Date.now();
        minCommitment = {
          commitmentStart: str(mc.commitment_start_date),
          commitmentEnd: str(mc.commitment_end_date),
          cyclesRequired: mc.cycles_required,
          completed: done,
          completedAt: mc.completed_at ? str(mc.completed_at) : null,
          downgradeEligibleDate: str(mc.commitment_end_date),
          downgradeLocked: !done,
        };
      }
      const pm = pmRows[0];
      if (pm) {
        paymentMethod = { type: pm.type, last4: pm.last4, brand: pm.brand, expiry: pm.expiry, isDefault: pm.is_default };
      }
      for (const i of invRows) {
        invoices.push({
          id: i.id,
          invoiceNumber: i.invoice_number,
          totalAel: num(i.total_ael) ?? 0,
          status: i.status,
          billingPeriodStart: i.billing_period_start ? str(i.billing_period_start) : null,
          billingPeriodEnd: i.billing_period_end ? str(i.billing_period_end) : null,
          dueDate: i.due_date ? str(i.due_date) : null,
          paidAt: i.paid_at ? str(i.paid_at) : null,
        });
        if (i.status === "Open") outstanding += num(i.total_ael) ?? 0;
        if (i.status === "Failed") failedPayment = true;
      }
      for (const e of evRows) {
        paymentEvents.push({
          id: e.id,
          eventType: e.event_type,
          amountAel: num(e.amount_ael),
          occurredAt: str(e.occurred_at),
        });
      }
      for (const w of whRows) {
        webhooks.push({
          id: w.id,
          provider: w.provider,
          eventType: w.event_type,
          eventId: w.event_id,
          processed: w.processed,
          receivedAt: str(w.received_at),
        });
      }
      for (const o of ovRows) {
        overrides.push({
          id: o.id,
          reason: o.reason,
          financialTreatment: o.financial_treatment,
          effectiveDate: str(o.effective_date),
          status: o.status,
          requestedBy: o.requested_by,
          seniorAdminName: o.senior_name,
          createdAt: str(o.created_at),
        });
      }
      const up = upRows[0];
      if (up) pendingUpgrade = { id: up.id, status: up.status, toPlanName: up.plan_name, effectiveDate: up.effective_date ? str(up.effective_date) : null };
      const dn = dnRows[0];
      if (dn) pendingDowngrade = { id: dn.id, status: dn.status, toPlanName: dn.plan_name, effectiveDate: dn.effective_date ? str(dn.effective_date) : null };
      const cx = cxRows[0];
      if (cx) cancellation = { id: cx.id, mode: cx.mode, status: cx.status, effectiveDate: cx.effective_date ? str(cx.effective_date) : null };
      for (const p of plans) {
        availablePlans.push({
          id: p.id,
          code: p.code,
          name: p.name,
          category: p.category,
          priceMonthlyAel: num(p.price_monthly_ael),
          priceAnnualAel: num(p.price_annual_ael),
          sortOrder: p.sort_order,
        });
      }
      features = feats.map((f) => f.feature);
      entitlements = ents.map((e) => ({ key: e.entitlement_key, value: (e.value ?? {}) as Record<string, string | number | boolean | null> }));
    }
    return {
      ok: true,
      panel: {
        company: { id: company.id, name: company.name, ownerId: company.owner_id, ownerEmail: company.owner_email },
        subscription: sub
          ? {
              id: sub.id,
              status: sub.status,
              billingInterval: sub.billing_interval,
              startedAt: sub.started_at ? str(sub.started_at) : null,
              currentPeriodStart: sub.current_period_start ? str(sub.current_period_start) : null,
              currentPeriodEnd: sub.current_period_end ? str(sub.current_period_end) : null,
              nextBillingDate: sub.next_billing_date ? str(sub.next_billing_date) : null,
              cancelledAt: sub.cancelled_at ? str(sub.cancelled_at) : null,
              providerSubscriptionId: sub.provider_subscription_id,
            }
          : null,
        customer: sub
          ? { id: sub.customer_id, providerCustomerId: sub.c_provider_customer_id, userId: sub.c_user_id }
          : null,
        plan: plan
          ? {
              id: plan.id,
              code: plan.code,
              name: plan.name,
              category: plan.category,
              priceAel: planPrice(plan, sub?.billing_interval ?? "monthly"),
              interval: sub?.billing_interval ?? "monthly",
              features,
              entitlements,
            }
          : null,
        minCommitment,
        paymentMethod,
        outstandingBalanceAel: outstanding,
        failedPayment,
        pendingUpgrade,
        pendingDowngrade,
        cancellation,
        invoices,
        paymentEvents,
        webhooks,
        overrides,
        availablePlans,
      },
    };
  } catch (err) {
    console.error("doAdminGetBillingPanel failed:", err);
    return { ok: false, error: "Could not load the billing panel." };
  }
}

// ------------------------------------------------------------------ upgrade
export async function doAdminUpgradePreview(
  admin: AdminActor,
  companyId: string,
  newPlanId: string,
): Promise<{ ok: true; preview: UpgradePreview } | { ok: false; error: string; code?: string }> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED" };
  try {
    await ensureSchema();
    const sub = await loadCompanySubscription(admin.id, companyId);
    if (!sub) return { ok: false, error: "No subscription for this company." };
    const current = await loadPlanById(admin.id, sub.plan_id);
    const target = await loadPlanById(admin.id, newPlanId);
    if (!target) return { ok: false, error: "Target plan not found." };
    if (current && target.id === current.id) return { ok: false, error: "Company is already on this plan." };
    const interval = sub.billing_interval;
    const currentPrice = planPrice(current, interval);
    const targetPrice = planPrice(target, interval);
    if (targetPrice < currentPrice || (current && target.sort_order < current.sort_order)) {
      return { ok: false, error: "That plan is a downgrade. Use the downgrade flow instead.", code: "NOT_UPGRADE" };
    }
    const periodStart = sub.current_period_start ?? new Date();
    const periodEnd = sub.current_period_end ?? addMonths(periodStart, interval === "monthly" ? 1 : 12);
    const now = new Date();
    const totalMs = Math.max(1, periodEnd.getTime() - periodStart.getTime());
    const remainingMs = Math.max(0, periodEnd.getTime() - now.getTime());
    const proration = Math.round((remainingMs / totalMs) * (targetPrice - currentPrice));
    const [, currEnts, tgtEnts] = (await asUser(admin.id, "sb_admin", (tx) => [
      tx`select entitlement_key from plan_entitlements where plan_id = ${current?.id ?? null}`,
      tx`select entitlement_key from plan_entitlements where plan_id = ${target.id}`,
    ])) as unknown as [unknown, { entitlement_key: string }[], { entitlement_key: string }[]];
    return {
      ok: true,
      preview: {
        currentPlan: current?.name ?? "None",
        newPlan: target.name,
        newPlanId: target.id,
        priceDiffAel: targetPrice - currentPrice,
        prorationAmountAel: proration,
        effectiveDate: str(now),
        newCommitmentEnd: str(commitmentEnd(now, interval)),
        nextInvoiceAmountAel: targetPrice,
        interval,
        newEntitlements: tgtEnts.map((e) => e.entitlement_key),
        currentEntitlements: currEnts.map((e) => e.entitlement_key),
      },
    };
  } catch (err) {
    console.error("doAdminUpgradePreview failed:", err);
    return { ok: false, error: "Could not prepare the upgrade preview." };
  }
}

export async function doAdminExecuteUpgrade(
  admin: AdminActor,
  companyId: string,
  newPlanId: string,
  internalReason: string,
): Promise<AdminBillingActionResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED" };
  try {
    await ensureSchema();
    const company = await loadCompanyAndOwner(admin.id, companyId);
    if (!company) return { ok: false, error: "Company not found." };
    const sub = await loadCompanySubscription(admin.id, companyId);
    if (!sub) return { ok: false, error: "No subscription for this company." };
    const current = await loadPlanById(admin.id, sub.plan_id);
    const target = await loadPlanById(admin.id, newPlanId);
    if (!target) return { ok: false, error: "Target plan not found." };
    const preview = await doAdminUpgradePreview(admin, companyId, newPlanId);
    if (!preview.ok) return preview;
    // Reuse the state machine under the company owner's identity.
    const requested = await requestUpgrade(company.owner_id, company.owner_role, newPlanId);
    if (!requested.ok) return { ok: false, error: requested.error, code: requested.code };
    const confirmed = await confirmUpgrade(company.owner_id, company.owner_role, requested.data.requestId);
    if (!confirmed.ok) return { ok: false, error: confirmed.error };
    const body =
      `Your ScaleBridge membership has been upgraded from ${preview.preview.currentPlan} to ${preview.preview.newPlan}. ` +
      `Your new features are available from ${fmtDate(preview.preview.effectiveDate)}. ` +
      `Your updated billing amount is AED ${preview.preview.nextInvoiceAmountAel}. ` +
      `Your new minimum commitment period ends on ${fmtDate(preview.preview.newCommitmentEnd)}.`;
    await asUser(admin.id, "sb_admin", (tx) => [
      auditQuery(tx, admin.id, "billing.admin.upgrade.executed", {
        companyId,
        subscriptionId: sub.id,
        previousPlan: current?.name ?? null,
        previousPlanId: current?.id ?? null,
        newPlan: target.name,
        newPlanId: target.id,
        prorationAel: preview.preview.prorationAmountAel,
        nextInvoiceAel: preview.preview.nextInvoiceAmountAel,
        newCommitmentEnd: preview.preview.newCommitmentEnd,
        reason: internalReason,
        approval: "admin_confirmed",
        notificationStatus: "sent",
      }),
      notifyQuery(tx, company.owner_id, "membership", "Membership upgraded", body),
    ].filter((q): q is TxQuery => q !== null));
    return {
      ok: true,
      message: `Upgraded to ${target.name}. Commitment reset; new commitment ends ${fmtDate(preview.preview.newCommitmentEnd)}.`,
      effectiveDate: preview.preview.effectiveDate,
    };
  } catch (err) {
    console.error("doAdminExecuteUpgrade failed:", err);
    return { ok: false, error: "Could not execute the upgrade." };
  }
}

// ---------------------------------------------------------------- downgrade
export async function doAdminDowngradePreview(
  admin: AdminActor,
  companyId: string,
  newPlanId: string,
): Promise<{ ok: true; preview: DowngradePreview } | { ok: false; error: string; code?: string; eligibleDate?: string }> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED" };
  try {
    await ensureSchema();
    const sub = await loadCompanySubscription(admin.id, companyId);
    if (!sub) return { ok: false, error: "No subscription for this company." };
    const current = await loadPlanById(admin.id, sub.plan_id);
    const target = await loadPlanById(admin.id, newPlanId);
    if (!target) return { ok: false, error: "Target plan not found." };
    if (current && target.id === current.id) return { ok: false, error: "Company is already on this plan." };
    const [, mcRows, currEnts, tgtEnts] = (await asUser(admin.id, "sb_admin", (tx) => [
      tx`select commitment_start_date, commitment_end_date, completed from minimum_commitments
           where subscription_id = ${sub.id} order by commitment_start_date desc limit 1`,
      tx`select entitlement_key from plan_entitlements where plan_id = ${current?.id ?? null}`,
      tx`select entitlement_key from plan_entitlements where plan_id = ${target.id}`,
    ])) as unknown as [
      unknown,
      { commitment_start_date: Date; commitment_end_date: Date; completed: boolean }[],
      { entitlement_key: string }[],
      { entitlement_key: string }[],
    ];
    const mc = mcRows[0];
    const locked = mc ? !(mc.completed || mc.commitment_end_date.getTime() <= Date.now()) : false;
    const eligibleDate = mc ? str(mc.commitment_end_date) : null;
    const targetKeys = new Set(tgtEnts.map((e) => e.entitlement_key));
    return {
      ok: true,
      preview: {
        currentPlan: current?.name ?? "None",
        newPlan: target.name,
        newPlanId: target.id,
        futureBillingAmountAel: planPrice(target, sub.billing_interval),
        effectiveDate: sub.current_period_end ? str(sub.current_period_end) : str(new Date()),
        locked,
        eligibleDate: locked ? eligibleDate : null,
        featuresRemoved: currEnts.map((e) => e.entitlement_key).filter((k) => !targetKeys.has(k)),
      },
    };
  } catch (err) {
    console.error("doAdminDowngradePreview failed:", err);
    return { ok: false, error: "Could not prepare the downgrade preview." };
  }
}

/** Schedule a downgrade at the end of the current billing period (commitment lock respected). */
export async function doAdminScheduleDowngrade(
  admin: AdminActor,
  companyId: string,
  newPlanId: string,
  internalReason: string,
): Promise<AdminBillingActionResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED" };
  try {
    await ensureSchema();
    const company = await loadCompanyAndOwner(admin.id, companyId);
    if (!company) return { ok: false, error: "Company not found." };
    const sub = await loadCompanySubscription(admin.id, companyId);
    if (!sub) return { ok: false, error: "No subscription for this company." };
    const current = await loadPlanById(admin.id, sub.plan_id);
    const target = await loadPlanById(admin.id, newPlanId);
    if (!target) return { ok: false, error: "Target plan not found." };
    const preview = await doAdminDowngradePreview(admin, companyId, newPlanId);
    if (!preview.ok) {
      return {
        ok: false,
        error: preview.error,
        code: preview.code,
        eligibleDate: preview.eligibleDate,
      };
    }
    if (preview.preview.locked) {
      return {
        ok: false,
        error: `Downgrade locked until the minimum commitment completes (${preview.preview.eligibleDate}).`,
        code: "MIN_COMMITMENT",
        eligibleDate: preview.preview.eligibleDate ?? undefined,
      };
    }
    const requested = await requestDowngrade(company.owner_id, company.owner_role, newPlanId);
    if (!requested.ok) return { ok: false, error: requested.error, code: requested.code };
    const body =
      `Your downgrade to ${requested.data.newPlan} has been scheduled for ${fmtDate(requested.data.effectiveDate)}. ` +
      `Your current plan remains active until that date.`;
    await asUser(admin.id, "sb_admin", (tx) => [
      auditQuery(tx, admin.id, "billing.admin.downgrade.scheduled", {
        companyId,
        subscriptionId: sub.id,
        previousPlan: current?.name ?? null,
        newPlan: target.name,
        newPlanId: target.id,
        effectiveDate: requested.data.effectiveDate,
        futureBillingAel: requested.data.futureBillingAmountAel,
        featuresRemoved: requested.data.featuresRemoved,
        reason: internalReason,
        approval: "admin_confirmed",
        notificationStatus: "sent",
      }),
      notifyQuery(tx, company.owner_id, "membership", "Downgrade scheduled", body),
    ].filter((q): q is TxQuery => q !== null));
    return {
      ok: true,
      message: `Downgrade to ${requested.data.newPlan} scheduled for ${fmtDate(requested.data.effectiveDate)}.`,
      effectiveDate: requested.data.effectiveDate,
      requestId: requested.data.requestId,
    };
  } catch (err) {
    console.error("doAdminScheduleDowngrade failed:", err);
    return { ok: false, error: "Could not schedule the downgrade." };
  }
}

/** Immediate downgrade - senior authorised (super_admin). */
export async function doAdminImmediateDowngrade(
  admin: AdminActor,
  companyId: string,
  newPlanId: string,
  opts: {
    reason: string;
    clientRequestNote?: string;
    financialTreatment: string;
    effectiveDate: string;
  },
): Promise<AdminBillingActionResult> {
  const gate = requireSuperAdmin(admin);
  if (gate) return { ok: false, error: gate, code: "SENIOR_REQUIRED" };
  if (!opts.reason || !opts.financialTreatment) {
    return { ok: false, error: "Reason and financial treatment are required." };
  }
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED" };
  try {
    await ensureSchema();
    const company = await loadCompanyAndOwner(admin.id, companyId);
    if (!company) return { ok: false, error: "Company not found." };
    const sub = await loadCompanySubscription(admin.id, companyId);
    if (!sub) return { ok: false, error: "No subscription for this company." };
    const current = await loadPlanById(admin.id, sub.plan_id);
    const target = await loadPlanById(admin.id, newPlanId);
    if (!target) return { ok: false, error: "Target plan not found." };
    // Write the commitment override FIRST (senior-authorised exception), then
    // apply the downgrade immediately through the state machine.
    const overrideId = randomUUID();
    await asUser(admin.id, "sb_admin", (tx) => [
      tx`insert into commitment_overrides
           (id, subscription_id, company_id, requested_by, senior_admin_user_id,
            reason, client_request_note, financial_treatment, effective_date, status)
         values (${overrideId}, ${sub.id}, ${companyId}, ${admin.id}, ${admin.id},
                 ${opts.reason}, ${opts.clientRequestNote ?? null}, ${opts.financialTreatment},
                 ${new Date(opts.effectiveDate)}, 'active')`,
      auditQuery(tx, admin.id, "billing.admin.commitment_override.created", {
        companyId,
        subscriptionId: sub.id,
        overrideId,
        reason: opts.reason,
        clientRequestNote: opts.clientRequestNote ?? null,
        financialTreatment: opts.financialTreatment,
        effectiveDate: opts.effectiveDate,
        approvingAdmin: admin.id,
      }),
    ]);
    const requested = await requestDowngrade(company.owner_id, company.owner_role, newPlanId);
    if (!requested.ok) return { ok: false, error: requested.error, code: requested.code };
    const confirmed = await confirmDowngrade(company.owner_id, company.owner_role, requested.data.requestId);
    if (!confirmed.ok) return { ok: false, error: confirmed.error };
    const body =
      `Your ScaleBridge membership was adjusted under an approved account exception. ` +
      `Please review the updated plan, billing information, and effective date in your account.`;
    await asUser(admin.id, "sb_admin", (tx) => [
      auditQuery(tx, admin.id, "billing.admin.downgrade.immediate", {
        companyId,
        subscriptionId: sub.id,
        previousPlan: current?.name ?? null,
        newPlan: target.name,
        newPlanId: target.id,
        overrideId,
        reason: opts.reason,
        financialTreatment: opts.financialTreatment,
        effectiveDate: opts.effectiveDate,
        approvingAdmin: admin.id,
        notificationStatus: "sent",
      }),
      notifyQuery(tx, company.owner_id, "membership", "Account exception applied", body),
    ].filter((q): q is TxQuery => q !== null));
    return { ok: true, message: `Immediate downgrade to ${target.name} applied under senior authorisation.`, overrideId };
  } catch (err) {
    console.error("doAdminImmediateDowngrade failed:", err);
    return { ok: false, error: "Could not apply the immediate downgrade." };
  }
}

/** Commitment override only (no plan change) - senior authorised. */
export async function doAdminCommitmentOverride(
  admin: AdminActor,
  companyId: string,
  opts: {
    reason: string;
    clientRequestNote?: string;
    financialTreatment: string;
    effectiveDate: string;
  },
): Promise<AdminBillingActionResult> {
  const gate = requireSuperAdmin(admin);
  if (gate) return { ok: false, error: gate, code: "SENIOR_REQUIRED" };
  if (!opts.reason || !opts.financialTreatment || !opts.effectiveDate) {
    return { ok: false, error: "Reason, financial treatment and effective date are required." };
  }
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED" };
  try {
    await ensureSchema();
    const company = await loadCompanyAndOwner(admin.id, companyId);
    if (!company) return { ok: false, error: "Company not found." };
    const sub = await loadCompanySubscription(admin.id, companyId);
    if (!sub) return { ok: false, error: "No subscription for this company." };
    const overrideId = randomUUID();
    await asUser(admin.id, "sb_admin", (tx) => [
      tx`insert into commitment_overrides
           (id, subscription_id, company_id, requested_by, senior_admin_user_id,
            reason, client_request_note, financial_treatment, effective_date, status)
         values (${overrideId}, ${sub.id}, ${companyId}, ${admin.id}, ${admin.id},
                 ${opts.reason}, ${opts.clientRequestNote ?? null}, ${opts.financialTreatment},
                 ${new Date(opts.effectiveDate)}, 'active')`,
      auditQuery(tx, admin.id, "billing.admin.commitment_override.created", {
        companyId,
        subscriptionId: sub.id,
        overrideId,
        reason: opts.reason,
        clientRequestNote: opts.clientRequestNote ?? null,
        financialTreatment: opts.financialTreatment,
        effectiveDate: opts.effectiveDate,
        approvingAdmin: admin.id,
      }),
      notifyQuery(
        tx,
        company.owner_id,
        "membership",
        "Account exception applied",
        "Your ScaleBridge membership was adjusted under an approved account exception. Please review the updated plan, billing information, and effective date in your account.",
      ),
    ].filter((q): q is TxQuery => q !== null));
    return {
      ok: true,
      message: `Commitment override recorded (${opts.reason}). The minimum-commitment lock is waived from ${fmtDate(opts.effectiveDate)}.`,
      overrideId,
      effectiveDate: opts.effectiveDate,
    };
  } catch (err) {
    console.error("doAdminCommitmentOverride failed:", err);
    return { ok: false, error: "Could not record the commitment override." };
  }
}

// --------------------------------------------------------------- cancellation
export async function doAdminCancelSubscription(
  admin: AdminActor,
  companyId: string,
  mode: "end_of_period" | "immediate",
  reason: string,
): Promise<AdminBillingActionResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED" };
  try {
    await ensureSchema();
    const company = await loadCompanyAndOwner(admin.id, companyId);
    if (!company) return { ok: false, error: "Company not found." };
    const sub = await loadCompanySubscription(admin.id, companyId);
    if (!sub) return { ok: false, error: "No subscription for this company." };
    const plan = await loadPlanById(admin.id, sub.plan_id);
    const requested = await requestCancellation(company.owner_id, company.owner_role, mode, reason);
    if (!requested.ok) {
      return { ok: false, error: requested.error, code: requested.code, eligibleDate: requested.extra && requested.extra.eligibleDate != null ? String(requested.extra.eligibleDate) : undefined };
    }
    const confirmed = await confirmCancellation(company.owner_id, company.owner_role, requested.data.requestId);
    if (!confirmed.ok) return { ok: false, error: confirmed.error };
    const body =
      mode === "immediate"
        ? "Your ScaleBridge membership has been cancelled effective immediately. Your access has ended."
        : `Your ScaleBridge membership cancellation is scheduled for ${fmtDate(confirmed.data.effectiveDate)}. Your access continues until that date.`;
    await asUser(admin.id, "sb_admin", (tx) => [
      auditQuery(tx, admin.id, "billing.admin.cancellation", {
        companyId,
        subscriptionId: sub.id,
        plan: plan?.name ?? null,
        mode,
        effectiveDate: confirmed.data.effectiveDate,
        reason,
        notificationStatus: "sent",
      }),
      notifyQuery(tx, company.owner_id, "membership", mode === "immediate" ? "Membership cancelled" : "Cancellation scheduled", body),
    ].filter((q): q is TxQuery => q !== null));
    return {
      ok: true,
      message: mode === "immediate"
        ? "Subscription cancelled immediately."
        : `Cancellation scheduled for ${fmtDate(confirmed.data.effectiveDate)}.`,
      effectiveDate: confirmed.data.effectiveDate,
      requestId: requested.data.requestId,
    };
  } catch (err) {
    console.error("doAdminCancelSubscription failed:", err);
    return { ok: false, error: "Could not cancel the subscription." };
  }
}
