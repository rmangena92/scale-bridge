import {
  createFileRoute,
  Outlet,
  redirect,
  useLocation,
} from "@tanstack/react-router";
import { AdminShell } from "~/components/AdminShell";
import { DbSetupPage } from "~/components/ui";
import { getAdminSession } from "~/lib/admin";

/**
 * /admin layout route. Guards every page under /admin except the login page:
 * a visitor must hold an authenticated session AND a row in admin_roles
 * (resolved by loadAdminUser via getAdminSession). Anyone else is redirected
 * to /admin/login. The login page renders bare (no shell) so the redirect
 * target is never re-guarded.
 */
export const Route = createFileRoute("/admin")({
  beforeLoad: async ({ location }) => {
    if (location.pathname === "/admin/login") return;
    const session = await getAdminSession();
    if (session.setupRequired || !session.admin) {
      throw redirect({ to: "/admin/login" });
    }
  },
  loader: async () => {
    const session = await getAdminSession();
    return { admin: session.admin, setupRequired: session.setupRequired };
  },
  component: AdminLayout,
});

function AdminLayout() {
  const { pathname } = useLocation();
  const { admin, setupRequired } = Route.useLoaderData();

  if (pathname === "/admin/login") return <Outlet />;

  if (setupRequired) {
    return (
      <DbSetupPage title="ScaleBridge Admin Portal">
        Connect a Postgres database (DATABASE_URL) and re-run `bun run publish`
        to enable the admin portal.
      </DbSetupPage>
    );
  }
  if (!admin) return null; // beforeLoad is redirecting

  return (
    <AdminShell admin={admin}>
      <Outlet />
    </AdminShell>
  );
}
