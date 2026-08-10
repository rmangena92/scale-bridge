import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import {
  getAdminSession,
  listPendingDocuments,
  getDocumentDetail,
  reviewDocument,
} from "~/lib/admin";
import { DOCUMENT_REVIEW_BADGE_TONES, DOCUMENT_REVIEW_LABELS } from "~/lib/types";
import type { AdminDocumentRow } from "~/lib/types";
import {
  Badge,
  Button,
  Card,
  DbSetupPage,
  EmptyState,
  ErrorText,
  Field,
  Textarea,
} from "~/components/ui";

export const Route = createFileRoute("/admin/documents")({
  loader: async () => {
    const session = await getAdminSession();
    const result = await listPendingDocuments();
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      initial: result.ok ? result.documents : [],
      loadError: result.ok ? null : result.error,
    };
  },
  component: DocumentsReviewPage,
});

function DocumentsReviewPage() {
  const loader = Route.useLoaderData();
  const [documents, setDocuments] = useState<AdminDocumentRow[]>(loader.initial);
  const [error, setError] = useState<string | null>(loader.loadError);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, { action: string; actorEmail: string | null; createdAt: string }[]>>({});
  const [pending, setPending] = useState<string | null>(null);

  if (loader.setupRequired) {
    return (
      <DbSetupPage title="Document review">
        Connect a Postgres database (DATABASE_URL) to review documents.
      </DbSetupPage>
    );
  }
  if (!loader.admin) return null;
  const canMutate = loader.admin.canMutate;

  async function toggle(id: string) {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    setError(null);
    const result = await getDocumentDetail({ data: { documentId: id } });
    if (result.ok) {
      setHistory((h) => ({ ...h, [id]: result.history }));
    } else {
      setError(result.error ?? "Could not load review history.");
    }
  }

  async function act(docId: string, action: "approve" | "reject" | "needs_replacement") {
    setPending(`${docId}:${action}`);
    setError(null);
    const result = await reviewDocument({ data: { documentId: docId, action, comment: comments[docId] ?? "" } });
    setPending(null);
    if (!result.ok) { setError(result.error ?? "Could not record the review."); return; }
    const fresh = await listPendingDocuments();
    if (fresh.ok) setDocuments(fresh.documents);
  }

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">Documents</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Document review</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Licences, certificates, insurance and contract documents awaiting review. Open a document
          to see its metadata and review history, then approve it, reject it or request a replacement.
        </p>
      </div>

      {error && <div className="mb-5"><ErrorText>{error}</ErrorText></div>}

      {!canMutate && (
        <div className="mb-5"><Badge tone="amber">Read-only — you can view documents but not record reviews.</Badge></div>
      )}

      <Card className="overflow-x-auto">
        {documents.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No documents awaiting review" body="New uploads from companies appear here automatically." />
          </div>
        ) : (
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">Document</th>
                <th className="px-3 py-3">Type</th>
                <th className="px-3 py-3">Company</th>
                <th className="px-3 py-3">Workspace</th>
                <th className="px-3 py-3">Expiry</th>
                <th className="px-3 py-3">Uploaded</th>
                <th className="px-5 py-3">Review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {documents.map((d) => {
                const open = openId === d.id;
                return (
                  <Fragment key={d.id}>
                    <tr className="hover:bg-mist/60">
                      <td className="px-5 py-3">
                        <button type="button" onClick={() => toggle(d.id)} className="font-semibold text-navy hover:text-brand">
                          {d.name}
                        </button>
                        <p className="text-xs text-muted">
                          {d.fileUrl ? (
                            <a href={d.fileUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">Download ↗</a>
                          ) : "No file attached"}
                        </p>
                      </td>
                      <td className="px-3 py-3 text-muted">{d.category ?? "—"}</td>
                      <td className="px-3 py-3 text-muted">{d.companyName ?? "—"}</td>
                      <td className="px-3 py-3 text-muted">{d.workspaceTitle ?? "—"}</td>
                      <td className="px-3 py-3">{d.expiryDate ?? "—"}</td>
                      <td className="px-3 py-3 text-xs text-muted">{new Date(d.uploadedAt).toLocaleDateString()}</td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          <Button size="sm" disabled={!canMutate || pending !== null} onClick={() => act(d.id, "approve")}>
                            {pending === `${d.id}:approve` ? "…" : "Approve"}
                          </Button>
                          <Button size="sm" variant="outline" disabled={!canMutate || pending !== null} onClick={() => act(d.id, "reject")}>Reject</Button>
                          <Button size="sm" variant="outline" disabled={!canMutate || pending !== null} onClick={() => act(d.id, "needs_replacement")}>Replacement</Button>
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-mist/40">
                        <td colSpan={7} className="px-5 py-4">
                          <div className="grid gap-4 lg:grid-cols-2">
                            <div>
                              <p className="text-xs font-bold uppercase tracking-wider text-muted">Metadata</p>
                              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                                <dt className="text-muted">Visibility</dt><dd className="font-medium">{d.visibility}</dd>
                                <dt className="text-muted">Status</dt>
                                <dd><Badge tone={DOCUMENT_REVIEW_BADGE_TONES[d.reviewStatus]}>{DOCUMENT_REVIEW_LABELS[d.reviewStatus]}</Badge></dd>
                                <dt className="text-muted">Expiry reminder</dt><dd className="font-medium">{d.expiryReminderAt ? new Date(d.expiryReminderAt).toLocaleString() : "Not set"}</dd>
                                <dt className="text-muted">Uploaded</dt><dd className="font-medium">{new Date(d.uploadedAt).toLocaleString()}</dd>
                              </dl>
                              <div className="mt-4 max-w-lg">
                                <Field label="Review comment (recorded with this decision)" htmlFor={`dr-${d.id}`}>
                                  <Textarea id={`dr-${d.id}`} value={comments[d.id] ?? ""} onChange={(e) => setComments((c) => ({ ...c, [d.id]: e.target.value }))} placeholder="Optional…" />
                                </Field>
                              </div>
                            </div>
                            <div>
                              <p className="text-xs font-bold uppercase tracking-wider text-muted">Review history</p>
                              {!history[d.id] ? (
                                <p className="mt-2 text-sm text-muted">Loading…</p>
                              ) : history[d.id].length === 0 ? (
                                <p className="mt-2 text-sm text-muted">No previous reviews.</p>
                              ) : (
                                <ul className="mt-2 flex flex-col gap-1.5">
                                  {history[d.id].map((h) => (
                                    <li key={h.action + h.createdAt} className="rounded-lg bg-white px-3 py-2 text-xs shadow-[var(--shadow-card)]">
                                      <span className="font-mono font-semibold text-navy">{h.action}</span>
                                      <span className="text-muted"> · {h.actorEmail ?? "system"} · {new Date(h.createdAt).toLocaleString()}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
