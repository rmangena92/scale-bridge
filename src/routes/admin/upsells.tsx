import { createFileRoute } from "@tanstack/react-router";
import { getAdminSession, listCatalogueOpportunities } from "~/lib/admin";
import { OpportunitySummary, OpportunityTable } from "~/components/OpportunityTable";
import { DbSetupPage } from "~/components/ui";

export const Route = createFileRoute("/admin/upsells")({
  loader: async () => {
    const session = await getAdminSession();
    const result = await listCatalogueOpportunities({ data: { scope: "upsell" } });
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      initial: result.ok ? result.opportunities : [],
      loadError: result.ok ? null : result.error,
    };
  },
  component: UpsellsPage,
});

function UpsellsPage() {
  const loader = Route.useLoaderData();
  if (loader.setupRequired) {
    return (
      <DbSetupPage title="Upsell Opportunities">
        Connect a Postgres database (DATABASE_URL) to view upsell opportunities.
      </DbSetupPage>
    );
  }
  if (!loader.admin) return null;

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">Upsell Opportunities</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Upsell &amp; cross-sell recommendations</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Non-aggressive, evidence-backed recommendations reviewed and approved
          by Master Admins before any company is contacted.
        </p>
        <div className="mt-3">
          <OpportunitySummary
            total={loader.initial.length}
            label="upsell-recommended relationships (open and decided)"
          />
        </div>
      </div>
      <OpportunityTable
        scope="upsell"
        initial={loader.initial}
        loadError={loader.loadError}
        adminCanMutate={loader.admin.canMutate}
      />
      <p className="mt-4 text-xs text-muted">
        Suggested messaging, timing and ownership arrive with the AI upsell
        workflow build — approvals here control what the account team can action.
      </p>
    </div>
  );
}
