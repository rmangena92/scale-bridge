import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import { AppShell } from "~/components/AppShell";
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
  Textarea,
} from "~/components/ui";
import { getSessionUser } from "~/lib/auth";
import { createWorkspace, listWorkspaces, seedDemoData } from "~/lib/workspace";
import {
  WORKSPACE_BADGE_TONES,
  WORKSPACE_STATUSES,
  WORKSPACE_STATUS_LABELS,
} from "~/lib/types";
import type { PublicUser, PublicWorkspace, WorkspaceStatus } from "~/lib/types";

export const Route = createFileRoute("/workspaces/")({
  loader: async () => {
    const session = await getSessionUser();
    if (session.setupRequired) {
      return { setupRequired: true as const, user: null, workspaces: [] };
    }
    if (!session.user) throw redirect({ to: "/login" });
    const result = await listWorkspaces();
    return {
      setupRequired: false as const,
      user: session.user,
      workspaces: result.ok ? result.workspaces : [],
      loadError: result.ok ? null : result.error,
    };
  },
  component: WorkspacesPage,
});

function WorkspacesPage() {
  const loader = Route.useLoaderData();
  if (loader.setupRequired || !loader.user) {
    return (
      <DbSetupPage title="Contract workspaces">
        Connect a Postgres database (DATABASE_URL) and re-run `bun run publish`
        to create and manage contract workspaces.
      </DbSetupPage>
    );
  }
  return <WorkspacesBody user={loader.user} initial={loader.workspaces} />;
}

function WorkspacesBody({
  user,
  initial,
}: {
  user: PublicUser;
  initial: PublicWorkspace[];
}) {
  const [workspaces, setWorkspaces] = useState<PublicWorkspace[]>(initial);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const result = await listWorkspaces();
    if (result.ok) {
      setWorkspaces(result.workspaces);
      setError(null);
    } else if (result.error !== "SETUP_REQUIRED") {
      setError(result.error);
    }
  }

  return (
    <AppShell user={user}>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-teal">
            Contract workspaces
          </p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Your workspaces</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            One workspace per contract: define the scope, invite companies and
            track every participant from Invited → Joined → Verified.
          </p>
        </div>
        <DemoSeedButton onSeeded={refresh} />
      </div>

      {error && (
        <div className="mb-6">
          <ErrorText>{error}</ErrorText>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {workspaces.length === 0 ? (
            <EmptyState
              title="No contract workspaces yet"
              body="Create your first workspace to define work packages and invite companies — or seed the demo facilities-management contract to see the whole flow."
            />
          ) : (
            <div className="flex flex-col gap-4">
              {workspaces.map((w) => (
                <WorkspaceRow key={w.id} workspace={w} />
              ))}
            </div>
          )}
        </div>
        <div className="lg:col-span-1">
          <CreateWorkspaceCard onCreated={refresh} />
        </div>
      </div>
    </AppShell>
  );
}

function WorkspaceRow({ workspace }: { workspace: PublicWorkspace }) {
  return (
    <Card className="p-5 transition-shadow hover:shadow-[var(--shadow-card-hover)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-bold text-navy">
              {workspace.title}
            </h2>
            <Badge tone={WORKSPACE_BADGE_TONES[workspace.status]}>
              {WORKSPACE_STATUS_LABELS[workspace.status]}
            </Badge>
            {workspace.access === "participant" && <Badge tone="teal">Participant</Badge>}
          </div>
          {workspace.description && (
            <p className="mt-1 line-clamp-2 text-sm text-muted">
              {workspace.description}
            </p>
          )}
        </div>
        <Link
          to="/workspaces/$workspaceId"
          params={{ workspaceId: workspace.id }}
          className="inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-navy transition-colors hover:border-brand hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Open →
        </Link>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4">
        <Stat label="Work packages" value={workspace.packageCount} />
        <Stat label="Invited" value={workspace.invitedCount} tone="blue" />
        <Stat label="Joined" value={workspace.joinedCount} tone="green" />
      </dl>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "blue" | "green";
}) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className={`font-display text-xl font-bold ${tone === "blue" ? "text-brand" : tone === "green" ? "text-success" : "text-navy"}`}>
        {value}
      </dd>
    </div>
  );
}

function CreateWorkspaceCard({ onCreated }: { onCreated: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<WorkspaceStatus>("draft");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await createWorkspace({ data: { title, description, status } });
    setPending(false);
    if (result.ok) {
      setTitle("");
      setDescription("");
      setStatus("draft");
      await onCreated();
    } else {
      setError(result.error === "UNAUTHENTICATED" ? "Your session expired — please sign in again." : result.error);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-lg font-bold">New workspace</h2>
      <p className="mt-1 text-sm text-muted">
        Start a contract workspace. You can invite companies right after.
      </p>
      <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4">
        <Field label="Title" htmlFor="ws-title">
          <Input
            id="ws-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Riverside Plaza — Facilities Management"
            required
            maxLength={200}
          />
        </Field>
        <Field label="Description" htmlFor="ws-description">
          <Textarea
            id="ws-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Scope, site, expected timeline…"
            rows={3}
            maxLength={2000}
          />
        </Field>
        <Field label="Status" htmlFor="ws-status">
          <Select
            id="ws-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as WorkspaceStatus)}
          >
            {WORKSPACE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {WORKSPACE_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        {error && <ErrorText>{error}</ErrorText>}
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create workspace"}
        </Button>
      </form>
    </Card>
  );
}

function DemoSeedButton({ onSeeded }: { onSeeded: () => Promise<void> }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function seed() {
    setPending(true);
    setMessage(null);
    const result = await seedDemoData();
    setPending(false);
    if (result.ok) {
      setMessage("Demo data created ✓");
      await onSeeded();
    } else {
      setMessage(result.error);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button variant="secondary" size="sm" onClick={seed} disabled={pending}>
        {pending ? "Seeding…" : "Seed demo contract"}
      </Button>
      {message && <p className="max-w-xs text-right text-xs text-muted">{message}</p>}
    </div>
  );
}
