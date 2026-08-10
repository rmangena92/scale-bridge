import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "~/components/AdminShell";

export const Route = createFileRoute("/admin/reports")({
  component: () => (
    <ComingSoon title="reports" blurb="Reports — registrations, verification conversion, revenue and more (Part B)." />
  ),
});
