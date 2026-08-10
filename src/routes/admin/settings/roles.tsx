import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { getAdminSession, listAdminStaff, setAdminRoles, listAdminUsers } from "~/lib/admin";
import {
  ADMIN_ROLES,
  ADMIN_ROLE_DESCRIPTIONS,
  ADMIN_ROLE_LABELS,
} from "~/lib/types";
import type { AdminRole, AdminStaffMember, AdminUserSummary } from "~/lib/types";
import {
  Badge,
  Button,
  Card,
  DbSetupPage,
  EmptyState,
  ErrorText,
  Field,
  Input,
} from "~/components/ui";

export const Route = createFileRoute("/admin/settings/roles")({
  loader: async () => {
    const session = await getAdminSession();
    const staff = await listAdminStaff();
    const users = await listAdminUsers({ data: { query: "", status: "", role: "" } });
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      initial: staff.ok ? staff.staff : [],
      users: users.ok ? users.users : [],
      loadError: staff.ok ? null : staff.error,
    };
  },
  component: RolesPage,
});

function RolesPage() {
  const loader = Route.useLoaderData();
  const [staff, setStaff] = useState<AdminStaffMember[]>(loader.initial);
  const [allUsers] = useState<AdminUserSummary[]>(loader.users);
  const [error, setError] = useState<string | null>(loader.loadError);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, AdminRole[]>>(() =>
    Object.fromEntries(loader.initial.map((s) => [s.userId, s.roles])),
  );
  const [addEmail, setAddEmail] = useState("");
  const [addRoles, setAddRoles] = useState<AdminRole[]>(["operations"]);

  if (loader.setupRequired) {
    return (
      <DbSetupPage title="Roles & permissions">
        Connect a Postgres database (DATABASE_URL) to manage staff roles.
      </DbSetupPage>
    );
  }
  if (!loader.admin) return null;
  const me = loader.admin.user.id;
  const canMutate = loader.admin.canMutate && loader.admin.staffRoles.includes("super_admin");

  function toggleRole(userId: string, role: AdminRole) {
    setDrafts((d) => {
      const cur = d[userId] ?? [];
      return {
        ...d,
        [userId]: cur.includes(role) ? cur.filter((r) => r !== role) : [...cur, role],
      };
    });
  }

  async function save(userId: string) {
    if (userId === me) {
      setError("You can't modify your own admin roles.");
      return;
    }
    setPendingId(userId);
    setError(null);
    const result = await setAdminRoles({ data: { userId, roles: drafts[userId] ?? [] } });
    setPendingId(null);
    if (!result.ok) { setError(result.error ?? "Could not update roles."); return; }
    const fresh = await listAdminStaff();
    if (fresh.ok) {
      setStaff(fresh.staff);
      setDrafts((d) => {
        const next = { ...d };
        for (const s of fresh.staff) next[s.userId] = s.roles;
        return next;
      });
    }
  }

  async function onAdd() {
    const email = addEmail.trim().toLowerCase();
    if (!email) { setError("Enter a user email."); return; }
    const user = allUsers.find((u) => u.email.toLowerCase() === email);
    if (!user) { setError("No user found with that email. It must already have an account."); return; }
    if (user.id === me) { setError("You can't modify your own admin roles."); return; }
    setPendingId("add");
    setError(null);
    const result = await setAdminRoles({ data: { userId: user.id, roles: addRoles } });
    setPendingId(null);
    if (!result.ok) { setError(result.error ?? "Could not grant roles."); return; }
    setAddEmail("");
    const fresh = await listAdminStaff();
    if (fresh.ok) {
      setStaff(fresh.staff);
      setDrafts((d) => {
        const next = { ...d };
        for (const s of fresh.staff) next[s.userId] = s.roles;
        return next;
      });
    }
  }

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">Platform Settings</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Roles & permissions</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Grant or revoke ScaleBridge staff roles. Only a super admin can change roles; you cannot
          remove your own roles. Read-only staff can view the portal but cannot modify records.
        </p>
      </div>

      {!canMutate && (
        <div className="mb-5">
          <Badge tone="amber">Only super admins can change roles.</Badge>
        </div>
      )}

      {error && <div className="mb-5"><ErrorText>{error}</ErrorText></div>}

      {/* Role descriptions */}
      <Card className="p-5">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">Staff roles</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ADMIN_ROLES.map((r) => (
            <div key={r} className="rounded-xl border border-slate-200 p-3">
              <p className="text-sm font-bold text-navy">{ADMIN_ROLE_LABELS[r]}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">{ADMIN_ROLE_DESCRIPTIONS[r]}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Grant roles to a user */}
      <Card className="mt-5 p-5">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">Grant admin access</p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="w-64">
            <Field label="Existing user email" htmlFor="roles-email">
              <Input id="roles-email" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} placeholder="user@company.com" />
            </Field>
          </div>
          <div>
            <Field label="Roles to grant" htmlFor="roles-add">
              <select
                id="roles-add"
                multiple
                className="h-24 w-56 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
                value={addRoles}
                onChange={(e) =>
                  setAddRoles(Array.from(e.target.selectedOptions, (o) => o.value as AdminRole))
                }
              >
                {ADMIN_ROLES.map((r) => (
                  <option key={r} value={r}>{ADMIN_ROLE_LABELS[r]}</option>
                ))}
              </select>
            </Field>
          </div>
          <Button disabled={!canMutate || pendingId !== null || !addEmail.trim()} onClick={onAdd}>
            {pendingId === "add" ? "Saving…" : "Grant roles"}
          </Button>
        </div>
      </Card>

      {/* Staff list with role toggles */}
      <Card className="mt-5 overflow-x-auto">
        <div className="border-b border-slate-200 px-5 py-4">
          <p className="text-sm font-bold uppercase tracking-widest text-teal">Staff members</p>
        </div>
        {staff.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No staff members" body="Grant an admin role above to get started." />
          </div>
        ) : (
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">Staff member</th>
                <th className="px-3 py-3">Roles</th>
                <th className="px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {staff.map((s) => {
                const isMe = s.userId === me;
                const dirty = JSON.stringify(drafts[s.userId] ?? []) !== JSON.stringify(s.roles);
                return (
                  <tr key={s.userId} className="align-top hover:bg-mist/60">
                    <td className="px-5 py-3">
                      <p className="font-semibold text-navy">{s.name ?? s.email}</p>
                      <p className="text-xs text-muted">{s.email}</p>
                      {isMe && <Badge tone="teal" className="mt-1">You</Badge>}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {ADMIN_ROLES.map((r) => {
                          const on = (drafts[s.userId] ?? []).includes(r);
                          return (
                            <button
                              key={r}
                              type="button"
                              disabled={!canMutate || isMe}
                              onClick={() => toggleRole(s.userId, r)}
                              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset transition-colors disabled:cursor-not-allowed ${
                                on
                                  ? "bg-teal/15 text-teal ring-teal/30 hover:bg-teal/25"
                                  : "bg-slate-100 text-muted ring-slate-200 hover:bg-slate-200"
                              }`}
                              title={ADMIN_ROLE_DESCRIPTIONS[r]}
                            >
                              {ADMIN_ROLE_LABELS[r]}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <Button
                        size="sm"
                        disabled={!canMutate || isMe || !dirty || pendingId !== null}
                        onClick={() => save(s.userId)}
                      >
                        {pendingId === s.userId ? "Saving…" : dirty ? "Save changes" : "Saved"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
