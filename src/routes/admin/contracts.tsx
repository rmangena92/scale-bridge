import { createFileRoute, Outlet } from "@tanstack/react-router";

/** /admin/contracts layout — contract list (index) or contract detail page. */
export const Route = createFileRoute("/admin/contracts")({
  component: ContractsLayout,
});

function ContractsLayout() {
  return <Outlet />;
}
