import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { getAdminSession, listDisputes } from "~/lib/admin";
import {
  SUPPORT_CASE_BADGE_TONES,
  SUPPORT_CASE_PRIORITY_LABELS,
  SUPPORT_CASE_PRIORITY_TONES,
  SUPPORT_CASE_STATUS_LABELS,
} from "~/lib/types";
import { Badge, Card, DbSetupPage, EmptyState, ErrorText } from "~/components/ui";

export const Route = createFileRoute("/admin/disputes")({
  loader: async () => {
    const session = await getAdminSession();
    const result = await listDisputes();
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      disputes: result.ok ? result.disputes : [],
      loadError: result.ok ? null : result.error,
    };
  },
  component: DisputesPage,
});

function DisputesPage() {
  const { setupRequired, admin, disputes, loadError } = Route.useLoaderData();
  if (setupRequired) {
    return (
      <DbSetupPage title="Disputes">
        Connect a Postgres database (DATABASE_URL) to view disputes.
      </DbSetupPage>
    );
  }
  if (!admin) return null;

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">Disputes</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Disputes</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Escalated support cases tagged as disputes. A dedicated dispute
          workflow lands with the contract workspace build.
        </p>
      </div>

      {loadError && (
        <div className="mb-6">
          <ErrorText>{loadError}</ErrorText>
        </div>
      )}

      <Card>
        {disputes.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No disputes"
              body="No open or closed disputes. Dispute cases raised through support appear here."
            />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {disputes.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <Link
                    to="/admin/support/$caseId"
                    params={{ caseId: d.id }}
                    className="font-semibold text-navy hover:text-brand"
                  >
                    {d.caseNumber}
                  </Link>
                  <p className="truncate text-xs text-muted">
                    {d.workspaceTitle ?? "No workspace"} · {d.category ?? "dispute"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={SUPPORT_CASE_PRIORITY_TONES[d.priority as keyof typeof SUPPORT_CASE_PRIORITY_TONES] ?? "slate"}>
                    {SUPPORT_CASE_PRIORITY_LABELS[d.priority as keyof typeof SUPPORT_CASE_PRIORITY_LABELS] ?? d.priority}
                  </Badge>
                  <Badge tone={SUPPORT_CASE_BADGE_TONES[d.status as keyof typeof SUPPORT_CASE_BADGE_TONES] ?? "slate"}>
                    {SUPPORT_CASE_STATUS_LABELS[d.status as keyof typeof SUPPORT_CASE_STATUS_LABELS] ?? d.status}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
