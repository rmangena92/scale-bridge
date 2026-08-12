import { createFileRoute } from "@tanstack/react-router";
import { getAdminSession, getAdminReports } from "~/lib/admin";
import type { AdminReportsData } from "~/lib/admin";
import { Badge, Card, DbSetupPage, EmptyState, ErrorText } from "~/components/ui";
export const Route = createFileRoute("/admin/reports")({
  loader: async () => {
    const session = await getAdminSession();
    const result = await getAdminReports();
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      allowed: result.ok ? result.allowed : false,
      data: result.ok && result.allowed ? result.data : null,
      loadError: result.ok ? null : result.error,
    };
  },
  component: ReportsPage,
});

const SUB_STATUS_LABELS: Record<string, string> = {
  pending_plan_selection: "Pending plan selection",
  checkout_started: "Checkout started",
  payment_pending: "Payment pending",
  active: "Active",
  past_due: "Past due",
  payment_failed: "Payment failed",
  upgrade_pending: "Upgrade pending",
  downgrade_scheduled: "Downgrade scheduled",
  cancellation_requested: "Cancellation requested",
  cancel_at_period_end: "Cancel at period end",
  cancelled: "Cancelled",
  expired: "Expired",
  suspended: "Suspended",
};
const statusTone: Record<string, "green" | "red" | "amber" | "slate" | "blue" | "teal"> = {
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
const LIFE_LABELS: Record<string, string> = {
  created: "Created",
  upgraded: "Upgraded",
  downgraded: "Downgraded",
  cancelled: "Cancelled",
  resumed: "Resumed",
  expired: "Expired",
  suspended: "Suspended",
  plan_changed: "Plan changed",
};
const PLAN_LABELS: Record<string, string> = {
  open: "Open Free",
  verified: "Verified",
  growth: "Growth",
  strategic: "Strategic",
  anchor_starter: "Anchor Starter",
  anchor_professional: "Anchor Professional",
  anchor_enterprise: "Anchor Enterprise",
};
const planLabel = (code: string | null): string =>
  code ? (PLAN_LABELS[code] ?? code) : "No plan";

function fmtAel(v: number | null | undefined): string {
  if (v === null || v === undefined) return "-";
  return `AED ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtGbpCents(v: number): string {
  return `£${(v / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(v: string | null | undefined): string {
  if (!v) return "-";
  return new Date(v).toISOString().slice(0, 10);
}

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="mt-6 p-6">
      <h2 className="text-base font-bold text-slate-900">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </Card>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-5">
      <p className="text-xs font-bold uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 p-6">
        <EmptyState title="No data" body="Nothing to show for this report yet." />
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
            {head.map((h) => (
              <th key={h} className="px-3 py-3 first:pl-0">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-mist/60 align-top">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2.5 first:pl-0">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportsPage() {
  const { setupRequired, admin, allowed, data, loadError } = Route.useLoaderData();
  if (setupRequired) {
    return (
      <DbSetupPage title="Reports">
        Connect a Postgres database (DATABASE_URL) to view financial and subscription reports.
      </DbSetupPage>
    );
  }
  if (!admin) return null;
  if (!allowed || !data) {
    return (
      <div>
        <div className="mb-6">
          <p className="text-sm font-bold uppercase tracking-widest text-teal">Reports</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Financial and subscription reports</h1>
        </div>
        <Card className="p-6">
          <p className="text-sm font-semibold text-slate-900">Role-restricted report</p>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Financial and subscription reports are available to Super admin, Operations and
            Finance staff roles only. Your role ({admin.staffRoles.join(", ") || "none"}) does not
            have access. Contact a Super admin to request access.
          </p>
        </Card>
        {loadError && (
          <div className="mt-5">
            <ErrorText>{loadError}</ErrorText>
          </div>
        )}
      </div>
    );
  }
  return <ReportsView data={data} loadError={loadError} />;
}

function ReportsView({ data, loadError }: { data: AdminReportsData; loadError: string | null }) {
  const totalSubPaid = data.subInvoicesByStatus
    .filter((x) => x.status === "Paid")
    .reduce((a, x) => a + x.totalAel, 0);
  const totalSubOpen = data.subInvoicesByStatus
    .filter((x) => x.status === "Open")
    .reduce((a, x) => a + x.totalAel, 0);
  const totalSubInvoiced = data.subInvoicesByStatus.reduce((a, x) => a + x.totalAel, 0);
  const activeCount = data.subsByStatus.find((x) => x.status === "active")?.count ?? 0;
  const pendingCount = data.pendingChanges.length;
  const inLock = data.commitments.find((x) => !x.completed)?.count ?? 0;
  const completedCommitments = data.commitments.find((x) => x.completed)?.count ?? 0;
  const overrideCount = data.commitmentOverrides.reduce((a, x) => a + x.count, 0);
  const failedCount = data.subInvoicesByStatus.find((x) => x.status === "Failed")?.count ?? 0;

  return (
    <div>
      <div className="mb-2">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">Reports</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Financial and subscription reports</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Live figures from the subscription and contract databases, computed at page load.
          Subscription revenue is in AED; contract invoice amounts are stored in GBP.
        </p>
      </div>
      {loadError && (
        <div className="mt-5">
          <ErrorText>{loadError}</ErrorText>
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Sub revenue paid" value={fmtAel(totalSubPaid)} hint="Paid subscription invoices" />
        <Kpi label="Sub revenue invoiced" value={fmtAel(totalSubInvoiced)} hint="All subscription invoices" />
        <Kpi label="Active subscriptions" value={String(activeCount)} hint="Status: active" />
        <Kpi label="Pending changes" value={String(pendingCount)} hint="Upgrade, downgrade or cancellation in flight" />
      </div>

      <SectionCard
        title="Subscription revenue by plan"
        subtitle="Subscription invoices joined to membership plans (AED)."
      >
        <Table
          head={["Plan", "Category", "Invoices", "Invoiced", "Paid"]}
          rows={data.subRevenueByPlan.map((r) => [
            planLabel(r.planCode),
            r.category === "anchor" ? "Anchor" : "Partner",
            String(r.count),
            fmtAel(r.invoicedAel),
            fmtAel(r.paidAel),
          ])}
        />
      </SectionCard>

      <SectionCard
        title="Subscription revenue by month"
        subtitle="Paid subscription invoices by paid_at month (AED)."
      >
        <Table
          head={["Month", "Invoices paid", "Amount"]}
          rows={data.subRevenueByMonth.map((r) => [r.ym, String(r.count), fmtAel(r.totalAel)])}
        />
      </SectionCard>

      <SectionCard
        title="Recent payment events"
        subtitle="Latest sandbox billing-provider events with provider event IDs."
      >
        <Table
          head={["When", "Event", "Invoice", "Amount", "Provider event ID"]}
          rows={data.recentPaymentEvents.map((e) => [
            fmtDate(e.occurredAt),
            e.eventType === "payment_succeeded" ? (
              <Badge tone="green">succeeded</Badge>
            ) : e.eventType === "payment_failed" ? (
              <Badge tone="red">failed</Badge>
            ) : (
              <Badge tone="slate">{e.eventType}</Badge>
            ),
            e.invoiceNumber ?? "-",
            e.amountAel === null ? "-" : fmtAel(e.amountAel),
            e.providerEventId ?? "-",
          ])}
        />
      </SectionCard>

      <SectionCard
        title="Contract invoice revenue"
        subtitle="Workspace contract invoices by status (GBP). Outstanding excludes paid, cancelled and rejected."
      >
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Kpi label="Invoices" value={String(data.contractInvoicesTotal.count)} />
          <Kpi label="Paid" value={fmtGbpCents(data.contractInvoicesTotal.paidCents)} />
          <Kpi label="Outstanding" value={fmtGbpCents(data.contractInvoicesTotal.outstandingCents)} />
        </div>
        <Table
          head={["Status", "Count", "Total"]}
          rows={data.contractInvoicesByStatus.map((r) => [
            r.status,
            String(r.count),
            fmtGbpCents(r.totalCents),
          ])}
        />
        <div className="mt-5">
          <p className="mb-2 text-sm font-bold text-slate-900">By month (created)</p>
          <Table
            head={["Month", "Invoices", "Total"]}
            rows={data.contractInvoicesByMonth.map((r) => [
              r.ym,
              String(r.count),
              fmtGbpCents(r.totalCents),
            ])}
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Active subscriptions by plan"
        subtitle="Subscriptions currently in the active state, counted per membership plan."
      >
        <Table
          head={["Plan", "Category", "Active subscriptions"]}
          rows={data.activeSubsByPlan.map((r) => [
            planLabel(r.planCode),
            r.category === "anchor" ? "Anchor" : "Partner",
            String(r.count),
          ])}
        />
      </SectionCard>

      <SectionCard
        title="Subscription status distribution"
        subtitle="All subscriptions across the 13-status state machine."
      >
        <Table
          head={["Status", "Count"]}
          rows={data.subsByStatus.map((r) => [
            <Badge tone={statusTone[r.status] ?? "slate"}>{SUB_STATUS_LABELS[r.status] ?? r.status}</Badge>,
            String(r.count),
          ])}
        />
      </SectionCard>

      <SectionCard
        title="Subscription lifecycle"
        subtitle="Change types recorded in subscription_history (created, upgraded, downgraded, cancelled, plan changes)."
      >
        <Table
          head={["Change type", "Count"]}
          rows={data.lifecycle.map((r) => [LIFE_LABELS[r.changeType] ?? r.changeType, String(r.count)])}
        />
      </SectionCard>

      <SectionCard
        title="Upgrade, downgrade and cancellation requests"
        subtitle="Requests by type and status (upgrade_requests, downgrade_requests, cancellation_requests)."
      >
        <Table
          head={["Type", "Status", "Count"]}
          rows={data.requests.map((r) => [
            r.kind === "upgrade" ? "Upgrade" : r.kind === "downgrade" ? "Downgrade" : "Cancellation",
            r.status,
            String(r.count),
          ])}
        />
      </SectionCard>

      <SectionCard
        title="Minimum commitment status"
        subtitle="Three-month minimum commitment records; an active override lifts or adjusts the lock."
      >
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Kpi label="In lock" value={String(inLock)} hint="Commitment not yet completed" />
          <Kpi label="Completed" value={String(completedCommitments)} hint="Minimum commitment satisfied" />
          <Kpi label="Overrides" value={String(overrideCount)} hint="Commitment overrides across statuses" />
        </div>
        {data.commitmentOverrides.length > 0 && (
          <Table
            head={["Override status", "Count"]}
            rows={data.commitmentOverrides.map((r) => [r.status, String(r.count)])}
          />
        )}
      </SectionCard>

      <SectionCard
        title="Pending changes"
        subtitle="Subscriptions with an in-flight change: upgrade pending, downgrade scheduled, cancellation at period end or payment recovery."
      >
        <Table
          head={["Company", "Account email", "Plan", "Interval", "Status"]}
          rows={data.pendingChanges.map((r) => [
            r.companyName ?? "-",
            r.accountEmail ?? "-",
            planLabel(r.planCode),
            r.billingInterval,
            <Badge tone={statusTone[r.status] ?? "amber"}>{SUB_STATUS_LABELS[r.status] ?? r.status}</Badge>,
          ])}
        />
      </SectionCard>

      <SectionCard
        title="Membership plan prices"
        subtitle="Published plan price table (AED). Annual is two months free; Enterprise is custom."
      >
        <Table
          head={["Plan", "Category", "Monthly", "Annual", "Status"]}
          rows={data.plans.map((r) => [
            `${r.name} (${r.code})`,
            r.category === "anchor" ? "Anchor" : "Partner",
            r.priceMonthlyAel === null ? "Custom" : fmtAel(r.priceMonthlyAel),
            r.priceAnnualAel === null ? "Custom" : fmtAel(r.priceAnnualAel),
            r.status === "Active" ? <Badge tone="green">Active</Badge> : <Badge tone="slate">{r.status}</Badge>,
          ])}
        />
      </SectionCard>

      <SectionCard
        title="Billing webhook events"
        subtitle={`Billing-provider webhooks received (sandbox). Total: ${data.webhookTotals.count}${
          data.webhookTotals.lastReceived ? `, last received ${fmtDate(data.webhookTotals.lastReceived)}` : ""
        }.`}
      >
        <Table
          head={["Provider", "Event type", "Count"]}
          rows={data.webhookByType.map((r) => [r.provider, r.eventType, String(r.count)])}
        />
      </SectionCard>

      <p className="mt-6 text-xs text-muted">
        Figures are read directly from the database with admin RLS context at page load. Failed
        subscription invoices ({failedCount}) are included in invoiced but not in paid totals; open
        subscription invoices total {fmtAel(totalSubOpen)}.
      </p>
    </div>
  );
}
