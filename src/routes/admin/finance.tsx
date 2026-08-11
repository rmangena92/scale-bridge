import { createFileRoute } from "@tanstack/react-router";
import { getAdminSession, getFinanceSummary } from "~/lib/admin";
import { Badge, Card, DbSetupPage, EmptyState, ErrorText } from "~/components/ui";

export const Route = createFileRoute("/admin/finance")({
  loader: async () => {
    const session = await getAdminSession();
    const result = await getFinanceSummary();
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      summary: result.ok ? result.summary : null,
      loadError: result.ok ? null : result.error,
    };
  },
  component: FinancePage,
});

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  correction_required: "Correction required",
  scheduled_for_payment: "Scheduled for payment",
  paid: "Paid",
  overdue: "Overdue",
  cancelled: "Cancelled",
  corrections_requested: "Corrections requested",
};

function FinancePage() {
  const { setupRequired, admin, summary, loadError } = Route.useLoaderData();
  if (setupRequired) {
    return (
      <DbSetupPage title="Finance">
        Connect a Postgres database (DATABASE_URL) to view the finance summary.
      </DbSetupPage>
    );
  }
  if (!admin) return null;

  const pounds = (cents: number) =>
    `£${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">Finance</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Finance</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Invoice and payment overview. The platform has no real payment flow
          yet — figures below are contract invoice records only.
        </p>
      </div>

      {loadError && (
        <div className="mb-6">
          <ErrorText>{loadError}</ErrorText>
        </div>
      )}

      {summary && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card className="p-5">
              <p className="text-xs font-bold uppercase tracking-wider text-muted">Invoices</p>
              <p className="mt-2 font-display text-3xl font-bold text-navy">{summary.invoiceCount}</p>
            </Card>
            <Card className="p-5">
              <p className="text-xs font-bold uppercase tracking-wider text-muted">Outstanding</p>
              <p className="mt-2 font-display text-3xl font-bold text-amber">{pounds(summary.outstandingTotalCents)}</p>
            </Card>
            <Card className="p-5">
              <p className="text-xs font-bold uppercase tracking-wider text-muted">Paid</p>
              <p className="mt-2 font-display text-3xl font-bold text-success">{pounds(summary.paidTotalCents)}</p>
            </Card>
          </div>

          <Card className="mt-6 overflow-x-auto">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-lg font-bold">Invoices by status</h2>
            </div>
            {summary.byStatus.length === 0 ? (
              <div className="p-6">
                <EmptyState title="No invoices" body="Invoice records appear here once contracts produce them." />
              </div>
            ) : (
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                    <th className="px-5 py-3">Status</th>
                    <th className="px-3 py-3">Count</th>
                    <th className="px-5 py-3">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.byStatus.map((r: { status: string; count: number; totalCents: number }) => (
                    <tr key={r.status} className="hover:bg-mist/60">
                      <td className="px-5 py-3">
                        <Badge tone={r.status === "paid" ? "green" : r.status === "overdue" ? "red" : r.status === "cancelled" || r.status === "rejected" ? "slate" : "amber"}>
                          {STATUS_LABELS[r.status] ?? r.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-muted">{r.count}</td>
                      <td className="px-5 py-3 font-semibold text-navy">{pounds(r.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}

      {!summary && !loadError && <p className="text-sm text-muted">Loading finance summary…</p>}
    </div>
  );
}
