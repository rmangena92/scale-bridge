import { createFileRoute, Link } from "@tanstack/react-router";
import { getClientSession, listClientContracts, resolveClientOrg } from "~/lib/client";
import type { ClientContractSummary } from "~/lib/types";
import { WORKSPACE_BADGE_TONES, WORKSPACE_STATUS_LABELS } from "~/lib/types";
import { Badge, Card, DbSetupPage, EmptyState, ErrorText } from "~/components/ui";

export const Route = createFileRoute("/client/contracts/")({
  validateSearch: (search: Record<string, unknown>) => ({
    org: typeof search.org === "string" ? search.org : undefined,
  }),
  loaderDeps: ({ search }) => ({ org: search.org }),
  loader: async ({ deps }) => {
    const session = await getClientSession();
    if (!session.client) {
      return { setupRequired: session.setupRequired, client: null, orgId: null, contracts: [], loadError: null };
    }
    const org = resolveClientOrg(session.client, deps.org);
    const result = await listClientContracts({ data: { orgId: org.orgId } });
    return {
      setupRequired: session.setupRequired,
      client: session.client,
      orgId: org.orgId,
      contracts: result.ok ? result.data : [],
      loadError: result.ok ? null : result.error,
    };
  },
  component: ContractsPage,
});

function ContractsPage() {
  const { setupRequired, client, orgId, contracts, loadError } = Route.useLoaderData();

  if (setupRequired) {
    return (
      <DbSetupPage title="Your contracts">
        Connect a Postgres database (DATABASE_URL) to view contracts.
      </DbSetupPage>
    );
  }
  if (!client || !orgId) return null;

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">Contracts</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Your contracts</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Every contract your organisation has commissioned. Open a contract for
          the overview, scope and work-package view.
        </p>
      </div>

      {loadError && (
        <div className="mb-6">
          <ErrorText>{loadError}</ErrorText>
        </div>
      )}

      {contracts.length === 0 && !loadError ? (
        <EmptyState
          title="No contracts yet"
          body="Contracts linked to your organisation will appear here once the lead contractor shares them."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {contracts.map((c) => (
            <ContractRow key={c.id} contract={c} orgId={orgId} />
          ))}
        </div>
      )}
    </div>
  );
}

function ContractRow({ contract, orgId }: { contract: ClientContractSummary; orgId: string }) {
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to="/client/contracts/$workspaceId"
            search={{ org: orgId }}
            params={{ workspaceId: contract.id }}
            className="text-lg font-bold text-navy hover:underline"
          >
            {contract.title}
          </Link>
          <p className="mt-0.5 text-sm text-muted">
            {[contract.leadCompany ?? "Lead contractor", contract.industry, contract.location]
              .filter(Boolean)
              .join(" · ") || "Contract"}
          </p>
        </div>
        <Badge tone={WORKSPACE_BADGE_TONES[contract.status]}>
          {WORKSPACE_STATUS_LABELS[contract.status]}
        </Badge>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MiniStat label="Value" value={fmtMoney(contract.contractValue)} />
        <MiniStat label="Start" value={contract.startDate ?? "—"} />
        <MiniStat label="End" value={contract.endDate ?? "—"} />
        <MiniStat label="Completion" value={`${contract.completionPct}%`} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs text-muted">
        <span>Lead: {contract.leadName ?? contract.leadEmail ?? "—"}</span>
        <span aria-hidden>·</span>
        <span>{contract.visiblePackageCount} client-visible work package{contract.visiblePackageCount === 1 ? "" : "s"}</span>
      </div>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

function fmtMoney(v: number | null): string {
  if (v === null) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(v);
}
