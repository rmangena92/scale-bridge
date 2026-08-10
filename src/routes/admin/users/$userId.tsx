import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import {
  addAdminUserNote,
  getAdminSession,
  getAdminUserDetail,
  setAdminRoles,
  setAdminUserStatus,
  setAdminUserSystemRole,
} from "~/lib/admin";
import {
  ADMIN_ROLES,
  ADMIN_ROLE_LABELS,
  INVITATION_STATUS_LABELS,
  ROLE_LABELS,
  ROLES,
  USER_STATUS_LABELS,
} from "~/lib/types";
import type { AdminRole, AdminUserDetail, Role } from "~/lib/types";
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  DbSetupPage,
  EmptyState,
  ErrorText,
  Field,
  Select,
  Textarea,
} from "~/components/ui";

export const Route = createFileRoute("/admin/users/$userId")({
  loader: async ({ params }) => {
    const session = await getAdminSession();
    const detail = await getAdminUserDetail({ data: { userId: params.userId } });
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      detail: detail.ok ? detail.detail : null,
      loadError: detail.ok ? null : detail.error,
    };
  },
  component: UserDetailPage,
});

const statusTones: Record<string, "green" | "red" | "amber" | "slate" | "blue"> = {
  active: "green",
  suspended: "red",
  deactivated: "slate",
  invited: "blue",
  pending_verification: "amber",
};

function UserDetailPage() {
  const { setupRequired, admin, detail, loadError } = Route.useLoaderData();
  if (setupRequired) {
    return (
      <DbSetupPage title="User profile">
        Connect a Postgres database (DATABASE_URL) to manage users.
      </DbSetupPage>
    );
  }
  if (!admin) return null;
  if (!detail) {
    return (
      <div className="mb-6">
        <ErrorText>{loadError ?? "User not found."}</ErrorText>
        <Link to="/admin/users" className="mt-4 inline-block text-sm font-semibold text-brand hover:underline">
          ← Back to users
        </Link>
      </div>
    );
  }
  return <UserDetailBody adminCanMutate={admin.canMutate} self={admin.user.id === detail.user.id} detail={detail} />;
}

function UserDetailBody({
  adminCanMutate,
  self,
  detail,
}: {
  adminCanMutate: boolean;
  self: boolean;
  detail: AdminUserDetail;
}) {
  const [status, setStatus] = useState(detail.user.status);
  const [systemRole, setSystemRole] = useState<Role | "">(detail.user.systemRole ?? "");
  const [adminRoles, setRoleDraft] = useState<AdminRole[]>(detail.user.staffRoles);
  const [notes, setNotes] = useState<string[]>(detail.internalNotes);
  const [noteText, setNoteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  function showError(e: string | null) {
    setError(e);
    setFlash(null);
  }

  async function changeStatus(next: typeof status) {
    if (!adminCanMutate) {
      setError("Your role is read-only — status changes are not permitted.");
      return;
    }
    setBusy(true);
    showError(null);
    const result = await setAdminUserStatus({ data: { userId: detail.user.id, status: next } });
    setBusy(false);
    if (result.ok) {
      setStatus(next);
      setFlash(`Account ${next === "active" ? "reactivated" : "updated"} ✓`);
    } else {
      showError(result.error === "FORBIDDEN_READ_ONLY" ? "Your role is read-only — changes are not permitted." : result.error);
    }
  }

  async function saveSystemRole(e: FormEvent) {
    e.preventDefault();
    if (!adminCanMutate || !systemRole) return;
    setBusy(true);
    showError(null);
    const result = await setAdminUserSystemRole({ data: { userId: detail.user.id, role: systemRole } });
    setBusy(false);
    if (result.ok) {
      setFlash("System role saved ✓");
    } else {
      showError(result.error === "FORBIDDEN_READ_ONLY" ? "Your role is read-only — changes are not permitted." : result.error);
    }
  }

  async function saveAdminRoles() {
    if (!adminCanMutate) {
      setError("Your role is read-only — changes are not permitted.");
      return;
    }
    if (self) {
      setError("You can't modify your own admin roles.");
      return;
    }
    setBusy(true);
    showError(null);
    const result = await setAdminRoles({ data: { userId: detail.user.id, roles: adminRoles } });
    setBusy(false);
    if (result.ok) {
      setFlash("Admin roles saved ✓");
    } else {
      showError(result.error);
    }
  }

  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (!adminCanMutate || !noteText.trim()) return;
    setBusy(true);
    showError(null);
    const result = await addAdminUserNote({ data: { userId: detail.user.id, note: noteText } });
    setBusy(false);
    if (result.ok) {
      setNotes([...notes, noteText.trim()]);
      setNoteText("");
      setFlash("Note recorded ✓");
    } else {
      showError(result.error);
    }
  }

  function toggleAdminRole(r: AdminRole) {
    setRoleDraft((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r],
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-teal">Users</p>
          <h1 className="mt-1 text-2xl font-bold">{detail.user.name || detail.user.email}</h1>
          <p className="mt-1 text-sm text-muted">{detail.user.email}</p>
        </div>
        <Link to="/admin/users" className="text-sm font-semibold text-brand hover:underline">
          ← Back to users
        </Link>
      </div>

      {error && (
        <div className="mb-5">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      {flash && (
        <p className="mb-5 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm font-medium text-success">
          {flash}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* account status */}
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Account status</h2>
            <Badge tone={statusTones[status] ?? "slate"}>{USER_STATUS_LABELS[status]}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted">Joined {new Date(detail.user.createdAt).toLocaleDateString()}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {status !== "active" && (
              <Button size="sm" onClick={() => changeStatus("active")} disabled={busy || self}>
                Reactivate
              </Button>
            )}
            {status !== "suspended" && (
              <ConfirmButton
                label="Suspend account"
                confirmLabel="Confirm suspend?"
                onConfirm={() => changeStatus("suspended")}
                disabled={busy || self}
                variant="outline"
              />
            )}
            {status !== "deactivated" && (
              <ConfirmButton
                label="Deactivate"
                confirmLabel="Confirm deactivate?"
                onConfirm={() => changeStatus("deactivated")}
                disabled={busy || self}
                variant="outline"
              />
            )}
          </div>
          {self && (
            <p className="mt-3 text-xs text-muted">
              You can't suspend or deactivate your own account.
            </p>
          )}
          <p className="mt-4 text-xs text-muted">
            Suspending revokes the user's sessions immediately.
          </p>
        </Card>

        {/* system role */}
        <Card className="p-6">
          <h2 className="text-lg font-bold">System role</h2>
          <p className="mt-1 text-sm text-muted">
            The platform role used on the public site and for RLS scoping.
          </p>
          <form onSubmit={saveSystemRole} className="mt-4 flex items-end gap-3">
            <div className="flex-1">
              <Field label="Role" htmlFor="system-role">
                <Select
                  id="system-role"
                  value={systemRole}
                  onChange={(e) => setSystemRole(e.target.value as Role)}
                  disabled={!adminCanMutate || busy}
                >
                  <option value="">No profile yet</option>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button type="submit" size="sm" disabled={!adminCanMutate || busy || !systemRole}>
              Save
            </Button>
          </form>
        </Card>

        {/* admin roles */}
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Admin roles</h2>
            {detail.user.staffRoles.length > 0 && (
              <Badge tone="teal">Staff member</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted">
            Rows in admin_roles; any of them grants access to the Admin Portal
            (read_only = view only).
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {ADMIN_ROLES.map((r) => {
              const checked = adminRoles.includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  disabled={!adminCanMutate || busy || self}
                  onClick={() => toggleAdminRole(r)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset transition-colors ${
                    checked
                      ? "bg-navy/10 text-navy ring-navy/25"
                      : "bg-white text-muted ring-slate-300 hover:bg-mist"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {checked ? "✓ " : ""}
                  {ADMIN_ROLE_LABELS[r]}
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button size="sm" onClick={saveAdminRoles} disabled={!adminCanMutate || busy || self}>
              Save admin roles
            </Button>
            {self && <span className="text-xs text-muted">You can't edit your own roles.</span>}
          </div>
        </Card>

        {/* internal notes */}
        <Card className="p-6">
          <h2 className="text-lg font-bold">Internal notes</h2>
          <p className="mt-1 text-sm text-muted">Visible to ScaleBridge staff only.</p>
          {notes.length > 0 ? (
            <ul className="mt-4 flex flex-col gap-2">
              {notes.map((n, i) => (
                <li key={i} className="rounded-lg bg-mist px-3 py-2 text-sm text-ink">
                  {n}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-muted">No notes recorded.</p>
          )}
          <form onSubmit={addNote} className="mt-4 flex flex-col gap-3">
            <Textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add a note for the next administrator…"
              rows={2}
              disabled={!adminCanMutate || busy}
            />
            <div>
              <Button type="submit" size="sm" disabled={!adminCanMutate || busy || !noteText.trim()}>
                Add note
              </Button>
            </div>
          </form>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* invitation history */}
        <Card className="p-6">
          <h2 className="text-lg font-bold">Invitation history</h2>
          {detail.invitations.length === 0 ? (
            <div className="mt-4">
              <EmptyState title="No invitations" body="This user has no invitation history yet." />
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {detail.invitations.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">
                      {inv.workspaceTitle ?? "Workspace"}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {inv.companyName ?? inv.email} · {inv.workPackage ?? "—"}
                    </p>
                  </div>
                  <Badge tone="slate">{INVITATION_STATUS_LABELS[inv.status]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* login activity */}
        <Card className="p-6">
          <h2 className="text-lg font-bold">Login activity</h2>
          {detail.sessions.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No active sessions on record.</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {detail.sessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      {new Date(s.createdAt).toLocaleString()}
                    </p>
                    <p className="text-xs text-muted">
                      Last used {new Date(s.lastUsedAt).toLocaleString()} · expires{" "}
                      {new Date(s.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge tone="slate">
                    {new Date(s.expiresAt).getTime() > Date.now() ? "Active" : "Expired"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
