import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "~/components/AdminShell";

export const Route = createFileRoute("/admin/settings/")({
  component: () => (
    <ComingSoon title="settings" blurb="Platform settings — fees, configuration and system preferences (roles & permissions live under /admin/settings/roles)." />
  ),
});
