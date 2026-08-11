import { createFileRoute } from "@tanstack/react-router";
import { getAdminSession } from "~/lib/admin";
import { Card, DbSetupPage, EmptyState } from "~/components/ui";

export const Route = createFileRoute("/admin/services")({
  loader: async () => {
    const session = await getAdminSession();
    return { setupRequired: session.setupRequired, admin: session.admin };
  },
  component: ServicesPage,
});

function ServicesPage() {
  const { setupRequired, admin } = Route.useLoaderData();
  if (setupRequired) {
    return (
      <DbSetupPage title="Services">
        Connect a Postgres database (DATABASE_URL) to manage the services catalogue.
      </DbSetupPage>
    );
  }
  if (!admin) return null;
  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">Services</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Central services catalogue</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Every service — name, category, industry, qualifications, providers,
          demand and upsell relationships — lands with the services catalogue build.
        </p>
      </div>
      <Card className="p-6">
        <EmptyState
          title="No services yet"
          body="The central services catalogue is the next build step. Services will be listed here with providers, evidence, verification status and active demand — admins create, merge, categorise and approve them."
        />
      </Card>
    </div>
  );
}
