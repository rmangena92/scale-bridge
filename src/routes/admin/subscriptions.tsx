import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "~/components/AdminShell";

export const Route = createFileRoute("/admin/subscriptions")({
  component: () => (
    <ComingSoon title="subscriptions" blurb="Subscriptions — plans, company subscriptions and platform revenue (Part B)." />
  ),
});
