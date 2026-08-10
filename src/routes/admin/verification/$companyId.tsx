import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  getAdminSession,
  getVerificationCompany,
  reviewDocument,
  setDocumentExpiryReminder,
  setAdminCompanyStatus,
  addAdminCompanyNote,
} from "~/lib/admin";
import {
  COMPANY_STATUS_LABELS,
  DOCUMENT_REVIEW_BADGE_TONES,
  DOCUMENT_REVIEW_LABELS,
} from "~/lib/types";
import type { AdminDocumentRow } from "~/lib/types";
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  DbSetupPage,
  EmptyState,
  ErrorText,
  Field,
  Textarea,
} from "~/components/ui";

export const Route = createFileRoute("/admin/verification/$companyId")({
  loader: async ({ params }) => {
    const session = await getAdminSession();
    const result = await getVerificationCompany({ data: { companyId: params.companyId } });
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      companyId: params.companyId,
      initial: result.ok ? result : null,
      loadError: result.ok ? null : result.error,
    };
  },
  component: VerificationReviewPage,
});

function VerificationReviewPage() {
  const loader = Route.useLoaderData();
  const [detail, setDetail] = useState(
    loader.initial ? { company: loader.initial.company, documents: loader.initial.documents, history: loader.initial.history } : null,
  );
  const [error, setError] = useState<string | null>(loader.loadError);
  const [comment, setComment] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  if (loader.setupRequired) {
    return (
      <DbSetupPage title="Verification review">
        Connect a Postgres database (DATABASE_URL) to review companies.
      </DbSetupPage>
    );
  }
  if (!loader.admin) return null;
  if (!detail) {
    return (
      <div>
        <ErrorText>{error ?? "Could not load this company."}</ErrorText>
        <Link to="/admin/verification" className="mt-4 inline-block text-sm font-semibold text-brand hover:underline">
          ← Back to the queue
        </Link>
      </div>
    );
  }

  const canMutate = loader.admin.canMutate;
  const { company, documents, history } = detail;

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, key: string, after?: () => void) {
    setPendingAction(key);
    setError(null);
    const result = await fn();
    setPendingAction(null);
    if (!result.ok) {
      setError(result.error ?? "Action failed.");
      return;
    }
    if (after) after();
    const fresh = await getVerificationCompany({ data: { companyId: company.id } });
    if (fresh.ok) {
      setDetail({ company: fresh.company, documents: fresh.documents, history: fresh.history });
    }
  }

  const review = (docId: string, action: "approve" | "reject" | "needs_replacement" | "clarification_requested") =>
    run(
      () => reviewDocument({ data: { documentId: docId, action, comment: comment[docId] ?? "" } }),
      `review:${docId}:${action}`,
    );

  return (
    <div>
      <div className="mb-6">
        <Link to="/admin/verification" className="text-sm font-semibold text-brand hover:underline">
          ← Verification queue
        </Link>
        <p className="mt-3 text-sm font-bold uppercase tracking-widest text-teal">Verification review</p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold sm:text-3xl">{company.name}</h1>
          <Badge tone={company.verificationStatus === "verified" ? "green" : company.verificationStatus === "rejected" || company.verificationStatus === "suspended" ? "red" : "amber"}>
            {COMPANY_STATUS_LABELS[company.verificationStatus]}
          </Badge>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          {company.description ?? "No description on file."} · Owner: {company.ownerEmail} · Type: {company.type ?? "—"}
        </p>
      </div>

      {error && (
        <div className="mb-5">
          <ErrorText>{error}</ErrorText>
        </div>
      )}

      {!canMutate && (
        <div className="mb-5">
          <Badge tone="amber">Read-only — you can view this review but not change records.</Badge>
        </div>
      )}

      {/* Company-level actions */}
      <Card className="p-5">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">Verification actions</p>
        <p className="mt-1 text-xs text-muted">
          Decisions are recorded in the audit log. Approving the company sets verification to Verified;
          rejecting and suspending are reversible from the company page.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            disabled={!canMutate || pendingAction !== null || company.verificationStatus === "verified"}
            onClick={() => run(() => setAdminCompanyStatus({ data: { companyId: company.id, action: "verify" } }), "verify-company")}
          >
            Approve company
          </Button>
          <ConfirmButton
            label="Reject company"
            confirmLabel="Confirm rejection?"
            disabled={!canMutate || pendingAction !== null}
            variant="outline"
            onConfirm={() => run(() => setAdminCompanyStatus({ data: { companyId: company.id, action: "reject" } }), "reject-company")}
          />
          <ConfirmButton
            label="Suspend company"
            confirmLabel="Confirm suspension?"
            disabled={!canMutate || pendingAction !== null}
            variant="outline"
            onConfirm={() => run(() => setAdminCompanyStatus({ data: { companyId: company.id, action: "suspend" } }), "suspend-company")}
          />
        </div>
      </Card>

      {/* Documents */}
      <Card className="mt-5 overflow-x-auto">
        <div className="border-b border-slate-200 px-5 py-4">
          <p className="text-sm font-bold uppercase tracking-widest text-teal">Uploaded documents</p>
          <p className="mt-1 text-xs text-muted">
            Approve, reject, request a replacement or request clarification per document. Every decision writes an audit event.
          </p>
        </div>
        {documents.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No documents uploaded" body="This company has not uploaded any documents yet." />
          </div>
        ) : (
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">Document</th>
                <th className="px-3 py-3">Type</th>
                <th className="px-3 py-3">Expiry</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Reviewer</th>
                <th className="px-3 py-3">Comment</th>
                <th className="px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {documents.map((d) => (
                <DocumentRow
                  key={d.id}
                  doc={d}
                  comment={comment[d.id] ?? ""}
                  onComment={(v) => setComment((c) => ({ ...c, [d.id]: v }))}
                  onReview={(action) => review(d.id, action)}
                  onReminder={() => run(() => setDocumentExpiryReminder({ data: { documentId: d.id } }), `reminder:${d.id}`)}
                  canMutate={canMutate && pendingAction === null}
                />
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Internal notes */}
      <Card className="mt-5 p-5">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">Internal notes</p>
        {company.internalNotes.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2">
            {company.internalNotes.map((n, i) => (
              <li key={i} className="rounded-lg bg-mist px-3 py-2 text-sm text-ink">{n}</li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex items-start gap-2">
          <div className="flex-1">
            <Field label="Add an internal note" htmlFor="co-note">
              <Textarea id="co-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Visible to ScaleBridge staff only…" />
            </Field>
          </div>
          <Button
            className="mt-7"
            disabled={!canMutate || !note.trim()}
            onClick={async () => {
              const result = await addAdminCompanyNote({ data: { companyId: company.id, note } });
              if (!result.ok) { setError(result.error ?? "Could not save the note."); return; }
              setNote("");
              const fresh = await getVerificationCompany({ data: { companyId: company.id } });
              if (fresh.ok) setDetail({ company: fresh.company, documents: fresh.documents, history: fresh.history });
            }}
          >
            Add note
          </Button>
        </div>
      </Card>

      {/* Approval history */}
      <Card className="mt-5 overflow-x-auto">
        <div className="border-b border-slate-200 px-5 py-4">
          <p className="text-sm font-bold uppercase tracking-widest text-teal">Approval history</p>
        </div>
        {history.length === 0 ? (
          <div className="p-6"><EmptyState title="No recorded decisions" body="Audit events for this company will appear here." /></div>
        ) : (
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">When</th>
                <th className="px-3 py-3">Action</th>
                <th className="px-3 py-3">Actor</th>
                <th className="px-5 py-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.map((h) => (
                <tr key={h.id} className="align-top">
                  <td className="whitespace-nowrap px-5 py-3 text-xs text-muted">
                    {new Date(h.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-navy">{h.action}</td>
                  <td className="px-3 py-3 text-xs">{h.actorEmail ?? "system"}</td>
                  <td className="px-5 py-3 text-xs text-muted">
                    {h.details ? <code className="break-all">{JSON.stringify(h.details)}</code> : "—"}
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

function DocumentRow({
  doc,
  comment,
  onComment,
  onReview,
  onReminder,
  canMutate,
}: {
  doc: AdminDocumentRow;
  comment: string;
  onComment: (v: string) => void;
  onReview: (action: "approve" | "reject" | "needs_replacement" | "clarification_requested") => void;
  onReminder: () => void;
  canMutate: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pending = doc.reviewStatus === "pending";
  return (
    <>
      <tr className="hover:bg-mist/60">
        <td className="px-5 py-3">
          <button type="button" onClick={() => setOpen((o) => !o)} className="font-semibold text-navy hover:text-brand">
            {doc.name}
          </button>
          <p className="text-xs text-muted">
            {doc.fileUrl ? (
              <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">Download ↗</a>
            ) : "No file attached"}
          </p>
        </td>
        <td className="px-3 py-3 text-muted">{doc.category ?? "—"}</td>
        <td className="px-3 py-3">
          {doc.expiryDate ? (
            <span className={doc.expiryDate < new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10) ? "font-semibold text-danger" : ""}>
              {doc.expiryDate}
              {doc.expiryReminderAt ? " · ⏰" : ""}
            </span>
          ) : "—"}
        </td>
        <td className="px-3 py-3">
          <Badge tone={DOCUMENT_REVIEW_BADGE_TONES[doc.reviewStatus]}>{DOCUMENT_REVIEW_LABELS[doc.reviewStatus]}</Badge>
        </td>
        <td className="px-3 py-3 text-xs text-muted">{doc.reviewedByEmail ?? "—"}</td>
        <td className="px-3 py-3 text-xs text-muted">{doc.reviewComment ?? "—"}</td>
        <td className="px-5 py-3">
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" disabled={!canMutate || !pending} onClick={() => onReview("approve")}>Approve</Button>
            <Button size="sm" variant="outline" disabled={!canMutate || !pending} onClick={() => onReview("reject")}>Reject</Button>
            <Button size="sm" variant="outline" disabled={!canMutate || !pending} onClick={() => onReview("needs_replacement")}>Replacement</Button>
            <Button size="sm" variant="ghost" disabled={!canMutate || !pending} onClick={() => onReview("clarification_requested")}>Clarify</Button>
            <Button size="sm" variant="ghost" disabled={!canMutate} onClick={onReminder}>Set expiry reminder</Button>
          </div>
        </td>
      </tr>
      {open && (
        <tr className="bg-mist/40">
          <td colSpan={7} className="px-5 py-4">
            <div className="max-w-lg">
              <Field label="Review comment" htmlFor={`c-${doc.id}`}>
                <Textarea id={`c-${doc.id}`} value={comment} onChange={(e) => onComment(e.target.value)} placeholder="Optional comment recorded with this decision…" />
              </Field>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
