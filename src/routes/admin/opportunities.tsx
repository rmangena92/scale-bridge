import { createFileRoute } from "@tanstack/react-router";
import { getAdminSession, listCatalogueOpportunities } from "~/lib/admin";
import { OpportunitySummary, OpportunityTable } from "~/components/OpportunityTable";
import { DbSetupPage } from "~/components/ui";

export const Route = createFileRoute("/admin/opportunities")({
  loader: async () => {
    const session = await getAdminSession();
    const result = await listCatalogueOpportunities({ data: { scope: "open" } });
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      initial: result.ok ? result.opportunities : [],
      loadError: result.ok ? null : result.error,
    };
  },
  component: OpportunitiesPage,
});

function OpportunitiesPage() {
  const loader = Route.useLoaderData();
  if (loader.setupRequired) {
    return (
      <DbSetupPage title="Opportunities">
        Connect a Postgres database (DATABASE_URL) to view opportunities.
      </DbSetupPage>
    );
  }
  if (!loader.admin) return null;

  const reviewItems =
    loader.initial.filter((o) => o.source === "AI discovery").length +
    loader.initial.filter((o) => o.upsellRecommended).length;

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">Opportunities</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Contract opportunities</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          AI discoveries and upsell recommendations still awaiting an admin
          decision. Every decision is audit-logged; approved recommendations can
          then be actioned by the account team.
        </p>
        <div className="mt-3">
          <OpportunitySummary
            total={loader.initial.length}
            label={`open relationships · ${reviewItems} review items across the AI + upsell lenses (a relationship flagged in both counts twice)`}
          />
        </div>
      </div>
      <OpportunityTable
        scope="open"
        initial={loader.initial}
        loadError={loader.loadError}
        adminCanMutate={loader.admin.canMutate}
      />
      <p className="mt-4 text-xs text-muted">
        More arrives with the AI Service Intelligence agent build — agent runs,
        data-source permissions and model-version tracking.
      </p>
    </div>
  );
}
