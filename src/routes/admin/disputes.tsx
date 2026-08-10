import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "~/components/AdminShell";

export const Route = createFileRoute("/admin/disputes")({
  component: () => (
    <ComingSoon title="disputes" blurb="Dispute management — escalated cases and resolutions (Part B)." />
  ),
});
