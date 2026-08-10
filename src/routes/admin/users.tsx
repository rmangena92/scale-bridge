import { createFileRoute, Outlet } from "@tanstack/react-router";

/** /admin/users layout — renders the list (index) or a user detail page. */
export const Route = createFileRoute("/admin/users")({
  component: UsersLayout,
});

function UsersLayout() {
  return <Outlet />;
}
