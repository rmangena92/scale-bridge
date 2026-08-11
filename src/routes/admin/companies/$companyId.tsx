import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import {
  createAdminCompanyNote,
  getAdminCompanyDetail,
  getAdminSession,
  setAdminCompanyStatus,
  updateAdminCompanyNote,
} from "~/lib/admin";
import {
  COMPANY_STATUS_LABELS,
  DOCUMENT_REVIEW_LABELS,
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
  EmptyState,
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

const CATALOGUE_NOTE = "Arrives with the services catalogue build.";

type TabKey =
  | "overview"
  | "information"
  | "services"
  | "evidence"
  | "contracts"
  | "opportunities"
  | "documents"
  | "verification"
  | "contacts"
  | "ai"
  | "upsells"
  | "activity"
  | "notes";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "information", label: "Company Information" },
  { key: "services", label: "Services" },
  { key: "evidence", label: "Service Evidence" },
  { key: "contracts", label: "Contracts" },
  { key: "opportunities", label: "Opportunities" },
  { key: "documents", label: "Documents" },
  { key: "verification", label: "Verification" },
  { key: "contacts", label: "Contacts" },
  { key: "ai", label: "AI Insights" },
  { key: "upsells", label: "Upsell Opportunities" },
  { key: "activity", label: "Activity" },
  { key: "notes", label: "Internal Notes" },
];

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
  const [tab, setTab] = useState<TabKey>("overview");
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
      const next =
        action === "verify" ? "verified" : action === "reject" ? "rejected" : action === "suspend" ? "suspended" : "registered";
      setStatus(next);
      setFlash(`Company ${action === "restore" ? "restored" : action + "d"} ✓`);
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
          <div className="mt-1 flex flex-wrap items-center gap-3">
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

      {/* tab bar */}
      <div className="mb-6 flex flex-wrap gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[var(--shadow-card)]">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTab(t.key);
              setError(null);
              setFlash(null);
            }}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
              tab === t.key
                ? "bg-navy text-white"
                : "text-muted hover:bg-mist hover:text-navy"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <OverviewTab detail={detail} status={status} onAction={runAction} adminCanMutate={adminCanMutate} busy={busy} onTab={setTab} />
      )}
      {tab === "information" && <InformationTab detail={detail} />}
      {tab === "services" && (
        <CatalogueEmptyState
          title="Services"
          body="The services catalogue (plan item 2) adds services to this company with evidence, verification status and active-with-ScaleBridge tracking."
        />
      )}
      {tab === "evidence" && (
        <CatalogueEmptyState
          title="Service evidence"
          body="Evidence per service — certificates, capability statements, case studies and documents — arrives with the services catalogue build."
        />
      )}
      {tab === "contracts" && <ContractsTab detail={detail} />}
      {tab === "opportunities" && (
        <CatalogueEmptyState
          title="Opportunities"
          body="Contract opportunities matched to this company arrive with the services catalogue build."
        />
      )}
      {tab === "documents" && <DocumentsTab detail={detail} />}
      {tab === "verification" && <VerificationTab detail={detail} />}
      {tab === "contacts" && <ContactsTab detail={detail} />}
      {tab === "ai" && (
        <CatalogueEmptyState
          title="AI insights"
          body="AI Service Intelligence discoveries (plan item 5) appear here with evidence and confidence levels."
        />
      )}
      {tab === "upsells" && (
        <CatalogueEmptyState
          title="Upsell opportunities"
          body="Human-approved upsell and cross-sell recommendations (plan item 6) appear here."
        />
      )}
      {tab === "activity" && <ActivityTab detail={detail} />}
      {tab === "notes" && (
        <NotesTab detail={detail} adminCanMutate={adminCanMutate} />
      )}
    </div>
  );
}

function SectionHeading({ title, body }: { title: string; body?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-bold">{title}</h2>
      {body && <p className="mt-1 text-sm text-muted">{body}</p>}
    </div>
  );
}

function CatalogueEmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <SectionHeading title={title} body={CATALOGUE_NOTE} />
      <EmptyState title={`No ${title.toLowerCase()} yet`} body={body} />
    </div>
  );
}

// ---------------------------------------------------------------- Overview
function OverviewTab({
  detail,
  status,
  onAction,
  adminCanMutate,
  busy,
  onTab,
}: {
  detail: AdminCompanyDetail;
  status: string;
  onAction: (a: "verify" | "reject" | "suspend" | "restore") => void;
  adminCanMutate: boolean;
  busy: boolean;
  onTab: (t: TabKey) => void;
}) {
  const c = detail.company;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-6 lg:col-span-2">
        <Card className="p-6">
          <SectionHeading title="Key facts" />
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Fact label="Company name" value={c.name} />
            <Fact label="Industry / type" value={c.type ?? "—"} />
            <Fact label="Verification status" value={(COMPANY_STATUS_LABELS as Record<string, string>)[status] ?? status} />
            <Fact label="Contact email" value={c.contactEmail ?? "—"} />
            <Fact label="Owner" value={c.ownerEmail ?? "—"} />
            <Fact label="Registered" value={new Date(c.createdAt).toLocaleDateString()} />
          </dl>
          {c.description && (
            <p className="mt-4 rounded-lg bg-mist px-3 py-2 text-sm text-ink">{c.description}</p>
          )}
        </Card>

        <Card className="p-6">
          <SectionHeading title="Quick links" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => onTab("contracts")}>
              Contracts ({detail.contracts.length})
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onTab("documents")}>
              Documents ({detail.documents.length})
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onTab("contacts")}>
              Contacts ({detail.users.length})
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onTab("verification")}>
              Verification
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onTab("activity")}>
              Activity ({detail.activity.length})
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onTab("notes")}>
              Internal notes ({detail.notes.length})
            </Button>
          </div>
        </Card>
      </div>

      <Card className="h-fit p-6">
        <h2 className="text-lg font-bold">Verification &amp; status</h2>
        <p className="mt-1 text-sm text-muted">Every decision is written to the audit log.</p>
        <div className="mt-4 flex flex-col gap-2">
          {status !== "verified" && status !== "suspended" && (
            <Button size="sm" onClick={() => onAction("verify")} disabled={busy}>
              Approve verification
            </Button>
          )}
          {status !== "rejected" && status !== "suspended" && (
            <ConfirmButton
              label="Reject verification"
              confirmLabel="Confirm rejection?"
              onConfirm={() => onAction("reject")}
              disabled={busy}
              variant="outline"
            />
          )}
          {status !== "suspended" && (
            <ConfirmButton
              label="Suspend company"
              confirmLabel="Confirm suspension?"
              onConfirm={() => onAction("suspend")}
              disabled={busy}
              variant="outline"
            />
          )}
          {(status === "suspended" || status === "rejected") && (
            <Button size="sm" variant="secondary" onClick={() => onAction("restore")} disabled={busy}>
              Restore company
            </Button>
          )}
        </div>
        <p className="mt-4 text-xs text-muted">
          {adminCanMutate ? "You can change verification and account status." : "Read-only role — changes are disabled."}
        </p>
      </Card>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}

// ------------------------------------------------------- Company Information
function InformationTab({ detail }: { detail: AdminCompanyDetail }) {
  const c = detail.company;
  return (
    <Card className="p-6">
      <SectionHeading title="Company information" body="Profile fields as registered — read-only here." />
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Fact label="Company name" value={c.name} />
        <Fact label="Industry / type" value={c.type ?? "—"} />
        <Fact label="Contact email" value={c.contactEmail ?? "—"} />
        <Fact label="Owner account" value={c.ownerEmail ?? "—"} />
        <Fact label="Registered" value={new Date(c.createdAt).toLocaleDateString()} />
        <Fact label="Last updated" value={new Date(c.updatedAt).toLocaleDateString()} />
        <Fact label="Verification status" value={COMPANY_STATUS_LABELS[c.verificationStatus] ?? c.verificationStatus} />
        <Fact label="Company ID" value={c.id} />
      </dl>
      {c.description && (
        <>
          <h3 className="mt-6 text-sm font-bold uppercase tracking-wider text-muted">Description</h3>
          <p className="mt-2 rounded-lg bg-mist px-3 py-2 text-sm text-ink">{c.description}</p>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Contracts
function ContractsTab({ detail }: { detail: AdminCompanyDetail }) {
  return (
    <div>
      <SectionHeading
        title="Contracts"
        body="Contract workspaces this company leads or participates in."
      />
      <Card>
        {detail.contracts.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No contracts linked" body="No contract workspaces reference this company yet." />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {detail.contracts.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <Link
                  to="/admin/contracts/$workspaceId"
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
  );
}

// --------------------------------------------------------------- Documents
function DocumentsTab({ detail }: { detail: AdminCompanyDetail }) {
  return (
    <div>
      <SectionHeading
        title="Documents"
        body="Licences, certificates and other documents uploaded by this company's users."
      />
      <Card>
        {detail.documents.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No documents uploaded" body="Documents uploaded by the company's users appear here." />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {detail.documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{d.name}</p>
                  <p className="truncate text-xs text-muted">
                    {d.category ?? "document"} · {d.visibility}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {d.expiryDate && <Badge tone="amber">{d.expiryDate}</Badge>}
                  <Badge tone={d.reviewStatus === "approved" ? "green" : "amber"}>
                    {DOCUMENT_REVIEW_LABELS[d.reviewStatus as keyof typeof DOCUMENT_REVIEW_LABELS] ?? d.reviewStatus}
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

// ------------------------------------------------------------ Verification
function VerificationTab({ detail }: { detail: AdminCompanyDetail }) {
  const c = detail.company;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="p-6">
        <SectionHeading title="Verification status" />
        <div className="flex items-center gap-3">
          <Badge tone={statusTones[c.verificationStatus] ?? "slate"}>
            {COMPANY_STATUS_LABELS[c.verificationStatus]}
          </Badge>
          <span className="text-sm text-muted">
            set {new Date(c.updatedAt).toLocaleDateString()}
          </span>
        </div>
        <h3 className="mt-6 text-sm font-bold uppercase tracking-wider text-muted">
          Documents in scope
        </h3>
        {detail.documents.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No documents uploaded for verification.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {detail.documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 py-2">
                <span className="truncate text-sm text-ink">{d.name}</span>
                <Badge tone={d.reviewStatus === "approved" ? "green" : d.reviewStatus === "rejected" ? "red" : "amber"}>
                  {DOCUMENT_REVIEW_LABELS[d.reviewStatus as keyof typeof DOCUMENT_REVIEW_LABELS] ?? d.reviewStatus}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="p-6">
        <SectionHeading title="Verification history" body="Admin verification decisions from the audit trail." />
        {detail.verificationHistory.length === 0 ? (
          <p className="text-sm text-muted">No admin verification events recorded yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {detail.verificationHistory.map((a) => (
              <li key={a.id} className="py-2.5">
                <p className="font-mono text-xs font-semibold text-navy">{a.action}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {a.actorEmail ?? "system"} · {formatDateTime(a.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------- Contacts
function ContactsTab({ detail }: { detail: AdminCompanyDetail }) {
  const c = detail.company;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="p-6">
        <SectionHeading title="Registered users" body="User profiles linked to this company." />
        {detail.users.length === 0 ? (
          <p className="text-sm text-muted">No user profiles linked to this company.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
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
      <Card className="p-6">
        <SectionHeading title="Company owner" />
        <p className="text-sm text-ink">{c.ownerEmail ?? "—"}</p>
        <p className="mt-1 text-xs text-muted">Owner account ID: {c.ownerId}</p>
        <p className="mt-4 text-sm text-muted">
          Additional named contacts (buyers, project users, guests) arrive with the
          contract workspace build.
        </p>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Activity
function ActivityTab({ detail }: { detail: AdminCompanyDetail }) {
  return (
    <div>
      <SectionHeading
        title="Activity"
        body="Audit trail for this company — company-scoped events and its contract workspaces."
      />
      <Card>
        {detail.activity.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No activity recorded" body="Audit events for this company appear here." />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {detail.activity.map((a) => (
              <li key={a.id} className="px-5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-xs font-semibold text-navy">{a.action}</p>
                  <span className="shrink-0 text-xs text-muted">{formatDateTime(a.createdAt)}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted">{a.actorEmail ?? "system"}</p>
                {a.details && (
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-mist px-3 py-2 font-mono text-[11px] text-ink">
                    {JSON.stringify(a.details, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------ Internal Notes
function NotesTab({
  detail,
  adminCanMutate,
}: {
  detail: AdminCompanyDetail;
  adminCanMutate: boolean;
}) {
  const [notes, setNotes] = useState(detail.notes);
  const [body, setBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (!adminCanMutate || !body.trim()) return;
    setBusy(true);
    setError(null);
    const result = await createAdminCompanyNote({
      data: { companyId: detail.company.id, body },
    });
    setBusy(false);
    if (result.ok) {
      setBody("");
      setFlash("Note recorded ✓");
      const refresh = await getAdminCompanyDetail({
        data: { companyId: detail.company.id },
      });
      if (refresh.ok) setNotes(refresh.detail.notes);
    } else {
      setError(result.error);
    }
  }

  async function saveEdit(noteId: string) {
    if (!adminCanMutate || !editBody.trim()) return;
    setBusy(true);
    setError(null);
    const result = await updateAdminCompanyNote({ data: { noteId, body: editBody } });
    setBusy(false);
    if (result.ok) {
      setEditingId(null);
      setFlash("Note updated ✓");
      const refresh = await getAdminCompanyDetail({
        data: { companyId: detail.company.id },
      });
      if (refresh.ok) setNotes(refresh.detail.notes);
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <SectionHeading
          title="Internal notes"
          body="Visible to ScaleBridge staff only. Adds and edits are audit-logged with author and timestamp."
        />
        <Card>
          {notes.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No internal notes" body="Add the first note for this company below." />
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {notes.map((n) => (
                <li key={n.id} className="px-5 py-3">
                  {editingId === n.id ? (
                    <div className="flex flex-col gap-2">
                      <Textarea
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        rows={3}
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => saveEdit(n.id)} disabled={busy || !editBody.trim()}>
                          Save
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingId(null)} disabled={busy}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="whitespace-pre-wrap text-sm text-ink">{n.body}</p>
                        <p className="mt-1 text-xs text-muted">
                          {n.authorName ?? n.authorEmail ?? "ScaleBridge staff"} · added{" "}
                          {formatDateTime(n.createdAt)}
                          {n.updatedAt !== n.createdAt && " · edited"}
                        </p>
                      </div>
                      {adminCanMutate && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0"
                          onClick={() => {
                            setEditingId(n.id);
                            setEditBody(n.body);
                            setError(null);
                          }}
                          disabled={busy}
                        >
                          Edit
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="h-fit p-6">
        <h2 className="text-lg font-bold">Add a note</h2>
        {!adminCanMutate ? (
          <p className="mt-2 text-sm text-muted">Read-only role — notes are disabled.</p>
        ) : (
          <form onSubmit={addNote} className="mt-3 flex flex-col gap-3">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Internal note…"
              rows={4}
            />
            <Button type="submit" size="sm" disabled={busy || !body.trim()}>
              Add note
            </Button>
          </form>
        )}
        {error && (
          <div className="mt-4">
            <ErrorText>{error}</ErrorText>
          </div>
        )}
        {flash && (
          <p className="mt-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm font-medium text-success">
            {flash}
          </p>
        )}
      </Card>
    </div>
  );
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
