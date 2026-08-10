import { createFileRoute, Outlet } from "@tanstack/react-router";

/** /admin/settings layout — platform configuration pages. */
export const Route = createFileRoute("/admin/settings")({
  component: SettingsLayout,
});

function SettingsLayout() {
  return <Outlet />;
}
