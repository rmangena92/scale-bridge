import { createFileRoute, Outlet } from "@tanstack/react-router";
/** /admin/ai layout — renders the AI Controls overview (index) or a run detail page. */
export const Route = createFileRoute("/admin/ai")({
  component: AiControlsLayout,
});
function AiControlsLayout() {
  return <Outlet />;
}
