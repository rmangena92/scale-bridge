import { createFileRoute } from "@tanstack/react-router";
import { getAdminSession } from "~/lib/admin";
import { Card, DbSetupPage, EmptyState } from "~/components/ui";

export const Route = createFileRoute("/admin/opportunities")({
  loader: async () => {
    const session = await getAdminSession();
    return { setupRequired: session.setupRequired, admin: session.admin };
  },
  component: OpportunitiesPage,
});

function OpportunitiesPage() {
  const { setupRequired, admin } = Route.useLoaderData();
  if (setupRequired) {
    return (
      <DbSetupPage title="Opportunities">
        Connect a Postgres database (DATABASE_URL) to view opportunities.
      </DbSetupPage>
    );
  }
  if (!admin) return null;
  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">Opportunities</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Contract opportunities</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Opportunities matched to companies across the platform.
        </p>
      </div>
      <Card className="p-6">
        <EmptyState
          title="No opportunities yet"
          body="Opportunities arrive with the services catalogue build, which adds service-to-company relationships, contract demand and matching."
        />
      </Card>
    </div>
  );
}
