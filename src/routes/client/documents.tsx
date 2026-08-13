import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { getClientSession, listClientDocuments, resolveClientOrg } from "~/lib/client";
import type { ClientDocument } from "~/lib/types";
import {
  CLIENT_DOCUMENT_CATEGORY_LABELS,
  CLIENT_DOCUMENT_STATUS_LABELS,
  CLIENT_DOCUMENT_STATUS_TONES,
} from "~/lib/types";
import { Badge, Card, DbSetupPage, EmptyState, ErrorText, Select } from "~/components/ui";
import { canReview, DocumentReviewForm, fmtDateTime, isPending } from "~/components/client-review";
import { useClientPortal } from "~/components/ClientShell";

export const Route = createFileRoute("/client/documents")({
  validateSearch: (search: Record<string, unknown>) => ({
    org: typeof search.org === "string" ? search.org : undefined,
    review: typeof search.review === "string" ? search.review : undefined,
  }),
  loaderDeps: ({ search }) => ({ org: search.org }),
  loader: async ({ deps }) => {
    const session = await getClientSession();
    if (!session.client) {
      return { setupRequired: session.setupRequired, orgId: null, docs: [], loadError: null };
    }
    const org = resolveClientOrg(session.client, deps.org);
    const result = await listClientDocuments({ data: { orgId: org.orgId } });
    return {
      setupRequired: session.setupRequired,
      orgId: org.orgId,
      docs: result.ok ? result.data : [],
      loadError: result.ok ? null : result.error,
    };
  },
  component: DocumentsPage,
});

function DocumentsPage() {
  const { setupRequired, orgId, docs: initial, loadError } = Route.useLoaderData();
  const { org } = useClientPortal();
  const [docs, setDocs] = useState<ClientDocument[]>(initial);
  const [ws, setWs] = useState("all");
  const [openId, setOpenId] = useState<string | null>(Route.useSearch().review ?? null);
  const [notice, setNotice] = useState<string | null>(null);

  const workspaces = useMemo(() => {
    const seen = new Map<string, string | null>();
    for (const d of docs) {
      if (!seen.has(d.workspaceId)) seen.set(d.workspaceId, d.workspaceTitle);
    }
    return [...seen.entries()].map(([workspaceId, title]) => ({ workspaceId, title }));
  }, [docs]);

  const visible = ws === "all" ? docs : docs.filter((d) => d.workspaceId === ws);
  const canAct = canReview(org.role, "document");

  if (setupRequired) {
    return (
      <DbSetupPage title="Documents">
        Connect a Postgres database (DATABASE_URL) to view contract documents.
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
          <p className="text-sm font-bold uppercase tracking-widest text-teal">Documents</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Contract documents</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Review documents the lead contractor shares with your organisation. Items under
            review can be approved or sent back for changes.
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
          title="No documents shared yet"
          body="Client-visible documents shared by the lead contractor will appear here for review."
        />
      ) : (
        <Card className="divide-y divide-slate-100 p-0">
          {visible.map((d) => {
            const pending = isPending("document", d.status);
            const open = openId === d.id;
            return (
              <div key={d.id} className="px-6 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-navy">{d.title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                      <span>{d.workspaceTitle ?? "Contract"}</span>
                      {d.category && (
                        <span className="text-teal">
                          {CLIENT_DOCUMENT_CATEGORY_LABELS[d.category] ?? d.category}
                        </span>
                      )}
                      <span>Shared {fmtDateTime(d.sharedAt ?? d.createdAt)}</span>
                      {d.uploadedByEmail && <span>by {d.uploadedByEmail}</span>}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={CLIENT_DOCUMENT_STATUS_TONES[d.status]}>
                      {CLIENT_DOCUMENT_STATUS_LABELS[d.status]}
                    </Badge>
                    {pending && canAct && (
                      <button
                        type="button"
                        onClick={() => setOpenId(open ? null : d.id)}
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-navy transition-colors hover:border-brand hover:text-brand"
                      >
                        {open ? "Close review" : "Review"}
                      </button>
                    )}
                  </div>
                </div>
                {open && pending && (
                  <div className="mt-3">
                    <DocumentReviewForm
                      orgId={orgId}
                      document={d}
                      onCancel={() => setOpenId(null)}
                      onSuccess={(decision) => {
                        setDocs((prev) =>
                          prev.map((x) =>
                            x.id === d.id
                              ? {
                                  ...x,
                                  status: decision === "approved" ? "approved" : "needs_changes",
                                }
                              : x,
                          ),
                        );
                        setOpenId(null);
                        setNotice(`${d.title} — ${decision === "approved" ? "approved" : "changes requested"}.`);
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
