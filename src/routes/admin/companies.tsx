import { createFileRoute, Outlet } from "@tanstack/react-router";

/** /admin/companies layout — renders the list (index) or a company detail page. */
export const Route = createFileRoute("/admin/companies")({
  component: CompaniesLayout,
});

function CompaniesLayout() {
  return <Outlet />;
}
