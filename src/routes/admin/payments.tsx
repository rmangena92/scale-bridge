import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "~/components/AdminShell";

export const Route = createFileRoute("/admin/payments")({
  component: () => (
    <ComingSoon title="payments" blurb="Payments — invoices, outstanding balances and refunds (Part B)." />
  ),
});
