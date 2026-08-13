import { createFileRoute, Outlet } from "@tanstack/react-router";
/** /admin/services layout — service catalogue list (index), categories, or service detail page. */
export const Route = createFileRoute("/admin/services")({
  component: ServicesLayout,
});
function ServicesLayout() {
  return <Outlet />;
}
