import {
  createFileRoute,
  Outlet,
  redirect,
  useLocation,
} from "@tanstack/react-router";
import { ClientPortalProvider, ClientShell } from "~/components/ClientShell";
import { DbSetupPage } from "~/components/ui";
import { getClientSession, resolveClientOrg } from "~/lib/client";

/**
 * /client layout route. Guards every page under /client except the login page:
 * a visitor must hold an authenticated session AND at least one
 * client_org_members row (resolved by loadClientUser via getClientSession).
 * Anyone else is redirected to /client/login. The login page renders bare (no
 * shell) so the redirect target is never re-guarded.
 *
 * Org switching: the layout reads the optional `org` search param; the
 * effective org is the param when it names one of the user's orgs, otherwise
 * the primary org. Child pages resolve their org the same way and re-run their
 * loaders when the search changes (loaderDeps keyed on `org`).
 */
export const Route = createFileRoute("/client")({
  validateSearch: (search: Record<string, unknown>): { org?: string } => ({
    org: typeof search.org === "string" ? search.org : undefined,
  }),
  beforeLoad: async ({ location }) => {
    if (location.pathname === "/client/login") return;
    const session = await getClientSession();
    if (session.setupRequired || !session.client) {
      throw redirect({ to: "/client/login" });
    }
  },
  loaderDeps: ({ search }) => ({ org: search.org }),
  loader: async ({ deps }) => {
    const session = await getClientSession();
    return {
      client: session.client,
      setupRequired: session.setupRequired,
      org: session.client ? resolveClientOrg(session.client, deps.org) : null,
    };
  },
  component: ClientLayout,
});

function ClientLayout() {
  const { pathname } = useLocation();
  const { client, setupRequired, org } = Route.useLoaderData();

  if (pathname === "/client/login") return <Outlet />;

  if (setupRequired) {
    return (
      <DbSetupPage title="ScaleBridge Client Portal">
        Connect a Postgres database (DATABASE_URL) and re-run `bun run publish`
        to enable the client portal.
      </DbSetupPage>
    );
  }
  if (!client || !org) {
    // Transitional state only (beforeLoad redirects genuinely logged-out
    // users): renders while the fresh session loader is in flight right
    // after login, instead of a blank page.
    return (
      <div className="flex min-h-dvh items-center justify-center bg-mist">
        <p className="text-sm text-muted">Loading…</p>
      </div>
    );
  }

  return (
    <ClientPortalProvider client={client} org={org}>
      <ClientShell client={client} org={org}>
        <Outlet />
      </ClientShell>
    </ClientPortalProvider>
  );
}
