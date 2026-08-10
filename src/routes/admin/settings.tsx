import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "~/components/AdminShell";

export const Route = createFileRoute("/admin/settings")({
  component: () => (
    <ComingSoon title="settings" blurb="Platform settings — roles, permissions, fees and configuration (Part B)." />
  ),
});
