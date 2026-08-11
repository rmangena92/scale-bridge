import { createFileRoute } from "@tanstack/react-router";
import { ClientComingSoon } from "~/components/ClientShell";

export const Route = createFileRoute("/client/variations")({
  validateSearch: (search: Record<string, unknown>) => ({
    org: typeof search.org === "string" ? search.org : undefined,
  }),
  component: StubPage,
});

function StubPage() {
  return (
    <ClientComingSoon
      title="Variations"
      blurb="Review variation requests from the lead contractor."
    />
  );
}
