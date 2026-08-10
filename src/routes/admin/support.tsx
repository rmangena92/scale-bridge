import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "~/components/AdminShell";

export const Route = createFileRoute("/admin/support")({
  component: () => (
    <ComingSoon title="support" blurb="Support cases — tickets, case messages and internal notes (Part B)." />
  ),
});
