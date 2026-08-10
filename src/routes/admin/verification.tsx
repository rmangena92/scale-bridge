import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "~/components/AdminShell";

export const Route = createFileRoute("/admin/verification")({
  component: () => (
    <ComingSoon title="verification" blurb="Company verification queue — document review, approval and rejection of company verification (Part B)." />
  ),
});
