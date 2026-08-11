import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import {
  getClientSession,
  inviteClientMember,
  listClientTeam,
  resolveClientOrg,
  updateClientMemberRole,
} from "~/lib/client";
import type { ClientRole, ClientTeamMember } from "~/lib/types";
import {
  CLIENT_ROLES,
  CLIENT_ROLE_BADGE_TONES,
  CLIENT_ROLE_LABELS,
  USER_STATUS_LABELS,
} from "~/lib/types";
import { Badge, Button, Card, DbSetupPage, EmptyState, ErrorText, Field, Input, Select } from "~/components/ui";
import { useClientPortal } from "~/components/ClientShell";

export const Route = createFileRoute("/client/team")({
  validateSearch: (search: Record<string, unknown>) => ({
    org: typeof search.org === "string" ? search.org : undefined,
  }),
  loaderDeps: ({ search }) => ({ org: search.org }),
  loader: async ({ deps }) => {
    const session = await getClientSession();
    if (!session.client) {
      return { setupRequired: session.setupRequired, client: null, orgId: null, members: [], loadError: null };
    }
    const org = resolveClientOrg(session.client, deps.org);
    const result = await listClientTeam({ data: { orgId: org.orgId } });
    return {
      setupRequired: session.setupRequired,
      client: session.client,
      orgId: org.orgId,
      members: result.ok ? result.data : [],
      loadError: result.ok ? null : result.error,
    };
  },
  component: TeamPage,
});

function TeamPage() {
  const { setupRequired, client, orgId, members, loadError } = Route.useLoaderData();
  const { org: membership } = useClientPortal();
  const isAdmin = membership.role === "client_admin";

  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<ClientRole>("client_pm");
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [inviteErr, setInviteErr] = useState<string | null>(null);
  const [roster, setRoster] = useState<ClientTeamMember[]>(members);
  const [rosterError, setRosterError] = useState<string | null>(loadError);

  if (setupRequired) {
    return (
      <DbSetupPage title="Team">
        Connect a Postgres database (DATABASE_URL) to manage your team.
      </DbSetupPage>
    );
  }
  if (!client || !orgId) return null;

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    setInviteErr(null);
    setInviteMsg(null);
    setInviting(true);
    const result = await inviteClientMember({ data: { orgId, email, name, role } });
    setInviting(false);
    if (result.ok) {
      setInviteMsg(
        result.tempPassword
          ? `${name} was invited. Temporary sign-in password (demo): ${result.tempPassword}`
          : `${name} was added to the team (existing account attached).`,
      );
      setEmail("");
      setName("");
      setInviteOpen(false);
      const fresh = await listClientTeam({ data: { orgId } });
      if (fresh.ok) setRoster(fresh.data);
    } else {
      setInviteErr(result.error);
    }
  }

  async function onChangeRole(userId: string, next: ClientRole) {
    setRosterError(null);
    const result = await updateClientMemberRole({ data: { orgId, userId, role: next } });
    if (result.ok) {
      setRoster((r) => r.map((m) => (m.userId === userId ? { ...m, role: next } : m)));
    } else {
      setRosterError(result.error);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">Team</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Organisation team</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          The people who act for {membership.orgName} on ScaleBridge
          {isAdmin ? " — you can invite members and change roles." : " — read-only for your role."}
        </p>
        {isAdmin && (
          <Button size="sm" className="mt-4" onClick={() => setInviteOpen((v) => !v)}>
            {inviteOpen ? "Close invite form" : "Invite a member"}
          </Button>
        )}
      </div>

      {rosterError && (
        <div className="mb-6">
          <ErrorText>{rosterError}</ErrorText>
        </div>
      )}
      {inviteMsg && <p className="mb-4 text-sm font-medium text-success">{inviteMsg}</p>}
      {inviteErr && (
        <div className="mb-4">
          <ErrorText>{inviteErr}</ErrorText>
        </div>
      )}

      {inviteOpen && isAdmin && (
        <Card className="mb-6 p-6">
          <h2 className="text-lg font-bold">Invite a team member</h2>
          <p className="mt-1 text-xs text-muted">
            Creates (or attaches) a ScaleBridge account and adds them to{" "}
            {membership.orgName}. Audit-logged.
          </p>
          <form onSubmit={onInvite} className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="inv-name">
              <Input
                id="inv-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Alex Morgan"
                required
              />
            </Field>
            <Field label="Work email" htmlFor="inv-email">
              <Input
                id="inv-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alex@yourcompany.com"
                required
              />
            </Field>
            <Field label="Role" htmlFor="inv-role">
              <Select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as ClientRole)}>
                {CLIENT_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {CLIENT_ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end">
              <Button type="submit" disabled={inviting}>
                {inviting ? "Inviting…" : "Invite member"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {roster.length === 0 && !rosterError ? (
        <EmptyState title="No team members" body="Invite the first member of your organisation." />
      ) : (
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Members</h2>
            <Badge tone="navy">{roster.length}</Badge>
          </div>
          <ul className="mt-4 divide-y divide-slate-100">
            {roster.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <span className="truncate">{m.name ?? m.email}</span>
                    {m.isSelf && <Badge tone="teal">You</Badge>}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {m.email} · {USER_STATUS_LABELS[m.userStatus] ?? m.userStatus} · joined{" "}
                    {shortDate(m.joinedAt)}
                  </p>
                </div>
                {isAdmin && !m.isSelf ? (
                  <Select
                    aria-label={`Role for ${m.email}`}
                    className="h-9 w-52"
                    value={m.role}
                    onChange={(e) => onChangeRole(m.userId, e.target.value as ClientRole)}
                  >
                    {CLIENT_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {CLIENT_ROLE_LABELS[r]}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Badge tone={CLIENT_ROLE_BADGE_TONES[m.role]}>
                    {CLIENT_ROLE_LABELS[m.role]}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
