import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "~/components/AdminShell";

export const Route = createFileRoute("/admin/audit-log")({
  component: () => (
    <ComingSoon title="audit-log" blurb="Platform audit log — every administrative decision, immutable (Part B)." />
  ),
});
