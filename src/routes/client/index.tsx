import { createFileRoute, Link } from "@tanstack/react-router";
import { getClientDashboard, getClientSession, resolveClientOrg } from "~/lib/client";
import type { ClientDashboardStats } from "~/lib/types";
import { Badge, Card, DbSetupPage, ErrorText } from "~/components/ui";

export const Route = createFileRoute("/client/")({
  validateSearch: (search: Record<string, unknown>) => ({
    org: typeof search.org === "string" ? search.org : undefined,
  }),
  loaderDeps: ({ search }) => ({ org: search.org }),
  loader: async ({ deps }) => {
    const session = await getClientSession();
    if (!session.client) {
      return { setupRequired: session.setupRequired, client: null, orgId: null, stats: null, statsError: null };
    }
    const org = resolveClientOrg(session.client, deps.org);
    const stats = await getClientDashboard({ data: { orgId: org.orgId } });
    return {
      setupRequired: session.setupRequired,
      client: session.client,
      orgId: org.orgId,
      stats: stats.ok ? stats.data : null,
      statsError: stats.ok ? null : stats.error,
    };
  },
  component: ClientDashboardPage,
});

function ClientDashboardPage() {
  const { setupRequired, client, orgId, stats, statsError } = Route.useLoaderData();

  if (setupRequired) {
    return (
      <DbSetupPage title="Client dashboard">
        Connect a Postgres database (DATABASE_URL) and re-run `bun run publish`.
      </DbSetupPage>
    );
  }
  if (!client || !orgId) return null;

  return (
    <div>
      <div className="mb-8">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">
          Client Dashboard
        </p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Contract overview</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          {stats
            ? `Live delivery status for ${stats.orgName}${stats.activeContracts > 0 ? ` — ${stats.activeContracts} active contract${stats.activeContracts === 1 ? "" : "s"}` : ""}.`
            : "Loading your contracts…"}
        </p>
      </div>

      {statsError && (
        <div className="mb-6">
          <ErrorText>{statsError}</ErrorText>
        </div>
      )}

      {stats ? (
        <>
          <StatGrid stats={stats} />
          <div className="mt-8 grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 flex flex-col gap-6">
              <UpcomingMilestones stats={stats} />
              <RecentActivity stats={stats} />
            </div>
            <div className="flex flex-col gap-6">
              <ActionCards stats={stats} />
              <ContractEndDates stats={stats} orgId={orgId} />
            </div>
          </div>
        </>
      ) : (
        !statsError && <p className="text-sm text-muted">Loading delivery statistics…</p>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = "navy",
  hint,
}: {
  label: string;
  value: number | string;
  tone?: "navy" | "teal" | "amber" | "green" | "red";
  hint?: string;
}) {
  const valueColor =
    tone === "teal"
      ? "text-teal"
      : tone === "amber"
        ? "text-amber"
        : tone === "green"
          ? "text-success"
          : tone === "red"
            ? "text-danger"
            : "text-navy";
  return (
    <Card className="p-5">
      <p className="text-xs font-bold uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-2 font-display text-3xl font-bold ${valueColor}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  );
}

function StatGrid({ stats }: { stats: ClientDashboardStats }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
      <StatCard
        label="Active contracts"
        value={stats.activeContracts}
        tone="green"
      />
      <StatCard
        label="Contract value"
        value={fmtMoney(stats.contractValue)}
        tone="teal"
      />
      <StatCard
        label="Overall completion"
        value={`${stats.completionPct}%`}
        tone={stats.completionPct >= 100 ? "green" : "navy"}
        hint="Milestones completed"
      />
      <StatCard
        label="Upcoming milestones"
        value={stats.upcomingMilestones.length}
        hint="next 6 shown below"
      />
      <StatCard
        label="Pending approvals"
        value={stats.pendingApprovals}
        tone={stats.pendingApprovals > 0 ? "amber" : "navy"}
      />
      <StatCard
        label="Documents awaiting review"
        value={stats.documentsAwaitingReview}
        tone={stats.documentsAwaitingReview > 0 ? "amber" : "navy"}
      />
      <StatCard
        label="Open issues"
        value={stats.openIssues}
        tone={stats.openIssues > 0 ? "red" : "navy"}
      />
      <StatCard
        label="Variation requests"
        value={stats.variationRequests}
        tone={stats.variationRequests > 0 ? "amber" : "navy"}
      />
      <StatCard
        label="Invoices awaiting action"
        value={stats.invoicesAwaitingAction}
        tone={stats.invoicesAwaitingAction > 0 ? "amber" : "navy"}
      />
      <StatCard
        label="Recent messages"
        value={stats.recentMessages}
        hint="Messaging ships in Part C"
      />
      <StatCard label="Contract end dates" value={stats.contractEndDates.length} hint="closest first" />
      <StatCard
        label="Documented events"
        value={stats.recentActivity.length}
        hint="last 8 shown below"
      />
    </div>
  );
}

function UpcomingMilestones({ stats }: { stats: ClientDashboardStats }) {
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Upcoming milestones</h2>
        <Badge tone="navy">{stats.upcomingMilestones.length}</Badge>
      </div>
      {stats.upcomingMilestones.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          No upcoming milestones — the lead contractor has not scheduled anything
          for the coming period.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100">
          {stats.upcomingMilestones.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{m.name}</p>
                <p className="truncate text-xs text-muted">{m.workspaceTitle ?? "Contract"}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={m.dueDate ? "blue" : "slate"}>
                  {m.dueDate ?? "No date"}
                </Badge>
                <Badge tone="slate">{statusLabel(m.status)}</Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ActionCards({ stats }: { stats: ClientDashboardStats }) {
  const rows: { label: string; count: number; tone: "amber" | "red" | "green"; href: string }[] = [
    { label: "Pending approvals", count: stats.pendingApprovals, tone: "amber", href: "/client/approvals" },
    { label: "Documents awaiting review", count: stats.documentsAwaitingReview, tone: "amber", href: "/client/documents" },
    { label: "Open issues", count: stats.openIssues, tone: "red", href: "/client/issues" },
    { label: "Variation requests", count: stats.variationRequests, tone: "amber", href: "/client/variations" },
    { label: "Invoices awaiting action", count: stats.invoicesAwaitingAction, tone: "amber", href: "/client/invoices" },
  ];
  return (
    <Card className="p-6">
      <h2 className="text-lg font-bold">Needs your attention</h2>
      <ul className="mt-3 divide-y divide-slate-100">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-2 py-2.5">
            <Link
              to={r.href}
              className="text-sm font-semibold text-brand hover:underline"
            >
              {r.label}
            </Link>
            <Badge tone={r.count > 0 ? r.tone : "slate"}>{r.count}</Badge>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">
        Open a queue to review and decide each item — approvals are live.
      </p>
    </Card>
  );
}

function ContractEndDates({ stats, orgId }: { stats: ClientDashboardStats; orgId: string }) {
  return (
    <Card className="p-6">
      <h2 className="text-lg font-bold">Contract end dates</h2>
      {stats.contractEndDates.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No end dates recorded.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {stats.contractEndDates.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-2">
              <Link
                to="/client/contracts/$workspaceId"
                search={{ org: orgId }}
                params={{ workspaceId: c.id }}
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
  );
}

function RecentActivity({ stats }: { stats: ClientDashboardStats }) {
  return (
    <Card className="p-6">
      <h2 className="text-lg font-bold">Recent activity</h2>
      {stats.recentActivity.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          No recorded activity yet for this organisation.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100">
          {stats.recentActivity.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs font-semibold text-navy">{a.action}</p>
                <p className="truncate text-xs text-muted">{a.actorEmail ?? "system"}</p>
              </div>
              <span className="shrink-0 text-xs text-muted">{a.createdAt ? formatDate(a.createdAt) : "—"}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function fmtMoney(v: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(v);
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

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
