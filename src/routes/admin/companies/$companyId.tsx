import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import {
  addAdminCompanyNote,
  getAdminCompanyDetail,
  getAdminSession,
  setAdminCompanyStatus,
} from "~/lib/admin";
import {
  COMPANY_STATUS_LABELS,
  ROLE_LABELS,
  WORKSPACE_STATUS_LABELS,
} from "~/lib/types";
import type { AdminCompanyDetail } from "~/lib/types";
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  DbSetupPage,
  ErrorText,
  Textarea,
} from "~/components/ui";

export const Route = createFileRoute("/admin/companies/$companyId")({
  loader: async ({ params }) => {
    const session = await getAdminSession();
    const detail = await getAdminCompanyDetail({ data: { companyId: params.companyId } });
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      detail: detail.ok ? detail.detail : null,
      loadError: detail.ok ? null : detail.error,
    };
  },
  component: CompanyDetailPage,
});

const statusTones: Record<string, "green" | "red" | "amber" | "slate" | "blue" | "teal"> = {
  verified: "green",
  unverified: "slate",
  pending: "amber",
  draft: "slate",
  registered: "blue",
  documents_pending: "amber",
  under_review: "amber",
  rejected: "red",
  suspended: "red",
  archived: "slate",
};

function CompanyDetailPage() {
  const { setupRequired, admin, detail, loadError } = Route.useLoaderData();
  if (setupRequired) {
    return (
      <DbSetupPage title="Company profile">
        Connect a Postgres database (DATABASE_URL) to manage companies.
      </DbSetupPage>
    );
  }
  if (!admin) return null;
  if (!detail) {
    return (
      <div className="mb-6">
        <ErrorText>{loadError ?? "Company not found."}</ErrorText>
        <Link to="/admin/companies" className="mt-4 inline-block text-sm font-semibold text-brand hover:underline">
          ← Back to companies
        </Link>
      </div>
    );
  }
  return <CompanyDetailBody adminCanMutate={admin.canMutate} detail={detail} />;
}

function CompanyDetailBody({
  adminCanMutate,
  detail,
}: {
  adminCanMutate: boolean;
  detail: AdminCompanyDetail;
}) {
  const [status, setStatus] = useState(detail.company.verificationStatus);
  const [notes, setNotes] = useState<string[]>(detail.company.internalNotes);
  const [noteText, setNoteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  function guard(): boolean {
    if (!adminCanMutate) {
      setError("Your role is read-only — changes are not permitted.");
      setFlash(null);
      return false;
    }
    setError(null);
    setFlash(null);
    return true;
  }

  async function runAction(action: "verify" | "reject" | "suspend" | "restore") {
    if (!guard()) return;
    setBusy(true);
    const result = await setAdminCompanyStatus({
      data: { companyId: detail.company.id, action },
    });
    setBusy(false);
    if (result.ok) {
      const next = action === "verify" ? "verified" : action === "reject" ? "rejected" : action === "suspend" ? "suspended" : "registered";
      setStatus(next);
      setFlash(`Company ${action === "restore" ? "restored" : action + "d"} ✓`);
    } else {
      setError(result.error);
    }
  }

  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (!adminCanMutate || !noteText.trim()) return;
    setBusy(true);
    setError(null);
    const result = await addAdminCompanyNote({
      data: { companyId: detail.company.id, note: noteText },
    });
    setBusy(false);
    if (result.ok) {
      setNotes([...notes, noteText.trim()]);
      setNoteText("");
      setFlash("Note recorded ✓");
    } else {
      setError(result.error);
    }
  }

  const c = detail.company;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-teal">Companies</p>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-2xl font-bold">{c.name}</h1>
            <Badge tone={statusTones[status] ?? "slate"}>{COMPANY_STATUS_LABELS[status]}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted">{c.type ?? "—"}</p>
        </div>
        <Link to="/admin/companies" className="text-sm font-semibold text-brand hover:underline">
          ← Back to companies
        </Link>
      </div>

      {error && (
        <div className="mb-5">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      {flash && (
        <p className="mb-5 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm font-medium text-success">
          {flash}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          {/* registration data */}
          <Card className="p-6">
            <h2 className="text-lg font-bold">Registration data</h2>
            <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-muted">Company name</dt>
                <dd className="mt-0.5 text-sm font-semibold text-ink">{c.name}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-muted">Industry / type</dt>
                <dd className="mt-0.5 text-sm text-ink">{c.type ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-muted">Contact email</dt>
                <dd className="mt-0.5 text-sm text-ink">{c.contactEmail ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-muted">Owner</dt>
                <dd className="mt-0.5 text-sm text-ink">{c.ownerEmail ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-muted">Registered</dt>
                <dd className="mt-0.5 text-sm text-ink">{new Date(c.createdAt).toLocaleDateString()}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-muted">Last updated</dt>
                <dd className="mt-0.5 text-sm text-ink">{new Date(c.updatedAt).toLocaleDateString()}</dd>
              </div>
            </dl>
            {c.description && (
              <p className="mt-4 rounded-lg bg-mist px-3 py-2 text-sm text-ink">{c.description}</p>
            )}
          </Card>

          {/* users */}
          <Card className="p-6">
            <h2 className="text-lg font-bold">Associated users</h2>
            {detail.users.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No user profiles linked to this company.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {detail.users.map((u) => (
                  <li key={u.userId} className="flex items-center justify-between gap-3 py-2.5">
                    <Link
                      to="/admin/users/$userId"
                      params={{ userId: u.userId }}
                      className="min-w-0 font-semibold text-navy hover:text-brand"
                    >
                      <span className="block truncate">{u.name || u.email}</span>
                      <span className="block text-xs font-normal text-muted">{u.email}</span>
                    </Link>
                    <Badge tone="navy">{ROLE_LABELS[u.systemRole]}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* documents */}
          <Card className="p-6">
            <h2 className="text-lg font-bold">Licences &amp; certificates</h2>
            {detail.documents.length === 0 ? (
              <p className="mt-3 text-sm text-muted">
                No documents uploaded yet. The verification queue (Part B) will drive document
                review here.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {detail.documents.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{d.name}</p>
                      <p className="truncate text-xs text-muted">
                        {d.category ?? "document"} · {d.visibility}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {d.expiryDate && <Badge tone="amber">{d.expiryDate}</Badge>}
                      <Badge tone={d.reviewStatus === "approved" ? "green" : "amber"}>
                        {d.reviewStatus}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* contracts */}
          <Card className="p-6">
            <h2 className="text-lg font-bold">Contracts</h2>
            {detail.contracts.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No contract workspaces linked to this company.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {detail.contracts.map((w) => (
                  <li key={w.id} className="flex items-center justify-between gap-3 py-2.5">
                    <Link
                      to="/workspaces/$workspaceId"
                      params={{ workspaceId: w.id }}
                      className="min-w-0 font-semibold text-navy hover:text-brand"
                    >
                      <span className="block truncate">{w.title}</span>
                      <span className="block text-xs font-normal text-muted">
                        created {new Date(w.createdAt).toLocaleDateString()}
                      </span>
                    </Link>
                    <Badge tone="slate">{WORKSPACE_STATUS_LABELS[w.status]}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          {/* actions */}
          <Card className="p-6">
            <h2 className="text-lg font-bold">Verification &amp; status</h2>
            <p className="mt-1 text-sm text-muted">
              Every decision is written to the audit log.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {status !== "verified" && status !== "suspended" && (
                <Button size="sm" onClick={() => runAction("verify")} disabled={busy}>
                  Approve verification
                </Button>
              )}
              {status !== "rejected" && status !== "suspended" && (
                <ConfirmButton
                  label="Reject verification"
                  confirmLabel="Confirm rejection?"
                  onConfirm={() => runAction("reject")}
                  disabled={busy}
                  variant="outline"
                />
              )}
              {status !== "suspended" && (
                <ConfirmButton
                  label="Suspend company"
                  confirmLabel="Confirm suspension?"
                  onConfirm={() => runAction("suspend")}
                  disabled={busy}
                  variant="outline"
                />
              )}
              {(status === "suspended" || status === "rejected") && (
                <Button size="sm" variant="secondary" onClick={() => runAction("restore")} disabled={busy}>
                  Restore company
                </Button>
              )}
            </div>
          </Card>

          {/* internal notes */}
          <Card className="p-6">
            <h2 className="text-lg font-bold">Internal notes</h2>
            <p className="mt-1 text-sm text-muted">Visible to ScaleBridge staff only.</p>
            {notes.length > 0 ? (
              <ul className="mt-4 flex flex-col gap-2">
                {notes.map((n, i) => (
                  <li key={i} className="rounded-lg bg-mist px-3 py-2 text-sm text-ink">{n}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-muted">No notes recorded.</p>
            )}
            <form onSubmit={addNote} className="mt-4 flex flex-col gap-3">
              <Textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add an internal note…"
                rows={2}
                disabled={!adminCanMutate || busy}
              />
              <div>
                <Button type="submit" size="sm" disabled={!adminCanMutate || busy || !noteText.trim()}>
                  Add note
                </Button>
              </div>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
