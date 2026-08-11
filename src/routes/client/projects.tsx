import { createFileRoute } from "@tanstack/react-router";
import { ClientComingSoon } from "~/components/ClientShell";

export const Route = createFileRoute("/client/projects")({
  validateSearch: (search: Record<string, unknown>) => ({
    org: typeof search.org === "string" ? search.org : undefined,
  }),
  component: StubPage,
});

function StubPage() {
  return (
    <ClientComingSoon
      title="Projects"
      blurb="Project workspaces, task boards and delivery dashboards for the lead contractor's delivery teams."
    />
  );
}
