import { createFileRoute, Outlet } from "@tanstack/react-router";

/** /admin/verification layout — queue list (index) or company review page. */
export const Route = createFileRoute("/admin/verification")({
  component: VerificationLayout,
});

function VerificationLayout() {
  return <Outlet />;
}
