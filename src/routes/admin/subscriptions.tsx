import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import { getAdminSession, listAdminSubscriptions } from "~/lib/admin";
import type { AdminSubscriptionRow } from "~/lib/admin";
import { Badge, Button, Card, DbSetupPage, EmptyState, ErrorText, Field, Select } from "~/components/ui";

export const Route = createFileRoute("/admin/subscriptions")({
  loader: async () => {
    const session = await getAdminSession();
    const result = await listAdminSubscriptions({ data: { status: "", planId: "" } });
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      initial: result.ok ? result.subscriptions : [],
      plans: result.ok ? result.plans : [],
      loadError: result.ok ? null : result.error,
    };
  },
  component: SubscriptionsPage,
});

/** Mirrors the backend 13-status state machine (labels for the filter UI). */
const SUBSCRIPTION_STATUSES = [
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
] as const;
const STATUS_DISPLAY: Record<string, string> = {
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

const statusTones: Record<string, "green" | "red" | "amber" | "slate" | "blue" | "teal"> = {
  active: "green",
  pending_plan_selection: "amber",
  checkout_started: "blue",
  payment_pending: "amber",
  past_due: "amber",
  payment_failed: "red",
  upgrade_pending: "blue",
  downgrade_scheduled: "amber",
  cancellation_requested: "amber",
  cancel_at_period_end: "amber",
  cancelled: "red",
  expired: "slate",
  suspended: "red",
};

const paymentTones: Record<string, "green" | "red" | "amber" | "slate" | "blue" | "teal"> = {
  Paid: "green",
  Open: "amber",
  Draft: "slate",
  Failed: "red",
  Voided: "slate",
};

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function fmtAed(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `AED ${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function SubscriptionsPage() {
  const loader = Route.useLoaderData();
  const [rows, setRows] = useState<AdminSubscriptionRow[]>(loader.initial);
  const [plans] = useState(loader.plans);
  const [status, setStatus] = useState("");
  const [planId, setPlanId] = useState("");
  const [error, setError] = useState<string | null>(loader.loadError);
  const [pending, setPending] = useState(false);

  if (loader.setupRequired) {
    return (
      <DbSetupPage title="Subscriptions">
        Connect a Postgres database (DATABASE_URL) to manage subscriptions.
      </DbSetupPage>
    );
  }
  if (!loader.admin) return null;

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await listAdminSubscriptions({ data: { status, planId } });
    setPending(false);
    if (result.ok) {
      setRows(result.subscriptions);
    } else {
      setError(result.error);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">Subscriptions</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Membership subscriptions</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Every subscription across the platform — plan, billing, commitment and
          payment status. Read-only view (manual management arrives in a later stage).
        </p>
      </div>

      <Card className="p-5">
        <form onSubmit={onSearch} className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Field label="Subscription status" htmlFor="sub-status">
              <Select id="sub-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All statuses</option>
                {SUBSCRIPTION_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_DISPLAY[s]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="w-56">
            <Field label="Membership plan" htmlFor="sub-plan">
              <Select id="sub-plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
                <option value="">All plans</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Searching…" : "Search"}
          </Button>
        </form>
      </Card>

      {error && (
        <div className="mt-5">
          <ErrorText>{error}</ErrorText>
        </div>
      )}

      <Card className="mt-5 overflow-x-auto">
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No subscriptions found"
              body="No subscriptions match the current filters. Memberships appear here once a client selects a plan."
            />
          </div>
        ) : (
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">Company</th>
                <th className="px-3 py-3">Plan</th>
                <th className="px-3 py-3">Price</th>
                <th className="px-3 py-3">Interval</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Start date</th>
                <th className="px-3 py-3">Current period</th>
                <th className="px-3 py-3">Next billing</th>
                <th className="px-3 py-3">Minimum commitment</th>
                <th className="px-3 py-3">Downgrade eligible</th>
                <th className="px-3 py-3">Payment</th>
                <th className="px-3 py-3">Pending change</th>
                <th className="px-3 py-3">Cancellation</th>
                <th className="px-5 py-3">Provider IDs (sandbox)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-mist/60 align-top">
                  <td className="px-5 py-3">
                    {r.companyId ? (
                      <Link
                        to="/admin/companies/$companyId"
                        params={{ companyId: r.companyId }}
                        search={{}}
                        className="font-semibold text-navy hover:text-brand"
                      >
                        {r.companyName ?? "—"}
                      </Link>
                    ) : (
                      <span className="font-semibold text-navy">{r.companyName ?? "—"}</span>
                    )}
                    <p className="text-xs text-muted">{r.accountEmail ?? "—"}</p>
                  </td>
                  <td className="px-3 py-3">
                    <span className="font-semibold text-navy">{r.planName ?? "—"}</span>
                    {r.planCode && <p className="text-xs text-muted">{r.planCode}</p>}
                  </td>
                  <td className="px-3 py-3">{fmtAed(r.priceAel)}</td>
                  <td className="px-3 py-3 capitalize text-muted">{r.billingInterval}</td>
                  <td className="px-3 py-3">
                    <Badge tone={statusTones[r.status] ?? "slate"}>{r.statusLabel}</Badge>
                  </td>
                  <td className="px-3 py-3 text-muted">{fmtDate(r.startedAt)}</td>
                  <td className="px-3 py-3 text-muted">
                    {fmtDate(r.currentPeriodStart)} → {fmtDate(r.currentPeriodEnd)}
                  </td>
                  <td className="px-3 py-3 text-muted">{fmtDate(r.nextBillingDate)}</td>
                  <td className="px-3 py-3 text-muted">
                    {fmtDate(r.commitmentStart)} → {fmtDate(r.commitmentEnd)}
                    {r.commitmentCompleted && (
                      <p className="text-xs font-semibold text-success">completed</p>
                    )}
                  </td>
                  <td className="px-3 py-3 text-muted">{fmtDate(r.downgradeEligibleDate)}</td>
                  <td className="px-3 py-3">
                    {r.paymentStatus ? (
                      <>
                        <Badge tone={paymentTones[r.paymentStatus] ?? "slate"}>{r.paymentStatus}</Badge>
                        {r.outstandingInvoices > 0 && (
                          <p className="mt-1 text-xs text-red-600">
                            {r.outstandingInvoices} open invoice{r.outstandingInvoices === 1 ? "" : "s"}
                          </p>
                        )}
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-muted">
                    {[r.pendingUpgrade && `Upgrade: ${r.pendingUpgrade}`, r.pendingDowngrade && `Downgrade: ${r.pendingDowngrade}`]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </td>
                  <td className="px-3 py-3 text-muted">{r.cancellationStatus ?? "—"}</td>
                  <td className="px-5 py-3 text-xs text-muted">
                    <p>Customer: {r.providerCustomerId ?? "—"}</p>
                    <p>Subscription: {r.providerSubscriptionId ?? "—"}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
