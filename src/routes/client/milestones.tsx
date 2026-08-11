import { createFileRoute } from "@tanstack/react-router";
import { ClientComingSoon } from "~/components/ClientShell";

export const Route = createFileRoute("/client/milestones")({
  validateSearch: (search: Record<string, unknown>) => ({
    org: typeof search.org === "string" ? search.org : undefined,
  }),
  component: StubPage,
});

function StubPage() {
  return (
    <ClientComingSoon
      title="Milestones"
      blurb="Review and approval of milestone submissions from the lead contractor."
    />
  );
}
