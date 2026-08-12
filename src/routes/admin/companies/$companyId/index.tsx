import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { enterViewAsClient } from "~/lib/admin-view";
import {
  adminGrantEntitlement,
  adminListCompanyEntitlements,
  adminRevokeEntitlement,
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
import type {
  AdminCompanySubscriptionDetail,
  CompanyEntitlementRow,
  CompanyEntitlementsResult,
} from "~/lib/admin";
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
  Field,
  Input,
  Select,
  Textarea,
} from "~/components/ui";
import { AdminSubscriptionPanel } from "~/components/AdminSubscriptionPanel";

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
      staffRoles={admin.staffRoles ?? []}
      detail={detail}
      relationships={relationships}
      relationshipsError={relationshipsError}
      subscription={subscription}
    />
  );
}
function CompanyDetailBody({
  adminCanMutate,
  staffRoles,
  detail,
  relationships: initialRelationships,
  relationshipsError: initialRelationshipsError,
  subscription,
}: {
  adminCanMutate: boolean;
  staffRoles: string[];
  detail: AdminCompanyDetail;
  relationships: CompanyServiceRow[];
  relationshipsError: string | null;
  subscription: AdminCompanySubscriptionDetail | null;
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
        search: { section: "dashboard", ws: undefined, thread: undefined },
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
      {tab === "subscription" && (
        <SubscriptionTab companyId={detail.company.id} staffRoles={staffRoles} adminCanMutate={adminCanMutate} />
      )}
      {tab === "entitlements" && (
        <EntitlementsTab companyId={detail.company.id} staffRoles={staffRoles} adminCanMutate={adminCanMutate} subscription={subscription} />
      )}
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
  companyId,
  staffRoles,
  adminCanMutate,
}: {
  companyId: string;
  staffRoles: string[];
  adminCanMutate: boolean;
}) {
  return (
    <AdminSubscriptionPanel
      companyId={companyId}
      staffRoles={staffRoles}
      adminCanMutate={adminCanMutate}
    />
  );
}
// ------------------------------------------------- Feature Entitlements (spec 7)
const ENTITLEMENT_CHOICES: { key: string; label: string }[] = [
  { key: "basic_profile", label: "Basic Profile" },
  { key: "verified_profile", label: "Verified Profile" },
  { key: "expanded_profile", label: "Expanded Profile" },
  { key: "directory_visibility", label: "Directory Visibility" },
  { key: "opportunity_access", label: "Opportunity Access" },
  { key: "contract_participation", label: "Contract Participation" },
  { key: "contract_invitations", label: "Contract Invitations" },
  { key: "unlimited_invitations", label: "Unlimited Invitations" },
  { key: "team_members", label: "Team Members" },
  { key: "document_storage", label: "Document Storage" },
  { key: "work_packages", label: "Work Packages" },
  { key: "tasks_and_milestones", label: "Tasks and Milestones" },
  { key: "client_portal", label: "Client Portal" },
  { key: "bid_workspace", label: "Bid Workspace" },
  { key: "pricing_comparison", label: "Pricing Comparison" },
  { key: "pricing_submissions", label: "Pricing Submissions" },
  { key: "approvals", label: "Approvals" },
  { key: "variations", label: "Variations" },
  { key: "invoice_tracking", label: "Invoice Tracking" },
  { key: "performance_reports", label: "Performance Reports" },
  { key: "ai_partnership_intelligence", label: "AI Partnership Intelligence" },
  { key: "priority_support", label: "Priority Support" },
  { key: "private_partner_network", label: "Private Partner Network" },
  { key: "api_access", label: "API Access" },
  { key: "multiple_locations", label: "Multiple Locations" },
  { key: "multiple_divisions", label: "Multiple Divisions" },
  { key: "advanced_reporting", label: "Advanced Reporting" },
];
const ENTITLEMENT_MUTATE = ["operations", "finance", "super_admin"];
const ENTITLEMENT_STATUS_TONES: Record<
  string,
  "teal" | "blue" | "amber" | "green" | "red" | "slate"
> = {
  "Plan Included": "teal",
  "Admin Granted": "blue",
  Promotional: "amber",
  Temporary: "green",
  Restricted: "red",
  Expired: "slate",
};

function EntitlementsTab({
  companyId,
  staffRoles,
  adminCanMutate,
  subscription,
}: {
  companyId: string;
  staffRoles: string[];
  adminCanMutate: boolean;
  subscription: AdminCompanySubscriptionDetail | null;
}) {
  const [ent, setEnt] = useState<CompanyEntitlementsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [grantOpen, setGrantOpen] = useState(false);
  const [revokeRow, setRevokeRow] = useState<CompanyEntitlementRow | null>(null);
  const load = async () => {
    setLoading(true);
    setLoadError(null);
    const res = await adminListCompanyEntitlements({ data: { companyId } });
    if (res.ok) setEnt(res);
    else setLoadError(res.error);
    setLoading(false);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);
  const canMutate =
    adminCanMutate && staffRoles.some((r) => ENTITLEMENT_MUTATE.includes(r));
  if (loading && !ent) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted">Loading entitlements...</p>
      </Card>
    );
  }
  if (loadError && !ent) {
    return (
      <Card className="p-6">
        <ErrorText>{loadError}</ErrorText>
      </Card>
    );
  }
  const rows = ent?.ok ? ent.entitlements : [];
  const planName = ent?.ok ? ent.company.planName : subscription?.plan?.name ?? null;
  return (
    <div className="flex flex-col gap-6">
      {notice && (
        <div className="rounded-xl border border-success/30 bg-success/5 px-4 py-3 text-sm text-success">
          {notice}
        </div>
      )}
      <Card className="p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Company entitlements</h2>
            <p className="mt-1 text-sm text-muted">
              {planName
                ? `Plan: ${planName} - every feature marked with its source status.`
                : "Every feature marked with its source status: Plan Included / Admin Granted / Promotional / Temporary / Restricted / Expired."}
            </p>
          </div>
          {canMutate && (
            <Button size="sm" onClick={() => setGrantOpen(true)}>
              Grant feature access
            </Button>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">No entitlements found for this company.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <li
                key={`${r.key}-${i}`}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{r.label}</span>
                    <Badge tone={ENTITLEMENT_STATUS_TONES[r.status] ?? "slate"}>{r.status}</Badge>
                    {r.scheduled && <Badge tone="navy">Scheduled</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {r.key}
                    {r.expiresAt ? ` - expires ${fmtDate2(r.expiresAt)}` : ""}
                    {r.effectiveFrom && r.scheduled ? ` - starts ${fmtDate2(r.effectiveFrom)}` : ""}
                    {r.grantedByEmail ? ` - granted by ${r.grantedByEmail}` : ""}
                  </p>
                  {r.reason && <p className="mt-1 text-xs text-muted">Reason: {r.reason}</p>}
                </div>
                {r.grantId &&
                  (r.status === "Admin Granted" ||
                    r.status === "Promotional" ||
                    r.status === "Temporary") &&
                  canMutate && (
                    <Button variant="outline" size="sm" onClick={() => setRevokeRow(r)}>
                      Revoke
                    </Button>
                  )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {!canMutate && (
        <Card className="p-6">
          <SectionHeading
            title="Read-only view"
            body="Grant and revoke actions require an operations, finance or super_admin staff role."
          />
        </Card>
      )}
      <Card className="p-6">
        <SectionHeading
          title="Entitlement audit trail"
          body="Every grant / revoke / change, from entitlement_audit_logs."
        />
        {!subscription || subscription.entitlementAudit.length === 0 ? (
          <p className="text-sm text-muted">No entitlement audit entries yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {subscription.entitlementAudit.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="font-medium text-ink">
                  {e.action} - {e.entitlementKey.replace(/_/g, " ")}
                </span>
                <span className="text-xs text-muted">
                  {e.reason ?? ""} - {fmtDate2(e.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {grantOpen && canMutate && (
        <GrantEntitlementModal
          companyId={companyId}
          companyName={ent?.ok ? ent.company.name : ""}
          choices={ENTITLEMENT_CHOICES}
          onClose={() => setGrantOpen(false)}
          onDone={async (msg) => {
            setGrantOpen(false);
            setNotice(msg);
            await load();
          }}
        />
      )}
      {revokeRow && canMutate && (
        <RevokeEntitlementModal
          companyId={companyId}
          row={revokeRow}
          onClose={() => setRevokeRow(null)}
          onDone={async (msg) => {
            setRevokeRow(null);
            setNotice(msg);
            await load();
          }}
        />
      )}
    </div>
  );
}

function GrantEntitlementModal({
  companyId,
  companyName,
  choices,
  onClose,
  onDone,
}: {
  companyId: string;
  companyName: string;
  choices: { key: string; label: string }[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [key, setKey] = useState(choices[0]?.key ?? "");
  const [customMode, setCustomMode] = useState(false);
  const [customKey, setCustomKey] = useState("");
  const [grantType, setGrantType] = useState<"admin_grant" | "promotional" | "temporary">("admin_grant");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [notify, setNotify] = useState(true);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosenKey = customMode ? customKey.trim() : key;
  const chosenLabel =
    choices.find((c) => c.key === chosenKey)?.label ??
    chosenKey.replace(/_/g, " ");
  const execute = async () => {
    setBusy(true);
    setError(null);
    const res = await adminGrantEntitlement({
      data: {
        companyId,
        entitlementKey: chosenKey,
        grantType,
        reason: reason.trim(),
        expiresAt: expiresAt || null,
        effectiveFrom: effectiveFrom || null,
        notify,
      },
    });
    setBusy(false);
    if (!res.ok) setError(res.error);
    else onDone(res.message);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 p-4">
      <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl">
        {!review ? (
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-lg font-bold">Grant feature access</h3>
              <p className="mt-1 text-sm text-muted">Company: {companyName}</p>
            </div>
            <Field label="Entitlement">
              {customMode ? (
                <Input
                  value={customKey}
                  onChange={(e) => setCustomKey(e.target.value)}
                  placeholder="entitlement_key"
                />
              ) : (
                <Select value={key} onChange={(e) => setKey(e.target.value)}>
                  {choices.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={customMode}
                onChange={(e) => setCustomMode(e.target.checked)}
              />
              Enter a custom entitlement key
            </label>
            <Field label="Grant type">
              <Select
                value={grantType}
                onChange={(e) =>
                  setGrantType(e.target.value as "admin_grant" | "promotional" | "temporary")
                }
              >
                <option value="admin_grant">Admin grant (permanent)</option>
                <option value="promotional">Promotional</option>
                <option value="temporary">Temporary (requires expiry)</option>
              </Select>
            </Field>
            <Field label="Reason">
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Why is this access being granted?"
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Expiry date (temporary grants)" hint="Optional for admin grant / promotional.">
                <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
              </Field>
              <Field label="Effective date (scheduling)" hint="Leave empty to apply immediately.">
                <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={notify}
                onChange={(e) => setNotify(e.target.checked)}
              />
              Notify the company owner
            </label>
            {error && <ErrorText>{error}</ErrorText>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!chosenKey || !reason.trim()}
                onClick={() => setReview(true)}
              >
                Review grant
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-slate-200 bg-mist/50 p-4">
              <SectionHeading
                title="Confirm grant"
                body="This is written to the audit log and can notify the company owner."
              />
              <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <Fact label="Entitlement" value={chosenLabel} />
                <Fact label="Key" value={chosenKey} />
                <Fact label="Grant type" value={grantType} />
                <Fact label="Notify owner" value={notify ? "Yes" : "No"} />
                {expiresAt && <Fact label="Expires" value={expiresAt} />}
                {effectiveFrom && <Fact label="Effective" value={effectiveFrom} />}
              </dl>
              <p className="mt-3 text-sm text-ink">Reason: {reason}</p>
            </div>
            {error && <ErrorText>{error}</ErrorText>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setReview(false)}>
                Back
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => void execute()}
              >
                {busy ? "Granting..." : "Confirm grant"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RevokeEntitlementModal({
  companyId,
  row,
  onClose,
  onDone,
}: {
  companyId: string;
  row: CompanyEntitlementRow;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const execute = async () => {
    setBusy(true);
    setError(null);
    const res = await adminRevokeEntitlement({
      data: { companyId, grantId: row.grantId!, reason: reason.trim(), notify },
    });
    setBusy(false);
    if (!res.ok) setError(res.error);
    else onDone(res.message);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex flex-col gap-4">
          <div>
            <h3 className="text-lg font-bold">Revoke {row.label}</h3>
            <p className="mt-1 text-sm text-muted">
              Current status: {row.status}. The company owner keeps the audit record of this grant.
            </p>
          </div>
          <Field label="Reason">
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Why is this access being revoked?"
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
            />
            Notify the company owner
          </label>
          {error && <ErrorText>{error}</ErrorText>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy || !reason.trim()}
              onClick={() => void execute()}
            >
              {busy ? "Revoking..." : "Confirm revoke"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
