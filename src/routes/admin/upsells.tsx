import { createFileRoute } from "@tanstack/react-router";
import { getAdminSession } from "~/lib/admin";
import { Card, DbSetupPage, EmptyState } from "~/components/ui";

export const Route = createFileRoute("/admin/upsells")({
  loader: async () => {
    const session = await getAdminSession();
    return { setupRequired: session.setupRequired, admin: session.admin };
  },
  component: UpsellsPage,
});

function UpsellsPage() {
  const { setupRequired, admin } = Route.useLoaderData();
  if (setupRequired) {
    return (
      <DbSetupPage title="Upsell Opportunities">
        Connect a Postgres database (DATABASE_URL) to view upsell opportunities.
      </DbSetupPage>
    );
  }
  if (!admin) return null;
  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">Upsell Opportunities</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Upsell &amp; cross-sell recommendations</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Non-aggressive, evidence-backed recommendations reviewed and approved
          by Master Admins before any company is contacted.
        </p>
      </div>
      <Card className="p-6">
        <EmptyState
          title="No upsell recommendations yet"
          body="The upsell and cross-sell workflow lands with the AI Service Intelligence agent. Recommendations will show evidence, confidence, suggested messaging and full approval status."
        />
      </Card>
    </div>
  );
}
