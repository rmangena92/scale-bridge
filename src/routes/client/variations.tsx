import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { getClientSession, listClientVariations, resolveClientOrg } from "~/lib/client";
import type { ClientVariation } from "~/lib/types";
import {
  CLIENT_VARIATION_STATUS_LABELS,
  CLIENT_VARIATION_STATUS_TONES,
} from "~/lib/types";
import { Badge, Card, DbSetupPage, EmptyState, ErrorText, Select } from "~/components/ui";
import { canReview, fmtMoneyCents, isPending, VariationReviewForm } from "~/components/client-review";
import { useClientPortal } from "~/components/ClientShell";

export const Route = createFileRoute("/client/variations")({
  validateSearch: (search: Record<string, unknown>) => ({
    org: typeof search.org === "string" ? search.org : undefined,
    review: typeof search.review === "string" ? search.review : undefined,
  }),
  loaderDeps: ({ search }) => ({ org: search.org }),
  loader: async ({ deps }) => {
    const session = await getClientSession();
    if (!session.client) {
      return { setupRequired: session.setupRequired, orgId: null, variations: [], loadError: null };
    }
    const org = resolveClientOrg(session.client, deps.org);
    const result = await listClientVariations({ data: { orgId: org.orgId } });
    return {
      setupRequired: session.setupRequired,
      orgId: org.orgId,
      variations: result.ok ? result.data : [],
      loadError: result.ok ? null : result.error,
    };
  },
  component: VariationsPage,
});

function VariationsPage() {
  const { setupRequired, orgId, variations: initial, loadError } = Route.useLoaderData();
  const { org } = useClientPortal();
  const [variations, setVariations] = useState<ClientVariation[]>(initial);
  const [ws, setWs] = useState("all");
  const [openId, setOpenId] = useState<string | null>(Route.useSearch().review ?? null);
  const [notice, setNotice] = useState<string | null>(null);

  const workspaces = useMemo(() => {
    const seen = new Map<string, string | null>();
    for (const v of variations) {
      if (!seen.has(v.workspaceId)) seen.set(v.workspaceId, v.workspaceTitle);
    }
    return [...seen.entries()].map(([workspaceId, title]) => ({ workspaceId, title }));
  }, [variations]);

  const visible = ws === "all" ? variations : variations.filter((v) => v.workspaceId === ws);
  const canAct = canReview(org.role, "variation");

  if (setupRequired) {
    return (
      <DbSetupPage title="Variations">
        Connect a Postgres database (DATABASE_URL) to view variation requests.
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
          <p className="text-sm font-bold uppercase tracking-widest text-teal">Variations</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Variation requests</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Approve, reject or ask for clarification on scope and price changes proposed by the
            lead contractor.
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
          title="No variations proposed"
          body="Scope or price changes proposed by the lead contractor will appear here for your decision."
        />
      ) : (
        <Card className="divide-y divide-slate-100 p-0">
          {visible.map((v) => {
            const pending = isPending("variation", v.status);
            const open = openId === v.id;
            return (
              <div key={v.id} className="px-6 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-navy">{v.title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                      <span>{v.workspaceTitle ?? "Contract"}</span>
                      {v.workPackageName && <span>{v.workPackageName}</span>}
                      {v.proposedAmountCents != null && (
                        <span className="font-semibold text-ink">
                          {fmtMoneyCents(v.proposedAmountCents)}
                        </span>
                      )}
                      {v.decidedByEmail && <span>Decided by {v.decidedByEmail}</span>}
                    </p>
                    {(v.description || v.reason) && (
                      <p className="mt-1 line-clamp-2 max-w-2xl text-xs leading-relaxed text-muted">
                        {v.description ?? v.reason}
                      </p>
                    )}
                    {v.conditions && (
                      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-teal">
                        Conditions: {v.conditions}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={CLIENT_VARIATION_STATUS_TONES[v.status]}>
                      {CLIENT_VARIATION_STATUS_LABELS[v.status]}
                    </Badge>
                    {pending && canAct && (
                      <button
                        type="button"
                        onClick={() => setOpenId(open ? null : v.id)}
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-navy transition-colors hover:border-brand hover:text-brand"
                      >
                        {open ? "Close review" : "Decide"}
                      </button>
                    )}
                  </div>
                </div>
                {open && pending && (
                  <div className="mt-3">
                    <VariationReviewForm
                      orgId={orgId}
                      variation={v}
                      onCancel={() => setOpenId(null)}
                      onSuccess={(decision) => {
                        setVariations((prev) =>
                          prev.map((x) =>
                            x.id === v.id ? { ...x, status: decision } : x,
                          ),
                        );
                        setOpenId(null);
                        setNotice(
                          `${v.title} — ${
                            decision === "approved"
                              ? "approved"
                              : decision === "rejected"
                                ? "rejected"
                                : decision === "conditions"
                                  ? "approved with conditions"
                                  : "clarification requested"
                          }.`,
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
        Need the full delivery context?{" "}
        <Link to="/client/contracts" search={{ org: orgId }} className="font-semibold text-brand hover:underline">
          View your contracts
        </Link>
        .
      </p>
    </div>
  );
}
