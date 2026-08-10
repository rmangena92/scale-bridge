import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "~/components/AdminShell";

export const Route = createFileRoute("/admin/projects")({
  component: () => (
    <ComingSoon title="projects" blurb="Project workspaces — monitor work packages, milestones and delivery progress (Part B)." />
  ),
});
