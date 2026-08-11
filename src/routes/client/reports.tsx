import { createFileRoute } from "@tanstack/react-router";
import { Badge, Button, Card, DbSetupPage, EmptyState, ErrorText } from "~/components/ui";
import {
  getClientSession,
  listClientProgressReports,
  resolveClientOrg,
} from "~/lib/client";
import type { ClientProgressReport } from "~/lib/types";

export const Route = createFileRoute("/client/reports")({
  validateSearch: (search: Record<string, unknown>) => ({
    org: typeof search.org === "string" ? search.org : undefined,
  }),
  loaderDeps: ({ search }) => ({ org: search.org }),
  loader: async ({ deps }) => {
    const session = await getClientSession();
    if (!session.client) {
      return { setupRequired: session.setupRequired, orgId: null, reports: [], loadError: null };
    }
    const org = resolveClientOrg(session.client, deps.org);
    const result = await listClientProgressReports({ data: { orgId: org.orgId } });
    return {
      setupRequired: session.setupRequired,
      orgId: org.orgId,
      reports: result.ok ? result.data : [],
      loadError: result.ok ? null : result.error,
    };
  },
  component: ReportsPage,
});

function fmtDate(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
function fmtTime(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) +
    " · " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}

function ReportsPage() {
  const { setupRequired, orgId, reports, loadError } = Route.useLoaderData();
  if (setupRequired) {
    return (
      <DbSetupPage title="Reports">
        Connect a Postgres database (DATABASE_URL) to view reports.
      </DbSetupPage>
    );
  }
  if (!orgId) return null;
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-teal">Reports</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Progress reports</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Client-facing progress and delivery reports submitted by the lead contractor.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge tone="slate">{reports.length} report{reports.length === 1 ? "" : "s"}</Badge>
          <Button
            variant="outline"
            size="sm"
            disabled
            title="Exports will be available in a later release"
          >
            Export all (coming soon)
          </Button>
        </div>
      </div>
      {loadError && (
        <div className="mb-6">
          <ErrorText>{loadError}</ErrorText>
        </div>
      )}
      {reports.length === 0 && !loadError ? (
        <EmptyState
          title="No reports yet"
          body="Progress reports submitted by your lead contractor will appear here."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {reports.map((r) => (
            <ReportCard key={r.id} report={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReportCard({ report }: { report: ClientProgressReport }) {
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-bold text-navy">{report.title ?? "Progress report"}</p>
          <p className="mt-0.5 text-sm text-muted">
            {report.workspaceTitle}
            {report.milestoneTitle ? ` · ${report.milestoneTitle}` : ""}
          </p>
        </div>
        <Badge tone="teal">
          {fmtDate(report.periodStart)} – {fmtDate(report.periodEnd)}
        </Badge>
      </div>
      {report.body && (
        <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm text-muted">{report.body}</p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs text-muted">
        <span>Submitted by {report.submittedByEmail ?? "the lead contractor"}</span>
        <span aria-hidden>·</span>
        <span>{fmtTime(report.createdAt)}</span>
        <span aria-hidden>·</span>
        <span className="italic">Exports and downloadable PDFs land in a later release.</span>
      </div>
    </Card>
  );
}
