import { createFileRoute } from "@tanstack/react-router";
import { getAdminSession, listCatalogueOpportunities } from "~/lib/admin";
import { OpportunitySummary, OpportunityTable } from "~/components/OpportunityTable";
import { DbSetupPage } from "~/components/ui";

export const Route = createFileRoute("/admin/ai-insights")({
  loader: async () => {
    const session = await getAdminSession();
    const result = await listCatalogueOpportunities({ data: { scope: "ai" } });
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      initial: result.ok ? result.opportunities : [],
      loadError: result.ok ? null : result.error,
    };
  },
  component: AiInsightsPage,
});

function AiInsightsPage() {
  const loader = Route.useLoaderData();
  if (loader.setupRequired) {
    return (
      <DbSetupPage title="AI Insights">
        Connect a Postgres database (DATABASE_URL) to view AI insights.
      </DbSetupPage>
    );
  }
  if (!loader.admin) return null;

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">AI Insights</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">AI Service Intelligence</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Evidence-based service discoveries with confidence levels, sources and
          full audit trails. Human approval is required before anything is surfaced.
        </p>
        <div className="mt-3">
          <OpportunitySummary
            total={loader.initial.length}
            label="AI discovery rows with their evidence and decisions"
          />
        </div>
      </div>
      <OpportunityTable
        scope="ai"
        initial={loader.initial}
        loadError={loader.loadError}
        adminCanMutate={loader.admin.canMutate}
        showEvidence
      />
      <p className="mt-4 text-xs text-muted">
        The agent never invents services and never modifies profiles without
        human approval — the discovery engine, agent runs and data-source
        permissions land with the AI Service Intelligence build.
      </p>
    </div>
  );
}
