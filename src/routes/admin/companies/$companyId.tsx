import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Company detail layout: /admin/companies/$companyId renders the index route
 * (company profile); the /view-as-client child renders the temporary
 * client-portal view. Kept as a thin layout so the child is not swallowed by
 * the company-detail component (TanStack requires an <Outlet /> here).
 */
export const Route = createFileRoute("/admin/companies/$companyId")({
  component: () => <Outlet />,
});
