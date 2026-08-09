import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "~/components/AppShell";
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  DbSetupPage,
  EmptyState,
  ErrorText,
} from "~/components/ui";
import { getSessionUser } from "~/lib/auth";
import { listMyInvitations, respondToInvitation } from "~/lib/workspace";
import {
  INVITATION_BADGE_TONES,
  INVITATION_STATUS_LABELS,
  PARTICIPANT_ROLE_LABELS,
} from "~/lib/types";
import type { PublicInvitation, PublicUser } from "~/lib/types";

export const Route = createFileRoute("/invitations")({
  loader: async () => {
    const session = await getSessionUser();
    if (session.setupRequired) {
      return { setupRequired: true as const, user: null, invitations: [] };
    }
    if (!session.user) throw redirect({ to: "/login" });
    const result = await listMyInvitations();
    return {
      setupRequired: false as const,
      user: session.user,
      invitations: result.ok ? result.invitations : [],
      loadError: result.ok ? null : result.error,
    };
  },
  component: InvitationsPage,
});

function InvitationsPage() {
  const loader = Route.useLoaderData();
  if (loader.setupRequired || !loader.user) {
    return (
      <DbSetupPage title="Invitations">
        Connect a Postgres database (DATABASE_URL) and re-run `bun run publish`
        to see invitations to contract workspaces.
      </DbSetupPage>
    );
  }
  return <InvitationsBody user={loader.user} initial={loader.invitations} />;
}

function InvitationsBody({
  user,
  initial,
}: {
  user: PublicUser;
  initial: PublicInvitation[];
}) {
  const [invitations, setInvitations] = useState<PublicInvitation[]>(initial);
  const [error, setError] = useState<string | null>(null);

  const pending = invitations.filter((i) => i.status === "invited");
  const history = invitations.filter((i) => i.status !== "invited");

  async function respond(inv: PublicInvitation, response: "accept" | "decline") {
    setError(null);
    const result = await respondToInvitation({ data: { invitationId: inv.id, response } });
    if (!result.ok) {
      setError(result.error === "UNAUTHENTICATED" ? "Your session expired — please sign in again." : result.error);
      return;
    }
    setInvitations((prev) =>
      prev.map((i) =>
        i.id === inv.id
          ? { ...i, status: response === "accept" ? "joined" : "declined" }
          : i,
      ),
    );
  }

  return (
    <AppShell user={user}>
      <div className="mb-8">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">
          Invitations
        </p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
          Your invitations
        </h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Invitations addressed to <span className="font-semibold text-ink">{user.email}</span>.
          Accept to join a contract workspace, or decline to pass.
        </p>
      </div>

      {error && (
        <div className="mb-6">
          <ErrorText>{error}</ErrorText>
        </div>
      )}

      {pending.length === 0 ? (
        <EmptyState
          title="No pending invitations"
          body="When a lead contractor invites your email to a workspace, it will appear here ready to accept or decline."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {pending.map((inv) => (
            <Card key={inv.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-bold text-navy">
                      {inv.workspaceTitle ?? "Contract workspace"}
                    </h2>
                    <Badge tone="blue">{INVITATION_STATUS_LABELS[inv.status]}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    Invited as{" "}
                    <span className="font-semibold text-ink">
                      {PARTICIPANT_ROLE_LABELS[inv.participantRole]}
                    </span>
                    {inv.workPackage && (
                      <>
                        {" "}
                        for{" "}
                        <span className="font-semibold text-ink">{inv.workPackage}</span>
                      </>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {inv.companyName && `${inv.companyName} · `}
                    Sent{" "}
                    {new Date(inv.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => void respond(inv, "accept")}
                  >
                    Accept
                  </Button>
                  <ConfirmButton
                    label="Decline"
                    confirmLabel="Decline invitation?"
                    size="sm"
                    variant="outline"
                    className="border-danger/40 text-danger hover:border-danger hover:text-danger"
                    onConfirm={() => void respond(inv, "decline")}
                  />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <Card className="mt-8 p-6">
          <h2 className="text-lg font-bold">History</h2>
          <ul className="mt-3 divide-y divide-slate-100">
            {history.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <p className="font-semibold text-ink">
                    {inv.workspaceTitle ?? "Contract workspace"}
                  </p>
                  <p className="text-xs text-muted">
                    {PARTICIPANT_ROLE_LABELS[inv.participantRole]}
                    {inv.workPackage ? ` · ${inv.workPackage}` : ""}
                    {inv.respondedAt
                      ? ` · ${new Date(inv.respondedAt).toLocaleDateString()}`
                      : ""}
                  </p>
                </div>
                <Badge tone={INVITATION_BADGE_TONES[inv.status]}>
                  {INVITATION_STATUS_LABELS[inv.status]}
                </Badge>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted">
            {history.some((i) => i.status === "joined" || i.status === "verified") && (
              <>
                You're participating in these workspaces — find them under{" "}
                <Link to="/workspaces" className="font-semibold text-brand hover:underline">
                  Workspaces
                </Link>
                .
              </>
            )}
          </p>
        </Card>
      )}
    </AppShell>
  );
}
