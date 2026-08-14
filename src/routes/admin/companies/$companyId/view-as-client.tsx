import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge, Button, Card, EmptyState, ErrorText } from "~/components/ui";
import {
  exitViewAsClient,
  getViewAsClientApprovals,
  getViewAsClientContract,
  getViewAsClientDashboard,
  getViewAsClientDocuments,
  getViewAsClientInvoices,
  getViewAsClientIssues,
  getViewAsClientMilestones,
  getViewAsClientOrg,
  getViewAsClientReports,
  getViewAsClientSession,
  getViewAsClientVariations,
  listViewAsClientContracts,
  listViewAsClientConversations,
  listViewAsClientMessages,
  listViewAsClientNotifications,
  listViewAsClientTeam,
} from "~/lib/admin-view";
import type { ViewAsClientSessionInfo } from "~/lib/admin-view";
import type {
  ClientApprovals,
  ClientContractDetail,
  ClientContractSummary,
  ClientConversation,
  ClientDashboardStats,
  ClientDocument,
  ClientInvoice,
  ClientIssue,
  ClientMilestone,
  ClientNotification,
  ClientOrgProfile,
  ClientProgressReport,
  ClientTeamMember,
  ClientThread,
  ClientVariation,
} from "~/lib/types";
import {
  CLIENT_DOCUMENT_CATEGORY_LABELS,
  CLIENT_DOCUMENT_STATUS_LABELS,
  CLIENT_DOCUMENT_STATUS_TONES,
  CLIENT_INVOICE_STATUS_LABELS,
  CLIENT_INVOICE_STATUS_TONES,
  CLIENT_ISSUE_SEVERITY_LABELS,
  CLIENT_ISSUE_SEVERITY_TONES,
  CLIENT_ISSUE_STATUS_LABELS,
  CLIENT_ISSUE_STATUS_TONES,
  CLIENT_MESSAGE_THREAD_LABELS,
  CLIENT_MILESTONE_STATUS_LABELS,
  CLIENT_MILESTONE_STATUS_TONES,
  CLIENT_ROLE_LABELS,
  CLIENT_VARIATION_STATUS_LABELS,
  CLIENT_VARIATION_STATUS_TONES,
  WORKSPACE_BADGE_TONES,
  WORKSPACE_STATUS_LABELS,
} from "~/lib/types";

export const Route = createFileRoute("/admin/companies/$companyId/view-as-client")({
  validateSearch: (search: Record<string, unknown>) => ({
    section:
      typeof search.section === "string" &&
      ["dashboard", "contracts", "contract", "organisation", "team", "messages", "notifications", "documents", "milestones", "approvals", "issues", "variations", "invoices", "reports"].includes(search.section)
        ? search.section
        : "dashboard",
    ws: typeof search.ws === "string" ? search.ws : undefined,
    thread: typeof search.thread === "string" ? search.thread : undefined,
  }),
  loaderDeps: ({ search }) => ({ section: search.section, ws: search.ws, thread: search.thread }),
  loader: async ({ deps }) => {
    const session = await getViewAsClientSession();
    if (!session.ok) {
      return {
        invalid: true,
        invalidError: session.error,
        session: null,
        dashboard: null,
        contracts: [],
        contract: null,
        org: null,
        team: [],
        notifications: null,
        conversations: [],
        thread: null,
        documents: [],
        milestones: [],
        approvals: null,
        issues: [],
        variations: [],
        invoices: [],
        reports: [],
        section: deps.section,
        loadErrors: [] as string[],
      };
    }
    const orgId = session.session.orgId;
    const section = deps.section;
    const errors: string[] = [];
    let dashboard: ClientDashboardStats | null = null;
    let contracts: ClientContractSummary[] = [];
    let contract: ClientContractDetail | null = null;
    let org: ClientOrgProfile | null = null;
    let team: ClientTeamMember[] = [];
    let notifications: { notifications: ClientNotification[]; unreadCount: number } | null = null;
    let conversations: ClientConversation[] = [];
    let thread: ClientThread | null = null;
    let documents: ClientDocument[] = [];
    let milestones: ClientMilestone[] = [];
    let approvals: ClientApprovals | null = null;
    let issues: ClientIssue[] = [];
    let variations: ClientVariation[] = [];
    let invoices: ClientInvoice[] = [];
    let reports: ClientProgressReport[] = [];

    if (section === "dashboard") {
      const r = await getViewAsClientDashboard({ data: { orgId } });
      if (r.ok) dashboard = r.data;
      else errors.push(r.error);
    } else if (section === "contracts") {
      const r = await listViewAsClientContracts({ data: { orgId } });
      if (r.ok) contracts = r.data;
      else errors.push(r.error);
    } else if (section === "contract" && deps.ws) {
      const r = await getViewAsClientContract({ data: { orgId, workspaceId: deps.ws } });
      if (r.ok) contract = r.data;
      else errors.push(r.error);
    } else if (section === "organisation") {
      const r = await getViewAsClientOrg({ data: { orgId } });
      if (r.ok) org = r.data;
      else errors.push(r.error);
    } else if (section === "team") {
      const r = await listViewAsClientTeam({ data: { orgId } });
      if (r.ok) team = r.data;
      else errors.push(r.error);
    } else if (section === "notifications") {
      const r = await listViewAsClientNotifications({ data: { orgId } });
      if (r.ok) notifications = r.data;
      else errors.push(r.error);
    } else if (section === "messages") {
      const r = await listViewAsClientConversations({ data: { orgId } });
      if (r.ok) conversations = r.data;
      else errors.push(r.error);
      if (deps.ws && deps.thread) {
        const t = await listViewAsClientMessages({ data: { orgId, workspaceId: deps.ws, threadKey: deps.thread } });
        if (t.ok) thread = t.data;
        else errors.push(t.error);
      }
    } else if (section === "documents") {
      const r = await getViewAsClientDocuments({ data: { orgId, workspaceId: deps.ws } });
      if (r.ok) documents = r.data;
      else errors.push(r.error);
    } else if (section === "milestones") {
      const r = await getViewAsClientMilestones({ data: { orgId, workspaceId: deps.ws } });
      if (r.ok) milestones = r.data;
      else errors.push(r.error);
    } else if (section === "approvals") {
      const r = await getViewAsClientApprovals({ data: { orgId } });
      if (r.ok) approvals = r.data;
      else errors.push(r.error);
    } else if (section === "issues") {
      const r = await getViewAsClientIssues({ data: { orgId, workspaceId: deps.ws } });
      if (r.ok) issues = r.data;
      else errors.push(r.error);
    } else if (section === "variations") {
      const r = await getViewAsClientVariations({ data: { orgId, workspaceId: deps.ws } });
      if (r.ok) variations = r.data;
      else errors.push(r.error);
    } else if (section === "invoices") {
      const r = await getViewAsClientInvoices({ data: { orgId, workspaceId: deps.ws } });
      if (r.ok) invoices = r.data;
      else errors.push(r.error);
    } else if (section === "reports") {
      const r = await getViewAsClientReports({ data: { orgId } });
      if (r.ok) reports = r.data;
      else errors.push(r.error);
    }

    return {
      invalid: false,
      invalidError: null,
      session: session.session,
      dashboard,
      contracts,
      contract,
      org,
      team,
      notifications,
      conversations,
      thread,
      documents,
      milestones,
      approvals,
      issues,
      variations,
      invoices,
      reports,
      section,
      loadErrors: errors,
    };
  },
  component: ViewAsClientPage,
});

function ViewAsClientPage() {
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  const params = Route.useParams();
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (data.invalid) {
      // Redirect back to the company detail page with a notice (token stale,
      // expired or missing). The detail page reads the notice search param.
      void navigate({
        to: "/admin/companies/$companyId",
        params: { companyId: params.companyId },
        search: { notice: data.invalidError === "EXPIRED" ? "view-expired" : "view-ended" },
        replace: true,
      });
    }
  }, [data.invalid, data.invalidError, navigate, params.companyId]);

  if (data.invalid) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-mist p-6">
        <Card className="w-full max-w-md p-6">
          <p className="text-sm font-bold uppercase tracking-widest text-amber">View as Client</p>
          <h1 className="mt-1 text-xl font-bold">Session ended</h1>
          <p className="mt-2 text-sm text-muted">
            {data.invalidError === "EXPIRED"
              ? "This View as Client session expired after 20 minutes and has been closed. The expiry was recorded in the audit log."
              : "This View as Client session is no longer active. It may have been ended or the token is invalid."}
          </p>
          <div className="mt-4">
            <Button
              variant="primary"
              onClick={() =>
                void navigate({
                  to: "/admin/companies/$companyId",
                  params: { companyId: params.companyId },
                  search: { notice: data.invalidError === "EXPIRED" ? "view-expired" : "view-ended" },
                  replace: true,
                })
              }
            >
              Back to company
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const session = data.session as ViewAsClientSessionInfo;
  const section = data.section;

  async function handleExit() {
    setExiting(true);
    await exitViewAsClient();
    await navigate({
      to: "/admin/companies/$companyId",
      params: { companyId: params.companyId },
      search: { notice: "view-exited" },
      replace: true,
    });
  }

  const navItems: { key: string; label: string; built: boolean }[] = [
    { key: "dashboard", label: "Dashboard", built: true },
    { key: "contracts", label: "Contracts", built: true },
    { key: "organisation", label: "My Organisation", built: true },
    { key: "team", label: "Team", built: true },
    { key: "messages", label: "Messages", built: true },
    { key: "notifications", label: "Notifications", built: true },
    { key: "documents", label: "Documents", built: true },
    { key: "milestones", label: "Milestones", built: true },
    { key: "approvals", label: "Approvals", built: true },
    { key: "issues", label: "Issues", built: true },
    { key: "variations", label: "Variations", built: true },
    { key: "invoices", label: "Invoices", built: true },
    { key: "reports", label: "Reports", built: true },
  ];

  const sidebar = (
    <div className="flex h-full flex-col bg-navy text-white">
      <div className="flex h-14 items-center gap-2 px-5">
        <span className="text-sm font-bold">ScaleBridge</span>
        <span className="text-[11px] font-semibold uppercase tracking-widest text-teal">Client Portal</span>
      </div>
      <div className="border-b border-white/10 px-5 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-white/50">Viewing for</p>
        <p className="mt-0.5 truncate text-sm font-bold text-white">{session.orgName}</p>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="flex flex-col gap-0.5">
          {navItems.map((item) => {
            const active =
              item.key === "contracts"
                ? section === "contracts" || section === "contract"
                : section === item.key;
            return (
              <li key={item.key}>
                <Link
                  to="/admin/companies/$companyId/view-as-client"
                  params={{ companyId: params.companyId }}
                  search={{ section: item.key, ws: undefined, thread: undefined }}
                  className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                    active ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <span>{item.label}</span>
                  {!item.built && (
                    <span className="rounded-full bg-teal/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-teal">
                      stub
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-white/10 px-5 py-4">
        <p className="truncate text-sm font-semibold">{session.adminName || session.adminEmail}</p>
        <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-widest text-amber">
          Master Admin
        </p>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-mist">
      {/* Fixed high-visibility identity banner - always visible, never dismissible */}
      <div className="fixed inset-x-0 top-0 z-50 border-b-2 border-navy bg-amber-400 px-4 py-2 shadow-lg">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 text-xs font-extrabold uppercase tracking-widest text-navy sm:text-sm">
            View as Client
          </p>
          <p className="min-w-0 flex-1 truncate text-xs font-semibold text-navy sm:text-sm">
            Viewing {session.orgName} as {session.adminName || session.adminEmail} (
            {session.adminRoles.join(", ")}) - Reason: {session.reason}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden rounded bg-navy/10 px-2 py-1 text-[11px] font-bold text-navy lg:inline">
              expires {new Date(session.expiresAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            </span>
            <Button size="sm" variant="outline" onClick={handleExit} disabled={exiting}>
              {exiting ? "Exiting..." : "Exit view"}
            </Button>
          </div>
        </div>
      </div>

      {/* desktop sidebar (below banner) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 pt-14 lg:block">{sidebar}</aside>

      <div className="pt-14 lg:pl-64">
        <header className="sticky top-14 z-20 flex h-14 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <p className="text-sm font-bold uppercase tracking-widest text-teal">
            ScaleBridge Client - {session.orgName}
          </p>
          <Badge tone="amber">Read-only view</Badge>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
          <p className="mb-6 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-xs font-medium text-navy">
            You are viewing this portal as a Master Admin for support purposes. All actions are
            read-only and every entry, exit and expiry is recorded in the audit log.
          </p>
          {data.loadErrors.length > 0 && (
            <div className="mb-6">
              {data.loadErrors.map((e) => (
                <ErrorText key={e}>{e}</ErrorText>
              ))}
            </div>
          )}
          {section === "dashboard" && <DashboardSection stats={data.dashboard} companyId={params.companyId} />}
          {section === "contracts" && <ContractsSection contracts={data.contracts} companyId={params.companyId} />}
          {section === "contract" && data.contract && <ContractSection contract={data.contract} companyId={params.companyId} />}
          {section === "organisation" && <OrganisationSection org={data.org} />}
          {section === "team" && <TeamSection team={data.team} />}
          {section === "notifications" && <NotificationsSection data={data.notifications} />}
          {section === "messages" && (
            <MessagesSection conversations={data.conversations} thread={data.thread} companyId={params.companyId} />
          )}
          {section === "documents" && <DocumentsSection documents={data.documents} />}
          {section === "milestones" && <MilestonesSection milestones={data.milestones} />}
          {section === "approvals" && <ApprovalsSection approvals={data.approvals} />}
          {section === "issues" && <IssuesSection issues={data.issues} />}
          {section === "variations" && <VariationsSection variations={data.variations} />}
          {section === "invoices" && <InvoicesSection invoices={data.invoices} />}
          {section === "reports" && <ReportsSection reports={data.reports} />}
        </main>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- banner helpers
function fmtMoney(v: number | null): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(v ?? 0);
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    upcoming: "Upcoming",
    in_progress: "In progress",
    submitted_for_review: "For review",
    approved: "Approved",
    completed: "Completed",
    delayed: "Delayed",
  };
  return labels[status] ?? status;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ------------------------------------------------------------------ dashboard
function DashboardSection({ stats, companyId }: { stats: ClientDashboardStats | null; companyId: string }) {
  if (!stats) {
    return <EmptyState title="Dashboard unavailable" body="The client dashboard could not be loaded for this organisation." />;
  }
  const rows: { label: string; value: number | string; tone: "navy" | "teal" | "amber" | "green" | "red"; hint?: string }[] = [
    { label: "Active contracts", value: stats.activeContracts, tone: "green" },
    { label: "Contract value", value: fmtMoney(stats.contractValue), tone: "teal" },
    { label: "Overall completion", value: `${stats.completionPct}%`, tone: stats.completionPct >= 100 ? "green" : "navy", hint: "Milestones completed" },
    { label: "Upcoming milestones", value: stats.upcomingMilestones.length, tone: "navy" },
    { label: "Pending approvals", value: stats.pendingApprovals, tone: stats.pendingApprovals > 0 ? "amber" : "navy" },
    { label: "Documents awaiting review", value: stats.documentsAwaitingReview, tone: stats.documentsAwaitingReview > 0 ? "amber" : "navy" },
    { label: "Open issues", value: stats.openIssues, tone: stats.openIssues > 0 ? "red" : "navy" },
    { label: "Variation requests", value: stats.variationRequests, tone: stats.variationRequests > 0 ? "amber" : "navy" },
    { label: "Invoices awaiting action", value: stats.invoicesAwaitingAction, tone: stats.invoicesAwaitingAction > 0 ? "amber" : "navy" },
    { label: "Contract end dates", value: stats.contractEndDates.length, tone: "navy", hint: "closest first" },
  ];
  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-widest text-teal">Client Dashboard</p>
      <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Contract overview</h1>
      <p className="mt-2 max-w-xl text-sm text-muted">
        Live delivery status for {stats.orgName}
        {stats.activeContracts > 0 ? ` - ${stats.activeContracts} active contract${stats.activeContracts === 1 ? "" : "s"}` : ""}.
      </p>
      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {rows.map((r) => (
          <Card key={r.label} className="p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-muted">{r.label}</p>
            <p className={`mt-2 font-display text-3xl font-bold ${r.tone === "teal" ? "text-teal" : r.tone === "amber" ? "text-amber" : r.tone === "green" ? "text-success" : r.tone === "red" ? "text-danger" : "text-navy"}`}>
              {r.value}
            </p>
            {r.hint && <p className="mt-1 text-xs text-muted">{r.hint}</p>}
          </Card>
        ))}
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Upcoming milestones</h2>
              <Badge tone="navy">{stats.upcomingMilestones.length}</Badge>
            </div>
            {stats.upcomingMilestones.length === 0 ? (
              <p className="mt-4 text-sm text-muted">No upcoming milestones scheduled for the coming period.</p>
            ) : (
              <ul className="mt-4 divide-y divide-slate-100">
                {stats.upcomingMilestones.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{m.name}</p>
                      <p className="truncate text-xs text-muted">{m.workspaceTitle ?? "Contract"}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone={m.dueDate ? "blue" : "slate"}>{m.dueDate ?? "No date"}</Badge>
                      <Badge tone="slate">{statusLabel(m.status)}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="p-6">
            <h2 className="text-lg font-bold">Recent activity</h2>
            {stats.recentActivity.length === 0 ? (
              <p className="mt-4 text-sm text-muted">No recorded activity yet for this organisation.</p>
            ) : (
              <ul className="mt-4 divide-y divide-slate-100">
                {stats.recentActivity.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs font-semibold text-navy">{a.action}</p>
                      <p className="truncate text-xs text-muted">{a.actorEmail ?? "system"}</p>
                    </div>
                    <span className="shrink-0 text-xs text-muted">{a.createdAt ? fmtDateTime(a.createdAt) : "-"}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="flex flex-col gap-6">
          <Card className="p-6">
            <h2 className="text-lg font-bold">Needs your attention</h2>
            <ul className="mt-3 divide-y divide-slate-100">
              {[
                { label: "Pending approvals", count: stats.pendingApprovals, tone: "amber" },
                { label: "Documents awaiting review", count: stats.documentsAwaitingReview, tone: "amber" },
                { label: "Open issues", count: stats.openIssues, tone: "red" },
                { label: "Variation requests", count: stats.variationRequests, tone: "amber" },
                { label: "Invoices awaiting action", count: stats.invoicesAwaitingAction, tone: "amber" },
              ].map((r) => (
                <li key={r.label} className="flex items-center justify-between gap-2 py-2.5">
                  <span className="text-sm font-semibold text-ink">{r.label}</span>
                  <Badge tone={r.count > 0 ? (r.tone as "amber" | "red") : "slate"}>{r.count}</Badge>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-6">
            <h2 className="text-lg font-bold">Contract end dates</h2>
            {stats.contractEndDates.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No end dates recorded.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {stats.contractEndDates.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                    <Link
                      to="/admin/companies/$companyId/view-as-client"
                      params={{ companyId }}
                      search={{ section: "contract", ws: c.id, thread: undefined }}
                      className="min-w-0 truncate text-sm font-semibold text-ink hover:underline"
                    >
                      {c.title}
                    </Link>
                    <Badge tone="navy">{c.endDate}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ contracts
function ContractsSection({ contracts, companyId }: { contracts: ClientContractSummary[]; companyId: string }) {
  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-widest text-teal">Contracts</p>
      <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Your contracts</h1>
      <p className="mt-2 max-w-xl text-sm text-muted">
        Every contract this organisation has commissioned, as shown in the client portal.
      </p>
      {contracts.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No contracts" body="This organisation has no linked contracts yet." />
        </div>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {contracts.map((c) => (
            <Card key={c.id} className="p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="min-w-0 truncate text-base font-bold">{c.title}</h2>
                <Badge tone={WORKSPACE_BADGE_TONES[c.status] ?? "slate"}>{WORKSPACE_STATUS_LABELS[c.status]}</Badge>
              </div>
              {c.description && <p className="mt-2 line-clamp-2 text-sm text-muted">{c.description}</p>}
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt className="text-xs font-bold uppercase tracking-wider text-muted">Value</dt>
                  <dd className="font-semibold text-ink">{fmtMoney(c.contractValue)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase tracking-wider text-muted">Completion</dt>
                  <dd className="font-semibold text-ink">{c.completionPct}%</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase tracking-wider text-muted">Lead</dt>
                  <dd className="truncate font-semibold text-ink">{c.leadCompany ?? c.leadName ?? c.leadEmail ?? "-"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase tracking-wider text-muted">Work packages</dt>
                  <dd className="font-semibold text-ink">{c.visiblePackageCount}</dd>
                </div>
                {c.startDate && (
                  <div>
                    <dt className="text-xs font-bold uppercase tracking-wider text-muted">Start</dt>
                    <dd className="font-semibold text-ink">{c.startDate}</dd>
                  </div>
                )}
                {c.endDate && (
                  <div>
                    <dt className="text-xs font-bold uppercase tracking-wider text-muted">End</dt>
                    <dd className="font-semibold text-ink">{c.endDate}</dd>
                  </div>
                )}
              </dl>
              <Link
                to="/admin/companies/$companyId/view-as-client"
                params={{ companyId }}
                search={{ section: "contract", ws: c.id, thread: undefined }}
                className="mt-4 inline-block text-sm font-semibold text-brand hover:underline"
              >
                Open contract view
              </Link>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------- contract detail view
function ContractSection({ contract, companyId }: { contract: ClientContractDetail; companyId: string }) {
  const ws = contract.workspace;
  return (
    <div>
      <Link
        to="/admin/companies/$companyId/view-as-client"
        params={{ companyId }}
        search={{ section: "contracts", ws: undefined, thread: undefined }}
        className="text-sm font-semibold text-brand hover:underline"
      >
        Back to contracts
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold sm:text-3xl">{ws.title}</h1>
        <Badge tone={WORKSPACE_BADGE_TONES[ws.status] ?? "slate"}>{WORKSPACE_STATUS_LABELS[ws.status]}</Badge>
      </div>
      {ws.description && <p className="mt-2 max-w-2xl text-sm text-muted">{ws.description}</p>}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Contract value", value: fmtMoney(ws.contractValue) },
          { label: "Start date", value: ws.startDate ?? "-" },
          { label: "End date", value: ws.endDate ?? "-" },
          { label: "Lead", value: contract.lead?.companyName ?? contract.lead?.name ?? contract.lead?.email ?? "-" },
        ].map((x) => (
          <Card key={x.label} className="p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-muted">{x.label}</p>
            <p className="mt-1 truncate font-semibold text-ink">{x.value}</p>
          </Card>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Work packages</h2>
            <Badge tone="navy">{contract.workPackages.length}</Badge>
          </div>
          {contract.workPackages.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No client-visible work packages.</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {contract.workPackages.map((wp) => (
                <li key={wp.id} className="py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ink">{wp.name}</p>
                    <Badge tone={wp.status === "completed" ? "green" : wp.status === "in_progress" ? "blue" : "slate"}>
                      {statusLabel(wp.status)}
                    </Badge>
                  </div>
                  {wp.description && <p className="mt-1 text-xs text-muted">{wp.description}</p>}
                  <p className="mt-1 text-xs text-muted">
                    {wp.companyName ?? "Company"} - {wp.completedMilestoneCount}/{wp.milestoneCount} milestones ({wp.completionPct}%)
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-6">
          <h2 className="text-lg font-bold">Milestones</h2>
          {contract.milestones.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No milestones recorded.</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {contract.milestones.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{m.name}</p>
                    {m.workPackageName && <p className="truncate text-xs text-muted">{m.workPackageName}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={m.dueDate ? "blue" : "slate"}>{m.dueDate ?? "No date"}</Badge>
                    <Badge tone="slate">{statusLabel(m.status)}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-6">
          <h2 className="text-lg font-bold">Documents</h2>
          {contract.documents.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No client-visible documents.</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {contract.documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{d.name}</p>
                    <p className="truncate text-xs text-muted">{d.category ?? "document"}</p>
                  </div>
                  <Badge tone={d.reviewStatus === "approved" ? "green" : "amber"}>{d.reviewStatus}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-6">
          <h2 className="text-lg font-bold">Invoices &amp; issues</h2>
          {contract.invoices.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No invoices recorded.</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100">
              {contract.invoices.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{i.invoiceNumber}</p>
                    <p className="truncate text-xs text-muted">{i.title ?? "Invoice"}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{fmtMoney(i.amount)}</span>
                    <Badge tone="slate">{i.status}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {contract.issues.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No open issues recorded.</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100">
              {contract.issues.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                  <p className="truncate text-sm font-semibold text-ink">{i.title}</p>
                  <div className="flex shrink-0 items-center gap-2">
                    {i.severity && <Badge tone={i.severity === "critical" ? "red" : "amber"}>{i.severity}</Badge>}
                    <Badge tone="slate">{i.status}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-6 p-6">
        <h2 className="text-lg font-bold">Contract activity</h2>
        {contract.audit.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No activity recorded for this contract.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {contract.audit.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs font-semibold text-navy">{a.action}</p>
                  <p className="truncate text-xs text-muted">{a.actorEmail ?? "system"}</p>
                </div>
                <span className="shrink-0 text-xs text-muted">{fmtDateTime(a.createdAt ?? "")}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// -------------------------------------------------------------- organisation
function OrganisationSection({ org }: { org: ClientOrgProfile | null }) {
  if (!org) return <EmptyState title="Organisation unavailable" body="The organisation profile could not be loaded." />;
  const rows: { label: string; value: string }[] = [
    { label: "Legal name", value: org.name },
    { label: "Status", value: org.status },
    { label: "Registration number", value: org.registrationNumber ?? "-" },
    { label: "Registration country", value: org.registrationCountry ?? "-" },
    { label: "Tax ID", value: org.taxId ?? "-" },
    { label: "Address", value: org.address ?? "-" },
    { label: "Contact email", value: org.contactEmail ?? "-" },
    { label: "Contact phone", value: org.contactPhone ?? "-" },
  ];
  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-widest text-teal">My Organisation</p>
      <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Organisation profile</h1>
      <p className="mt-2 max-w-xl text-sm text-muted">
        The profile this client sees when they open My Organisation (read-only in this view).
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {rows.map((r) => (
          <Card key={r.label} className="p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-muted">{r.label}</p>
            <p className="mt-1 text-sm font-semibold text-ink">{r.value}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------- team
function TeamSection({ team }: { team: ClientTeamMember[] }) {
  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-widest text-teal">Team</p>
      <h1 className="mt-1 text-2xl font-bold sm:text-3xl">People who act for this organisation</h1>
      <p className="mt-2 max-w-xl text-sm text-muted">Client portal members for this organisation, with their client roles.</p>
      {team.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No team members" body="No client portal members are linked to this organisation." />
        </div>
      ) : (
        <Card className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">Name</th>
                <th className="px-3 py-3">Email</th>
                <th className="px-3 py-3">Client role</th>
                <th className="px-5 py-3">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {team.map((m) => (
                <tr key={m.userId} className="hover:bg-mist/60">
                  <td className="px-5 py-3 font-semibold text-navy">{m.name ?? "-"}</td>
                  <td className="px-3 py-3 text-muted">{m.email}</td>
                  <td className="px-3 py-3">
                    <Badge tone="blue">{CLIENT_ROLE_LABELS[m.role] ?? m.role}</Badge>
                  </td>
                  <td className="px-5 py-3 text-muted">{m.joinedAt ? fmtDate(m.joinedAt) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ------------------------------------------------------------ notifications
function NotificationsSection({ data }: { data: { notifications: ClientNotification[]; unreadCount: number } | null }) {
  if (!data) return <EmptyState title="Notifications unavailable" body="Notifications could not be loaded." />;
  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-widest text-teal">Notifications</p>
      <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Organisation notifications</h1>
      <p className="mt-2 max-w-xl text-sm text-muted">
        All notifications raised for this organisation ({data.notifications.length}; {data.unreadCount} unread).
        Client users see only the notifications addressed to them personally.
      </p>
      {data.notifications.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No notifications" body="No notifications have been raised for this organisation." />
        </div>
      ) : (
        <Card className="mt-6">
          <ul className="divide-y divide-slate-100">
            {data.notifications.map((n) => (
              <li key={n.id} className="flex items-start justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">
                    {!n.read && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-teal" />}
                    {n.title}
                  </p>
                  {n.body && <p className="mt-0.5 truncate text-xs text-muted">{n.body}</p>}
                  {n.workspaceTitle && <p className="mt-0.5 text-xs text-muted">{n.workspaceTitle}</p>}
                </div>
                <span className="shrink-0 text-xs text-muted">{fmtDateTime(n.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ messages
function MessagesSection({
  conversations,
  thread,
  companyId,
}: {
  conversations: ClientConversation[];
  thread: ClientThread | null;
  companyId: string;
}) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (!selected && conversations.length > 0) {
      const first = `${conversations[0].workspaceId}::${conversations[0].threadKey}`;
      setSelected(first);
      void navigate({
        to: "/admin/companies/$companyId/view-as-client",
        params: { companyId },
        search: { section: "messages", ws: conversations[0].workspaceId, thread: conversations[0].threadKey },
        replace: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, selected]);

  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-widest text-teal">Messages</p>
      <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Client conversations</h1>
      <p className="mt-2 max-w-xl text-sm text-muted">
        Message threads between this organisation and its lead contractors. Read-only in this view.
      </p>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-1">
          <h2 className="px-1 pb-2 text-sm font-bold uppercase tracking-wider text-muted">Threads</h2>
          {conversations.length === 0 ? (
            <p className="px-1 text-sm text-muted">No conversations yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {conversations.map((c) => {
                const key = `${c.workspaceId}::${c.threadKey}`;
                const active = selected === key || (thread && thread.workspaceId === c.workspaceId && thread.threadKey === c.threadKey);
                return (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(key);
                        void navigate({
                          to: "/admin/companies/$companyId/view-as-client",
                          params: { companyId },
                          search: { section: "messages", ws: c.workspaceId, thread: c.threadKey },
                          replace: true,
                        });
                      }}
                      className={`w-full px-2 py-2.5 text-left hover:bg-mist/60 ${active ? "bg-mist" : ""}`}
                    >
                      <p className="truncate text-sm font-semibold text-ink">{c.workspaceTitle}</p>
                      <p className="text-xs font-semibold text-teal">
                        {CLIENT_MESSAGE_THREAD_LABELS[c.threadType] ?? c.threadType}
                        {c.entityTitle ? ` - ${c.entityTitle}` : ""}
                      </p>
                      {c.lastBody && <p className="mt-0.5 truncate text-xs text-muted">{c.lastBody}</p>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card className="p-6 lg:col-span-2">
          {thread ? (
            <>
              <div className="border-b border-slate-200 pb-3">
                <h2 className="text-lg font-bold">{thread.workspaceTitle}</h2>
                <p className="text-xs font-semibold text-teal">
                  {CLIENT_MESSAGE_THREAD_LABELS[thread.threadType] ?? thread.threadType}
                  {thread.entityTitle ? ` - ${thread.entityTitle}` : ""}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  Lead: {thread.leadCompany ?? thread.leadName ?? thread.leadEmail ?? "-"}
                </p>
              </div>
              {thread.messages.length === 0 ? (
                <p className="mt-4 text-sm text-muted">No messages in this thread.</p>
              ) : (
                <ul className="mt-4 space-y-4">
                  {thread.messages.map((m) => (
                    <li key={m.id} className="rounded-xl bg-mist p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-navy">
                          {m.authorName ?? m.authorEmail}
                          <span className="ml-2 text-xs font-semibold uppercase tracking-wide text-teal">
                            {m.authorSide === "lead" ? "Lead" : "Client"}
                          </span>
                        </p>
                        <span className="text-xs text-muted">{fmtDateTime(m.createdAt)}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{m.body}</p>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 text-xs text-muted">
                This view is read-only; replies can only be sent from the real client account.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted">Select a thread to read its messages.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------- Part B + reports sections
// Read-only mirrors of the client portal Part B screens (spec §12 item 17).
function fmtMoneyCents(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency || "GBP",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
function SectionHeader({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div className="mb-6">
      <p className="text-sm font-bold uppercase tracking-widest text-teal">{eyebrow}</p>
      <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{title}</h1>
      <p className="mt-2 max-w-xl text-sm text-muted">{body}</p>
    </div>
  );
}
function DocumentsSection({ documents }: { documents: ClientDocument[] }) {
  return (
    <div>
      <SectionHeader
        eyebrow="Documents"
        title="Contract documents"
        body="Documents the lead contractor shares with this organisation, exactly as the client sees them."
      />
      {documents.length === 0 ? (
        <EmptyState title="No documents" body="No client-visible documents have been shared yet." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">Document</th>
                <th className="px-3 py-3">Contract</th>
                <th className="px-3 py-3">Category</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Shared by</th>
                <th className="px-5 py-3">Shared at</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {documents.map((d) => (
                <tr key={d.id} className="hover:bg-mist/60">
                  <td className="max-w-[260px] truncate px-5 py-3 font-semibold text-navy">{d.title}</td>
                  <td className="max-w-[180px] truncate px-3 py-3 text-muted">{d.workspaceTitle ?? "-"}</td>
                  <td className="px-3 py-3 text-muted">{d.category ? CLIENT_DOCUMENT_CATEGORY_LABELS[d.category] ?? d.category : "-"}</td>
                  <td className="px-3 py-3">
                    <Badge tone={CLIENT_DOCUMENT_STATUS_TONES[d.status] ?? "slate"}>{CLIENT_DOCUMENT_STATUS_LABELS[d.status] ?? d.status}</Badge>
                  </td>
                  <td className="px-3 py-3 text-muted">{d.uploadedByEmail ?? "-"}</td>
                  <td className="px-5 py-3 text-muted">{d.sharedAt ? fmtDateTime(d.sharedAt) : fmtDateTime(d.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
function MilestonesSection({ milestones }: { milestones: ClientMilestone[] }) {
  return (
    <div>
      <SectionHeader
        eyebrow="Milestones"
        title="Milestones"
        body="Milestones across this organisation's contracts, exactly as the client sees them."
      />
      {milestones.length === 0 ? (
        <EmptyState title="No milestones" body="No milestones have been created on linked contracts yet." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">Milestone</th>
                <th className="px-3 py-3">Contract</th>
                <th className="px-3 py-3">Work package</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Due</th>
                <th className="px-5 py-3">Submitted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {milestones.map((m) => (
                <tr key={m.id} className="hover:bg-mist/60">
                  <td className="max-w-[240px] truncate px-5 py-3 font-semibold text-navy">{m.title}</td>
                  <td className="max-w-[180px] truncate px-3 py-3 text-muted">{m.workspaceTitle ?? "-"}</td>
                  <td className="max-w-[160px] truncate px-3 py-3 text-muted">{m.workPackageName ?? "-"}</td>
                  <td className="px-3 py-3">
                    <Badge tone={CLIENT_MILESTONE_STATUS_TONES[m.status] ?? "slate"}>{CLIENT_MILESTONE_STATUS_LABELS[m.status] ?? m.status}</Badge>
                  </td>
                  <td className="px-3 py-3 text-muted">{m.dueDate ? fmtDateTime(m.dueDate) : "-"}</td>
                  <td className="px-5 py-3 text-muted">{m.submittedAt ? fmtDateTime(m.submittedAt) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
function ApprovalsSection({ approvals }: { approvals: ClientApprovals | null }) {
  const empty = approvals && approvals.counts.variations + approvals.counts.invoices + approvals.counts.milestones + approvals.counts.documents + approvals.counts.issues === 0;
  return (
    <div>
      <SectionHeader
        eyebrow="Approvals"
        title="Approvals hub"
        body="Items waiting for this organisation's decision — the same queue the client sees on the Approvals page."
      />
      {!approvals ? (
        <EmptyState title="Nothing to review" body="No items are waiting for this organisation's approval." />
      ) : (
        <div className="grid gap-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {(
              [
                ["Variations", approvals.counts.variations],
                ["Invoices", approvals.counts.invoices],
                ["Milestones", approvals.counts.milestones],
                ["Documents", approvals.counts.documents],
                ["Issues", approvals.counts.issues],
              ] as [string, number][]
            ).map(([label, count]) => (
              <Card key={label} className="p-4 text-center">
                <p className="text-2xl font-bold text-navy">{count}</p>
                <p className="mt-1 text-xs font-bold uppercase tracking-wider text-muted">{label}</p>
              </Card>
            ))}
          </div>
          {!empty && (
            <>
              {approvals.variations.length > 0 && (
                <Card className="p-5">
                  <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-teal">Variations awaiting decision</h2>
                  <ul className="divide-y divide-slate-100">
                    {approvals.variations.map((v) => (
                      <li key={v.id} className="flex items-center justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-ink">{v.title}</p>
                          <p className="text-xs text-muted">{v.workspaceTitle}{v.proposedAmountCents != null ? ` · ${fmtMoneyCents(v.proposedAmountCents, "GBP")}` : ""}</p>
                        </div>
                        <Badge tone={CLIENT_VARIATION_STATUS_TONES[v.status] ?? "slate"}>{CLIENT_VARIATION_STATUS_LABELS[v.status] ?? v.status}</Badge>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              {approvals.invoices.length > 0 && (
                <Card className="p-5">
                  <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-teal">Invoices awaiting review</h2>
                  <ul className="divide-y divide-slate-100">
                    {approvals.invoices.map((i) => (
                      <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-ink">{i.invoiceNumber} — {i.title ?? "Invoice"}</p>
                          <p className="text-xs text-muted">{i.workspaceTitle} · {fmtMoneyCents(i.amountCents, i.currency)}</p>
                        </div>
                        <Badge tone={CLIENT_INVOICE_STATUS_TONES[i.status] ?? "slate"}>{CLIENT_INVOICE_STATUS_LABELS[i.status] ?? i.status}</Badge>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              {approvals.milestones.length > 0 && (
                <Card className="p-5">
                  <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-teal">Milestones awaiting review</h2>
                  <ul className="divide-y divide-slate-100">
                    {approvals.milestones.map((m) => (
                      <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                        <p className="min-w-0 truncate font-semibold text-ink">{m.title} <span className="text-xs font-normal text-muted">· {m.workspaceTitle}</span></p>
                        <Badge tone={CLIENT_MILESTONE_STATUS_TONES[m.status] ?? "slate"}>{CLIENT_MILESTONE_STATUS_LABELS[m.status] ?? m.status}</Badge>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              {approvals.documents.length > 0 && (
                <Card className="p-5">
                  <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-teal">Documents awaiting review</h2>
                  <ul className="divide-y divide-slate-100">
                    {approvals.documents.map((d) => (
                      <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                        <p className="min-w-0 truncate font-semibold text-ink">{d.title} <span className="text-xs font-normal text-muted">· {d.workspaceTitle}</span></p>
                        <Badge tone={CLIENT_DOCUMENT_STATUS_TONES[d.status] ?? "slate"}>{CLIENT_DOCUMENT_STATUS_LABELS[d.status] ?? d.status}</Badge>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              {approvals.issues.length > 0 && (
                <Card className="p-5">
                  <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-teal">Open issues</h2>
                  <ul className="divide-y divide-slate-100">
                    {approvals.issues.map((i) => (
                      <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                        <p className="min-w-0 truncate font-semibold text-ink">{i.title} <span className="text-xs font-normal text-muted">· {i.workspaceTitle}</span></p>
                        <Badge tone={CLIENT_ISSUE_STATUS_TONES[i.status] ?? "slate"}>{CLIENT_ISSUE_STATUS_LABELS[i.status] ?? i.status}</Badge>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          )}
          {empty && <p className="text-sm text-muted">No items currently waiting for approval.</p>}
        </div>
      )}
    </div>
  );
}
function IssuesSection({ issues }: { issues: ClientIssue[] }) {
  return (
    <div>
      <SectionHeader
        eyebrow="Issues"
        title="Issues & responses"
        body="Issues raised on this organisation's contracts, exactly as the client sees them."
      />
      {issues.length === 0 ? (
        <EmptyState title="No issues" body="No issues have been raised on linked contracts." />
      ) : (
        <div className="flex flex-col gap-4">
          {issues.map((i) => (
            <Card key={i.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-navy">{i.title}</p>
                  <p className="mt-0.5 text-sm text-muted">{i.workspaceTitle}{i.workPackageName ? ` · ${i.workPackageName}` : ""}</p>
                </div>
                <div className="flex items-center gap-2">
                  {i.severity && <Badge tone={CLIENT_ISSUE_SEVERITY_TONES[i.severity] ?? "slate"}>{CLIENT_ISSUE_SEVERITY_LABELS[i.severity] ?? i.severity}</Badge>}
                  <Badge tone={CLIENT_ISSUE_STATUS_TONES[i.status] ?? "slate"}>{CLIENT_ISSUE_STATUS_LABELS[i.status] ?? i.status}</Badge>
                </div>
              </div>
              {i.description && <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-muted">{i.description}</p>}
              {i.response && (
                <div className="mt-3 rounded-lg border border-teal/30 bg-teal/5 px-3 py-2 text-sm">
                  <p className="text-xs font-bold uppercase tracking-wider text-teal">Lead response · {i.respondedByEmail ?? "lead contractor"}</p>
                  <p className="mt-1 whitespace-pre-wrap text-ink">{i.response}</p>
                </div>
              )}
              <p className="mt-3 text-xs text-muted">Raised by {i.raisedByEmail ?? "the client organisation"} · {fmtDateTime(i.createdAt)}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
function VariationsSection({ variations }: { variations: ClientVariation[] }) {
  return (
    <div>
      <SectionHeader
        eyebrow="Variations"
        title="Variation requests"
        body="Variations proposed on this organisation's contracts, exactly as the client sees them."
      />
      {variations.length === 0 ? (
        <EmptyState title="No variations" body="No variations have been proposed on linked contracts." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">Variation</th>
                <th className="px-3 py-3">Contract</th>
                <th className="px-3 py-3">Work package</th>
                <th className="px-3 py-3">Proposed value</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-5 py-3">Requested</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {variations.map((v) => (
                <tr key={v.id} className="hover:bg-mist/60">
                  <td className="max-w-[240px] truncate px-5 py-3 font-semibold text-navy">{v.title}</td>
                  <td className="max-w-[180px] truncate px-3 py-3 text-muted">{v.workspaceTitle ?? "-"}</td>
                  <td className="max-w-[150px] truncate px-3 py-3 text-muted">{v.workPackageName ?? "-"}</td>
                  <td className="px-3 py-3">{v.proposedAmountCents != null ? fmtMoneyCents(v.proposedAmountCents, "GBP") : "-"}</td>
                  <td className="px-3 py-3">
                    <Badge tone={CLIENT_VARIATION_STATUS_TONES[v.status] ?? "slate"}>{CLIENT_VARIATION_STATUS_LABELS[v.status] ?? v.status}</Badge>
                  </td>
                  <td className="px-5 py-3 text-muted">{fmtDateTime(v.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
function InvoicesSection({ invoices }: { invoices: ClientInvoice[] }) {
  return (
    <div>
      <SectionHeader
        eyebrow="Invoices"
        title="Invoices"
        body="Invoices issued on this organisation's contracts, exactly as the client sees them."
      />
      {invoices.length === 0 ? (
        <EmptyState title="No invoices" body="No invoices have been issued on linked contracts." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">Invoice</th>
                <th className="px-3 py-3">Contract</th>
                <th className="px-3 py-3">Supplier</th>
                <th className="px-3 py-3">Amount</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Due</th>
                <th className="px-5 py-3">Paid</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.map((i) => (
                <tr key={i.id} className="hover:bg-mist/60">
                  <td className="px-5 py-3 font-semibold text-navy">{i.invoiceNumber}</td>
                  <td className="max-w-[180px] truncate px-3 py-3 text-muted">{i.workspaceTitle ?? "-"}</td>
                  <td className="max-w-[160px] truncate px-3 py-3 text-muted">{i.supplierCompanyName ?? "-"}</td>
                  <td className="px-3 py-3 font-semibold">{fmtMoneyCents(i.amountCents, i.currency)}</td>
                  <td className="px-3 py-3">
                    <Badge tone={CLIENT_INVOICE_STATUS_TONES[i.status] ?? "slate"}>{CLIENT_INVOICE_STATUS_LABELS[i.status] ?? i.status}</Badge>
                  </td>
                  <td className="px-3 py-3 text-muted">{i.dueDate ? fmtDateTime(i.dueDate) : "-"}</td>
                  <td className="px-5 py-3 text-muted">{i.paidAt ? fmtDateTime(i.paidAt) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
function ReportsSection({ reports }: { reports: ClientProgressReport[] }) {
  return (
    <div>
      <SectionHeader
        eyebrow="Reports"
        title="Progress reports"
        body="Progress reports submitted by the lead contractor for this organisation, exactly as the client sees them."
      />
      {reports.length === 0 ? (
        <EmptyState title="No reports yet" body="Progress reports submitted by the lead contractor will appear here." />
      ) : (
        <div className="flex flex-col gap-4">
          {reports.map((r) => (
            <Card key={r.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-lg font-bold text-navy">{r.title ?? "Progress report"}</p>
                  <p className="mt-0.5 text-sm text-muted">
                    {r.workspaceTitle}
                    {r.milestoneTitle ? ` · ${r.milestoneTitle}` : ""}
                  </p>
                </div>
                <Badge tone="teal">
                  {r.periodStart ? fmtDateTime(r.periodStart).slice(0, 10) : "-"} – {r.periodEnd ? fmtDateTime(r.periodEnd).slice(0, 10) : "-"}
                </Badge>
              </div>
              {r.body && <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm text-muted">{r.body}</p>}
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs text-muted">
                <span>Submitted by {r.submittedByEmail ?? "the lead contractor"}</span>
                <span aria-hidden>·</span>
                <span>{fmtDateTime(r.createdAt)}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

