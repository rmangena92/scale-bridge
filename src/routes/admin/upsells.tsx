import { createFileRoute, Outlet } from "@tanstack/react-router";
/** /admin/upsells layout — renders the opportunity list (index) or a detail page. */
export const Route = createFileRoute("/admin/upsells")({
  component: UpsellsLayout,
});
function UpsellsLayout() {
  return <Outlet />;
}
