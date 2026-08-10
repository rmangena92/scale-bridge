import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { getAdminSession, listAdminUsers } from "~/lib/admin";
import {
  ROLE_LABELS,
  USER_STATUS_LABELS,
  USER_STATUSES,
  ROLES,
} from "~/lib/types";
import type { AdminUserSummary } from "~/lib/types";
import {
  Badge,
  Button,
  Card,
  DbSetupPage,
  EmptyState,
  ErrorText,
  Field,
  Input,
  Select,
} from "~/components/ui";

export const Route = createFileRoute("/admin/users/")({
  loader: async () => {
    const session = await getAdminSession();
    const result = await listAdminUsers({ data: { query: "", status: "", role: "" } });
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      initial: result.ok ? result.users : [],
      loadError: result.ok ? null : result.error,
    };
  },
  component: UsersPage,
});

const statusTones: Record<string, "green" | "red" | "amber" | "slate" | "blue"> = {
  active: "green",
  suspended: "red",
  deactivated: "slate",
  invited: "blue",
  pending_verification: "amber",
};

function UsersPage() {
  const loader = Route.useLoaderData();
  const [users, setUsers] = useState<AdminUserSummary[]>(loader.initial);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [role, setRole] = useState("");
  const [error, setError] = useState<string | null>(loader.loadError);
  const [pending, setPending] = useState(false);

  if (loader.setupRequired) {
    return (
      <DbSetupPage title="User management">
        Connect a Postgres database (DATABASE_URL) to manage users.
      </DbSetupPage>
    );
  }
  if (!loader.admin) return null;

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await listAdminUsers({ data: { query, status, role } });
    setPending(false);
    if (result.ok) {
      setUsers(result.users);
    } else {
      setError(result.error);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">
          Users
        </p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">User management</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Search accounts, review profiles and manage status and roles across
          the platform.
        </p>
      </div>

      <Card className="p-5">
        <form onSubmit={onSearch} className="flex flex-wrap items-end gap-3">
          <div className="min-w-52 flex-1">
            <Field label="Search" htmlFor="user-search">
              <Input
                id="user-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Email or name…"
              />
            </Field>
          </div>
          <div className="w-44">
            <Field label="Status" htmlFor="user-status">
              <Select
                id="user-status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">All statuses</option>
                {USER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {USER_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="w-44">
            <Field label="Role" htmlFor="user-role">
              <Select id="user-role" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="">All roles</option>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Searching…" : "Search"}
          </Button>
        </form>
      </Card>

      {error && (
        <div className="mt-5">
          <ErrorText>{error}</ErrorText>
        </div>
      )}

      <Card className="mt-5 overflow-x-auto">
        {users.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No users found"
              body="Try a different search term or clear the filters."
            />
          </div>
        ) : (
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">User</th>
                <th className="px-3 py-3">System role</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Company</th>
                <th className="px-3 py-3">Staff</th>
                <th className="px-5 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-mist/60">
                  <td className="px-5 py-3">
                    <Link
                      to="/admin/users/$userId"
                      params={{ userId: u.id }}
                      className="font-semibold text-navy hover:text-brand"
                    >
                      {u.name || u.email}
                    </Link>
                    <p className="text-xs text-muted">{u.email}</p>
                  </td>
                  <td className="px-3 py-3">
                    {u.systemRole ? (
                      <Badge tone="navy">{ROLE_LABELS[u.systemRole]}</Badge>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <Badge tone={statusTones[u.status] ?? "slate"}>
                      {USER_STATUS_LABELS[u.status]}
                    </Badge>
                  </td>
                  <td className="px-3 py-3 text-muted">
                    {u.companyName ?? "—"}
                  </td>
                  <td className="px-3 py-3">
                    {u.staffRoles.length > 0 ? (
                      <Badge tone="teal">Admin</Badge>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-xs text-muted">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
