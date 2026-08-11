import { createFileRoute } from "@tanstack/react-router";
import { getAdminDashboard, getAdminSession } from "~/lib/admin";
import type { AdminDashboardStats } from "~/lib/types";
import { Badge, Card, DbSetupPage, ErrorText } from "~/components/ui";

export const Route = createFileRoute("/admin/")({
  loader: async () => {
    const session = await getAdminSession();
    const stats = await getAdminDashboard();
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      stats: stats.ok ? stats.stats : null,
      statsError: stats.ok ? null : stats.error,
    };
  },
  component: MasterDashboardPage,
});

function MasterDashboardPage() {
  const { setupRequired, admin, stats, statsError } = Route.useLoaderData();

  if (setupRequired) {
    return (
      <DbSetupPage title="Master Admin dashboard">
        Connect a Postgres database (DATABASE_URL) and re-run `bun run publish`.
      </DbSetupPage>
    );
  }
  if (!admin) return null;

  return (
    <div>
      <div className="mb-8">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">
          Master Dashboard
        </p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Platform overview</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Live counts from the ScaleBridge database{stats ? "" : " — stats unavailable"}.
          Services, opportunities and AI surfaces reflect the live catalogue.
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
            <div className="lg:col-span-2">
              <RecentActivity stats={stats} />
            </div>
            <div className="flex flex-col gap-6">
              <CatalogueCard />
              <ExpiringLicences stats={stats} />
            </div>
          </div>
        </>
      ) : (
        !statsError && (
          <p className="text-sm text-muted">Loading platform statistics…</p>
        )
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
  tone?: "navy" | "teal" | "amber" | "green" | "red" | "blue";
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
            : tone === "blue"
              ? "text-brand"
              : "text-navy";
  return (
    <Card className="p-5">
      <p className="text-xs font-bold uppercase tracking-wider text-muted">
        {label}
      </p>
      <p className={`mt-2 font-display text-3xl font-bold ${valueColor}`}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  );
}

function StatGrid({ stats }: { stats: AdminDashboardStats }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
      <StatCard label="Companies — total" value={stats.totalCompanies} tone="blue" />
      <StatCard
        label="Companies — verified"
        value={stats.companiesVerified}
        tone="green"
      />
      <StatCard
        label="Companies — awaiting verification"
        value={stats.companiesAwaitingVerification}
        tone={stats.companiesAwaitingVerification > 0 ? "amber" : "navy"}
      />
      <StatCard
        label="Active contracts"
        value={stats.activeContracts}
        tone="green"
      />
      <StatCard
        label="Expiring documents (90 days)"
        value={stats.expiringLicences.length}
        tone={stats.expiringLicences.length > 0 ? "amber" : "navy"}
        hint="licences, certificates & insurance"
      />
      <StatCard
        label="Open support requests"
        value={stats.openSupportRequests}
        tone={stats.openSupportRequests > 0 ? "amber" : "navy"}
      />
      <StatCard
        label="Open disputes"
        value={stats.openDisputes}
        tone={stats.openDisputes > 0 ? "red" : "navy"}
      />
      <StatCard
        label="Awaiting participant responses"
        value={stats.contractsAwaitingResponses}
        tone={stats.contractsAwaitingResponses > 0 ? "amber" : "navy"}
      />
      <StatCard
        label="Services listed"
        value={stats.servicesListed}
        hint="listed + pending review, excludes rejected/archived"
      />
      <StatCard
        label="Opportunities"
        value={stats.opportunitiesOpen}
        hint="open AI + upsell review items (a dual-lens row counts twice)"
      />
      <StatCard
        label="AI discoveries"
        value={stats.aiDiscoveries}
        hint="awaiting admin review"
      />
      <StatCard
        label="Upsell recommendations"
        value={stats.upsellRecommendations}
        hint="awaiting admin review"
      />
    </div>
  );
}

function CatalogueCard() {
  return (
    <Card className="p-6">
      <h2 className="text-lg font-bold">Services catalogue &amp; AI</h2>
      <p className="mt-2 text-sm text-muted">
        The catalogue is live — services, company relationships, evidence,
        opportunities and upsell decisions are all managed in the portal. The AI
        Service Intelligence agent, upsell workflow and agent controls land in
        the next build steps.
      </p>
      <div className="mt-4 grid gap-2 text-xs text-muted sm:grid-cols-2">
        <div className="rounded-lg bg-mist px-3 py-2">
          <span className="font-semibold text-navy">Services catalogue</span> — live
        </div>
        <div className="rounded-lg bg-mist px-3 py-2">
          <span className="font-semibold text-navy">AI Service Intelligence</span> — plan item 5
        </div>
        <div className="rounded-lg bg-mist px-3 py-2">
          <span className="font-semibold text-navy">Upsell workflow</span> — plan item 6
        </div>
        <div className="rounded-lg bg-mist px-3 py-2">
          <span className="font-semibold text-navy">Agent controls</span> — plan item 7
        </div>
      </div>
    </Card>
  );
}

function RecentActivity({ stats }: { stats: AdminDashboardStats }) {
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Recent platform activity</h2>
        <Badge tone="navy">{stats.recentActivity.length}</Badge>
      </div>
      {stats.recentActivity.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          No audit events yet — activity appears as users sign up, create
          workspaces and respond to invitations.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100">
          {stats.recentActivity.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs font-semibold text-navy">
                  {a.action ?? "—"}
                </p>
                <p className="truncate text-xs text-muted">
                  {a.actorEmail ?? "system"}
                </p>
              </div>
              <span className="shrink-0 text-xs text-muted">
                {a.createdAt ? formatDate(a.createdAt) : "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ExpiringLicences({ stats }: { stats: AdminDashboardStats }) {
  return (
    <Card className="p-6">
      <h2 className="text-lg font-bold">Expiring licences &amp; documents</h2>
      {stats.expiringLicences.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          Nothing expiring in the next 90 days.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {stats.expiringLicences.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{d.name}</p>
                <p className="truncate text-xs text-muted">
                  {d.companyName ?? "—"} · {d.category ?? "document"}
                </p>
              </div>
              <Badge tone="amber">{d.expiryDate}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
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
