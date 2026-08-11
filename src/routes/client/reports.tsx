import { createFileRoute } from "@tanstack/react-router";
import { ClientComingSoon } from "~/components/ClientShell";

export const Route = createFileRoute("/client/reports")({
  validateSearch: (search: Record<string, unknown>) => ({
    org: typeof search.org === "string" ? search.org : undefined,
  }),
  component: StubPage,
});

function StubPage() {
  return (
    <ClientComingSoon
      title="Reports"
      blurb="Client-facing progress and delivery reports."
    />
  );
}
