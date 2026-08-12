/**
 * ScaleBridge subscription & membership system — core logic (server-only).
 *
 * Owner CTO spec delivered 2026-08-12 (/home/team/shared/subscription-flow-spec.md).
 * This module is the BACKEND FOUNDATION: plans/entitlements, customers,
 * subscriptions, the 13 spec statuses, the three-month minimum commitment,
 * upgrade / downgrade / cancellation rules, billing cycles, invoices,
 * subscription history, feature access + entitlement audit logs, and a
 * pluggable billing provider (sandbox implemented; Stripe slot documented).
 *
 * ARCHITECTURE RULE (spec §6): the internal subscription status is NEVER
 * mutated from the frontend response. Every state change is applied by
 * `handleProviderWebhook()`, which first records the raw provider event into
 * `billing_provider_webhook_events` and then derives the state change from
 * that event. The sandbox provider "emits" an event object; the Stripe
 * provider will deliver events to an HTTP endpoint that feeds the same
 * handler. Webhooks are the source of truth.
 *
 * RLS: every read/write runs through asUser(actorId, role, ...) so the
 * app.user_id / app.role transaction-local settings drive the policies
 * defined in schema.ts (customer-owned rows; sb_admin manages all). Public
 * plan reads (listPublishedPlans) run through asService() against the
 * `to scalebridge_app` public policies.
 *
 * Money: AED, stored as numeric(12,2) in whole dirhams; this module works in
 * integers and rounds proration to whole dirhams.
 *
 * IMPORTANT (TanStack Start constraint): this module is the server-only core.
 * The client-safe wrapper is ./billing.ts — never import this module from a
 * client component.
 */
import { randomUUID } from "node:crypto";
import { asService, asUser, dbConfigured, ensureSchema } from "./db";
import type { Tx, TxQuery } from "./db";
import { auditQuery } from "./audit";
import { loadSessionUser } from "./auth-core";

// ------------------------------------------------------------- shared types
export type BillingInterval = "monthly" | "annual";
export type SandboxSimulation = "success" | "failure";

/** The 13 spec §6 statuses (snake_case storage; display names derived). */
export type SubscriptionStatus =
  | "pending_plan_selection"
  | "checkout_started"
  | "payment_pending"
  | "active"
  | "past_due"
  | "payment_failed"
  | "upgrade_pending"
  | "downgrade_scheduled"
  | "cancellation_requested"
  | "cancel_at_period_end"
  | "cancelled"
  | "expired"
  | "suspended";

export const SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
  "pending_plan_selection",
  "checkout_started",
  "payment_pending",
  "active",
  "past_due",
  "payment_failed",
  "upgrade_pending",
  "downgrade_scheduled",
  "cancellation_requested",
  "cancel_at_period_end",
  "cancelled",
  "expired",
  "suspended",
];

export const STATUS_DISPLAY: Record<SubscriptionStatus, string> = {
  pending_plan_selection: "Pending Plan Selection",
  checkout_started: "Checkout Started",
  payment_pending: "Payment Pending",
  active: "Active",
  past_due: "Past Due",
  payment_failed: "Payment Failed",
  upgrade_pending: "Upgrade Pending",
  downgrade_scheduled: "Downgrade Scheduled",
  cancellation_requested: "Cancellation Requested",
  cancel_at_period_end: "Cancel at Period End",
  cancelled: "Cancelled",
  expired: "Expired",
  suspended: "Suspended",
};

/** Spec §7 entitlement keys — feature checks must use these, never plan names. */
export const ENTITLEMENT_KEYS = [
  "basic_profile",
  "verified_profile",
  "directory_visibility",
  "opportunity_access",
  "contract_invitations",
  "contract_participation",
  "team_members",
  "document_storage",
  "work_packages",
  "tasks_and_milestones",
  "client_portal",
  "bid_workspace",
  "pricing_comparison",
  "approvals",
  "variations",
  "invoice_tracking",
  "performance_reports",
  "ai_partnership_intelligence",
  "priority_support",
  "private_partner_network",
  "api_access",
] as const;

// ------------------------------------------------------------- date helpers
function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d;
}

/** One billing period ahead (period_end is the exclusive next-billing date). */
export function addInterval(date: Date, interval: BillingInterval): Date {
  return interval === "monthly" ? addMonths(date, 1) : addMonths(date, 12);
}

/** Spec example: monthly from 12 Aug -> commitment end 12 Nov (+3 cycles). */
export function commitmentEnd(start: Date, interval: BillingInterval): Date {
  return interval === "monthly" ? addMonths(start, 3) : addMonths(start, 36);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const roundAel = (n: number): number => Math.round(n);

// ------------------------------------------------------------ provider layer
/**
 * A billing-provider event, normalized for `handleProviderWebhook`. Real
 * providers (Stripe) deliver the same shape from their webhook endpoint; the
 * sandbox constructs it from simulated payment results.
 */
export type ProviderWebhookEvent = {
  provider: string;
  eventId: string;
  /** checkout.completed | invoice.payment_succeeded | invoice.payment_failed |
   *  subscription.canceled | subscription.expired | subscription.updated */
  eventType: string;
  payload: Record<string, unknown>;
};

/**
 * Billing provider abstraction. The sandbox is implemented and fully
 * testable end-to-end; Stripe slots in by implementing this interface with
 * the owner's own keys (business secrets — never committed).
 */
export interface BillingProvider {
  readonly name: string;
  createPaymentIntent(input: {
    amountAel: number;
    customerId: string;
    subscriptionId: string;
    planId: string | null;
    billingInterval: BillingInterval;
    metadata?: Record<string, unknown>;
  }): Promise<{ providerPaymentIntentId: string }>;
  /**
   * Sandbox: `simulate` "failure" to exercise the Payment_Failed recovery
   * flow. Returns the normalized webhook event to feed handleProviderWebhook
   * (or null when the payment is still pending). Stripe would instead emit
   * events asynchronously to the webhook endpoint.
   */
  confirmPayment(input: {
    providerPaymentIntentId: string;
    amountAel: number;
    subscriptionId: string;
    planId: string | null;
    billingInterval: BillingInterval;
    simulate?: SandboxSimulation;
    eventType?: string;
    upgradeRequestId?: string;
    previousPlanId?: string | null;
    prorationAmountAel?: number;
  }): Promise<{ succeeded: boolean; event: ProviderWebhookEvent | null }>;
}

export const sandboxProvider: BillingProvider = {
  name: "sandbox",
  async createPaymentIntent({ amountAel, subscriptionId }) {
    return {
      providerPaymentIntentId: `sandbox_pi_${randomUUID().slice(0, 8)}_${amountAel}_${subscriptionId.slice(0, 8)}`,
    };
  },
  async confirmPayment(input) {
    const evtBase = `sandbox_evt_${randomUUID().slice(0, 12)}`;
    if (input.simulate === "failure") {
      return {
        succeeded: false,
        event: {
          provider: "sandbox",
          eventId: `${evtBase}_failed`,
          eventType: input.eventType === "checkout.completed" ? "invoice.payment_failed" : "invoice.payment_failed",
          payload: {
            subscriptionId: input.subscriptionId,
            planId: input.planId,
            billingInterval: input.billingInterval,
            amountAel: input.amountAel,
            failureCode: "card_declined",
            upgradeRequestId: input.upgradeRequestId ?? null,
            previousPlanId: input.previousPlanId ?? null,
            prorationAmountAel: input.prorationAmountAel ?? 0,
          },
        },
      };
    }
    return {
      succeeded: true,
      event: {
        provider: "sandbox",
        eventId: evtBase,
        eventType: input.eventType ?? "checkout.completed",
        payload: {
          subscriptionId: input.subscriptionId,
          planId: input.planId,
          billingInterval: input.billingInterval,
          amountAel: input.amountAel,
          upgradeRequestId: input.upgradeRequestId ?? null,
          previousPlanId: input.previousPlanId ?? null,
          prorationAmountAel: input.prorationAmountAel ?? 0,
        },
      },
    };
  },
};

/**
 * Stripe slot — NOT implemented: Stripe keys do not exist yet and must come
 * from the owner's own account as business secrets (env vars). When wired:
 * implement createPaymentIntent/confirmPayment against the Stripe API and add
 * an HTTP route that verifies the webhook signature, normalizes the event to
 * ProviderWebhookEvent, and calls handleProviderWebhook with an admin actor.
 */
export const stripeProvider: BillingProvider = {
  name: "stripe",
  async createPaymentIntent() {
    throw new Error(
      "Stripe billing provider is not configured. The owner will connect their own Stripe account (keys as business secrets).",
    );
  },
  async confirmPayment() {
    throw new Error("Stripe billing provider is not configured.");
  },
};

export function getBillingProvider(name?: string): BillingProvider {
  return name === "stripe" ? stripeProvider : sandboxProvider;
}

// --------------------------------------------------------------- result types
export type PlanPublic = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: "partner" | "anchor";
  priceMonthlyAel: number | null;
  priceAnnualAel: number | null;
  billingIntervals: BillingInterval[];
  sortOrder: number;
  status: "Active" | "Archived";
  features: string[];
  entitlements: { key: string; value: EntitlementValue }[];
};

/** Serializable structured payload attached to a failure (UI hints: dates, amounts). */
export type ResultExtra = Record<string, string | number | boolean | null>;
/** Serializable jsonb value carried inside plan entitlements (server-fn safe). */
export type EntitlementValue = Record<string, string | number | boolean | null>;
/** Serializable jsonb details payload on history rows (server-fn safe). */
export type JsonDetails = Record<string, string | number | boolean | null>;

export type Result<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string; extra?: ResultExtra };

type PlanRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: "partner" | "anchor";
  price_monthly_ael: string | number | null;
  price_annual_ael: string | number | null;
  billing_intervals: BillingInterval[];
  sort_order: number;
  status: "Active" | "Archived";
};
type EntitlementRow = { plan_id: string; entitlement_key: string; value: unknown };
type FeatureRow = { plan_id: string; feature: string };
type SubscriptionRow = {
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
  updated_at: Date;
};
type CustomerRow = { id: string; user_id: string; company_id: string | null; provider_customer_id: string | null };
type CommitmentRow = {
  id: string;
  subscription_id: string;
  commitment_start_date: Date;
  commitment_end_date: Date;
  cycles_required: number;
  completed: boolean;
  completed_at: Date | null;
};

const num = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

const str = (v: unknown): string => String(v);

// ---------------------------------------------------------------- plan reads
/** Public pricing-window read — Active plans + features + entitlements. */
export async function listPublishedPlans(): Promise<Result<PlanPublic[]>> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", code: "SETUP_REQUIRED" };
  try {
    await ensureSchema();
    const [plans, ents, feats] = (await asService((tx) => [
      tx`select id, code, name, description, category, price_monthly_ael,
                price_annual_ael, billing_intervals, sort_order, status
           from membership_plans
          where status = 'Active'
          order by sort_order, name`,
      tx`select e.plan_id as plan_id, e.entitlement_key as entitlement_key, e.value as value
           from plan_entitlements e
           join membership_plans p on p.id = e.plan_id
          where p.status = 'Active'`,
      tx`select f.plan_id as plan_id, f.feature as feature
           from plan_features f
           join membership_plans p on p.id = f.plan_id
          where p.status = 'Active'
          order by f.plan_id, f.sort_order, f.feature`,
    ])) as unknown as [PlanRow[], EntitlementRow[], FeatureRow[]];
    const entByPlan = new Map<string, { key: string; value: EntitlementValue }[]>();
    for (const e of ents) {
      const list = entByPlan.get(e.plan_id) ?? [];
      list.push({
        key: e.entitlement_key,
        value: (e.value ?? { enabled: true }) as EntitlementValue,
      });
      entByPlan.set(e.plan_id, list);
    }
    const featByPlan = new Map<string, string[]>();
    for (const f of feats) {
      const list = featByPlan.get(f.plan_id) ?? [];
      list.push(f.feature);
      featByPlan.set(f.plan_id, list);
    }
    return {
      ok: true,
      data: plans.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        description: p.description,
        category: p.category,
        priceMonthlyAel: num(p.price_monthly_ael),
        priceAnnualAel: num(p.price_annual_ael),
        billingIntervals: p.billing_intervals ?? ["monthly"],
        sortOrder: p.sort_order,
        status: p.status,
        features: featByPlan.get(p.id) ?? [],
        entitlements: entByPlan.get(p.id) ?? [],
      })),
    };
  } catch (err) {
    console.error("listPublishedPlans failed:", err);
    return { ok: false, error: "Could not load membership plans." };
  }
}


// -------------------------------------------------------------- customers
/** Find (or create) the customer record for a user (+ optional company). */
export async function getOrCreateCustomer(
  actorId: string,
  role: string,
  companyId?: string | null,
): Promise<{ id: string } | { error: string }> {
  if (!dbConfigured()) return { error: "SETUP_REQUIRED" };
  await ensureSchema();
  try {
    const existing = (await asUser(actorId, role, (tx) => [
      tx`select id from customers where user_id = ${actorId}
           and company_id is not distinct from ${companyId ?? null}
         limit 1`,
    ]))[1] as { id: string }[];
    if (existing[0]) return { id: existing[0].id };
    const inserted = (await asUser(actorId, role, (tx) => [
      tx`insert into customers (id, user_id, company_id)
         values (${randomUUID()}, ${actorId}, ${companyId ?? null})
         returning id`,
    ]))[1] as { id: string }[];
    if (inserted[0]) return { id: inserted[0].id };
    return { error: "Could not create customer record." };
  } catch (err) {
    // A concurrent create could race on the unique (user_id, company_id);
    // re-read rather than failing.
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "23505") {
      const existing = (await asUser(actorId, role, (tx) => [
        tx`select id from customers where user_id = ${actorId}
             and company_id is not distinct from ${companyId ?? null}
           limit 1`,
      ]))[1] as { id: string }[];
      if (existing[0]) return { id: existing[0].id };
    }
    console.error("getOrCreateCustomer failed:", err);
    return { error: "Could not create customer record." };
  }
}

// ------------------------------------------------------------- subscriptions
async function loadSubscription(
  actorId: string,
  role: string,
  subscriptionId: string,
): Promise<SubscriptionRow | null> {
  const rows = (await asUser(actorId, role, (tx) => [
    tx`select id, customer_id, plan_id, provider_subscription_id, status,
              billing_interval, current_period_start, current_period_end,
              next_billing_date, started_at, cancelled_at, created_at, updated_at
         from subscriptions where id = ${subscriptionId}`,
  ]))[1] as SubscriptionRow[];
  return rows[0] ?? null;
}

async function loadCustomer(
  actorId: string,
  role: string,
  customerId: string,
): Promise<CustomerRow | null> {
  const rows = (await asUser(actorId, role, (tx) => [
    tx`select id, user_id, company_id, provider_customer_id from customers where id = ${customerId}`,
  ]))[1] as CustomerRow[];
  return rows[0] ?? null;
}

async function loadPlan(
  actorId: string,
  role: string,
  planId: string | null,
): Promise<PlanRow | null> {
  if (!planId) return null;
  const rows = (await asUser(actorId, role, (tx) => [
    tx`select id, code, name, description, category, price_monthly_ael,
              price_annual_ael, billing_intervals, sort_order, status
         from membership_plans where id = ${planId}`,
  ]))[1] as PlanRow[];
  return rows[0] ?? null;
}

async function loadLatestCommitment(
  actorId: string,
  role: string,
  subscriptionId: string,
): Promise<CommitmentRow | null> {
  const rows = (await asUser(actorId, role, (tx) => [
    tx`select id, subscription_id, commitment_start_date, commitment_end_date,
              cycles_required, completed, completed_at
         from minimum_commitments
        where subscription_id = ${subscriptionId}
        order by commitment_start_date desc
        limit 1`,
  ]))[1] as CommitmentRow[];
  return rows[0] ?? null;
}

/**
 * The user's subscription for their own customer record. `companyId` narrows
 * when provided; otherwise the first subscription found for the user.
 */
export async function getActiveSubscription(
  actorId: string,
  role: string,
  companyId?: string | null,
): Promise<{
  subscription: SubscriptionRow | null;
  customer: CustomerRow | null;
  plan: PlanRow | null;
  commitment: CommitmentRow | null;
}> {
  if (!dbConfigured()) return { subscription: null, customer: null, plan: null, commitment: null };
  await ensureSchema();
  const rows = (await asUser(actorId, role, (tx) => [
    tx`select s.id, s.customer_id, s.plan_id, s.provider_subscription_id, s.status,
              s.billing_interval, s.current_period_start, s.current_period_end,
              s.next_billing_date, s.started_at, s.cancelled_at, s.created_at, s.updated_at,
              c.user_id as c_user_id, c.company_id as c_company_id, c.provider_customer_id as c_provider_customer_id
         from subscriptions s
         join customers c on c.id = s.customer_id
        where c.user_id = ${actorId}
          and (${companyId ?? null}::uuid is null or c.company_id = ${companyId ?? null})
        order by s.created_at desc
        limit 1`,
  ]))[1] as unknown as (SubscriptionRow & {
    c_user_id: string;
    c_company_id: string | null;
    c_provider_customer_id: string | null;
  })[];
  const row = rows[0];
  if (!row) return { subscription: null, customer: null, plan: null, commitment: null };
  const subscription: SubscriptionRow = {
    id: row.id,
    customer_id: row.customer_id,
    plan_id: row.plan_id,
    provider_subscription_id: row.provider_subscription_id,
    status: row.status,
    billing_interval: row.billing_interval,
    current_period_start: row.current_period_start,
    current_period_end: row.current_period_end,
    next_billing_date: row.next_billing_date,
    started_at: row.started_at,
    cancelled_at: row.cancelled_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  const customer: CustomerRow = {
    id: row.customer_id,
    user_id: row.c_user_id,
    company_id: row.c_company_id,
    provider_customer_id: row.c_provider_customer_id,
  };
  const plan = await loadPlan(actorId, role, subscription.plan_id);
  const commitment = await loadLatestCommitment(actorId, role, subscription.id);
  return { subscription, customer, plan, commitment };
}

function planPrice(plan: PlanRow | null, interval: BillingInterval): number {
  if (!plan) return 0;
  const v = interval === "annual" ? plan.price_annual_ael : plan.price_monthly_ael;
  return num(v) ?? 0;
}

// ------------------------------------------------------------ selectPlan
export async function selectPlan(
  actorId: string,
  role: string,
  companyId: string | null | undefined,
  planId: string,
  billingInterval: BillingInterval,
): Promise<Result<{ subscriptionId: string; status: SubscriptionStatus; planId: string }>> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", code: "SETUP_REQUIRED" };
  try {
    await ensureSchema();
    const plan = await loadPlan(actorId, role, planId);
    if (!plan) return { ok: false, error: "Selected plan was not found." };
    if (plan.status !== "Active") return { ok: false, error: "Selected plan is not available." };
    const customer = await getOrCreateCustomer(actorId, role, companyId);
    if ("error" in customer) return { ok: false, error: customer.error };
    const existingRows = (await asUser(actorId, role, (tx) => [
      tx`select id, status from subscriptions where customer_id = ${customer.id} order by created_at desc limit 1`,
    ]))[1] as { id: string; status: SubscriptionStatus }[];
    const existing = existingRows[0] ?? null;
    if (existing) {
      if (existing.status === "active" || existing.status === "cancel_at_period_end") {
        return {
          ok: false,
          error: "You already have an active membership. Use Upgrade from the billing area instead.",
          code: "ALREADY_ACTIVE",
        };
      }
      // Resume/interruptible states: update the pending selection.
      await asUser(actorId, role, (tx) => [
        tx`update subscriptions
              set plan_id = ${planId}, billing_interval = ${billingInterval},
                  status = 'checkout_started', updated_at = now()
            where id = ${existing.id}`,
        tx`delete from subscription_items where subscription_id = ${existing.id}`,
        tx`insert into subscription_items (id, subscription_id, plan_id, quantity, unit_amount, billing_interval)
           values (${randomUUID()}, ${existing.id}, ${planId}, 1, ${planPrice(plan, billingInterval)}, ${billingInterval})`,
        tx`insert into subscription_history
             (id, subscription_id, user_id, previous_plan_id, new_plan_id, change_type,
              effective_date, billing_amount_ael, payment_status, confirmation_status, source_event, details)
           values (${randomUUID()}, ${existing.id}, ${actorId}, ${null}, ${planId}, 'plan_changed',
                   now(), ${planPrice(plan, billingInterval)}, 'pending', 'pending', 'select_plan', ${{
            stage: "plan_selected",
            planCode: plan.code,
          } as never})`,
        auditQuery(tx, actorId, "billing.select_plan", {
          subscriptionId: existing.id,
          planId,
          interval: billingInterval,
        }),
      ]);
      return {
        ok: true,
        data: { subscriptionId: existing.id, status: "checkout_started", planId },
      };
    }
    // First-time selection.
    const subscriptionId = randomUUID();
    await asUser(actorId, role, (tx) => [
      tx`insert into subscriptions
           (id, customer_id, plan_id, provider_subscription_id, status, billing_interval,
            current_period_start, current_period_end, next_billing_date, started_at)
         values (${subscriptionId}, ${customer.id}, ${planId}, ${null}, 'checkout_started', ${billingInterval},
                 ${null}, ${null}, ${null}, ${null})`,
      tx`insert into subscription_items (id, subscription_id, plan_id, quantity, unit_amount, billing_interval)
         values (${randomUUID()}, ${subscriptionId}, ${planId}, 1, ${planPrice(plan, billingInterval)}, ${billingInterval})`,
      tx`insert into subscription_history
           (id, subscription_id, user_id, previous_plan_id, new_plan_id, change_type,
            effective_date, billing_amount_ael, payment_status, confirmation_status, source_event, details)
         values (${randomUUID()}, ${subscriptionId}, ${actorId}, ${null}, ${planId}, 'created',
                 now(), ${planPrice(plan, billingInterval)}, 'pending', 'pending', 'select_plan', ${{
            stage: "plan_selected",
            planCode: plan.code,
          } as never})`,
      auditQuery(tx, actorId, "billing.select_plan", {
        subscriptionId,
        planId,
        interval: billingInterval,
      }),
    ]);
    return { ok: true, data: { subscriptionId, status: "checkout_started", planId } };
  } catch (err) {
    console.error("selectPlan failed:", err);
    return { ok: false, error: "Could not start checkout." };
  }
}

// ------------------------------------------------------------ webhook core
export type WebhookResult = Result<{ eventId: string; applied: boolean }>;

/**
 * THE source of truth (spec §6). Records the raw provider event into
 * billing_provider_webhook_events and applies the derived subscription state
 * change — never called from the frontend response path; always fed by the
 * provider (sandbox emits; Stripe will POST to an endpoint).
 */
export async function handleProviderWebhook(
  actorId: string,
  role: string,
  event: ProviderWebhookEvent,
): Promise<WebhookResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", code: "SETUP_REQUIRED" };
  try {
    await ensureSchema();
    // Idempotency: skip events already applied.
    const knownRows = (await asUser(actorId, role, (tx) => [
      tx`select id, processed from billing_provider_webhook_events where event_id = ${event.eventId}`,
    ]))[1] as { id: string; processed: boolean }[];
    if (knownRows[0]?.processed) return { ok: true, data: { eventId: event.eventId, applied: false } };

    const subId = (event.payload.subscriptionId as string) ?? "";
    const planId = (event.payload.planId as string) ?? null;
    const interval = (event.payload.billingInterval as BillingInterval) ?? "monthly";
    const amount = num(event.payload.amountAel as string | number) ?? 0;

    switch (event.eventType) {
      case "checkout.completed": {
        const sub = subId ? await loadSubscription(actorId, role, subId) : null;
        if (!sub) return { ok: false, error: "Subscription not found for checkout.completed." };
        const upgradeRequestId = (event.payload.upgradeRequestId as string) ?? null;
        await applyCheckoutCompleted(actorId, role, event, sub, planId, interval, amount, upgradeRequestId);
        break;
      }
      case "invoice.payment_succeeded": {
        await applyInvoicePaymentSucceeded(actorId, role, event, subId, amount);
        break;
      }
      case "invoice.payment_failed": {
        await applyInvoicePaymentFailed(actorId, role, event, subId, amount, planId, interval);
        break;
      }
      case "subscription.canceled": {
        await applySubscriptionCancelled(actorId, role, event, subId, planId);
        break;
      }
      case "subscription.expired": {
        await applySubscriptionExpired(actorId, role, event, subId);
        break;
      }
      case "subscription.updated": {
        await applySubscriptionUpdated(actorId, role, event, subId, planId, interval);
        break;
      }
      default:
        return { ok: false, error: `Unhandled provider event type: ${event.eventType}` };
    }
    return { ok: true, data: { eventId: event.eventId, applied: true } };
  } catch (err) {
    console.error("handleProviderWebhook failed:", err);
    return { ok: false, error: "Webhook processing failed." };
  }
}

/** Insert the webhook event row + mark processed (one statement each). */
function webhookQueries(
  tx: Tx,
  event: ProviderWebhookEvent,
  processed: boolean,
  processingError?: string,
) {
  return [
    tx`insert into billing_provider_webhook_events (id, provider, event_type, event_id, payload, received_at, processed, processed_at, processing_error)
       values (${randomUUID()}, ${event.provider}, ${event.eventType}, ${event.eventId}, ${event.payload as never}, now(), ${processed}, ${processed ? new Date() : null}, ${processingError ?? null})
       on conflict (event_id) do update
         set processed = excluded.processed,
             processed_at = excluded.processed_at,
             processing_error = excluded.processing_error`,
  ];
}

/** Grant a plan's entitlements to the company + audit each grant. */
function grantEntitlementsQueries(
  tx: Tx,
  actorId: string,
  companyId: string | null,
  subscriptionId: string,
  planId: string,
  reason: string,
  effectiveFrom: Date,
) {
  const qs: TxQuery[] = [];
  // Revoke anything currently granted for this subscription (idempotent swap).
  qs.push(
    tx`update feature_access_records
          set granted = false, effective_to = ${effectiveFrom}
        where subscription_id = ${subscriptionId} and granted = true`,
  );
  qs.push(
    tx`insert into feature_access_records (id, company_id, subscription_id, entitlement_key, granted, effective_from, effective_to)
       select ${randomUUID()}, ${companyId}, ${subscriptionId}, e.entitlement_key, true, ${effectiveFrom}, null
         from plan_entitlements e
        where e.plan_id = ${planId}
       on conflict do nothing`,
  );
  qs.push(
    tx`insert into entitlement_audit_logs (id, company_id, subscription_id, actor_user_id, action, entitlement_key, previous_value, new_value, reason)
       select ${randomUUID()}, ${companyId}, ${subscriptionId}, ${actorId}, 'granted', e.entitlement_key, null, e.value, ${reason}
         from plan_entitlements e
        where e.plan_id = ${planId}`,
  );
  return qs;
}

/** Revoke all granted entitlements for a subscription + audit each revoke.
 *  NOTE: the audit insert...select MUST come before the update in the batch —
 *  postgres.js executes tx queries in array order, so the audit reads the
 *  granted rows before they flip to false. */
function revokeEntitlementsQueries(
  tx: Tx,
  actorId: string,
  companyId: string | null,
  subscriptionId: string,
  reason: string,
  effective: Date,
) {
  return [
    tx`insert into entitlement_audit_logs (id, company_id, subscription_id, actor_user_id, action, entitlement_key, previous_value, new_value, reason)
       select ${randomUUID()}, ${companyId}, ${subscriptionId}, ${actorId}, 'revoked', f.entitlement_key, null, null, ${reason}
         from feature_access_records f
        where f.subscription_id = ${subscriptionId} and f.granted = true`,
    tx`update feature_access_records
          set granted = false, effective_to = ${effective}
        where subscription_id = ${subscriptionId} and granted = true`,
  ];
}

/** Initial activation or upgrade application driven by checkout.completed. */
async function applyCheckoutCompleted(
  actorId: string,
  role: string,
  event: ProviderWebhookEvent,
  sub: SubscriptionRow,
  planId: string | null,
  interval: BillingInterval,
  amount: number,
  upgradeRequestId: string | null,
): Promise<void> {
  if (!planId) throw new Error("checkout.completed without planId");
  const customer = await loadCustomer(actorId, role, sub.customer_id);
  const companyId = customer?.company_id ?? null;
  const now = new Date();
  const prevPlanId = (event.payload.previousPlanId as string) ?? null;
  let previousPlanId: string | null = prevPlanId;
  let upgradeRequest: { id: string; from_plan_id: string | null; to_plan_id: string } | null = null;
  if (upgradeRequestId) {
    const rows = (await asUser(actorId, role, (tx) => [
      tx`select id, from_plan_id, to_plan_id from upgrade_requests
          where id = ${upgradeRequestId} and status = 'Confirmed'`,
    ]))[1] as { id: string; from_plan_id: string | null; to_plan_id: string }[];
    upgradeRequest = rows[0] ?? null;
    if (upgradeRequest) previousPlanId = upgradeRequest.from_plan_id;
  }
  const isUpgrade = Boolean(upgradeRequest) || Boolean(sub.started_at);
  const plan = await loadPlan(actorId, role, planId);
  const planPriceValue = planPrice(plan, interval);
  const periodStart = sub.current_period_start ?? now;
  const periodEnd = sub.current_period_end ?? addInterval(now, interval);
  const commitEnd = commitmentEnd(now, interval);
  const invoiceId = randomUUID();
  const cycleId = randomUUID();
  const commitmentId = randomUUID();
  await asUser(actorId, role, (tx) => {
    const qs: TxQuery[] = [];
    qs.push(
      tx`update subscriptions
            set plan_id = ${planId}, status = 'active', billing_interval = ${interval},
                current_period_start = ${periodStart}, current_period_end = ${periodEnd},
                next_billing_date = ${periodEnd}, started_at = ${sub.started_at ?? now},
                cancelled_at = null, updated_at = now()
          where id = ${sub.id}`,
    );
    qs.push(
      tx`delete from subscription_items where subscription_id = ${sub.id}`,
      tx`insert into subscription_items (id, subscription_id, plan_id, quantity, unit_amount, billing_interval)
         values (${randomUUID()}, ${sub.id}, ${planId}, 1, ${planPriceValue}, ${interval})`,
    );
    // Initial activation: first billing cycle + full-price invoice. Upgrade:
    // proration invoice only (cycle #1 stays untouched; next full invoice at
    // the current period end).
    if (!isUpgrade) {
      qs.push(
        tx`insert into billing_cycles (id, subscription_id, cycle_number, period_start, period_end, status, amount_ael, paid_at)
           values (${cycleId}, ${sub.id}, 1, ${periodStart}, ${periodEnd}, 'Paid', ${amount}, ${now})`,
      );
    }
    qs.push(
      tx`insert into subscription_invoices (id, customer_id, subscription_id, invoice_number, amount_ael, tax_ael, total_ael, status, billing_period_start, billing_period_end, due_date, paid_at, provider_invoice_id)
         values (${invoiceId}, ${sub.customer_id}, ${sub.id}, ${`SB-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`}, ${amount}, 0, ${amount}, 'Paid', ${periodStart}, ${periodEnd}, ${periodEnd}, ${now}, ${event.eventId})`,
    );
    qs.push(
      tx`insert into payment_events (id, invoice_id, event_type, amount_ael, provider_event_id, occurred_at, raw)
         values (${randomUUID()}, ${invoiceId}, 'payment_succeeded', ${amount}, ${event.eventId}, ${now}, ${event.payload as never})`,
    );
    // Minimum commitment: one per plan start. A new commitment begins on every
    // activation (upgrade starts a fresh 3-cycle commitment — spec §4).
    qs.push(
      tx`insert into minimum_commitments (id, subscription_id, commitment_start_date, commitment_end_date, cycles_required, completed, completed_at)
         values (${commitmentId}, ${sub.id}, ${now}, ${commitEnd}, 3, false, null)
         on conflict (subscription_id, commitment_start_date) do nothing`,
    );
    // Entitlements: revoke old plan grants, grant the new plan's.
    if (isUpgrade && previousPlanId) {
      qs.push(...revokeEntitlementsQueries(tx, actorId, companyId, sub.id, "plan_upgrade", now));
    }
    qs.push(...grantEntitlementsQueries(tx, actorId, companyId, sub.id, planId, isUpgrade ? "plan_upgrade" : "plan_activation", now));
    if (upgradeRequest) {
      qs.push(
        tx`update upgrade_requests
              set status = 'Completed', processed_at = now(), resolution_notes = 'Payment succeeded; upgrade applied.'
            where id = ${upgradeRequest.id}`,
      );
    }
    // History: every change records company (via subscription), actor,
    // previous/new plan, change type, effective date, billing + proration
    // amounts, min commitment date, payment + confirmation status, event.
    qs.push(
      tx`insert into subscription_history
           (id, subscription_id, user_id, previous_plan_id, new_plan_id, change_type,
            effective_date, billing_amount_ael, proration_amount_ael, min_commitment_end_date,
            payment_status, confirmation_status, source_event, details)
         values (${randomUUID()}, ${sub.id}, ${actorId}, ${previousPlanId ?? sub.plan_id ?? null}, ${planId},
                 ${isUpgrade ? "upgraded" : "created"}, ${now}, ${planPriceValue},
                 ${isUpgrade ? (num(event.payload.prorationAmountAel as string | number) ?? 0) : null},
                 ${commitEnd}, 'paid', 'confirmed', ${event.eventId}, ${{
            stage: isUpgrade ? "upgrade_applied" : "activated",
            provider: event.provider,
            upgradeRequestId: upgradeRequest?.id ?? null,
          } as never})`,
    );
    qs.push(
      auditQuery(tx, actorId, isUpgrade ? "billing.subscription.upgraded" : "billing.subscription.activated", {
        subscriptionId: sub.id,
        planId,
        interval,
        amountAel: amount,
        minCommitmentEnd: str(commitEnd),
        sourceEvent: event.eventId,
      }),
    );
    qs.push(...webhookQueries(tx, event, true));
    return qs;
  });
}

/** Renewal invoice paid (next billing cycle started). */
async function applyInvoicePaymentSucceeded(
  actorId: string,
  role: string,
  event: ProviderWebhookEvent,
  subId: string,
  amount: number,
): Promise<void> {
  const sub = subId ? await loadSubscription(actorId, role, subId) : null;
  if (!sub) throw new Error("Subscription not found for invoice.payment_succeeded.");
  const now = new Date();
  const periodStart = sub.next_billing_date ?? now;
  const periodEnd = addInterval(periodStart, sub.billing_interval);
  const invoiceId = randomUUID();
  const cycleRows = (await asUser(actorId, role, (tx) => [
    tx`select coalesce(max(cycle_number), 0)::int as n from billing_cycles where subscription_id = ${sub.id}`,
  ]))[1] as { n: number }[];
  const cycleNumber = cycleRows[0].n + 1;
  await asUser(actorId, role, (tx) => {
    const qs: TxQuery[] = [];
    qs.push(
      tx`update subscriptions
            set status = 'active', current_period_start = ${periodStart}, current_period_end = ${periodEnd},
                next_billing_date = ${periodEnd}, updated_at = now()
          where id = ${sub.id}`,
    );
    qs.push(
      tx`insert into billing_cycles (id, subscription_id, cycle_number, period_start, period_end, status, amount_ael, paid_at)
         values (${randomUUID()}, ${sub.id}, ${cycleNumber}, ${periodStart}, ${periodEnd}, 'Paid', ${amount}, ${now})`,
    );
    qs.push(
      tx`insert into subscription_invoices (id, customer_id, subscription_id, invoice_number, amount_ael, tax_ael, total_ael, status, billing_period_start, billing_period_end, due_date, paid_at, provider_invoice_id)
         values (${invoiceId}, ${sub.customer_id}, ${sub.id}, ${`SB-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`}, ${amount}, 0, ${amount}, 'Paid', ${periodStart}, ${periodEnd}, ${periodEnd}, ${now}, ${event.eventId})`,
    );
    qs.push(
      tx`insert into payment_events (id, invoice_id, event_type, amount_ael, provider_event_id, occurred_at, raw)
         values (${randomUUID()}, ${invoiceId}, 'payment_succeeded', ${amount}, ${event.eventId}, ${now}, ${event.payload as never})`,
    );
    qs.push(
      tx`insert into subscription_history
           (id, subscription_id, user_id, previous_plan_id, new_plan_id, change_type,
            effective_date, billing_amount_ael, min_commitment_end_date, payment_status, confirmation_status, source_event, details)
         values (${randomUUID()}, ${sub.id}, ${actorId}, ${sub.plan_id}, ${sub.plan_id}, 'plan_changed',
                 ${now}, ${amount}, ${null}, 'paid', 'confirmed', ${event.eventId}, ${{
            stage: "renewal",
            cycleNumber,
          } as never})`,
    );
    qs.push(
      auditQuery(tx, actorId, "billing.invoice.paid", {
        subscriptionId: sub.id,
        invoiceId,
        amountAel: amount,
        cycleNumber,
        sourceEvent: event.eventId,
      }),
    );
    qs.push(...webhookQueries(tx, event, true));
    return qs;
  });
}

/** Failed payment — Payment_Failed recovery state; no access change. */
async function applyInvoicePaymentFailed(
  actorId: string,
  role: string,
  event: ProviderWebhookEvent,
  subId: string,
  amount: number,
  planId: string | null,
  _interval: BillingInterval,
): Promise<void> {
  const sub = subId ? await loadSubscription(actorId, role, subId) : null;
  if (!sub) throw new Error("Subscription not found for invoice.payment_failed.");
  const invRows = (await asUser(actorId, role, (tx) => [
    tx`select id from subscription_invoices where subscription_id = ${sub.id} order by created_at desc limit 1`,
  ]))[1] as { id: string }[];
  const invoiceId = invRows[0]?.id ?? null;
  await asUser(actorId, role, (tx) => {
    const qs: TxQuery[] = [];
    qs.push(
      tx`update subscriptions
            set status = 'payment_failed', updated_at = now()
          where id = ${sub.id}`,
    );
    if (invoiceId) {
      qs.push(tx`update subscription_invoices set status = 'Failed' where id = ${invoiceId}`);
    }
    qs.push(
      tx`insert into payment_events (id, invoice_id, event_type, amount_ael, provider_event_id, occurred_at, raw)
         values (${randomUUID()}, ${invoiceId}, 'payment_failed', ${amount}, ${event.eventId}, now(), ${event.payload as never})`,
    );
    qs.push(
      tx`insert into subscription_history
           (id, subscription_id, user_id, previous_plan_id, new_plan_id, change_type,
            effective_date, billing_amount_ael, payment_status, confirmation_status, source_event, details)
         values (${randomUUID()}, ${sub.id}, ${actorId}, ${sub.plan_id}, ${planId ?? sub.plan_id}, 'plan_changed',
                 now(), ${amount}, 'failed', 'pending', ${event.eventId}, ${{
            stage: "checkout_failed",
            failureCode: (event.payload.failureCode as string) ?? null,
          } as never})`,
    );
    qs.push(
      auditQuery(tx, actorId, "billing.payment_failed", {
        subscriptionId: sub.id,
        amountAel: amount,
        sourceEvent: event.eventId,
      }),
    );
    qs.push(...webhookQueries(tx, event, true));
    return qs;
  });
}

/** Provider canceled the subscription (immediate or after period end). */
async function applySubscriptionCancelled(
  actorId: string,
  role: string,
  event: ProviderWebhookEvent,
  subId: string,
  planId: string | null,
): Promise<void> {
  const sub = subId ? await loadSubscription(actorId, role, subId) : null;
  if (!sub) throw new Error("Subscription not found for subscription.canceled.");
  const customer = await loadCustomer(actorId, role, sub.customer_id);
  const now = new Date();
  const reqRows = (await asUser(actorId, role, (tx) => [
    tx`select id from cancellation_requests
        where subscription_id = ${sub.id} and status in ('Confirmed','Completed')
        order by requested_at desc limit 1`,
  ]))[1] as { id: string }[];
  const requestId = reqRows[0]?.id ?? null;
  await asUser(actorId, role, (tx) => {
    const qs: TxQuery[] = [];
    qs.push(
      tx`update subscriptions
            set status = 'cancelled', cancelled_at = now(), updated_at = now()
          where id = ${sub.id}`,
    );
    qs.push(...revokeEntitlementsQueries(tx, actorId, customer?.company_id ?? null, sub.id, "subscription_cancelled", now));
    if (requestId) {
      qs.push(
        tx`update cancellation_requests set status = 'Completed', processed_at = now()
           where id = ${requestId}`,
      );
    }
    qs.push(
      tx`insert into subscription_history
           (id, subscription_id, user_id, previous_plan_id, new_plan_id, change_type,
            effective_date, billing_amount_ael, payment_status, confirmation_status, source_event, details)
         values (${randomUUID()}, ${sub.id}, ${actorId}, ${sub.plan_id}, ${planId ?? sub.plan_id}, 'cancelled',
                 ${now}, ${null}, 'paid', 'confirmed', ${event.eventId}, ${{
            stage: "cancelled",
          } as never})`,
    );
    qs.push(
      auditQuery(tx, actorId, "billing.subscription.cancelled", {
        subscriptionId: sub.id,
        sourceEvent: event.eventId,
      }),
    );
    qs.push(...webhookQueries(tx, event, true));
    return qs;
  });
}

/** Subscription expired (no renewal). */
async function applySubscriptionExpired(
  actorId: string,
  role: string,
  event: ProviderWebhookEvent,
  subId: string,
): Promise<void> {
  const sub = subId ? await loadSubscription(actorId, role, subId) : null;
  if (!sub) throw new Error("Subscription not found for subscription.expired.");
  const customer = await loadCustomer(actorId, role, sub.customer_id);
  const now = new Date();
  await asUser(actorId, role, (tx) => {
    const qs: TxQuery[] = [];
    qs.push(
      tx`update subscriptions set status = 'expired', updated_at = now() where id = ${sub.id}`,
    );
    qs.push(...revokeEntitlementsQueries(tx, actorId, customer?.company_id ?? null, sub.id, "subscription_expired", now));
    qs.push(
      tx`insert into subscription_history
           (id, subscription_id, user_id, previous_plan_id, new_plan_id, change_type,
            effective_date, payment_status, confirmation_status, source_event, details)
         values (${randomUUID()}, ${sub.id}, ${actorId}, ${sub.plan_id}, ${sub.plan_id}, 'expired',
                 ${now}, 'unpaid', 'confirmed', ${event.eventId}, ${{
            stage: "expired",
          } as never})`,
    );
    qs.push(
      auditQuery(tx, actorId, "billing.subscription.expired", {
        subscriptionId: sub.id,
        sourceEvent: event.eventId,
      }),
    );
    qs.push(...webhookQueries(tx, event, true));
    return qs;
  });
}

/** Provider plan change (scheduled downgrade at period end, admin changes). */
async function applySubscriptionUpdated(
  actorId: string,
  role: string,
  event: ProviderWebhookEvent,
  subId: string,
  planId: string | null,
  interval: BillingInterval,
): Promise<void> {
  const sub = subId ? await loadSubscription(actorId, role, subId) : null;
  if (!sub) throw new Error("Subscription not found for subscription.updated.");
  const customer = await loadCustomer(actorId, role, sub.customer_id);
  if (!planId) throw new Error("subscription.updated without planId");
  const now = new Date();
  const reqRows = (await asUser(actorId, role, (tx) => [
    tx`select id, to_plan_id from downgrade_requests
        where subscription_id = ${sub.id} and status = 'Confirmed'
        order by requested_at desc limit 1`,
  ]))[1] as { id: string; to_plan_id: string }[];
  const downgradeRequest = reqRows[0] ?? null;
  const isDowngrade = Boolean(downgradeRequest);
  const prevPlanId = sub.plan_id;
  const targetPlan = await loadPlan(actorId, role, planId);
  const targetPrice = planPrice(targetPlan, interval);
  await asUser(actorId, role, (tx) => {
    const qs: TxQuery[] = [];
    qs.push(
      tx`update subscriptions
            set plan_id = ${planId}, status = 'active', billing_interval = ${interval}, updated_at = now()
          where id = ${sub.id}`,
    );
    qs.push(
      tx`delete from subscription_items where subscription_id = ${sub.id}`,
      tx`insert into subscription_items (id, subscription_id, plan_id, quantity, unit_amount, billing_interval)
         values (${randomUUID()}, ${sub.id}, ${planId}, 1, ${targetPrice}, ${interval})`,
    );
    if (downgradeRequest) {
      // Downgrades do NOT restart the minimum commitment (spec §4).
      qs.push(
        tx`update downgrade_requests set status = 'Completed', processed_at = now() where id = ${downgradeRequest.id}`,
      );
    }
    qs.push(...revokeEntitlementsQueries(tx, actorId, customer?.company_id ?? null, sub.id, "plan_downgrade", now));
    qs.push(...grantEntitlementsQueries(tx, actorId, customer?.company_id ?? null, sub.id, planId, isDowngrade ? "plan_downgrade" : "plan_changed", now));
    qs.push(
      tx`insert into subscription_history
           (id, subscription_id, user_id, previous_plan_id, new_plan_id, change_type,
            effective_date, billing_amount_ael, payment_status, confirmation_status, source_event, details)
         values (${randomUUID()}, ${sub.id}, ${actorId}, ${prevPlanId}, ${planId},
                 ${isDowngrade ? "downgraded" : "plan_changed"}, ${now}, ${targetPrice},
                 ${null}, 'paid', 'confirmed', ${event.eventId}, ${{
            stage: isDowngrade ? "downgrade_applied" : "plan_updated",
            downgradeRequestId: downgradeRequest?.id ?? null,
          } as never})`,
    );
    qs.push(
      auditQuery(tx, actorId, isDowngrade ? "billing.subscription.downgraded" : "billing.subscription.plan_updated", {
        subscriptionId: sub.id,
        previousPlanId: prevPlanId,
        newPlanId: planId,
        sourceEvent: event.eventId,
      }),
    );
    qs.push(...webhookQueries(tx, event, true));
    return qs;
  });
}

// ------------------------------------------------------------ completeCheckout
/** Sandbox checkout: Payment_Pending -> provider confirm -> webhook applies. */
export async function completeCheckout(
  actorId: string,
  role: string,
  subscriptionId: string,
  opts?: { simulate?: SandboxSimulation },
): Promise<Result<{ status: SubscriptionStatus; eventId: string; webhookApplied: boolean }>> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", code: "SETUP_REQUIRED" };
  try {
    await ensureSchema();
    const sub = await loadSubscription(actorId, role, subscriptionId);
    if (!sub) return { ok: false, error: "Subscription not found.", code: "NOT_FOUND" };
    if (!["checkout_started", "payment_pending", "payment_failed"].includes(sub.status)) {
      return { ok: false, error: `Cannot checkout a subscription in status '${sub.status}'.` };
    }
    const plan = await loadPlan(actorId, role, sub.plan_id);
    if (!plan) return { ok: false, error: "Subscription has no plan." };
    const amount = planPrice(plan, sub.billing_interval);
    const provider = sandboxProvider;
    const pi = await provider.createPaymentIntent({
      amountAel: amount,
      customerId: sub.customer_id,
      subscriptionId,
      planId: sub.plan_id,
      billingInterval: sub.billing_interval,
    });
    // Payment_Pending is the intermediate state before the provider confirms.
    await asUser(actorId, role, (tx) => [
      tx`update subscriptions set status = 'payment_pending', updated_at = now() where id = ${subscriptionId}`,
      auditQuery(tx, actorId, "billing.checkout.started", { subscriptionId, amountAel: amount }),
    ]);
    const { event } = await provider.confirmPayment({
      providerPaymentIntentId: pi.providerPaymentIntentId,
      amountAel: amount,
      subscriptionId,
      planId: sub.plan_id,
      billingInterval: sub.billing_interval,
      simulate: opts?.simulate,
      eventType: "checkout.completed",
    });
    if (!event) return { ok: false, error: "Payment still pending." };
    const result = await handleProviderWebhook(actorId, role, event);
    if (!result.ok) return result;
    const after = await loadSubscription(actorId, role, subscriptionId);
    return {
      ok: true,
      data: {
        status: after?.status ?? "active",
        eventId: event.eventId,
        webhookApplied: result.data.applied,
      },
    };
  } catch (err) {
    console.error("completeCheckout failed:", err);
    return { ok: false, error: "Could not complete checkout." };
  }
}

// ---------------------------------------------------------------- upgrades
export async function requestUpgrade(
  actorId: string,
  role: string,
  planId: string,
  billingInterval?: BillingInterval,
): Promise<
  Result<{
    requestId: string;
    preview: {
      currentPlan: string;
      newPlan: string;
      newPlanId: string;
      monthlyPriceDiff: number;
      prorationAmountAel: number;
      effectiveDate: string;
      newCommitmentEnd: string;
      nextInvoiceAmountAel: number;
      interval: BillingInterval;
    };
  }>
> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", code: "SETUP_REQUIRED" };
  try {
    await ensureSchema();
    const { subscription, plan: currentPlan } = await getActiveSubscription(actorId, role);
    if (!subscription || !currentPlan) return { ok: false, error: "No active subscription to upgrade." };
    if (subscription.status !== "active") {
      return { ok: false, error: `Upgrades require an Active subscription (status: ${subscription.status}).` };
    }
    const target = await loadPlan(actorId, role, planId);
    if (!target || target.status !== "Active") return { ok: false, error: "Target plan not found." };
    if (target.id === currentPlan.id) return { ok: false, error: "You are already on this plan." };
    const interval = billingInterval ?? subscription.billing_interval;
    const currentPrice = planPrice(currentPlan, interval);
    const targetPrice = planPrice(target, interval);
    if (targetPrice < currentPrice || target.sort_order < currentPlan.sort_order) {
      return { ok: false, error: "That plan is a downgrade. Use the downgrade flow instead.", code: "NOT_UPGRADE" };
    }
    // Proration: remaining days in current period × daily rate difference.
    const periodStart = subscription.current_period_start ?? new Date();
    const periodEnd = subscription.current_period_end ?? addInterval(periodStart, interval);
    const now = new Date();
    const totalMs = Math.max(1, periodEnd.getTime() - periodStart.getTime());
    const remainingMs = Math.max(0, periodEnd.getTime() - now.getTime());
    const fraction = remainingMs / totalMs;
    const proration = roundAel(fraction * (targetPrice - currentPrice));
    const effectiveDate = now;
    const newCommitmentEnd = commitmentEnd(effectiveDate, interval);
    const requestId = randomUUID();
    await asUser(actorId, role, (tx) => [
      tx`insert into upgrade_requests
           (id, subscription_id, from_plan_id, to_plan_id, requested_by, status, requested_at, effective_date, proration_amount_ael, reason)
         values (${requestId}, ${subscription.id}, ${currentPlan.id}, ${target.id}, ${actorId}, 'Pending', now(), ${effectiveDate}, ${proration}, 'Upgrade requested')`,
      tx`insert into subscription_history
           (id, subscription_id, user_id, previous_plan_id, new_plan_id, change_type,
            effective_date, billing_amount_ael, proration_amount_ael, min_commitment_end_date,
            payment_status, confirmation_status, source_event, details)
         values (${randomUUID()}, ${subscription.id}, ${actorId}, ${currentPlan.id}, ${target.id}, 'plan_changed',
                 ${effectiveDate}, ${targetPrice}, ${proration}, ${newCommitmentEnd}, 'pending', 'pending', 'request_upgrade', ${{
            stage: "upgrade_requested",
          } as never})`,
      auditQuery(tx, actorId, "billing.upgrade.requested", {
        subscriptionId: subscription.id,
        fromPlanId: currentPlan.id,
        toPlanId: target.id,
        prorationAel: proration,
      }),
    ]);
    return {
      ok: true,
      data: {
        requestId,
        preview: {
          currentPlan: currentPlan.name,
          newPlan: target.name,
          newPlanId: target.id,
          monthlyPriceDiff: targetPrice - currentPrice,
          prorationAmountAel: proration,
          effectiveDate: str(effectiveDate),
          newCommitmentEnd: str(newCommitmentEnd),
          nextInvoiceAmountAel: targetPrice,
          interval,
        },
      },
    };
  } catch (err) {
    console.error("requestUpgrade failed:", err);
    return { ok: false, error: "Could not prepare the upgrade." };
  }
}

/** Confirm an upgrade: sandbox payment -> checkout.completed -> webhook applies. */
export async function confirmUpgrade(
  actorId: string,
  role: string,
  requestId: string,
  opts?: { simulate?: SandboxSimulation },
): Promise<Result<{ status: SubscriptionStatus; newPlanId: string; newCommitmentEnd: string; eventId: string }>> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", code: "SETUP_REQUIRED" };
  try {
    await ensureSchema();
    const reqRows = (await asUser(actorId, role, (tx) => [
      tx`select u.id, u.subscription_id, u.from_plan_id, u.to_plan_id, u.status, u.proration_amount_ael,
                s.customer_id, s.plan_id, s.billing_interval, s.status as sub_status
           from upgrade_requests u
           join subscriptions s on s.id = u.subscription_id
          where u.id = ${requestId}`,
    ]))[1] as {
      id: string;
      subscription_id: string;
      from_plan_id: string | null;
      to_plan_id: string;
      status: string;
      proration_amount_ael: string | number | null;
      customer_id: string;
      plan_id: string | null;
      billing_interval: BillingInterval;
      sub_status: string;
    }[];
    const req = reqRows[0];
    if (!req) return { ok: false, error: "Upgrade request not found.", code: "NOT_FOUND" };
    if (req.status !== "Pending") return { ok: false, error: "Upgrade request is not pending." };
    if (req.sub_status !== "active") return { ok: false, error: "Subscription is not active." };
    const proration = num(req.proration_amount_ael) ?? 0;
    // Mark confirmed + Upgrade_Pending before payment; the webhook completes it.
    await asUser(actorId, role, (tx) => [
      tx`update upgrade_requests set status = 'Confirmed', processed_at = now() where id = ${requestId}`,
      tx`update subscriptions set status = 'upgrade_pending', plan_id = ${req.to_plan_id}, updated_at = now() where id = ${req.subscription_id}`,
    ]);
    const provider = sandboxProvider;
    const pi = await provider.createPaymentIntent({
      amountAel: proration,
      customerId: req.customer_id,
      subscriptionId: req.subscription_id,
      planId: req.to_plan_id,
      billingInterval: req.billing_interval,
      metadata: { upgradeRequestId: requestId },
    });
    const { event } = await provider.confirmPayment({
      providerPaymentIntentId: pi.providerPaymentIntentId,
      amountAel: proration,
      subscriptionId: req.subscription_id,
      planId: req.to_plan_id,
      billingInterval: req.billing_interval,
      simulate: opts?.simulate,
      eventType: "checkout.completed",
      upgradeRequestId: requestId,
      previousPlanId: req.from_plan_id ?? req.plan_id,
      prorationAmountAel: proration,
    });
    if (!event) return { ok: false, error: "Payment still pending." };
    const result = await handleProviderWebhook(actorId, role, event);
    if (!result.ok) return result;
    const sub = await loadSubscription(actorId, role, req.subscription_id);
    const now = new Date();
    return {
      ok: true,
      data: {
        status: sub?.status ?? "active",
        newPlanId: req.to_plan_id,
        newCommitmentEnd: str(commitmentEnd(now, req.billing_interval)),
        eventId: event.eventId,
      },
    };
  } catch (err) {
    console.error("confirmUpgrade failed:", err);
    return { ok: false, error: "Could not confirm the upgrade." };
  }
}

// --------------------------------------------------------------- downgrades
export async function requestDowngrade(
  actorId: string,
  role: string,
  planId: string,
): Promise<
  Result<{
    requestId: string;
    effectiveDate: string;
    currentPlan: string;
    newPlan: string;
    featuresRemoved: string[];
    futureBillingAmountAel: number;
    status: SubscriptionStatus;
  }>
> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", code: "SETUP_REQUIRED" };
  try {
    await ensureSchema();
    const { subscription, plan: currentPlan, commitment } = await getActiveSubscription(actorId, role);
    if (!subscription || !currentPlan) return { ok: false, error: "No active subscription." };
    if (subscription.status !== "active") {
      return { ok: false, error: `Downgrades require an Active subscription (status: ${subscription.status}).` };
    }
    const target = await loadPlan(actorId, role, planId);
    if (!target || target.status !== "Active") return { ok: false, error: "Target plan not found." };
    if (target.id === currentPlan.id) return { ok: false, error: "You are already on this plan." };
    if (planPrice(target, subscription.billing_interval) > planPrice(currentPlan, subscription.billing_interval) ||
        target.sort_order > currentPlan.sort_order) {
      return { ok: false, error: "That plan is an upgrade. Use the upgrade flow instead.", code: "NOT_DOWNGRADE" };
    }
    // Spec §4: locked until the 3-month minimum commitment completes.
    if (commitment && !commitment.completed && commitment.commitment_end_date.getTime() > Date.now()) {
      return {
        ok: false,
        error: `Downgrade available on ${commitment.commitment_end_date.toISOString().slice(0, 10)}. You can continue using your current plan until then or upgrade to a higher plan at any time.`,
        code: "MIN_COMMITMENT",
        extra: { eligibleDate: commitment.commitment_end_date.toISOString().slice(0, 10) },
      };
    }
    const effectiveDate = subscription.current_period_end ?? new Date();
    const requestId = randomUUID();
    // Features that will be removed: current plan entitlements not in target.
    const [, currEnts, tgtEnts] = (await asUser(actorId, role, (tx) => [
      tx`select entitlement_key from plan_entitlements where plan_id = ${currentPlan.id}`,
      tx`select entitlement_key from plan_entitlements where plan_id = ${target.id}`,
    ])) as unknown as [unknown, { entitlement_key: string }[], { entitlement_key: string }[]];
    const targetKeys = new Set(tgtEnts.map((e) => e.entitlement_key));
    const featuresRemoved = currEnts.map((e) => e.entitlement_key).filter((k) => !targetKeys.has(k));
    await asUser(actorId, role, (tx) => [
      tx`insert into downgrade_requests
           (id, subscription_id, from_plan_id, to_plan_id, requested_by, status, requested_at, effective_date, reason)
         values (${requestId}, ${subscription.id}, ${currentPlan.id}, ${target.id}, ${actorId}, 'Pending', now(), ${effectiveDate}, 'Downgrade requested')`,
      tx`update subscriptions set status = 'downgrade_scheduled', updated_at = now() where id = ${subscription.id}`,
      tx`insert into subscription_history
           (id, subscription_id, user_id, previous_plan_id, new_plan_id, change_type,
            effective_date, billing_amount_ael, payment_status, confirmation_status, source_event, details)
         values (${randomUUID()}, ${subscription.id}, ${actorId}, ${currentPlan.id}, ${target.id}, 'downgraded',
                 ${effectiveDate}, ${planPrice(target, subscription.billing_interval)}, 'pending', 'pending', 'request_downgrade', ${{
            stage: "downgrade_scheduled",
            featuresRemoved,
          } as never})`,
      auditQuery(tx, actorId, "billing.downgrade.scheduled", {
        subscriptionId: subscription.id,
        fromPlanId: currentPlan.id,
        toPlanId: target.id,
        effectiveDate: str(effectiveDate),
      }),
    ]);
    return {
      ok: true,
      data: {
        requestId,
        effectiveDate: str(effectiveDate),
        currentPlan: currentPlan.name,
        newPlan: target.name,
        featuresRemoved,
        futureBillingAmountAel: planPrice(target, subscription.billing_interval),
        status: "downgrade_scheduled",
      },
    };
  } catch (err) {
    console.error("requestDowngrade failed:", err);
    return { ok: false, error: "Could not schedule the downgrade." };
  }
}

/** Apply a scheduled downgrade (sandbox period-end trigger). */
export async function confirmDowngrade(
  actorId: string,
  role: string,
  requestId: string,
): Promise<Result<{ status: SubscriptionStatus; newPlanId: string; effectiveDate: string; eventId: string }>> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", code: "SETUP_REQUIRED" };
  try {
    await ensureSchema();
    const reqRows = (await asUser(actorId, role, (tx) => [
      tx`select d.id, d.subscription_id, d.to_plan_id, d.status, d.effective_date,
                s.status as sub_status, s.billing_interval
           from downgrade_requests d
           join subscriptions s on s.id = d.subscription_id
          where d.id = ${requestId}`,
    ]))[1] as {
      id: string;
      subscription_id: string;
      to_plan_id: string;
      status: string;
      effective_date: Date;
      sub_status: string;
      billing_interval: BillingInterval;
    }[];
    const req = reqRows[0];
    if (!req) return { ok: false, error: "Downgrade request not found.", code: "NOT_FOUND" };
    if (req.status !== "Pending") return { ok: false, error: "Downgrade request is not pending." };
    if (req.sub_status !== "downgrade_scheduled") {
      return { ok: false, error: "Subscription is not in Downgrade Scheduled state." };
    }
    await asUser(actorId, role, (tx) => [
      tx`update downgrade_requests set status = 'Confirmed', processed_at = now() where id = ${requestId}`,
    ]);
    const event: ProviderWebhookEvent = {
      provider: "sandbox",
      eventId: `sandbox_evt_dn_${randomUUID().slice(0, 12)}`,
      eventType: "subscription.updated",
      payload: {
        subscriptionId: req.subscription_id,
        planId: req.to_plan_id,
        billingInterval: req.billing_interval,
        amountAel: 0,
      },
    };
    const result = await handleProviderWebhook(actorId, role, event);
    if (!result.ok) return result;
    return {
      ok: true,
      data: {
        status: "active",
        newPlanId: req.to_plan_id,
        effectiveDate: str(req.effective_date),
        eventId: event.eventId,
      },
    };
  } catch (err) {
    console.error("confirmDowngrade failed:", err);
    return { ok: false, error: "Could not apply the downgrade." };
  }
}

// ------------------------------------------------------------- cancellations
export async function requestCancellation(
  actorId: string,
  role: string,
  mode: "end_of_period" | "immediate",
  reason?: string,
): Promise<
  Result<{
    requestId: string;
    effectiveDate: string;
    mode: "end_of_period" | "immediate";
    remainingCommitmentDays?: number;
    amountDueAel?: number;
    status: SubscriptionStatus;
  }>
> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", code: "SETUP_REQUIRED" };
  try {
    await ensureSchema();
    const { subscription, plan: currentPlan, commitment } = await getActiveSubscription(actorId, role);
    if (!subscription || !currentPlan) return { ok: false, error: "No active subscription." };
    if (subscription.status === "cancel_at_period_end") {
      return { ok: false, error: "Cancellation is already scheduled for the end of the current billing period." };
    }
    if (subscription.status !== "active") {
      return { ok: false, error: `Cannot cancel a subscription in status '${subscription.status}'.` };
    }
    // Immediate cancellation during the minimum commitment: show what remains.
    if (mode === "immediate" && commitment && !commitment.completed &&
        commitment.commitment_end_date.getTime() > Date.now()) {
      const remainingMs = commitment.commitment_end_date.getTime() - Date.now();
      const remainingDays = Math.ceil(remainingMs / DAY_MS);
      const price = planPrice(currentPlan, subscription.billing_interval);
      const cycles = subscription.billing_interval === "monthly" ? Math.ceil(remainingDays / 30) : 1;
      const amountDue = price * cycles;
      return {
        ok: false,
        error:
          `Your membership includes a minimum three-month service period (until ${commitment.commitment_end_date.toISOString().slice(0, 10)}). ` +
          `Remaining commitment: ${remainingDays} days — AED ${amountDue} still due. You may cancel at the end of the current billing period, or wait until the minimum commitment completes.`,
        code: "MIN_COMMITMENT",
        extra: {
          eligibleDate: commitment.commitment_end_date.toISOString().slice(0, 10),
          remainingCommitmentDays: remainingDays,
          amountDueAel: amountDue,
        },
      };
    }
    const effectiveDate = mode === "immediate" ? new Date() : (subscription.current_period_end ?? new Date());
    const requestId = randomUUID();
    await asUser(actorId, role, (tx) => [
      tx`insert into cancellation_requests
           (id, subscription_id, requested_by, status, requested_at, effective_date, mode, reason)
         values (${requestId}, ${subscription.id}, ${actorId}, 'Pending', now(), ${effectiveDate}, ${mode}, ${reason ?? null})`,
      tx`update subscriptions set status = 'cancellation_requested', updated_at = now() where id = ${subscription.id}`,
      tx`insert into subscription_history
           (id, subscription_id, user_id, previous_plan_id, new_plan_id, change_type,
            effective_date, billing_amount_ael, payment_status, confirmation_status, source_event, details)
         values (${randomUUID()}, ${subscription.id}, ${actorId}, ${currentPlan.id}, ${currentPlan.id}, 'cancelled',
                 ${effectiveDate}, ${null}, 'pending', 'pending', 'request_cancellation', ${{
            stage: "cancellation_requested",
            mode,
          } as never})`,
      auditQuery(tx, actorId, "billing.cancellation.requested", {
        subscriptionId: subscription.id,
        mode,
        effectiveDate: str(effectiveDate),
      }),
    ]);
    return {
      ok: true,
      data: {
        requestId,
        effectiveDate: str(effectiveDate),
        mode,
        status: "cancellation_requested",
      },
    };
  } catch (err) {
    console.error("requestCancellation failed:", err);
    return { ok: false, error: "Could not request cancellation." };
  }
}

/** Confirm a cancellation request — never silent; requires confirmation. */
export async function confirmCancellation(
  actorId: string,
  role: string,
  requestId: string,
): Promise<Result<{ status: SubscriptionStatus; effectiveDate: string; eventId?: string }>> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", code: "SETUP_REQUIRED" };
  try {
    await ensureSchema();
    const reqRows = (await asUser(actorId, role, (tx) => [
      tx`select c.id, c.subscription_id, c.status, c.effective_date, c.mode,
                s.status as sub_status, s.plan_id, s.billing_interval, s.customer_id
           from cancellation_requests c
           join subscriptions s on s.id = c.subscription_id
          where c.id = ${requestId}`,
    ]))[1] as {
      id: string;
      subscription_id: string;
      status: string;
      effective_date: Date;
      mode: "end_of_period" | "immediate";
      sub_status: string;
      plan_id: string | null;
      billing_interval: BillingInterval;
      customer_id: string;
    }[];
    const req = reqRows[0];
    if (!req) return { ok: false, error: "Cancellation request not found.", code: "NOT_FOUND" };
    if (req.status !== "Pending") return { ok: false, error: "Cancellation request is not pending." };
    if (req.sub_status !== "cancellation_requested") {
      return { ok: false, error: "Subscription is not awaiting cancellation confirmation." };
    }
    if (req.mode === "immediate") {
      // Access ends now; provider emits subscription.canceled -> webhook applies.
      const event: ProviderWebhookEvent = {
        provider: "sandbox",
        eventId: `sandbox_evt_cx_${randomUUID().slice(0, 12)}`,
        eventType: "subscription.canceled",
        payload: {
          subscriptionId: req.subscription_id,
          planId: req.plan_id,
          billingInterval: req.billing_interval,
          amountAel: 0,
        },
      };
      await asUser(actorId, role, (tx) => [
        tx`update cancellation_requests set status = 'Confirmed', processed_at = now() where id = ${requestId}`,
      ]);
      const result = await handleProviderWebhook(actorId, role, event);
      if (!result.ok) return result;
      return {
        ok: true,
        data: { status: "cancelled", effectiveDate: str(new Date()), eventId: event.eventId },
      };
    }
    // End of period: access continues until current_period_end.
    await asUser(actorId, role, (tx) => [
      tx`update subscriptions
            set status = 'cancel_at_period_end', cancelled_at = ${req.effective_date}, updated_at = now()
          where id = ${req.subscription_id}`,
      tx`update cancellation_requests set status = 'Confirmed', processed_at = now() where id = ${requestId}`,
      tx`insert into subscription_history
           (id, subscription_id, user_id, previous_plan_id, new_plan_id, change_type,
            effective_date, billing_amount_ael, payment_status, confirmation_status, source_event, details)
         values (${randomUUID()}, ${req.subscription_id}, ${actorId}, ${req.plan_id}, ${req.plan_id}, 'cancelled',
                 ${req.effective_date}, ${null}, 'paid', 'confirmed', 'confirm_cancellation', ${{
            stage: "cancel_at_period_end",
          } as never})`,
      auditQuery(tx, actorId, "billing.cancellation.confirmed", {
        subscriptionId: req.subscription_id,
        effectiveDate: str(req.effective_date),
      }),
    ]);
    return { ok: true, data: { status: "cancel_at_period_end", effectiveDate: str(req.effective_date) } };
  } catch (err) {
    console.error("confirmCancellation failed:", err);
    return { ok: false, error: "Could not confirm cancellation." };
  }
}

// ------------------------------------------------------- period-end processing
/**
 * Applies transitions whose effective date has arrived: scheduled downgrades
 * and end-of-period cancellations. Driven by provider events (subscription.
 * updated / subscription.canceled) so the webhook path stays authoritative.
 * `forceSubscriptionId` simulates the sandbox period-end trigger for tests.
 */
export async function applyScheduledChanges(
  actorId: string,
  role: string,
  opts?: { forceSubscriptionId?: string },
): Promise<Result<{ downgradesApplied: number; cancellationsApplied: number }>> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", code: "SETUP_REQUIRED" };
  try {
    await ensureSchema();
    const force = opts?.forceSubscriptionId ?? null;
    const dueRows = (await asUser(actorId, role, (tx) => [
      tx`select s.id as subscription_id, s.plan_id, s.billing_interval, s.status
           from subscriptions s
          where (s.status = 'downgrade_scheduled' or s.status = 'cancel_at_period_end')
            and (${force}::uuid is null or s.id = ${force})`,
    ]))[1] as {
      subscription_id: string;
      plan_id: string | null;
      billing_interval: BillingInterval;
      status: string;
    }[];
    let downgradesApplied = 0;
    let cancellationsApplied = 0;
    for (const due of dueRows) {
      if (due.status === "cancel_at_period_end") {
        const event: ProviderWebhookEvent = {
          provider: "sandbox",
          eventId: `sandbox_evt_pe_${randomUUID().slice(0, 12)}`,
          eventType: "subscription.canceled",
          payload: {
            subscriptionId: due.subscription_id,
            planId: due.plan_id,
            billingInterval: due.billing_interval,
            amountAel: 0,
          },
        };
        const res = await handleProviderWebhook(actorId, role, event);
        if (res.ok) cancellationsApplied += 1;
        continue;
      }
      // downgrade_scheduled
      const dReqRows = (await asUser(actorId, role, (tx) => [
        tx`select id, to_plan_id from downgrade_requests
            where subscription_id = ${due.subscription_id} and status = 'Pending'
            order by requested_at desc limit 1`,
      ]))[1] as { id: string; to_plan_id: string }[];
      const dReq = dReqRows[0] ?? null;
      if (!dReq) continue;
      const res = await confirmDowngrade(actorId, role, dReq.id);
      if (res.ok) downgradesApplied += 1;
    }
    return { ok: true, data: { downgradesApplied, cancellationsApplied } };
  } catch (err) {
    console.error("applyScheduledChanges failed:", err);
    return { ok: false, error: "Could not process scheduled changes." };
  }
}

// ------------------------------------------------------------------ overview
export type BillingOverview = {
  plan: {
    id: string | null;
    code: string | null;
    name: string | null;
    priceAel: number;
    interval: BillingInterval;
    status: SubscriptionStatus;
    statusLabel: string;
    startDate: string | null;
    nextBillingDate: string | null;
    currentPeriodEnd: string | null;
    minCommitmentEnd: string | null;
    minCommitmentCompleted: boolean;
    downgradeEligibleDate: string | null;
    downgradeEligible: boolean;
    cancelledAt: string | null;
    features: string[];
    activeFeatures: { key: string; value: EntitlementValue }[];
  };
  upgrade: {
    canUpgrade: boolean;
    higherPlans: { id: string; code: string; name: string; priceMonthlyAel: number | null; priceAnnualAel: number | null }[];
  };
  downgrade: { locked: boolean; lockedReason: string | null };
  cancellation: { canRequest: boolean; pendingRequest: { id: string; mode: string; effectiveDate: string } | null };
  invoices: {
    id: string;
    invoiceNumber: string;
    amountAel: number;
    totalAel: number;
    status: string;
    billingPeriodStart: string | null;
    billingPeriodEnd: string | null;
    paidAt: string | null;
  }[];
  history: {
    id: string;
    changeType: string;
    effectiveDate: string;
    billingAmountAel: number | null;
    prorationAmountAel: number | null;
    previousPlan: string | null;
    newPlan: string | null;
    paymentStatus: string | null;
    confirmationStatus: string | null;
    sourceEvent: string | null;
    details: JsonDetails | null;
  }[];
};

/** Everything the billing area needs in one read (current plan card etc.). */
export async function getBillingOverview(actorId: string, role: string): Promise<Result<BillingOverview>> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", code: "SETUP_REQUIRED" };
  try {
    await ensureSchema();
    const { subscription, customer, plan, commitment } = await getActiveSubscription(actorId, role);
    if (!subscription || !customer) {
      // Registered but no plan selected — the pricing window state.
      return {
        ok: true,
        data: {
          plan: {
            id: null, code: null, name: null, priceAel: 0, interval: "monthly",
            status: "pending_plan_selection", statusLabel: STATUS_DISPLAY.pending_plan_selection,
            startDate: null, nextBillingDate: null, currentPeriodEnd: null,
            minCommitmentEnd: null, minCommitmentCompleted: false, downgradeEligibleDate: null,
            downgradeEligible: false, cancelledAt: null, features: [], activeFeatures: [],
          },
          upgrade: { canUpgrade: false, higherPlans: [] },
          downgrade: { locked: true, lockedReason: null },
          cancellation: { canRequest: false, pendingRequest: null },
          invoices: [],
          history: [],
        },
      };
    }
    const [, _plansAll, feats, ents, _activeFeats, invRows, histRows, cancelReqRows, higherRows] = (await asUser(actorId, role, (tx) => [
      tx`select id, code, name, price_monthly_ael, price_annual_ael, sort_order, status from membership_plans`,
      tx`select f.feature as feature from plan_features f where f.plan_id = ${plan?.id ?? null} order by f.sort_order`,
      tx`select e.entitlement_key as entitlement_key, e.value as value from plan_entitlements e where e.plan_id = ${plan?.id ?? null}`,
      tx`select f.entitlement_key as entitlement_key from feature_access_records f
          where f.subscription_id = ${subscription.id} and f.granted = true and (f.effective_to is null or f.effective_to > now())`,
      tx`select id, invoice_number, amount_ael, total_ael, status, billing_period_start, billing_period_end, paid_at
           from subscription_invoices where customer_id = ${customer.id}
          order by created_at desc limit 12`,
      tx`select h.id, h.change_type, h.effective_date, h.billing_amount_ael, h.proration_amount_ael,
                h.previous_plan_id, h.new_plan_id, h.payment_status, h.confirmation_status, h.source_event, h.details,
                pp.name as prev_name, np.name as new_name
           from subscription_history h
           left join membership_plans pp on pp.id = h.previous_plan_id
           left join membership_plans np on np.id = h.new_plan_id
          where h.subscription_id = ${subscription.id}
          order by h.created_at desc limit 20`,
      tx`select id, mode, effective_date from cancellation_requests
          where subscription_id = ${subscription.id} and status in ('Pending','Confirmed')
          order by requested_at desc limit 1`,
      tx`select id, code, name, price_monthly_ael, price_annual_ael from membership_plans
          where status = 'Active' and sort_order > ${plan?.sort_order ?? 999}
          order by sort_order`,
    ])) as unknown as [unknown, 
      PlanRow[],
      { feature: string }[],
      { entitlement_key: string; value: unknown }[],
      { entitlement_key: string }[],
      {
        id: string; invoice_number: string; amount_ael: string | number; total_ael: string | number;
        status: string; billing_period_start: Date | null; billing_period_end: Date | null; paid_at: Date | null;
      }[],
      {
        id: string; change_type: string; effective_date: Date; billing_amount_ael: string | number | null;
        proration_amount_ael: string | number | null; previous_plan_id: string | null; new_plan_id: string | null;
        payment_status: string | null; confirmation_status: string | null; source_event: string | null;
        details: unknown; prev_name: string | null; new_name: string | null;
      }[],
      { id: string; mode: string; effective_date: Date }[],
      { id: string; code: string; name: string; price_monthly_ael: string | number | null; price_annual_ael: string | number | null }[],
    ];
    const now = Date.now();
    const commitmentDone = commitment
      ? commitment.completed || commitment.commitment_end_date.getTime() <= now
      : true;
    const price = plan ? planPrice(plan, subscription.billing_interval) : 0;
    const pendingCancel = cancelReqRows[0] ?? null;
    return {
      ok: true,
      data: {
        plan: {
          id: plan?.id ?? null,
          code: plan?.code ?? null,
          name: plan?.name ?? null,
          priceAel: price,
          interval: subscription.billing_interval,
          status: subscription.status,
          statusLabel: STATUS_DISPLAY[subscription.status] ?? subscription.status,
          startDate: subscription.started_at ? str(subscription.started_at) : null,
          nextBillingDate: subscription.next_billing_date ? str(subscription.next_billing_date) : null,
          currentPeriodEnd: subscription.current_period_end ? str(subscription.current_period_end) : null,
          minCommitmentEnd: commitment ? str(commitment.commitment_end_date) : null,
          minCommitmentCompleted: commitmentDone,
          downgradeEligibleDate: commitment ? str(commitment.commitment_end_date) : null,
          downgradeEligible: commitmentDone,
          cancelledAt: subscription.cancelled_at ? str(subscription.cancelled_at) : null,
          features: feats.map((f) => f.feature),
          activeFeatures: ents.map((e) => ({ key: e.entitlement_key, value: (e.value ?? {}) as EntitlementValue })),
        },
        upgrade: {
          canUpgrade: subscription.status === "active" && higherRows.length > 0,
          higherPlans: higherRows.map((p) => ({
            id: p.id,
            code: p.code,
            name: p.name,
            priceMonthlyAel: num(p.price_monthly_ael),
            priceAnnualAel: num(p.price_annual_ael),
          })),
        },
        downgrade: {
          locked: !commitmentDone,
          lockedReason: commitmentDone
            ? null
            : `Downgrade available on ${commitment ? commitment.commitment_end_date.toISOString().slice(0, 10) : "—"}. You can continue using your current plan until then or upgrade to a higher plan at any time.`,
        },
        cancellation: {
          canRequest: ["active", "cancel_at_period_end"].includes(subscription.status),
          pendingRequest: pendingCancel
            ? { id: pendingCancel.id, mode: pendingCancel.mode, effectiveDate: str(pendingCancel.effective_date) }
            : null,
        },
        invoices: invRows.map((i) => ({
          id: i.id,
          invoiceNumber: i.invoice_number,
          amountAel: num(i.amount_ael) ?? 0,
          totalAel: num(i.total_ael) ?? 0,
          status: i.status,
          billingPeriodStart: i.billing_period_start ? str(i.billing_period_start) : null,
          billingPeriodEnd: i.billing_period_end ? str(i.billing_period_end) : null,
          paidAt: i.paid_at ? str(i.paid_at) : null,
        })),
        history: histRows.map((h) => ({
          id: h.id,
          changeType: h.change_type,
          effectiveDate: str(h.effective_date),
          billingAmountAel: num(h.billing_amount_ael),
          prorationAmountAel: num(h.proration_amount_ael),
          previousPlan: h.prev_name ?? h.previous_plan_id,
          newPlan: h.new_name ?? h.new_plan_id,
          paymentStatus: h.payment_status,
          confirmationStatus: h.confirmation_status,
          sourceEvent: h.source_event,
          details: (h.details ?? null) as JsonDetails | null,
        })),
      },
    };
  } catch (err) {
    console.error("getBillingOverview failed:", err);
    return { ok: false, error: "Could not load your billing overview." };
  }
}

// ------------------------------------------------------------ list endpoints
export async function listInvoices(
  actorId: string,
  role: string,
): Promise<Result<BillingOverview["invoices"]>> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", code: "SETUP_REQUIRED" };
  try {
    await ensureSchema();
    const { customer } = await getActiveSubscription(actorId, role);
    if (!customer) return { ok: true, data: [] };
    const rows = (await asUser(actorId, role, (tx) => [
      tx`select id, invoice_number, amount_ael, tax_ael, total_ael, status,
                billing_period_start, billing_period_end, due_date, paid_at
           from subscription_invoices where customer_id = ${customer.id}
          order by created_at desc limit 50`,
    ]))[1] as {
      id: string; invoice_number: string; amount_ael: string | number; tax_ael: string | number;
      total_ael: string | number; status: string; billing_period_start: Date | null;
      billing_period_end: Date | null; due_date: Date | null; paid_at: Date | null;
    }[];
    return {
      ok: true,
      data: rows.map((i) => ({
        id: i.id,
        invoiceNumber: i.invoice_number,
        amountAel: num(i.amount_ael) ?? 0,
        totalAel: num(i.total_ael) ?? 0,
        status: i.status,
        billingPeriodStart: i.billing_period_start ? str(i.billing_period_start) : null,
        billingPeriodEnd: i.billing_period_end ? str(i.billing_period_end) : null,
        paidAt: i.paid_at ? str(i.paid_at) : null,
      })),
    };
  } catch (err) {
    console.error("listInvoices failed:", err);
    return { ok: false, error: "Could not load invoices." };
  }
}

export async function listSubscriptionHistory(
  actorId: string,
  role: string,
): Promise<Result<BillingOverview["history"]>> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", code: "SETUP_REQUIRED" };
  try {
    await ensureSchema();
    const { subscription } = await getActiveSubscription(actorId, role);
    if (!subscription) return { ok: true, data: [] };
    const rows = (await asUser(actorId, role, (tx) => [
      tx`select h.id, h.change_type, h.effective_date, h.billing_amount_ael, h.proration_amount_ael,
                h.payment_status, h.confirmation_status, h.source_event, h.details,
                pp.name as prev_name, np.name as new_name
           from subscription_history h
           left join membership_plans pp on pp.id = h.previous_plan_id
           left join membership_plans np on np.id = h.new_plan_id
          where h.subscription_id = ${subscription.id}
          order by h.created_at desc limit 100`,
    ]))[1] as {
      id: string; change_type: string; effective_date: Date; billing_amount_ael: string | number | null;
      proration_amount_ael: string | number | null; payment_status: string | null;
      confirmation_status: string | null; source_event: string | null; details: unknown;
      prev_name: string | null; new_name: string | null;
    }[];
    return {
      ok: true,
      data: rows.map((h) => ({
        id: h.id,
        changeType: h.change_type,
        effectiveDate: str(h.effective_date),
        billingAmountAel: num(h.billing_amount_ael),
        prorationAmountAel: num(h.proration_amount_ael),
        previousPlan: h.prev_name ?? null,
        newPlan: h.new_name ?? null,
        paymentStatus: h.payment_status,
        confirmationStatus: h.confirmation_status,
        sourceEvent: h.source_event,
        details: (h.details ?? null) as JsonDetails | null,
      })),
    };
  } catch (err) {
    console.error("listSubscriptionHistory failed:", err);
    return { ok: false, error: "Could not load subscription history." };
  }
}

// ---------------------------------------------------------------- session auth
/** Load the session user, or return null (callers return UNAUTHENTICATED). */
export async function requireSessionUser() {
  if (!dbConfigured()) return null;
  await ensureSchema();
  return loadSessionUser();
}

/** Resolve the acting user + their profile role for asUser() scopes. */
export async function sessionActor() {
  const user = await requireSessionUser();
  if (!user) return null;
  return { id: user.id, role: user.role };
}
