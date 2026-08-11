import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import { AppShell } from "~/components/AppShell";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  DbSetupPage,
  EmptyState,
  ErrorText,
  Field,
  Input,
  Select,
  Textarea,
} from "~/components/ui";
import { getSessionUser, updateProfile } from "~/lib/auth";
import { getAdminSession } from "~/lib/admin";
import { getMyCompany, saveCompany } from "~/lib/company";
import { listMyInvitations, listWorkspaces } from "~/lib/workspace";
import {
  ROLE_LABELS,
  VERIFICATION_LABELS,
  WORKSPACE_BADGE_TONES,
  WORKSPACE_STATUS_LABELS,
} from "~/lib/types";
import type { PublicCompany, PublicInvitation, PublicUser, PublicWorkspace } from "~/lib/types";

export const Route = createFileRoute("/app")({
  loader: async () => {
    const session = await getSessionUser();
    if (session.setupRequired) {
      return {
        setupRequired: true as const,
        user: null,
        company: null,
        workspaces: [],
        pendingInvitations: [],
      };
    }
    if (!session.user) throw redirect({ to: "/login" });
    // Admins get the Master Admin Portal, not this legacy workspace dashboard.
    const adminSession = await getAdminSession();
    if (adminSession.admin) throw redirect({ to: "/admin" });
    const companyResult = await getMyCompany();
    const [workspacesResult, invitesResult] = await Promise.all([
      listWorkspaces(),
      listMyInvitations(),
    ]);
    return {
      setupRequired: false as const,
      user: session.user,
      company: companyResult.ok ? companyResult.company : null,
      workspaces: workspacesResult.ok ? workspacesResult.workspaces : [],
      pendingInvitations: invitesResult.ok
        ? invitesResult.invitations.filter((i) => i.status === "invited")
        : [],
    };
  },
  component: AppPage,
});

function AppPage() {
  const { setupRequired, user, company, workspaces, pendingInvitations } =
    Route.useLoaderData();
  if (setupRequired || !user) {
    return (
      <DbSetupPage title="Workspace dashboard">
        Connect a Postgres database (DATABASE_URL) and re-run `bun run publish`
        to enable accounts, company profiles and contract workspaces.
      </DbSetupPage>
    );
  }
  return (
    <AppShell user={user}>
      <div className="mb-8">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">
          Dashboard
        </p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
          Welcome back{user.name ? `, ${user.name.split(" ")[0]}` : ""}
        </h1>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <CompanyCard company={company} />
          <WorkspacesCard workspaces={workspaces} />
        </div>
        <div className="flex flex-col gap-6">
          <ProfileCard user={user} />
          <InvitationsCard pending={pendingInvitations} />
        </div>
      </div>
    </AppShell>
  );
}

// ------------------------------------------------------------------ profile
function ProfileCard({ user }: { user: PublicUser }) {
  const [name, setName] = useState(user.name ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await updateProfile({ data: { name } });
    setPending(false);
    if (result.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } else {
      setError(result.error);
    }
  }

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Your profile</h2>
        <Badge tone="navy">{ROLE_LABELS[user.role]}</Badge>
      </div>
      <p className="mt-1 text-sm text-muted">{user.email}</p>
      <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4">
        <Field label="Display name" htmlFor="profile-name">
          <Input
            id="profile-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jordan Reyes"
            required
          />
        </Field>
        {error && <ErrorText>{error}</ErrorText>}
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save name"}
          </Button>
          {saved && <span className="text-sm font-medium text-success">Saved ✓</span>}
        </div>
      </form>
    </Card>
  );
}

// ------------------------------------------------------------------ company
function CompanyCard({
  company,
}: {
  company: PublicCompany | null;
}) {
  const [name, setName] = useState(company?.name ?? "");
  const [type, setType] = useState(company?.type ?? "");
  const [description, setDescription] = useState(company?.description ?? "");
  const [contactEmail, setContactEmail] = useState(company?.contactEmail ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const verification = company?.verificationStatus ?? "unverified";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await saveCompany({ data: { name, type, description, contactEmail } });
    setPending(false);
    if (result.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } else if (result.error === "UNAUTHENTICATED") {
      setError("Your session expired — please sign in again.");
    } else {
      setError(result.error);
    }
  }

  return (
    <Card className="p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Company profile</h2>
          <p className="mt-0.5 text-sm text-muted">
            {company
              ? "Edit how your company appears to lead contractors."
              : "Set up your company so lead contractors can find and invite you."}
          </p>
        </div>
        <Badge tone={verification === "verified" ? "green" : verification === "pending" ? "amber" : "slate"}>
          {VERIFICATION_LABELS[verification]}
        </Badge>
      </div>

      {verification !== "verified" && (
        <p className="mt-4 rounded-lg bg-mist px-3 py-2 text-xs text-muted">
          Company verification arrives in a later phase. Your profile is live
          and editable now; verification adds the check-mark badge.
        </p>
      )}

      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
        <Field label="Company name" htmlFor="company-name">
          <Input
            id="company-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Meridian HVAC Ltd."
            required
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type of business" htmlFor="company-type">
            <Select
              id="company-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="">Select a type…</option>
              <option value="hvac">HVAC</option>
              <option value="cleaning">Cleaning &amp; facilities</option>
              <option value="security">Security</option>
              <option value="electrical">Electrical</option>
              <option value="plumbing">Plumbing</option>
              <option value="construction">Construction</option>
              <option value="it">IT &amp; technology</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Contact email" htmlFor="company-email">
            <Input
              id="company-email"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="bids@meridianhvac.com"
            />
          </Field>
        </div>
        <Field
          label="Description"
          htmlFor="company-description"
          hint="A short paragraph on what your company does and its specialties."
        >
          <Textarea
            id="company-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Meridian HVAC designs, installs and maintains heating, ventilation and air-conditioning systems for commercial buildings across the region…"
            rows={4}
          />
        </Field>
        {error && <ErrorText>{error}</ErrorText>}
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : company ? "Save changes" : "Create company profile"}
          </Button>
          {saved && <span className="text-sm font-medium text-success">Saved ✓</span>}
        </div>
      </form>
    </Card>
  );
}

// -------------------------------------------------------------- workspaces
function WorkspacesCard({ workspaces }: { workspaces: PublicWorkspace[] }) {
  return (
    <Card className="p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Contract workspaces</h2>
          <p className="mt-0.5 text-sm text-muted">
            {workspaces.length === 0
              ? "Create a workspace to start inviting companies."
              : "Your workspaces and their participant pipeline."}
          </p>
        </div>
        <ButtonLink to="/workspaces" variant="outline" size="sm">
          Manage
        </ButtonLink>
      </div>
      {workspaces.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            title="No workspaces yet"
            body="Start your first contract workspace — define work packages and invite companies."
          >
            <ButtonLink to="/workspaces" size="sm">
              Create workspace
            </ButtonLink>
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-5 divide-y divide-slate-100">
          {workspaces.slice(0, 4).map((w) => (
            <li key={w.id} className="flex items-center justify-between gap-3 py-3">
              <Link
                to="/workspaces/$workspaceId"
                params={{ workspaceId: w.id }}
                className="min-w-0 font-semibold text-ink hover:text-brand"
              >
                <span className="block truncate">{w.title}</span>
                <span className="block text-xs font-normal text-muted">
                  {w.packageCount} packages · {w.joinedCount} joined ·{" "}
                  {w.invitedCount} invited
                </span>
              </Link>
              <Badge tone={WORKSPACE_BADGE_TONES[w.status]}>
                {WORKSPACE_STATUS_LABELS[w.status]}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ------------------------------------------------------------- invitations
function InvitationsCard({ pending }: { pending: PublicInvitation[] }) {
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Invitations</h2>
        {pending.length > 0 && <Badge tone="blue">{pending.length} pending</Badge>}
      </div>
      <p className="mt-1 text-sm text-muted">
        {pending.length === 0
          ? "No pending invitations for your email."
          : `You've been invited to ${pending.length === 1 ? "a contract workspace" : `${pending.length} contract workspaces`}.`}
      </p>
      <ButtonLink
        to="/invitations"
        variant="outline"
        size="sm"
        className="mt-4"
      >
        View invitations
      </ButtonLink>
    </Card>
  );
}
