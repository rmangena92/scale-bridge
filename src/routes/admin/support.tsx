import { createFileRoute, Outlet } from "@tanstack/react-router";

/** /admin/support layout — case list (index) or case detail page. */
export const Route = createFileRoute("/admin/support")({
  component: SupportLayout,
});

function SupportLayout() {
  return <Outlet />;
}
