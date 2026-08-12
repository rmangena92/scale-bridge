import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { enterViewAsClient } from "~/lib/admin-view";
import {
  createAdminCompanyNote,
  getAdminCompanyDetail,
  getAdminCompanySubscription,
  getAdminSession,
  listCompanyServices,
  setAdminCompanyStatus,
  updateAdminCompanyNote,
} from "~/lib/admin";
import {
  COMPANY_STATUS_LABELS,
  DOCUMENT_REVIEW_LABELS,
  ROLE_LABELS,
} from "~/lib/types";
import type { AdminCompanyDetail } from "~/lib/types";
import type { AdminCompanySubscriptionDetail } from "~/lib/admin";
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

export const Route = createFileRoute("/admin/companies/$companyId/")({
  validateSearch: (search: Record<string, unknown>) => ({
    notice: typeof search.notice === "string" ? search.notice : undefined,
  }),
  loader: async ({ params }) => {
    const session = await getAdminSession();
    const [detail, rels, sub] = await Promise.all([
      getAdminCompanyDetail({ data: { companyId: params.companyId } }),
      listCompanyServices({ data: { companyId: params.companyId } }),
      getAdminCompanySubscription({ data: { companyId: params.companyId } }),
    ]);
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      detail: detail.ok ? detail.detail : null,
      loadError: detail.ok ? null : detail.error,
      relationships: rels.ok ? rels.relationships : [],
      relationshipsError: rels.ok ? null : rels.error,
      subscription: sub.ok ? sub.detail : null,
      subscriptionError: sub.ok ? null : sub.error,
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
  | "membership"
  | "subscription"
  | "entitlements"
  | "contracts"
  | "workspaces"
  | "client-portals"
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
  { key: "membership", label: "Membership" },
  { key: "subscription", label: "Subscription" },
  { key: "entitlements", label: "Feature Entitlements" },
  { key: "contracts", label: "Contracts" },
  { key: "workspaces", label: "Partnership Workspaces" },
  { key: "opportunities", label: "Opportunities" },
  { key: "client-portals", label: "Client Portals" },
  { key: "documents", label: "Documents" },
  { key: "verification", label: "Verification" },
  { key: "contacts", label: "Contacts" },
  { key: "ai", label: "AI Insights" },
  { key: "upsells", label: "Upsell Opportunities" },
  { key: "activity", label: "Activity" },
  { key: "notes", label: "Internal Notes" },
];
function CompanyDetailPage() {
  const {
    setupRequired,
    admin,
    detail,
    loadError,
    relationships,
    relationshipsError,
    subscription,
    subscriptionError,
  } = Route.useLoaderData();
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
  return (
    <CompanyDetailBody
      adminCanMutate={admin.canMutate}
      detail={detail}
      relationships={relationships}
      relationshipsError={relationshipsError}
      subscription={subscription}
      subscriptionError={subscriptionError}
    />
  );
}
function CompanyDetailBody({
  adminCanMutate,
  detail,
  relationships: initialRelationships,
  relationshipsError: initialRelationshipsError,
  subscription,
  subscriptionError,
}: {
  adminCanMutate: boolean;
  detail: AdminCompanyDetail;
  relationships: CompanyServiceRow[];
  relationshipsError: string | null;
  subscription: AdminCompanySubscriptionDetail | null;
  subscriptionError: string | null;
}) {
  const [status, setStatus] = useState(detail.company.verificationStatus);
  const [tab, setTab] = useState<TabKey>("overview");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [relationships, setRelationships] =
    useState<CompanyServiceRow[]>(initialRelationships);
  const [relationshipsError, setRelationshipsError] =
    useState<string | null>(initialRelationshipsError);
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [showViewModal, setShowViewModal] = useState(false);
  const [viewReason, setViewReason] = useState("");
  const [viewOrg, setViewOrg] = useState<string | undefined>(undefined);
  const [viewBusy, setViewBusy] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);

  function guard(): boolean {
    if (!adminCanMutate) {
      setError("Your role is read-only - changes are not permitted.");
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

  async function refreshRelationships() {
    const rels = await listCompanyServices({ data: { companyId: detail.company.id } });
    if (rels.ok) {
      setRelationships(rels.relationships);
      setRelationshipsError(null);
    } else {
      setRelationshipsError(rels.error);
    }
  }

  const c = detail.company;
  const notice = search.notice;
  async function openViewAsClient(orgId: string | undefined) {
    const reason = viewReason.trim();
    if (reason.length < 3) {
      setViewError("Please enter a reason (a few words) for viewing as client.");
      return;
    }
    setViewBusy(true);
    setViewError(null);
    const result = await enterViewAsClient({
      data: { companyId: c.id, reason, orgId: orgId ?? null },
    });
    setViewBusy(false);
    if (result.ok) {
      setShowViewModal(false);
      setViewReason("");
      setViewOrg(undefined);
      await navigate({
        to: "/admin/companies/$companyId/view-as-client",
        params: { companyId: c.id },
        search: { section: "dashboard" },
      });
    } else {
      setViewError(result.error);
    }
  }
  return (
    <div>
      {notice && (
        <div className="mb-5 rounded-lg border border-teal/40 bg-teal/10 px-3 py-2 text-sm font-medium text-navy">
          {notice === "view-expired"
            ? "Your View as Client session expired after 20 minutes and was closed automatically. The expiry is recorded in the audit log."
            : notice === "view-exited"
              ? "You exited the View as Client session. Entry and exit are recorded in the audit log."
              : "The View as Client session is no longer active."}
        </div>
      )}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-teal">Companies</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold">{c.name}</h1>
            <Badge tone={statusTones[status] ?? "slate"}>{COMPANY_STATUS_LABELS[status]}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted">{c.type ?? "-"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setViewOrg(undefined);
              setViewError(null);
              setShowViewModal(true);
            }}
          >
            View as Client
          </Button>
          <Link to="/admin/companies" className="text-sm font-semibold text-brand hover:underline">
            Back to companies
          </Link>
        </div>
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
        <OverviewTab detail={detail} status={status} onAction={runAction} adminCanMutate={adminCanMutate} busy={busy} onTab={setTab} subscription={subscription} />
      )}
      {tab === "membership" && <MembershipTab detail={detail} subscription={subscription} />}
      {tab === "subscription" && <SubscriptionTab subscription={subscription} subscriptionError={subscriptionError} />}
      {tab === "entitlements" && <EntitlementsTab detail={detail} subscription={subscription} />}
      {tab === "information" && <InformationTab detail={detail} />}
      {tab === "services" && <ServicesTab relationships={relationships} relationshipsError={relationshipsError} />}
      {tab === "evidence" && <EvidenceTab relationships={relationships} />}
      {tab === "contracts" && <ContractsTab detail={detail} />}
      {tab === "workspaces" && <WorkspacesTab detail={detail} />}
      {tab === "client-portals" && (
        <ClientPortalsTab
          detail={detail}
          onView={(orgId: string) => {
            setViewOrg(orgId);
            setViewError(null);
            setShowViewModal(true);
          }}
        />
      )}
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
        <AiInsightsTab
          relationships={relationships}
          adminCanMutate={adminCanMutate}
          onRefresh={refreshRelationships}
          onError={setError}
          onFlash={setFlash}
        />
      )}
      {tab === "upsells" && (
        <UpsellsTab
          relationships={relationships}
          adminCanMutate={adminCanMutate}
          onRefresh={refreshRelationships}
          onError={setError}
          onFlash={setFlash}
        />
      )}
      {tab === "activity" && <ActivityTab detail={detail} />}
      {tab === "notes" && <NotesTab detail={detail} adminCanMutate={adminCanMutate} />}

      {showViewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold uppercase tracking-widest text-amber">View as Client</p>
                <h2 className="mt-1 text-xl font-bold">Temporary client portal view</h2>
              </div>
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-2 py-1 text-sm font-semibold text-muted hover:bg-mist"
                onClick={() => setShowViewModal(false)}
              >
                Close
              </button>
            </div>
            <p className="mt-3 text-sm text-muted">
              Opens a read-only view of the client portal for this company, exactly as the client
              sees it. Your identity stays visible in a banner on every page, the view expires
              automatically after 20 minutes, and the whole session is recorded in the audit log.
            </p>
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void openViewAsClient(viewOrg);
              }}
              className="mt-4"
            >
              <label htmlFor="view-reason" className="text-xs font-bold uppercase tracking-wider text-muted">
                Reason (required)
              </label>
              <textarea
                id="view-reason"
                value={viewReason}
                onChange={(e) => setViewReason(e.target.value)}
                rows={3}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                placeholder="e.g. Support ticket #123 - investigating invoice display issue"
              />
              {viewError && <p className="mt-2 text-sm text-danger">{viewError}</p>}
              <div className="mt-4 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowViewModal(false);
                    setViewReason("");
                    setViewError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={viewBusy}>
                  {viewBusy ? "Opening..." : "Enter client view"}
                </Button>
              </div>
            </form>
          </div>
        </div>
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
  subscription,
}: {
  detail: AdminCompanyDetail;
  status: string;
  onAction: (a: "verify" | "reject" | "suspend" | "restore") => void;
  adminCanMutate: boolean;
  busy: boolean;
  onTab: (t: TabKey) => void;
  subscription: AdminCompanySubscriptionDetail | null;
}) {
  const c = detail.company;
  const sub = subscription?.subscription ?? null;
  const plan = subscription?.plan ?? null;
  const minCommit = subscription?.commitments?.[0] ?? null;
  const outstandingInvoices = (subscription?.invoices ?? []).filter((i) => i.status === "Open").length;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-6 lg:col-span-2">
        <Card className="p-6">
          <SectionHeading title="Key facts" />
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Fact label="Company name" value={c.name} />
            <Fact label="Industry / type" value={c.type ?? "-"} />
            <Fact label="Verification status" value={(COMPANY_STATUS_LABELS as Record<string, string>)[status] ?? status} />
            <Fact label="Contact email" value={c.contactEmail ?? "-"} />
            <Fact label="Owner" value={c.ownerEmail ?? "-"} />
            <Fact label="Registered" value={new Date(c.createdAt).toLocaleDateString()} />
          </dl>
          {c.description && (
            <p className="mt-4 rounded-lg bg-mist px-3 py-2 text-sm text-ink">{c.description}</p>
          )}
        </Card>

        <Card className="p-6">
          <SectionHeading title="Membership" body={sub ? "Live subscription data - see the Membership tab for full detail." : "No subscription record for this company yet."} />
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Fact label="Current plan" value={plan?.name ?? "-"} />
            <Fact label="Subscription status" value={sub?.statusLabel ?? "-"} />
            <Fact label="Started" value={sub?.startedAt ? new Date(sub.startedAt).toLocaleDateString() : "-"} />
            <Fact label="Next billing" value={sub?.nextBillingDate ? new Date(sub.nextBillingDate).toLocaleDateString() : "-"} />
            <Fact label="Minimum commitment ends" value={minCommit ? new Date(minCommit.commitmentEnd).toLocaleDateString() : "-"} />
            <Fact label="Downgrade eligibility" value={minCommit ? new Date(minCommit.commitmentEnd).toLocaleDateString() : "-"} />
            <Fact label="Outstanding invoices" value={outstandingInvoices > 0 ? `${outstandingInvoices}` : "None"} />
            <Fact label="Payment status" value={subscription?.invoices?.[0]?.status ?? "-"} />
            <Fact label="Active contracts" value={`${detail.contracts.filter((x) => x.status === "active").length}`} />
          </dl>
          {sub && (
            <div className="mt-4">
              <Button size="sm" variant="secondary" onClick={() => onTab("membership")}>
                Open Membership
              </Button>
              <Button size="sm" variant="secondary" className="ml-2" onClick={() => onTab("subscription")}>
                Open Subscription
              </Button>
            </div>
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
            <Button size="sm" variant="secondary" onClick={() => onTab("membership")}>
              Membership
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
          {adminCanMutate ? "You can change verification and account status." : "Read-only role - changes are disabled."}
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
      <SectionHeading title="Company information" body="Profile fields as registered - read-only here." />
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Fact label="Company name" value={c.name} />
        <Fact label="Industry / type" value={c.type ?? "-"} />
        <Fact label="Contact email" value={c.contactEmail ?? "-"} />
        <Fact label="Owner account" value={c.ownerEmail ?? "-"} />
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
  const contracts = detail.contracts;
  const leadCount = contracts.filter((c) => c.role === "lead").length;
  const activeCount = contracts.filter((c) => c.status === "active").length;
  return (
    <div>
      <SectionHeading
        title="Contracts"
        body="Contract workspaces this company leads or participates in, with value, status and key dates (Master Admin spec section 3)."
      />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-2xl font-bold text-navy">{contracts.length}</div>
          <div className="text-xs font-semibold text-muted">Total workspaces</div>
        </Card>
        <Card className="p-4">
          <div className="text-2xl font-bold text-navy">{leadCount}</div>
          <div className="text-xs font-semibold text-muted">As lead contractor</div>
        </Card>
        <Card className="p-4">
          <div className="text-2xl font-bold text-navy">{activeCount}</div>
          <div className="text-xs font-semibold text-muted">Active contracts</div>
        </Card>
      </div>
      <Card className="overflow-x-auto">
        {contracts.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No contract workspaces" body="Contracts this company leads or joins appear here." />
          </div>
        ) : (
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">Contract</th>
                <th className="px-3 py-3">Role</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Value</th>
                <th className="px-3 py-3">Start</th>
                <th className="px-3 py-3">End</th>
                <th className="px-3 py-3">Participants</th>
                <th className="px-5 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {contracts.map((c) => (
                <tr key={c.id} className="hover:bg-mist/60">
                  <td className="px-5 py-3">
                    <Link to="/admin/contracts/$workspaceId" params={{ workspaceId: c.id }} className="font-semibold text-navy hover:text-brand">{c.title}</Link>
                  </td>
                  <td className="px-3 py-3">
                    {c.role === "lead" ? <Badge tone="teal">Lead</Badge> : <Badge tone="slate">Participant</Badge>}
                  </td>
                  <td className="px-3 py-3">
                    <Badge tone={c.status === "active" ? "green" : "slate"}>{c.status}</Badge>
                  </td>
                  <td className="px-3 py-3">
                    {c.contractValue != null ? `AED ${Number(c.contractValue).toLocaleString()}` : "-"}
                  </td>
                  <td className="px-3 py-3 text-muted">{c.startDate ? new Date(c.startDate).toLocaleDateString() : "-"}</td>
                  <td className="px-3 py-3 text-muted">{c.endDate ? new Date(c.endDate).toLocaleDateString() : "-"}</td>
                  <td className="px-3 py-3">{c.participantCount}</td>
                  <td className="px-5 py-3 text-muted">{new Date(c.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function WorkspacesTab({ detail }: { detail: AdminCompanyDetail }) {
  return (
    <div>
      <SectionHeading
        title="Partnership Workspaces"
        body="Contract workspaces this company leads or participates in (Master Admin spec section 9)."
      />
      <Card className="overflow-x-auto">
        {detail.contracts.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No partnership workspaces" body="Workspaces involving this company appear here." />
          </div>
        ) : (
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">Workspace</th>
                <th className="px-3 py-3">Role</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Value</th>
                <th className="px-3 py-3">Participants</th>
                <th className="px-5 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {detail.contracts.map((c) => (
                <tr key={c.id} className="hover:bg-mist/60">
                  <td className="px-5 py-3">
                    <Link to="/admin/contracts/$workspaceId" params={{ workspaceId: c.id }} className="font-semibold text-navy hover:text-brand">{c.title}</Link>
                  </td>
                  <td className="px-3 py-3">
                    {c.role === "lead" ? <Badge tone="teal">Lead</Badge> : <Badge tone="slate">Participant</Badge>}
                  </td>
                  <td className="px-3 py-3"><Badge tone={c.status === "active" ? "green" : "slate"}>{c.status}</Badge></td>
                  <td className="px-3 py-3">{c.contractValue != null ? `AED ${Number(c.contractValue).toLocaleString()}` : "-"}</td>
                  <td className="px-3 py-3">{c.participantCount}</td>
                  <td className="px-5 py-3 text-muted">{new Date(c.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function ClientPortalsTab({
  detail,
  onView,
}: {
  detail: AdminCompanyDetail;
  onView: (orgId: string) => void;
}) {
  const portals = detail.clientPortals;
  return (
    <div>
      <SectionHeading
        title="Client Portals"
        body="Buying organisations linked to this company workspaces (Master Admin spec section 9). Client portal plans are not modelled in the schema yet - shown as a dash placeholder."
      />
      <Card className="overflow-x-auto">
        {portals.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No client portals" body="Buying organisations linked to this company's contracts appear here." />
          </div>
        ) : (
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">Client organisation</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Portal plan</th>
                <th className="px-3 py-3">Members</th>
                <th className="px-3 py-3">Contracts</th>
                <th className="px-5 py-3">Last activity</th>
                <th className="px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {portals.map((o) => (
                <tr key={o.id} className="hover:bg-mist/60">
                  <td className="px-5 py-3 font-semibold text-navy">{o.name}</td>
                  <td className="px-3 py-3"><Badge tone={o.status === "verified" ? "green" : "slate"}>{o.status}</Badge></td>
                  <td className="px-3 py-3 text-muted">-</td>
                  <td className="px-3 py-3">{o.memberCount}</td>
                  <td className="px-3 py-3">
                    {o.contracts.length === 0 ? (
                      <span className="text-muted">-</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {o.contracts.map((c) => (
                          <li key={c.id}>
                            <Link to="/admin/contracts/$workspaceId" params={{ workspaceId: c.id }} className="text-brand hover:underline">{c.title}</Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-5 py-3 text-muted">{o.lastActivity ? new Date(o.lastActivity).toLocaleString() : "-"}</td>
                  <td className="px-5 py-3">
                    <Button variant="secondary" size="sm" onClick={() => onView(o.id)}>
                      View as Client
                    </Button>
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
        <p className="text-sm text-ink">{c.ownerEmail ?? "-"}</p>
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
        body="Audit trail for this company - company-scoped events and its contract workspaces."
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
          <p className="mt-2 text-sm text-muted">Read-only role - notes are disabled.</p>
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
                <th className="px-3 py-3">In contract</th>
                <th className="px-3 py-3">Upsell</th>
                <th className="px-5 py-3">Admin decision</th>
                <th className="px-5 py-3">Related opportunities</th>
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
                    {r.usedInContract ? <Badge tone="green">Yes</Badge> : <Badge tone="slate">No</Badge>}
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
                  <td className="px-5 py-3">
                    {r.opportunities.length === 0 ? (
                      <span className="text-muted">-</span>
                    ) : (
                      <ul className="space-y-1">
                        {r.opportunities.map((o) => (
                          <li key={o.id} className="flex items-center gap-1.5">
                            <Badge tone={o.kind === "upsell" ? "teal" : "indigo"}>{o.kind === "upsell" ? "Upsell" : "AI"}</Badge>
                            <span className="text-xs text-muted">{o.status}{o.confidence ? ` · ${o.confidence}` : ""}</span>
                          </li>
                        ))}
                      </ul>
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

function EvidenceTab({ relationships }: { relationships: CompanyServiceRow[] }) {
  const rows = relationships.flatMap((r) =>
    r.evidence.map((e) => ({ ...e, serviceName: r.service.name })),
  );
  return (
    <div>
      <SectionHeading
        title="Service evidence"
        body="Proof rows behind this company\'s relationships - service pages, capability statements, case studies and documents."
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
      body="AI Service Intelligence discoveries for this company - approve, reject or archive; every decision is audit-logged."
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
      body="Upsell and cross-sell recommendations for this company - human approval is required before anything is actioned."
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

// ------------------------------------------------------------- Membership
function fmtDate2(v: string | null | undefined): string {
  if (!v) return "-";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "-" : d.toLocaleDateString();
}
function fmtAed(v: number | null | undefined): string {
  if (v === null || v === undefined) return "-";
  return `AED ${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function MembershipTab({
  subscription,
}: {
  detail: AdminCompanyDetail;
  subscription: AdminCompanySubscriptionDetail | null;
}) {
  const sub = subscription?.subscription ?? null;
  const plan = subscription?.plan ?? null;
  const minCommit = subscription?.commitments?.[0] ?? null;
  const pm = subscription?.paymentMethods?.[0] ?? null;
  if (!sub) {
    return (
      <Card className="p-6">
        <EmptyState
          title="No membership yet"
          body="This company has no subscription record. Memberships appear once a client selects a plan and completes checkout."
        />
      </Card>
    );
  }
  const price = plan
    ? sub.billingInterval === "annual"
      ? plan.priceAnnualAel
      : plan.priceMonthlyAel
    : null;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="p-6">
        <SectionHeading title="Plan" body="Current membership plan and billing." />
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Fact label="Plan" value={plan?.name ?? "-"} />
          <Fact label="Price" value={fmtAed(price)} />
          <Fact label="Billing interval" value={sub.billingInterval === "annual" ? "Annual" : "Monthly"} />
          <Fact label="Subscription status" value={sub.statusLabel} />
          <Fact label="Start date" value={fmtDate2(sub.startedAt)} />
          <Fact label="Current billing period" value={`${fmtDate2(sub.currentPeriodStart)} → ${fmtDate2(sub.currentPeriodEnd)}`} />
          <Fact label="Next billing date" value={fmtDate2(sub.nextBillingDate)} />
          <Fact label="Payment method" value={pm ? `${pm.brand ?? pm.type} •••• ${pm.last4 ?? ""}`.trim() : "-"} />
        </dl>
      </Card>
      <Card className="p-6">
        <SectionHeading title="Minimum commitment" body="Three-month minimum service commitment." />
        {minCommit ? (
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Fact label="Commitment start" value={fmtDate2(minCommit.commitmentStart)} />
            <Fact label="Commitment end" value={fmtDate2(minCommit.commitmentEnd)} />
            <Fact label="Cycles required" value={`${minCommit.cyclesRequired}`} />
            <Fact label="Status" value={minCommit.completed ? "Completed" : "In progress"} />
            <Fact label="Downgrade eligibility" value={fmtDate2(minCommit.commitmentEnd)} />
          </dl>
        ) : (
          <p className="text-sm text-muted">No commitment record.</p>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------- Subscription
function SubscriptionTab({
  subscription,
  subscriptionError,
}: {
  subscription: AdminCompanySubscriptionDetail | null;
  subscriptionError: string | null;
}) {
  if (subscriptionError) {
    return (
      <Card className="p-6">
        <ErrorText>{subscriptionError}</ErrorText>
      </Card>
    );
  }
  if (!subscription || !subscription.subscription) {
    return (
      <Card className="p-6">
        <EmptyState
          title="No subscription record"
          body="Nothing to show yet - this company has not created a subscription."
        />
      </Card>
    );
  }
  const sub = subscription.subscription;
  const plan = subscription.plan;
  const outstanding = subscription.invoices.filter((i) => i.status === "Open").length;
  const failedPayment = subscription.invoices.some((i) => i.status === "Failed");
  const pendingUpgrade = subscription.upgradeRequests.find((u) => u.status === "Pending" || u.status === "Confirmed");
  const pendingDowngrade = subscription.downgradeRequests.find((d) => d.status === "Pending" || d.status === "Confirmed");
  const cancellation = subscription.cancellationRequests.find((cc) => cc.status === "Pending" || cc.status === "Confirmed");
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <SectionHeading title="Subscription" body="Read-only management panel - actions arrive with a later stage." />
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Fact label="Plan" value={plan?.name ?? "-"} />
            <Fact label="Billing interval" value={sub.billingInterval === "annual" ? "Annual" : "Monthly"} />
            <Fact label="Status" value={sub.statusLabel} />
            <Fact label="Started" value={fmtDate2(sub.startedAt)} />
            <Fact label="Current period" value={`${fmtDate2(sub.currentPeriodStart)} → ${fmtDate2(sub.currentPeriodEnd)}`} />
            <Fact label="Next billing date" value={fmtDate2(sub.nextBillingDate)} />
            <Fact label="Outstanding balance" value={outstanding > 0 ? `${outstanding} open invoice${outstanding === 1 ? "" : "s"}` : "None"} />
            <Fact label="Failed payment" value={failedPayment ? "Yes - action required" : "No"} />
            <Fact label="Pending upgrade" value={pendingUpgrade ? pendingUpgrade.status : "-"} />
            <Fact label="Pending downgrade" value={pendingDowngrade ? pendingDowngrade.status : "-"} />
            <Fact label="Cancellation status" value={cancellation ? `${cancellation.status} (${cancellation.mode})` : sub.status === "cancelled" || sub.status === "cancel_at_period_end" ? sub.statusLabel : "-"} />
            <Fact label="Stripe customer ID" value={subscription.customer?.providerCustomerId ?? "- (sandbox)"} />
            <Fact label="Stripe subscription ID" value={sub.providerSubscriptionId ?? "- (sandbox)"} />
          </dl>
        </Card>
        <Card className="p-6">
          <SectionHeading title="Payment method" />
          {subscription.paymentMethods.length === 0 ? (
            <p className="text-sm text-muted">No payment method on file.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {subscription.paymentMethods.map((m) => (
                <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-medium text-ink">
                    {m.brand ?? m.type} •••• {m.last4 ?? ""}
                    {m.expiry ? ` (${m.expiry})` : ""}
                  </span>
                  <Badge tone="teal">{m.isDefault ? "Default" : "-"}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card className="p-6">
        <SectionHeading title="Invoices" body="Subscription invoices from the billing provider (sandbox)." />
        {subscription.invoices.length === 0 ? (
          <p className="text-sm text-muted">No invoices yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                  <th className="py-2 pr-3">Number</th>
                  <th className="py-2 pr-3">Period</th>
                  <th className="py-2 pr-3">Total</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Due</th>
                  <th className="py-2">Paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {subscription.invoices.map((i) => (
                  <tr key={i.id}>
                    <td className="py-2 pr-3 font-medium text-navy">{i.invoiceNumber}</td>
                    <td className="py-2 pr-3 text-muted">{fmtDate2(i.billingPeriodStart)} → {fmtDate2(i.billingPeriodEnd)}</td>
                    <td className="py-2 pr-3">{fmtAed(i.totalAel)}</td>
                    <td className="py-2 pr-3"><Badge tone="slate">{i.status}</Badge></td>
                    <td className="py-2 pr-3 text-muted">{fmtDate2(i.dueDate)}</td>
                    <td className="py-2 text-muted">{fmtDate2(i.paidAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <SectionHeading title="Payment events" />
          {subscription.paymentEvents.length === 0 ? (
            <p className="text-sm text-muted">No payment events yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {subscription.paymentEvents.slice(0, 12).map((e) => (
                <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-medium text-ink">{e.eventType.replace(/_/g, " ")}</span>
                  <span className="text-xs text-muted">{fmtAed(e.amountAel)} · {fmtDate2(e.occurredAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-6">
          <SectionHeading title="Webhook history" body="Latest billing-provider webhook events (all tenants)." />
          {subscription.webhooks.length === 0 ? (
            <p className="text-sm text-muted">No webhook events yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {subscription.webhooks.slice(0, 12).map((w) => (
                <li key={w.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-medium text-ink">{w.eventType}</span>
                  <span className="text-xs text-muted">{w.processed ? "processed" : "unprocessed"} · {fmtDate2(w.receivedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card className="p-6">
        <SectionHeading title="Subscription history" body="Plan changes, commitments and payment outcomes." />
        {subscription.history.length === 0 ? (
          <p className="text-sm text-muted">No history yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {subscription.history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="font-medium capitalize text-ink">{h.changeType.replace(/_/g, " ")}</span>
                <span className="text-xs text-muted">
                  {h.billingAmountAel !== null ? fmtAed(h.billingAmountAel) : ""} · {fmtDate2(h.effectiveDate)} · {h.confirmationStatus ?? ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------- Feature Entitlements
function EntitlementsTab({
  subscription,
}: {
  detail: AdminCompanyDetail;
  subscription: AdminCompanySubscriptionDetail | null;
}) {
  if (!subscription || !subscription.subscription) {
    return (
      <Card className="p-6">
        <EmptyState
          title="No entitlements yet"
          body="Feature entitlements appear once the company has an active subscription plan."
        />
      </Card>
    );
  }
  const plan = subscription.plan;
  return (
    <div className="flex flex-col gap-6">
      <Card className="p-6">
        <SectionHeading
          title={`Plan entitlements - ${plan?.name ?? "Current plan"}`}
          body="Entitlements included in the membership plan, marked Plan Included."
        />
        {subscription.planEntitlements.length === 0 ? (
          <p className="text-sm text-muted">This plan has no entitlements configured.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {subscription.planEntitlements.map((e) => (
              <span key={e.key} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-mist px-3 py-1 text-xs font-semibold text-ink">
                {e.label}
                <Badge tone="teal">Plan Included</Badge>
              </span>
            ))}
          </div>
        )}
      </Card>
      <Card className="p-6">
        <SectionHeading
          title="Admin grants & revokes"
          body="Manual feature_access_records - visible as Admin Granted / Admin Revoked with any expiry."
        />
        {subscription.featureAccess.length === 0 ? (
          <p className="text-sm text-muted">No manual feature grants yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {subscription.featureAccess.map((f) => (
              <span key={f.key} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-mist px-3 py-1 text-xs font-semibold text-ink">
                {f.label}
                <Badge tone={f.granted ? "green" : "red"}>
                  {f.granted ? "Admin Granted" : "Admin Revoked"}
                </Badge>
                {f.effectiveTo && <span className="text-muted">until {fmtDate2(f.effectiveTo)}</span>}
              </span>
            ))}
          </div>
        )}
      </Card>
      <Card className="p-6">
        <SectionHeading title="Entitlement audit trail" body="Every grant / revoke / change, from entitlement_audit_logs." />
        {subscription.entitlementAudit.length === 0 ? (
          <p className="text-sm text-muted">No entitlement audit entries yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {subscription.entitlementAudit.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="font-medium text-ink">
                  {e.action} - {e.entitlementKey.replace(/_/g, " ")}
                </span>
                <span className="text-xs text-muted">
                  {e.reason ?? ""} · {fmtDate2(e.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
