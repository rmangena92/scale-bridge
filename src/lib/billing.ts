/**
 * Subscription & membership system — server functions (client-safe module).
 *
 * IMPORTANT (TanStack Start constraint): this module must not import
 * server-only modules at the top level — the client build replaces the
 * createServerFn handler bodies below with RPC stubs, and only imports that
 * are referenced *exclusively inside those bodies* get tree-shaken out of the
 * browser bundle. All real logic lives in ./subscriptions.ts, which is
 * imported only here and never from client components.
 *
 * RBAC: every handler resolves the session user via loadSessionUser() (from
 * auth-core) and denies with UNAUTHENTICATED otherwise. The one exception is
 * listPlans — the public pricing-window read (Active plans + features +
 * entitlements) that mirrors the landing.ts public-read pattern.
 */
import { createServerFn } from "@tanstack/react-start";
import { loadSessionUser } from "./auth-core";
import {
  completeCheckout,
  confirmCancellation,
  confirmDowngrade,
  confirmUpgrade,
  getBillingOverview,
  getSubscriptionGate,
  listInvoices,
  listPublishedPlans,
  listSubscriptionHistory,
  requestCancellation,
  requestDowngrade,
  requestUpgrade,
  selectPlan,
} from "./subscriptions";
import type { BillingInterval, SandboxSimulation } from "./subscriptions";

export type {
  BillingInterval,
  BillingOverview,
  PlanPublic,
  SandboxSimulation,
  SubscriptionGate,
  SubscriptionStatus,
} from "./subscriptions";

/** Session guard shared by every authed handler. Returns null when denied. */
async function guardUser(): Promise<{ id: string; role: string } | null> {
  const user = await loadSessionUser();
  return user ? { id: user.id, role: user.role } : null;
}

/** Public pricing-window read — Active plans + features + entitlements. */
export const listPlans = createServerFn({ method: "GET" }).handler(
  () => listPublishedPlans(),
);

/** Post-auth routing gate — subscription status + plan info in one call. */
export const getSubscriptionStatusFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await guardUser();
    if (!user) return { ok: false as const, error: "UNAUTHENTICATED" };
    return getSubscriptionGate(user.id, user.role);
  },
);

/** Billing area: current plan card, upgrade/downgrade/cancel states, invoices, history. */
export const getBillingOverviewFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await guardUser();
    if (!user) return { ok: false as const, error: "UNAUTHENTICATED" };
    return getBillingOverview(user.id, user.role);
  },
);

/** Select a plan -> subscription enters Checkout Started. */
export const selectPlanFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { planId: string; billingInterval: BillingInterval })
  .handler(async ({ data }) => {
    const user = await guardUser();
    if (!user) return { ok: false as const, error: "UNAUTHENTICATED" };
    return selectPlan(user.id, user.role, null, data.planId, data.billingInterval);
  });

/** Sandbox checkout: Payment_Pending -> provider confirm -> webhook applies. */
export const completeCheckoutFn = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) => d as { subscriptionId: string; simulate?: SandboxSimulation },
  )
  .handler(async ({ data }) => {
    const user = await guardUser();
    if (!user) return { ok: false as const, error: "UNAUTHENTICATED" };
    return completeCheckout(user.id, user.role, data.subscriptionId, {
      simulate: data.simulate,
    });
  });

/** Upgrade preview + request (Pending upgrade_request row + history). */
export const requestUpgradeFn = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) => d as { planId: string; billingInterval?: BillingInterval },
  )
  .handler(async ({ data }) => {
    const user = await guardUser();
    if (!user) return { ok: false as const, error: "UNAUTHENTICATED" };
    return requestUpgrade(user.id, user.role, data.planId, data.billingInterval);
  });

/** Confirm upgrade after sandbox payment success. */
export const confirmUpgradeFn = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) => d as { requestId: string; simulate?: SandboxSimulation },
  )
  .handler(async ({ data }) => {
    const user = await guardUser();
    if (!user) return { ok: false as const, error: "UNAUTHENTICATED" };
    return confirmUpgrade(user.id, user.role, data.requestId, {
      simulate: data.simulate,
    });
  });

/** Downgrade request — locked until the 3-month commitment completes. */
export const requestDowngradeFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { planId: string })
  .handler(async ({ data }) => {
    const user = await guardUser();
    if (!user) return { ok: false as const, error: "UNAUTHENTICATED" };
    return requestDowngrade(user.id, user.role, data.planId);
  });

/** Apply a scheduled downgrade (sandbox period-end trigger). */
export const confirmDowngradeFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { requestId: string })
  .handler(async ({ data }) => {
    const user = await guardUser();
    if (!user) return { ok: false as const, error: "UNAUTHENTICATED" };
    return confirmDowngrade(user.id, user.role, data.requestId);
  });

/** Cancellation request (Pending) — never silent; requires confirmation. */
export const requestCancellationFn = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) => d as { mode: "end_of_period" | "immediate"; reason?: string },
  )
  .handler(async ({ data }) => {
    const user = await guardUser();
    if (!user) return { ok: false as const, error: "UNAUTHENTICATED" };
    return requestCancellation(user.id, user.role, data.mode, data.reason);
  });

/** Confirm a cancellation request (Pending -> Confirmed; never silent). */
export const confirmCancellationFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { requestId: string })
  .handler(async ({ data }) => {
    const user = await guardUser();
    if (!user) return { ok: false as const, error: "UNAUTHENTICATED" };
    return confirmCancellation(user.id, user.role, data.requestId);
  });

/** Invoice history for the billing area. */
export const listInvoicesFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await guardUser();
    if (!user) return { ok: false as const, error: "UNAUTHENTICATED" };
    return listInvoices(user.id, user.role);
  },
);

/** Subscription history for the billing area. */
export const listSubscriptionHistoryFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await guardUser();
    if (!user) return { ok: false as const, error: "UNAUTHENTICATED" };
    return listSubscriptionHistory(user.id, user.role);
  },
);
