import { createFileRoute } from "@tanstack/react-router";
import { ClientComingSoon } from "~/components/ClientShell";

export const Route = createFileRoute("/client/invoices")({
  validateSearch: (search: Record<string, unknown>) => ({
    org: typeof search.org === "string" ? search.org : undefined,
  }),
  component: StubPage,
});

function StubPage() {
  return (
    <ClientComingSoon
      title="Invoices"
      blurb="Review submitted invoices, match to milestones and record payment status."
    />
  );
}
