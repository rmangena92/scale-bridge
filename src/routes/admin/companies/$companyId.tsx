import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import {
  createAdminCompanyNote,
  getAdminCompanyDetail,
  getAdminSession,
  listCompanyServices,
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
import type { CompanyServiceRow } from "~/lib/services";
import {
  ConfidenceBadge,
  DecisionBadge,
  DecisionButtons,
  ServiceStatusBadge,
  VerificationBadge,
} from "~/components/CatalogueBits";
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
    const [detail, rels] = await Promise.all([
      getAdminCompanyDetail({ data: { companyId: params.companyId } }),
      listCompanyServices({ data: { companyId: params.companyId } }),
    ]);
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      detail: detail.ok ? detail.detail : null,
      loadError: detail.ok ? null : detail.error,
      relationships: rels.ok ? rels.relationships : [],
      relationshipsError: rels.ok ? null : rels.error,
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


// --------------------------------------------------- Catalogue tabs (live)
function ServicesTab({
  relationships,
  relationshipsError,
}: {
  relationships: CompanyServiceRow[];
  relationshipsError: string | null;
}) {
  return (
    <div>
      <SectionHeading
        title="Services"
        body="Service-to-company relationships with source, confidence, verification status and active-with-ScaleBridge tracking."
      />
      {relationshipsError && (
        <div className="mb-4">
          <ErrorText>{relationshipsError}</ErrorText>
        </div>
      )}
      <Card className="overflow-x-auto">
        {relationships.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No services mapped"
              body="Services discovered or entered for this company appear here."
            />
          </div>
        ) : (
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">Service</th>
                <th className="px-3 py-3">Source</th>
                <th className="px-3 py-3">Confidence</th>
                <th className="px-3 py-3">Verification</th>
                <th className="px-3 py-3">Active</th>
                <th className="px-3 py-3">Upsell</th>
                <th className="px-5 py-3">Admin decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {relationships.map((r) => (
                <tr key={r.id} className="hover:bg-mist/60">
                  <td className="px-5 py-3">
                    <Link
                      to="/admin/services/$serviceId"
                      params={{ serviceId: r.serviceId }}
                      className="font-semibold text-navy hover:text-brand"
                    >
                      {r.service.name}
                    </Link>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="text-xs text-muted">{r.service.categoryName}</span>
                      <ServiceStatusBadge status={r.service.status} />
                    </div>
                  </td>
                  <td className="px-3 py-3 text-muted">{r.source}</td>
                  <td className="px-3 py-3">
                    <ConfidenceBadge confidence={r.confidence} />
                  </td>
                  <td className="px-3 py-3">
                    <VerificationBadge status={r.verificationStatus} />
                  </td>
                  <td className="px-3 py-3">
                    {r.activeWithScalebridge ? (
                      <Badge tone="green">Yes</Badge>
                    ) : (
                      <Badge tone="slate">No</Badge>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {r.upsellRecommended ? (
                      <Badge tone="teal">Yes</Badge>
                    ) : (
                      <Badge tone="slate">No</Badge>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <DecisionBadge decision={r.adminDecision} />
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

function EvidenceTab({ relationships }: { relationships: CompanyServiceRow[] }) {
  const rows = relationships.flatMap((r) =>
    r.evidence.map((e) => ({ ...e, serviceName: r.service.name })),
  );
  return (
    <div>
      <SectionHeading
        title="Service evidence"
        body="Proof rows behind this company\'s relationships — service pages, capability statements, case studies and documents."
      />
      <Card>
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No evidence recorded"
              body="Evidence captured for this company\'s services appears here."
            />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((e) => (
              <li key={e.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-ink">{e.title ?? "Untitled evidence"}</p>
                  <Badge tone="slate">{e.evidenceType ?? "document"}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {e.serviceName}
                  {e.agentVersion ? ` · agent v${e.agentVersion}` : ""}
                  {e.capturedAt ? ` · captured ${formatDateTime(e.capturedAt)}` : ""}
                </p>
                {e.sourceUrl && (
                  <a
                    href={e.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block max-w-full truncate text-xs font-semibold text-brand hover:underline"
                  >
                    {e.sourceUrl}
                  </a>
                )}
                {e.excerpt && (
                  <p className="mt-1.5 rounded-lg bg-mist px-3 py-2 text-xs text-ink">{e.excerpt}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function AiInsightsTab({
  relationships,
  adminCanMutate,
  onRefresh,
  onError,
  onFlash,
}: {
  relationships: CompanyServiceRow[];
  adminCanMutate: boolean;
  onRefresh: () => void;
  onError: (e: string) => void;
  onFlash: (m: string) => void;
}) {
  const rows = relationships.filter((r) => r.source === "AI discovery");
  return (
    <DecisionList
      title="AI insights"
      body="AI Service Intelligence discoveries for this company — approve, reject or archive; every decision is audit-logged."
      rows={rows}
      adminCanMutate={adminCanMutate}
      onRefresh={onRefresh}
      onError={onError}
      onFlash={onFlash}
    />
  );
}

function UpsellsTab({
  relationships,
  adminCanMutate,
  onRefresh,
  onError,
  onFlash,
}: {
  relationships: CompanyServiceRow[];
  adminCanMutate: boolean;
  onRefresh: () => void;
  onError: (e: string) => void;
  onFlash: (m: string) => void;
}) {
  const rows = relationships.filter((r) => r.upsellRecommended);
  return (
    <DecisionList
      title="Upsell opportunities"
      body="Upsell and cross-sell recommendations for this company — human approval is required before anything is actioned."
      rows={rows}
      adminCanMutate={adminCanMutate}
      onRefresh={onRefresh}
      onError={onError}
      onFlash={onFlash}
    />
  );
}

function DecisionList({
  title,
  body,
  rows,
  adminCanMutate,
  onRefresh,
  onError,
  onFlash,
}: {
  title: string;
  body: string;
  rows: CompanyServiceRow[];
  adminCanMutate: boolean;
  onRefresh: () => void;
  onError: (e: string) => void;
  onFlash: (m: string) => void;
}) {
  return (
    <div>
      <SectionHeading title={title} body={body} />
      <Card className="overflow-x-auto">
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState title="Nothing here yet" body="Rows appear once the catalogue records discoveries or recommendations for this company." />
          </div>
        ) : (
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">Service</th>
                <th className="px-3 py-3">Confidence</th>
                <th className="px-3 py-3">Evidence</th>
                <th className="px-3 py-3">Decision</th>
                <th className="px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="align-top hover:bg-mist/60">
                  <td className="px-5 py-3">
                    <Link
                      to="/admin/services/$serviceId"
                      params={{ serviceId: r.serviceId }}
                      className="font-semibold text-navy hover:text-brand"
                    >
                      {r.service.name}
                    </Link>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="text-xs text-muted">{r.service.categoryName}</span>
                      <ServiceStatusBadge status={r.service.status} />
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <ConfidenceBadge confidence={r.confidence} />
                  </td>
                  <td className="max-w-xs px-3 py-3">
                    {r.evidenceSummary ? (
                      <p className="text-xs text-ink">{r.evidenceSummary}</p>
                    ) : (
                      <span className="text-xs text-muted">
                        {r.evidence.length} evidence row{r.evidence.length === 1 ? "" : "s"} · no summary
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <DecisionBadge decision={r.adminDecision} />
                  </td>
                  <td className="px-5 py-3">
                    {adminCanMutate ? (
                      <DecisionButtons
                        relationshipId={r.id}
                        onDone={(ok, err) => {
                          if (!ok) {
                            onError(err ?? "Could not record the decision.");
                            return;
                          }
                          onError("");
                          onFlash("Decision recorded ✓");
                          onRefresh();
                        }}
                      />
                    ) : (
                      <span className="text-xs text-muted">Read-only</span>
                    )}
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
