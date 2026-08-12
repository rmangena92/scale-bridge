/**
 * Membership client-flow helpers (client-safe — no server-only imports).
 *
 * Shared by the post-auth routing loaders (/app, /workspaces, /membership,
 * /membership-checkout, /membership-confirmed, /onboarding, /billing-recovery)
 * and their components. The routing rules mirror spec §1 (status table) and
 * the owner's non-payment addendum (§4): payment_failed / past_due / suspended
 * ALWAYS route to the billing recovery screen; the free-plan revert path is
 * denied by design (backend entitlement checks enforce it; the UI must never
 * offer it either).
 */
import type { SubscriptionStatus } from "./billing";

/** Exact wording required by spec §3 — shown in pricing, checkout, recovery. */
export const COMMITMENT_NOTICE =
  "Your membership includes a minimum three-month service period. You may upgrade at any time. Downgrades become available after the minimum service period has been completed.";

/** Spec §1 destinations. */
export type GateDestination =
  | { kind: "pricing" } // no plan / pending selection / expired / cancelled
  | { kind: "resume" } // checkout started / payment pending
  | { kind: "recovery" } // payment failed / past due / suspended → ACCESS DENIED
  | { kind: "dashboard" }; // active / cancel at period end / cancellation requested / upgrade pending / downgrade scheduled

const DASHBOARD_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "cancel_at_period_end",
  "cancellation_requested",
  "upgrade_pending",
  "downgrade_scheduled",
]);

const RESUME_STATUSES: ReadonlySet<string> = new Set([
  "checkout_started",
  "payment_pending",
]);

const BLOCKED_STATUSES: ReadonlySet<string> = new Set([
  "payment_failed",
  "past_due",
  "suspended",
]);

export function gateDestination(status: SubscriptionStatus | null | undefined): GateDestination {
  if (!status) return { kind: "pricing" };
  if (DASHBOARD_STATUSES.has(status)) return { kind: "dashboard" };
  if (RESUME_STATUSES.has(status)) return { kind: "resume" };
  if (BLOCKED_STATUSES.has(status)) return { kind: "recovery" };
  return { kind: "pricing" }; // pending_plan_selection, cancelled, expired
}

/** True when the subscription is in a blocked (access-denied) state. */
export function isBlockedStatus(status: SubscriptionStatus | null | undefined): boolean {
  return !!status && BLOCKED_STATUSES.has(status);
}

/** Partner-company audience: the subscription flow applies to these roles only. */
export function isPartnerAudienceRole(role: string): boolean {
  return role === "lead_contractor" || role === "company_user";
}

/** AED formatting: 1490 → "AED 1,490". */
export function formatAed(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  const n = Math.round(amount);
  return `AED ${n.toLocaleString("en-US")}`;
}

/** ISO date → "12 Aug 2026". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Interval label. */
export function intervalLabel(interval: "monthly" | "annual"): string {
  return interval === "annual" ? "per year (annual billing)" : "per month (monthly billing)";
}

/**
 * Estimated next billing date for a checkout about to start: activation + 1
 * billing cycle (monthly → +1 month, annual → +12 months).
 */
export function estimatedNextBilling(interval: "monthly" | "annual"): string {
  const d = new Date();
  const months = interval === "annual" ? 12 : 1;
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Estimated downgrade-eligibility date for a checkout about to start: now + 3 cycles. */
export function estimatedCommitmentEnd(interval: "monthly" | "annual"): string {
  const d = new Date();
  const months = interval === "annual" ? 36 : 3;
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Small steps indicator used across the membership flow. */
export function MembershipStepper({ step }: { step: 1 | 2 | 3 | 4 }) {
  const steps = ["Membership", "Payment", "Profile", "Dashboard"];
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-muted">
      {steps.map((label, i) => {
        const idx = i + 1;
        const done = idx < step;
        const active = idx === step;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`grid size-5 place-items-center rounded-full text-[11px] ${
                done
                  ? "bg-teal text-white"
                  : active
                    ? "bg-navy text-white"
                    : "bg-slate-200 text-muted"
              }`}
            >
              {done ? "✓" : idx}
            </span>
            <span className={active ? "text-navy" : done ? "text-teal" : ""}>{label}</span>
            {idx < steps.length && <span className="text-slate-300">→</span>}
          </li>
        );
      })}
    </ol>
  );
}
