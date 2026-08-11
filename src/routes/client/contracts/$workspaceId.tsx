import { createFileRoute, Link } from "@tanstack/react-router";
import { getClientContract, getClientSession, resolveClientOrg } from "~/lib/client";
import type { ClientContractDetail, ClientWorkPackage } from "~/lib/types";
import {
  WORKSPACE_BADGE_TONES,
  WORKSPACE_STATUS_LABELS,
  WORK_PACKAGE_STATUS_LABELS,
} from "~/lib/types";
import { Badge, Card, DbSetupPage, EmptyState, ErrorText } from "~/components/ui";

export const Route = createFileRoute("/client/contracts/$workspaceId")({
  validateSearch: (search: Record<string, unknown>) => ({
    org: typeof search.org === "string" ? search.org : undefined,
  }),
  loaderDeps: ({ search }) => ({ org: search.org }),
  loader: async ({ deps, params }) => {
    const session = await getClientSession();
    if (!session.client) {
      return { setupRequired: session.setupRequired, client: null, orgId: null, detail: null, loadError: null };
    }
    const org = resolveClientOrg(session.client, deps.org);
    const result = await getClientContract({
      data: { orgId: org.orgId, workspaceId: params.workspaceId },
    });
    return {
      setupRequired: session.setupRequired,
      client: session.client,
      orgId: org.orgId,
      detail: result.ok ? result.data : null,
      loadError: result.ok ? null : result.error,
    };
  },
  component: ContractDetailPage,
});

function ContractDetailPage() {
  const { setupRequired, client, orgId, detail, loadError } = Route.useLoaderData();

  if (setupRequired) {
    return (
      <DbSetupPage title="Contract">
        Connect a Postgres database (DATABASE_URL) to view contracts.
      </DbSetupPage>
    );
  }
  if (!client || !orgId) return null;

  if (loadError) {
    return (
      <div>
        <Link to="/client/contracts" search={{ org: orgId }} className="text-sm font-semibold text-brand hover:underline">
          ← Back to contracts
        </Link>
        <div className="mt-6">
          <ErrorText>{loadError}</ErrorText>
        </div>
      </div>
    );
  }
  if (!detail) return null;

  return (
    <div>
      <Link to="/client/contracts" search={{ org: orgId }} className="text-sm font-semibold text-brand hover:underline">
        ← Back to contracts
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-teal">Contract</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{detail.workspace.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {[detail.workspace.industry, detail.workspace.location].filter(Boolean).join(" · ") || "Contract workspace"}
          </p>
        </div>
        <Badge tone={WORKSPACE_BADGE_TONES[detail.workspace.status]}>
          {WORKSPACE_STATUS_LABELS[detail.workspace.status]}
        </Badge>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <OverviewCard detail={detail} />
          <PartiesCard detail={detail} />
          <ScopeCard detail={detail} />
          <WorkPackagesCard detail={detail} />
        </div>
        <div className="flex flex-col gap-6">
          <DeliveryCard detail={detail} />
          <DocumentsCard detail={detail} />
          <RecentActivityCard detail={detail} />
        </div>
      </div>
    </div>
  );
}

function OverviewCard({ detail }: { detail: ClientContractDetail }) {
  const w = detail.workspace;
  const nextActions = detail.milestones
    .filter((m) => m.status === "upcoming" || m.status === "in_progress")
    .slice(0, 4);
  const clientIssues = detail.issues.filter((i) => i.status === "waiting_client").slice(0, 4);
  return (
    <Card className="p-6">
      <h2 className="text-lg font-bold">Contract overview</h2>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <OverviewField label="Lead contractor" value={detail.lead?.companyName ?? detail.lead?.name ?? "—"} />
        <OverviewField label="Client organisation" value={detail.clientOrg.name} />
        <OverviewField label="Status" value={WORKSPACE_STATUS_LABELS[w.status]} />
        <OverviewField label="Contract value" value={fmtMoney(w.contractValue)} />
        <OverviewField label="Start date" value={w.startDate ?? "—"} />
        <OverviewField label="End date" value={w.endDate ?? "—"} />
        <OverviewField label="Overall completion" value={`${overallCompletion(detail)}%`} />
        <OverviewField label="Work packages" value={`${detail.workPackages.length} client-visible`} />
        <OverviewField label="Key contact" value={detail.lead?.name ?? detail.lead?.email ?? "—"} />
      </dl>

      {w.description && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <p className="text-sm font-bold uppercase tracking-wider text-muted">Project summary</p>
          <p className="mt-1.5 text-sm leading-relaxed text-ink">{w.description}</p>
        </div>
      )}

      <div className="mt-5 grid gap-5 border-t border-slate-100 pt-4 sm:grid-cols-2">
        <div>
          <p className="text-sm font-bold uppercase tracking-wider text-muted">Current issues</p>
          {detail.issues.length === 0 ? (
            <p className="mt-1.5 text-sm text-muted">No open issues.</p>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {detail.issues.slice(0, 4).map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate font-medium text-ink">{i.title}</span>
                  <Badge tone={i.status === "resolved" || i.status === "closed" ? "green" : i.status === "waiting_client" ? "amber" : "red"}>
                    {issueStatus(i.status)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="text-sm font-bold uppercase tracking-wider text-muted">Next actions</p>
          {nextActions.length === 0 && clientIssues.length === 0 ? (
            <p className="mt-1.5 text-sm text-muted">Nothing scheduled.</p>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {nextActions.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate font-medium text-ink">{m.name}</span>
                  <Badge tone="blue">{m.dueDate ?? "No date"}</Badge>
                </li>
              ))}
              {clientIssues.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate font-medium text-ink">{i.title}</span>
                  <Badge tone="amber">Needs you</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

function PartiesCard({ detail }: { detail: ClientContractDetail }) {
  return (
    <Card className="p-6">
      <h2 className="text-lg font-bold">Lead contractor &amp; participating companies</h2>
      <p className="mt-1 text-xs text-muted">
        Names only — internal notes, margins and commercial pricing are never
        shown in the client portal.
      </p>
      <ul className="mt-4 divide-y divide-slate-100">
        <li className="flex items-center justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">
              {detail.lead?.companyName ?? detail.lead?.name ?? "Lead contractor"}
            </p>
            <p className="truncate text-xs text-muted">
              {detail.lead?.name ? `${detail.lead.name} · ` : ""}
              {detail.lead?.email ?? ""}
            </p>
          </div>
          <Badge tone="navy">Lead contractor</Badge>
        </li>
        {detail.participants.map((p) => (
          <li key={p.companyId ?? p.companyName} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{p.companyName ?? "Participating company"}</p>
            </div>
            <Badge tone="slate">Participant</Badge>
          </li>
        ))}
      </ul>
      {detail.participants.length === 0 && (
        <p className="mt-2 text-sm text-muted">
          No additional participating companies are visible on this contract.
        </p>
      )}
    </Card>
  );
}

function ScopeCard({ detail }: { detail: ClientContractDetail }) {
  const w = detail.workspace;
  return (
    <Card className="p-6">
      <h2 className="text-lg font-bold">Scope of work</h2>
      <p className="mt-1 text-xs text-muted">
        Approved scope and work-package descriptions shared with your organisation.
      </p>
      <p className="mt-4 text-sm leading-relaxed text-ink">
        {w.description ??
          "The approved scope is described by the work packages below; the lead contractor owns the detailed scope document."}
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {detail.workPackages.map((wp) => (
          <div key={wp.id} className="rounded-xl border border-slate-200 bg-mist/50 p-4">
            <p className="text-sm font-bold text-navy">{wp.name}</p>
            {wp.category && <p className="mt-0.5 text-xs text-muted">{wp.category}</p>}
            {wp.description && (
              <p className="mt-2 text-xs leading-relaxed text-muted">{wp.description}</p>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function WorkPackagesCard({ detail }: { detail: ClientContractDetail }) {
  return (
    <Card className="p-6">
      <h2 className="text-lg font-bold">Work packages</h2>
      <p className="mt-1 text-xs text-muted">
        Client-visible packages only — name, responsible company, scope and status.
      </p>
      {detail.workPackages.length === 0 ? (
        <EmptyState
          title="No client-visible packages"
          body="Work packages marked client-visible by the lead contractor will appear here."
        />
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {detail.workPackages.map((wp) => (
            <WorkPackageRow key={wp.id} wp={wp} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function WorkPackageRow({ wp }: { wp: ClientWorkPackage }) {
  return (
    <li className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-navy">{wp.name}</p>
          <p className="mt-0.5 text-xs text-muted">
            {wp.companyName ? `Responsible: ${wp.companyName}` : "Responsible company not disclosed"}
            {wp.category ? ` · ${wp.category}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="navy">{WORK_PACKAGE_STATUS_LABELS[wp.status]}</Badge>
          <Badge tone={wp.completionPct >= 100 ? "green" : "blue"}>{wp.completionPct}%</Badge>
        </div>
      </div>
      {(wp.description || wp.scopeNotes) && (
        <p className="mt-2 text-xs leading-relaxed text-muted">
          {wp.scopeNotes ?? wp.description}
        </p>
      )}
      <p className="mt-2 text-[11px] text-muted">
        {wp.milestoneCount} milestone{wp.milestoneCount === 1 ? "" : "s"} · {wp.completedMilestoneCount} completed
      </p>
    </li>
  );
}

function DeliveryCard({ detail }: { detail: ClientContractDetail }) {
  return (
    <Card className="p-6">
      <h2 className="text-lg font-bold">Delivery</h2>
      <div className="mt-3">
        <p className="text-xs font-bold uppercase tracking-wider text-muted">Milestones</p>
        {detail.milestones.length === 0 ? (
          <p className="mt-1 text-sm text-muted">No milestones scheduled.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1.5">
            {detail.milestones.slice(0, 6).map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate font-medium text-ink">{m.name}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <Badge tone="slate">{milestoneStatus(m.status)}</Badge>
                  {m.dueDate && <span className="text-xs text-muted">{m.dueDate}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-4 border-t border-slate-100 pt-3">
        <p className="text-xs font-bold uppercase tracking-wider text-muted">Invoices</p>
        {detail.invoices.length === 0 ? (
          <p className="mt-1 text-sm text-muted">No invoices yet.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1.5">
            {detail.invoices.slice(0, 5).map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate font-medium text-ink">
                  {i.title ?? i.invoiceNumber}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <Badge tone="slate">{invoiceStatus(i.status)}</Badge>
                  <span className="text-xs font-semibold text-ink">{fmtMoney(i.amount)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function DocumentsCard({ detail }: { detail: ClientContractDetail }) {
  return (
    <Card className="p-6">
      <h2 className="text-lg font-bold">Client-visible documents</h2>
      {detail.documents.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          No client-visible documents shared yet. Full document review ships in Part B.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {detail.documents.slice(0, 6).map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{d.name}</p>
                <p className="truncate text-xs text-muted">{d.category ?? "document"}</p>
              </div>
              <Badge tone={d.reviewStatus === "approved" ? "green" : d.reviewStatus === "pending" ? "amber" : "slate"}>
                {d.reviewStatus}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RecentActivityCard({ detail }: { detail: ClientContractDetail }) {
  return (
    <Card className="p-6">
      <h2 className="text-lg font-bold">Recent activity</h2>
      {detail.audit.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No recorded activity yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {detail.audit.slice(0, 8).map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="truncate font-mono text-[11px] font-semibold text-navy">{a.action}</p>
                <p className="truncate text-xs text-muted">{a.actorEmail ?? "system"}</p>
              </div>
              <span className="shrink-0 text-[11px] text-muted">{a.createdAt ? shortDate(a.createdAt) : "—"}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function OverviewField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}

function overallCompletion(detail: ClientContractDetail): number {
  const pkgs = detail.workPackages;
  if (pkgs.length === 0) return 0;
  const total = pkgs.reduce((s, p) => s + p.milestoneCount, 0);
  const done = pkgs.reduce((s, p) => s + p.completedMilestoneCount, 0);
  if (total === 0) return 0;
  return Math.round((done / total) * 100);
}

function fmtMoney(v: number | null): string {
  if (v === null) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(v);
}

function issueStatus(s: string): string {
  const labels: Record<string, string> = {
    open: "Open",
    under_review: "Under review",
    action_required: "Action required",
    waiting_client: "Waiting for client",
    waiting_contractor: "Waiting for contractor",
    resolved: "Resolved",
    closed: "Closed",
  };
  return labels[s] ?? s;
}

function milestoneStatus(s: string): string {
  const labels: Record<string, string> = {
    upcoming: "Upcoming",
    in_progress: "In progress",
    submitted_for_review: "For review",
    approved: "Approved",
    rejected: "Rejected",
    requires_clarification: "Clarification",
    delayed: "Delayed",
    completed: "Completed",
  };
  return labels[s] ?? s;
}

function invoiceStatus(s: string): string {
  const labels: Record<string, string> = {
    draft: "Draft",
    submitted: "Submitted",
    under_review: "Under review",
    approved: "Approved",
    rejected: "Rejected",
    correction_required: "Correction required",
    scheduled_for_payment: "Scheduled",
    paid: "Paid",
    overdue: "Overdue",
    cancelled: "Cancelled",
  };
  return labels[s] ?? s;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
