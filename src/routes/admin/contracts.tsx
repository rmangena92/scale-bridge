import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "~/components/AdminShell";

export const Route = createFileRoute("/admin/contracts")({
  component: () => (
    <ComingSoon title="contracts" blurb="Full contract administration — filter, inspect, suspend or archive contract workspaces (Part B)." />
  ),
});
