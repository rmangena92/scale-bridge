import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  getClientSession,
  listClientContracts,
  listClientIssues,
  resolveClientOrg,
} from "~/lib/client";
import type { ClientIssue } from "~/lib/types";
import {
  CLIENT_ISSUE_SEVERITY_LABELS,
  CLIENT_ISSUE_STATUS_LABELS,
  CLIENT_ISSUE_STATUS_TONES,
} from "~/lib/types";
import { Badge, Card, DbSetupPage, EmptyState, ErrorText, Select } from "~/components/ui";
import { canReview, fmtDateTime, IssueRaiseForm } from "~/components/client-review";
import { useClientPortal } from "~/components/ClientShell";

export const Route = createFileRoute("/client/issues")({
  validateSearch: (search: Record<string, unknown>) => ({
    org: typeof search.org === "string" ? search.org : undefined,
  }),
  loaderDeps: ({ search }) => ({ org: search.org }),
  loader: async ({ deps }) => {
    const session = await getClientSession();
    if (!session.client) {
      return {
        setupRequired: session.setupRequired,
        orgId: null,
        issues: [],
        workspaces: [],
        loadError: null,
      };
    }
    const org = resolveClientOrg(session.client, deps.org);
    const [issueResult, contractResult] = await Promise.all([
      listClientIssues({ data: { orgId: org.orgId } }),
      listClientContracts({ data: { orgId: org.orgId } }),
    ]);
    return {
      setupRequired: session.setupRequired,
      orgId: org.orgId,
      issues: issueResult.ok ? issueResult.data : [],
      workspaces: contractResult.ok
        ? contractResult.data.map((c) => ({ workspaceId: c.id, title: c.title }))
        : [],
      loadError: issueResult.ok ? null : issueResult.error,
    };
  },
  component: IssuesPage,
});

function IssuesPage() {
  const { setupRequired, orgId, issues: initial, workspaces, loadError } = Route.useLoaderData();
  const { org } = useClientPortal();
  const [issues, setIssues] = useState<ClientIssue[]>(initial);
  const [ws, setWs] = useState("all");
  const [raising, setRaising] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const canRaise = canReview(org.role, "issue");

  const visible = ws === "all" ? issues : issues.filter((i) => i.workspaceId === ws);
  const wsOptions = useMemo(() => {
    const seen = new Map<string, string | null>();
    for (const i of issues) {
      if (!seen.has(i.workspaceId)) seen.set(i.workspaceId, i.workspaceTitle);
    }
    return [...seen.entries()].map(([workspaceId, title]) => ({ workspaceId, title }));
  }, [issues]);

  if (setupRequired) {
    return (
      <DbSetupPage title="Issues">
        Connect a Postgres database (DATABASE_URL) to view issues.
      </DbSetupPage>
    );
  }
  if (!orgId) return null;
  if (loadError) {
    return (
      <div>
        <ErrorText>{loadError}</ErrorText>
      </div>
    );
  }

  async function refresh() {
    const r = await listClientIssues({ data: { orgId } });
    if (r.ok) setIssues(r.data);
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-teal">Issues</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Issues & follow-ups</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Track open issues on your contracts and raise new ones for the lead contractor to
            action. Resolutions are recorded here with the contractor's response.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(wsOptions.length > 1 || workspaces.length > 1) && (
            <Select className="w-56" value={ws} onChange={(e) => setWs(e.target.value)} aria-label="Filter by contract">
              <option value="all">All contracts</option>
              {(wsOptions.length > 1 ? wsOptions : workspaces).map((w) => (
                <option key={w.workspaceId} value={w.workspaceId}>
                  {w.title ?? "Contract"}
                </option>
              ))}
            </Select>
          )}
          {canRaise && (
            <button
              type="button"
              onClick={() => setRaising((v) => !v)}
              className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#145a93]"
            >
              {raising ? "Cancel" : "Raise issue"}
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div className="mb-6 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm font-medium text-success">
          {notice}
          <button
            type="button"
            className="ml-3 font-semibold underline-offset-2 hover:underline"
            onClick={() => setNotice(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {raising && workspaces.length > 0 && (
        <div className="mb-6">
          <IssueRaiseForm
            orgId={orgId}
            workspaces={workspaces}
            onCancel={() => setRaising(false)}
            onSuccess={() => {
              setRaising(false);
              setNotice("Issue raised — the lead contractor has been notified.");
              void refresh();
            }}
          />
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState
          title="No issues to show"
          body="Issues raised on your contracts will appear here with the contractor's responses."
        />
      ) : (
        <Card className="divide-y divide-slate-100 p-0">
          {visible.map((i) => (
            <div key={i.id} className="px-6 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-navy">{i.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    <span>{i.workspaceTitle ?? "Contract"}</span>
                    {i.workPackageName && <span>{i.workPackageName}</span>}
                    <span>
                      Raised {fmtDateTime(i.createdAt)}
                      {i.raisedByEmail ? ` by ${i.raisedByEmail}` : ""}
                    </span>
                  </p>
                  {i.description && (
                    <p className="mt-1 line-clamp-3 max-w-2xl text-xs leading-relaxed text-muted">
                      {i.description}
                    </p>
                  )}
                  {i.response && (
                    <div className="mt-2 max-w-2xl rounded-lg border border-teal/25 bg-teal/5 px-3 py-2">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-teal">
                        Contractor response
                        {i.respondedByEmail ? ` · ${i.respondedByEmail}` : ""}
                        {i.respondedAt ? ` · ${fmtDateTime(i.respondedAt)}` : ""}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-ink">
                        {i.response}
                      </p>
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {i.severity && <Badge tone="navy">{CLIENT_ISSUE_SEVERITY_LABELS[i.severity]}</Badge>}
                  <Badge tone={CLIENT_ISSUE_STATUS_TONES[i.status]}>
                    {CLIENT_ISSUE_STATUS_LABELS[i.status]}
                  </Badge>
                </div>
              </div>
            </div>
          ))}
        </Card>
      )}

      <p className="mt-4 text-xs text-muted">
        Issue status is maintained by the lead contractor —{" "}
        <Link
          to="/client/messages"
          search={{ org: orgId, ws: undefined, thread: undefined }}
          className="font-semibold text-brand hover:underline"
        >
          message them
        </Link>{" "}
        to chase an update.
      </p>
    </div>
  );
}
