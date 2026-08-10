import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "~/components/AdminShell";

export const Route = createFileRoute("/admin/documents")({
  component: () => (
    <ComingSoon title="documents" blurb="Document review — licences, certificates, insurance and contract documents (Part B)." />
  ),
});
