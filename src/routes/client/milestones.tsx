import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { getClientSession, listClientMilestones, resolveClientOrg } from "~/lib/client";
import type { ClientMilestone } from "~/lib/types";
import {
  CLIENT_MILESTONE_STATUS_LABELS,
  CLIENT_MILESTONE_STATUS_TONES,
} from "~/lib/types";
import { Badge, Card, DbSetupPage, EmptyState, ErrorText, Select } from "~/components/ui";
import { canReview, fmtDate, MilestoneReviewForm, isPending } from "~/components/client-review";
import { useClientPortal } from "~/components/ClientShell";

export const Route = createFileRoute("/client/milestones")({
  validateSearch: (search: Record<string, unknown>) => ({
    org: typeof search.org === "string" ? search.org : undefined,
    review: typeof search.review === "string" ? search.review : undefined,
  }),
  loaderDeps: ({ search }) => ({ org: search.org }),
  loader: async ({ deps }) => {
    const session = await getClientSession();
    if (!session.client) {
      return { setupRequired: session.setupRequired, orgId: null, milestones: [], loadError: null };
    }
    const org = resolveClientOrg(session.client, deps.org);
    const result = await listClientMilestones({ data: { orgId: org.orgId } });
    return {
      setupRequired: session.setupRequired,
      orgId: org.orgId,
      milestones: result.ok ? result.data : [],
      loadError: result.ok ? null : result.error,
    };
  },
  component: MilestonesPage,
});

function MilestonesPage() {
  const { setupRequired, orgId, milestones: initial, loadError } = Route.useLoaderData();
  const { org } = useClientPortal();
  const [milestones, setMilestones] = useState<ClientMilestone[]>(initial);
  const [ws, setWs] = useState("all");
  const [openId, setOpenId] = useState<string | null>(Route.useSearch().review ?? null);
  const [notice, setNotice] = useState<string | null>(null);

  const workspaces = useMemo(() => {
    const seen = new Map<string, string | null>();
    for (const m of milestones) {
      if (!seen.has(m.workspaceId)) seen.set(m.workspaceId, m.workspaceTitle);
    }
    return [...seen.entries()].map(([workspaceId, title]) => ({ workspaceId, title }));
  }, [milestones]);

  const visible = ws === "all" ? milestones : milestones.filter((m) => m.workspaceId === ws);
  const canAct = canReview(org.role, "milestone");

  if (setupRequired) {
    return (
      <DbSetupPage title="Milestones">
        Connect a Postgres database (DATABASE_URL) to view milestones.
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

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-teal">Milestones</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Delivery milestones</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Sign off submitted milestones or send them back for changes. Completed milestones
            count towards overall contract progress.
          </p>
        </div>
        {workspaces.length > 1 && (
          <Select className="w-64" value={ws} onChange={(e) => setWs(e.target.value)} aria-label="Filter by contract">
            <option value="all">All contracts</option>
            {workspaces.map((w) => (
              <option key={w.workspaceId} value={w.workspaceId}>
                {w.title ?? "Contract"}
              </option>
            ))}
          </Select>
        )}
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

      {visible.length === 0 ? (
        <EmptyState
          title="No milestones scheduled"
          body="When the lead contractor schedules delivery milestones they will appear here."
        />
      ) : (
        <Card className="divide-y divide-slate-100 p-0">
          {visible.map((m) => {
            const pending = isPending("milestone", m.status);
            const open = openId === m.id;
            return (
              <div key={m.id} className="px-6 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-navy">{m.title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                      <span>{m.workspaceTitle ?? "Contract"}</span>
                      {m.workPackageName && <span>{m.workPackageName}</span>}
                      <span>Due {fmtDate(m.dueDate)}</span>
                      {m.reviewedByEmail && <span>Reviewed by {m.reviewedByEmail}</span>}
                    </p>
                    {m.description && (
                      <p className="mt-1 line-clamp-2 max-w-2xl text-xs leading-relaxed text-muted">
                        {m.description}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={CLIENT_MILESTONE_STATUS_TONES[m.status]}>
                      {CLIENT_MILESTONE_STATUS_LABELS[m.status]}
                    </Badge>
                    {pending && canAct && (
                      <button
                        type="button"
                        onClick={() => setOpenId(open ? null : m.id)}
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-navy transition-colors hover:border-brand hover:text-brand"
                      >
                        {open ? "Close review" : "Sign off"}
                      </button>
                    )}
                  </div>
                </div>
                {open && pending && (
                  <div className="mt-3">
                    <MilestoneReviewForm
                      orgId={orgId}
                      milestone={m}
                      onCancel={() => setOpenId(null)}
                      onSuccess={(decision) => {
                        setMilestones((prev) =>
                          prev.map((x) =>
                            x.id === m.id
                              ? {
                                  ...x,
                                  status: decision === "approved" ? "approved" : "needs_changes",
                                  reviewedAt: new Date().toISOString(),
                                }
                              : x,
                          ),
                        );
                        setOpenId(null);
                        setNotice(
                          `${m.title} — ${decision === "approved" ? "signed off" : "changes requested"}.`,
                        );
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}

      <p className="mt-4 text-xs text-muted">
        Need to see these in context?{" "}
        <Link to="/client/contracts" search={{ org: orgId }} className="font-semibold text-brand hover:underline">
          View your contracts
        </Link>
        .
      </p>
    </div>
  );
}
