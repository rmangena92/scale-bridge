import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "~/components/AdminShell";

export const Route = createFileRoute("/admin/messages")({
  component: () => (
    <ComingSoon title="messages" blurb="Platform messaging — conversations across contracts and companies (Part B)." />
  ),
});
