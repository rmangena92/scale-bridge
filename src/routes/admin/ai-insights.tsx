import { createFileRoute } from "@tanstack/react-router";
import { getAdminSession } from "~/lib/admin";
import { Card, DbSetupPage, EmptyState } from "~/components/ui";

export const Route = createFileRoute("/admin/ai-insights")({
  loader: async () => {
    const session = await getAdminSession();
    return { setupRequired: session.setupRequired, admin: session.admin };
  },
  component: AiInsightsPage,
});

function AiInsightsPage() {
  const { setupRequired, admin } = Route.useLoaderData();
  if (setupRequired) {
    return (
      <DbSetupPage title="AI Insights">
        Connect a Postgres database (DATABASE_URL) to view AI insights.
      </DbSetupPage>
    );
  }
  if (!admin) return null;
  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">AI Insights</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">AI Service Intelligence</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Evidence-based service discoveries with confidence levels, sources and
          full audit trails. Human approval is required before anything is surfaced.
        </p>
      </div>
      <Card className="p-6">
        <EmptyState
          title="No AI discoveries yet"
          body="The AI Service Intelligence agent lands in a later build step. Discoveries will appear here with evidence, confidence levels and review status — the agent never invents services and never modifies profiles without human approval."
        />
      </Card>
    </div>
  );
}
