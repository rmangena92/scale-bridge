import { createFileRoute, Link, redirect, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import { AppShell } from "~/components/AppShell";
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  DbSetupPage,
  EmptyState,
  ErrorText,
  Field,
  Input,
  Select,
  Textarea,
} from "~/components/ui";
import { getSessionUser } from "~/lib/auth";
import {
  addDocument,
  createTask,
  createWorkPackage,
  deleteWorkPackage,
  getWorkspace,
  inviteCompany,
  updateMilestoneStatus,
  updateTaskStatus,
  updateWorkspace,
  verifyParticipant,
} from "~/lib/workspace";
import {
  CLIENT_DOCUMENT_STATUS_LABELS,
  CLIENT_DOCUMENT_STATUS_TONES,
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS,
  DOCUMENT_VISIBILITIES,
  DOCUMENT_VISIBILITY_LABELS,
  DOCUMENT_VISIBILITY_TONES,
  INVITATION_BADGE_TONES,
  INVITATION_STATUS_LABELS,
  MILESTONE_LEAD_STATUSES,
  MILESTONE_STATUS_LABELS,
  MILESTONE_STATUS_TONES,
  PARTICIPANT_ROLE_LABELS,
  PARTICIPANT_ROLES,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  TASK_STATUS_TONES,
  WORKSPACE_BADGE_TONES,
  WORKSPACE_STATUSES,
  WORKSPACE_STATUS_LABELS,
} from "~/lib/types";
import type {
  AuditEntry,
  ClientDocumentStatus,
  DocumentCategory,
  DocumentVisibility,
  MilestoneStatus,
  ParticipantRole,
  PublicDocument,
  PublicInvitation,
  PublicMilestone,
  PublicTask,
  PublicUser,
  PublicWorkPackage,
  PublicWorkspace,
  TaskStatus,
  WorkspaceCompany,
  WorkspaceStatus,
} from "~/lib/types";
import type { WorkspaceDetailResult } from "~/lib/workspace";

// Spec tab order — seven tabs are live this phase (overview, companies,
// packages, documents, tasks, milestones, audit); the rest are scaffolded as
// disabled placeholders so the structure matches the spec.
const TAB_ORDER = [
  "overview",
  "companies",
  "packages",
  "documents",
  "pricing",
  "tasks",
  "milestones",
  "messages",
  "approvals",
  "variations",
  "invoices",
  "performance",
  "audit",
  "settings",
] as const;

type TabId = (typeof TAB_ORDER)[number];

const TAB_LABELS: Record<TabId, string> = {
  overview: "Overview",
  companies: "Participating Companies",
  packages: "Scope & Work Packages",
  documents: "Documents",
  pricing: "Pricing & Commercials",
  tasks: "Tasks",
  milestones: "Milestones",
  messages: "Messages",
  approvals: "Approvals",
  variations: "Variations",
  invoices: "Invoices",
  performance: "Performance",
  audit: "Audit Log",
  settings: "Settings",
};

const ACTIVE_TABS: TabId[] = [
  "overview",
  "companies",
  "packages",
  "documents",
  "tasks",
  "milestones",
  "audit",
];

export const Route = createFileRoute("/workspaces/$workspaceId")({
  loader: async ({ params }) => {
    const session = await getSessionUser();
    if (session.setupRequired) {
      return { setupRequired: true as const, user: null, detail: null as null };
    }
    if (!session.user) throw redirect({ to: "/login" });
    const detail = await getWorkspace({ data: { workspaceId: params.workspaceId } });
    return {
      setupRequired: false as const,
      user: session.user,
      detail: detail.ok ? detail : null,
    };
  },
  component: WorkspaceDetailPage,
});

function WorkspaceDetailPage() {
  const loader = Route.useLoaderData();
  if (loader.setupRequired || !loader.user) {
    return (
      <DbSetupPage title="Workspace">
        Connect a Postgres database (DATABASE_URL) and re-run `bun run publish`
        to open contract workspaces.
      </DbSetupPage>
    );
  }
  if (!loader.detail) {
    return (
      <AppShell user={loader.user}>
        <Card className="p-8 text-center">
          <p className="font-display text-xl font-bold text-navy">
            Workspace not found
          </p>
          <p className="mt-2 text-sm text-muted">
            It may have been removed, or you don't have access to it.
          </p>
          <Link
            to="/workspaces"
            className="mt-5 inline-block text-sm font-semibold text-brand hover:underline"
          >
            ← Back to your workspaces
          </Link>
        </Card>
      </AppShell>
    );
  }
  return <WorkspaceBody user={loader.user} detail={loader.detail} />;
}

function WorkspaceBody({
  user,
  detail,
}: {
  user: PublicUser;
  detail: WorkspaceDetailResult;
}) {
  const search = useSearch({ strict: false }) as { tab?: string };
  if (!detail.ok) {
    return (
      <AppShell user={user}>
        <Card className="p-8 text-center">
          <p className="font-display text-xl font-bold text-navy">
            Couldn't open this workspace
          </p>
          <p className="mt-2 text-sm text-muted">{detail.error}</p>
          <Link
            to="/workspaces"
            className="mt-5 inline-block text-sm font-semibold text-brand hover:underline"
          >
            ← Back to your workspaces
          </Link>
        </Card>
      </AppShell>
    );
  }
  const [data, setData] = useState(detail);
  const [tab, setTab] = useState<TabId>(() =>
    ACTIVE_TABS.includes(search.tab as TabId)
      ? (search.tab as TabId)
      : "overview",
  );
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    const result = await getWorkspace({ data: { workspaceId: data.workspace.id } });
    if (result.ok) setData(result);
  }

  const {
    workspace,
    isLead,
    packages,
    invitations,
    audit,
    documents,
    tasks,
    milestones,
    companies,
  } = data;

  return (
    <AppShell user={user}>
      <div className="mb-6">
        <Link
          to="/workspaces"
          className="text-sm font-semibold text-brand hover:underline"
        >
          ← All workspaces
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold sm:text-3xl">{workspace.title}</h1>
              <Badge tone={WORKSPACE_BADGE_TONES[workspace.status]}>
                {WORKSPACE_STATUS_LABELS[workspace.status]}
              </Badge>
              {isLead ? (
                <Badge tone="navy">Lead contractor</Badge>
              ) : (
                <Badge tone="teal">Participant</Badge>
              )}
            </div>
            {workspace.description && (
              <p className="mt-2 max-w-2xl text-sm text-muted">
                {workspace.description}
              </p>
            )}
          </div>
          <div className="text-right text-xs text-muted">
            <p>
              Created{" "}
              {new Date(workspace.createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
            <p className="mt-0.5">
              {workspace.packageCount} packages · {workspace.joinedCount} joined ·{" "}
              {workspace.invitedCount} invited
            </p>
          </div>
        </div>
      </div>

      {notice && (
        <div className="mb-4">
          <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm font-medium text-success">
            {notice}
          </p>
        </div>
      )}

      <div className="mb-6 flex flex-wrap gap-1.5 border-b border-slate-200 pb-px">
        {TAB_ORDER.map((t) => {
          const active = ACTIVE_TABS.includes(t);
          return (
            <button
              key={t}
              type="button"
              disabled={!active}
              onClick={() => setTab(t)}
              title={active ? undefined : "Coming in a later phase"}
              className={
                active
                  ? `rounded-t-lg border-b-2 px-3.5 py-2 text-sm font-semibold transition-colors ${
                      tab === t
                        ? "border-brand text-brand"
                        : "border-transparent text-muted hover:text-navy"
                    }`
                  : "cursor-not-allowed rounded-t-lg border-b-2 border-transparent px-3.5 py-2 text-sm font-semibold text-slate-300"
              }
            >
              {TAB_LABELS[t]}
            </button>
          );
        })}
      </div>

      {tab === "overview" && (
        <OverviewTab
          workspace={workspace}
          isLead={isLead}
          audit={audit}
          onStatusChange={async () => {
            await refresh();
          }}
        />
      )}
      {tab === "companies" && isLead && (
        <CompaniesTab
          workspace={workspace}
          invitations={invitations}
          packages={packages}
          onChanged={async (msg) => {
            setNotice(msg);
            await refresh();
          }}
        />
      )}
      {tab === "companies" && !isLead && (
        <Card className="p-8 text-center">
          <p className="text-sm text-muted">
            The participant list is private to the lead contractor — other
            companies' details are never shared across the workspace.
          </p>
        </Card>
      )}
      {tab === "packages" && (
        <PackagesTab
          workspace={workspace}
          packages={packages}
          isLead={isLead}
          onChanged={async (msg) => {
            setNotice(msg);
            await refresh();
          }}
        />
      )}
      {tab === "documents" && (
        <DocumentsTab
          workspace={workspace}
          documents={documents}
          isLead={isLead}
          onChanged={async (msg) => {
            setNotice(msg);
            await refresh();
          }}
        />
      )}
      {tab === "tasks" && (
        <TasksTab
          workspace={workspace}
          tasks={tasks}
          packages={packages}
          companies={companies}
          onChanged={async (msg) => {
            setNotice(msg);
            await refresh();
          }}
        />
      )}
      {tab === "milestones" && (
        <MilestonesTab
          workspace={workspace}
          milestones={milestones}
          isLead={isLead}
          onChanged={async (msg) => {
            setNotice(msg);
            await refresh();
          }}
        />
      )}
      {tab === "audit" && isLead && <AuditLogTab audit={audit} />}
      {tab === "audit" && !isLead && (
        <Card className="p-8 text-center">
          <p className="text-sm text-muted">
            The audit trail is private to the lead contractor — actions you
            take in this workspace are logged, but the full log isn't shared
            with participants.
          </p>
        </Card>
      )}
      {!ACTIVE_TABS.includes(tab) && <PlaceholderTab tab={tab} />}
    </AppShell>
  );
}

// ------------------------------------------------------------------- tabs
function PlaceholderTab({ tab }: { tab: TabId }) {
  return (
    <Card className="p-8">
      <div className="flex items-start gap-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-mist text-teal">
          <svg
            viewBox="0 0 24 24"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 8v4l2.5 2.5M12 3a9 9 0 100 18 9 9 0 000-18z" />
          </svg>
        </span>
        <div>
          <h2 className="text-lg font-bold">{TAB_LABELS[tab]}</h2>
          <p className="mt-1 text-sm text-muted">
            This area is part of the ScaleBridge roadmap and will arrive in a
            later phase. The tab is in place now so the workspace structure
            matches the full specification.
          </p>
        </div>
      </div>
    </Card>
  );
}

function OverviewTab({
  workspace,
  isLead,
  audit,
  onStatusChange,
}: {
  workspace: PublicWorkspace;
  isLead: boolean;
  audit: AuditEntry[];
  onStatusChange: () => Promise<void>;
}) {
  const [status, setStatus] = useState<WorkspaceStatus>(workspace.status);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveStatus() {
    if (status === workspace.status) return;
    setError(null);
    setPending(true);
    const result = await updateWorkspace({ data: { workspaceId: workspace.id,
      input: {
        title: workspace.title,
        description: workspace.description ?? "",
        status,
      }, } });
    setPending(false);
    if (result.ok) {
      await onStatusChange();
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-6 lg:col-span-2">
        <Card className="p-6">
          <h2 className="text-lg font-bold">Contract overview</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <OverviewField label="Status" value={WORKSPACE_STATUS_LABELS[workspace.status]} />
            <OverviewField
              label="Description"
              value={workspace.description ?? "No description yet."}
            />
            <OverviewField
              label="Work packages"
              value={`${workspace.packageCount} defined`}
            />
            <OverviewField
              label="Participants"
              value={`${workspace.joinedCount} joined · ${workspace.invitedCount} invited`}
            />
          </dl>
          {isLead && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void saveStatus();
              }}
              className="mt-5 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-5"
            >
              <Field label="Move workspace to" htmlFor="ov-status">
                <Select
                  id="ov-status"
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
              <Button
                type="submit"
                size="sm"
                disabled={pending || status === workspace.status}
              >
                {pending ? "Saving…" : "Update status"}
              </Button>
              {error && <ErrorText>{error}</ErrorText>}
            </form>
          )}
        </Card>

        {isLead && (
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Recent activity</h2>
              <Badge tone="slate">Audit trail</Badge>
            </div>
            {audit.length === 0 ? (
              <p className="mt-4 text-sm text-muted">
                No activity yet — actions like invites and verifications are
                logged here automatically.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-slate-100">
                {audit.slice(0, 10).map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                    <span className="font-medium text-ink">{AUDIT_LABELS[a.action] ?? a.action}</span>
                    <span className="shrink-0 text-xs text-muted">
                      {new Date(a.createdAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      <div className="flex flex-col gap-6">
        <Card className="p-6">
          <h2 className="text-lg font-bold">Your access</h2>
          <p className="mt-2 text-sm text-muted">
            {isLead
              ? "You lead this workspace — you can manage packages, invite companies and verify participants."
              : "You're a participant here. You can see the scope and work packages you were invited into, and your own invitation status."}
          </p>
        </Card>
        <Card className="p-6">
          <h2 className="text-lg font-bold">Isolation</h2>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            ScaleBridge keeps every company's pricing, documents and commercial
            terms private to the workspace. Other participants never see your
            data unless the lead explicitly shares it.
          </p>
        </Card>
      </div>
    </div>
  );
}

function OverviewField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 text-sm text-ink">{value}</dd>
    </div>
  );
}

// ------------------------------------------------------------ companies tab
function CompaniesTab({
  workspace,
  invitations,
  packages,
  onChanged,
}: {
  workspace: PublicWorkspace;
  invitations: PublicInvitation[];
  packages: PublicWorkPackage[];
  onChanged: (message: string) => Promise<void>;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-6 lg:col-span-2">
        <Card className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">Participant pipeline</h2>
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <Badge tone="blue">Invited</Badge>
              <span>→</span>
              <Badge tone="teal">Joined</Badge>
              <span>→</span>
              <Badge tone="green">Verified</Badge>
            </div>
          </div>
          <p className="mt-1 text-sm text-muted">
            Companies you've invited, their responses, and their status. Only
            you can see this list.
          </p>
          {invitations.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title="No companies invited yet"
                body="Use the invite form to send the first invitation to this workspace."
              />
            </div>
          ) : (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    <th className="pb-2 pr-4">Company</th>
                    <th className="pb-2 pr-4">Role</th>
                    <th className="pb-2 pr-4">Work package</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invitations.map((inv) => (
                    <tr key={inv.id}>
                      <td className="py-3 pr-4">
                        <p className="font-semibold text-ink">
                          {inv.companyName ?? "Unnamed company"}
                        </p>
                        <p className="text-xs text-muted">{inv.email}</p>
                      </td>
                      <td className="py-3 pr-4 text-muted">
                        {PARTICIPANT_ROLE_LABELS[inv.participantRole]}
                      </td>
                      <td className="py-3 pr-4 text-muted">
                        {inv.workPackage ?? "—"}
                      </td>
                      <td className="py-3 pr-4">
                        <Badge tone={INVITATION_BADGE_TONES[inv.status]}>
                          {INVITATION_STATUS_LABELS[inv.status]}
                        </Badge>
                      </td>
                      <td className="py-3 text-right">
                        {inv.status === "joined" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={async () => {
                              const r = await verifyParticipant({ data: { workspaceId: workspace.id,
                                invitationId: inv.id, } });
                              if (r.ok) {
                                await onChanged(`${inv.email} verified ✓`);
                              } else {
                                await onChanged(r.error);
                              }
                            }}
                          >
                            Verify
                          </Button>
                        ) : (
                          <span className="text-xs text-slate-400">
                            {inv.respondedAt
                              ? new Date(inv.respondedAt).toLocaleDateString()
                              : "Awaiting response"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div>
        <InviteForm
          workspaceId={workspace.id}
          packages={packages}
          onInvited={async (msg) => onChanged(msg)}
        />
      </div>
    </div>
  );
}

function InviteForm({
  workspaceId,
  packages,
  onInvited,
}: {
  workspaceId: string;
  packages: PublicWorkPackage[];
  onInvited: (message: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [participantRole, setParticipantRole] = useState<ParticipantRole>("subcontractor");
  const [workPackage, setWorkPackage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await inviteCompany({ data: { workspaceId,
      input: {
        email,
        companyName,
        participantRole,
        workPackage,
      }, } });
    setPending(false);
    if (result.ok) {
      setEmail("");
      setCompanyName("");
      setWorkPackage("");
      await onInvited(`Invitation sent to ${email} ✓`);
    } else {
      setError(
        result.error === "UNAUTHENTICATED"
          ? "Your session expired — please sign in again."
          : result.error,
      );
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-lg font-bold">Invite a company</h2>
      <p className="mt-1 text-sm text-muted">
        Send an invitation by email. The company sees it when someone signs up
        with that address.
      </p>
      <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4">
        <Field label="Email" htmlFor="inv-email">
          <Input
            id="inv-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="bids@company.com"
            required
          />
        </Field>
        <Field label="Company name (optional)" htmlFor="inv-company">
          <Input
            id="inv-company"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Meridian HVAC Ltd."
          />
        </Field>
        <Field label="Role in the workspace" htmlFor="inv-role">
          <Select
            id="inv-role"
            value={participantRole}
            onChange={(e) => setParticipantRole(e.target.value as ParticipantRole)}
          >
            {PARTICIPANT_ROLES.map((r) => (
              <option key={r} value={r}>
                {PARTICIPANT_ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Work package (optional)" htmlFor="inv-pkg">
          <Select
            id="inv-pkg"
            value={workPackage}
            onChange={(e) => setWorkPackage(e.target.value)}
          >
            <option value="">No specific package</option>
            {packages.map((p) => (
              <option key={p.id} value={p.name}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        {error && <ErrorText>{error}</ErrorText>}
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send invitation"}
        </Button>
        <p className="text-xs text-muted">
          Limited to 10 invitations per minute per account.
        </p>
      </form>
    </Card>
  );
}

// --------------------------------------------------------------- scope tab
function PackagesTab({
  workspace,
  packages,
  isLead,
  onChanged,
}: {
  workspace: PublicWorkspace;
  packages: PublicWorkPackage[];
  isLead: boolean;
  onChanged: (message: string) => Promise<void>;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-4 lg:col-span-2">
        {packages.length === 0 ? (
          <EmptyState
            title="No work packages defined yet"
            body={
              isLead
                ? "Break the contract scope into packages — HVAC, cleaning, security — so companies know exactly what they're invited into."
                : "The lead contractor hasn't defined work packages yet."
            }
          />
        ) : (
          packages.map((p) => (
            <Card key={p.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-bold text-navy">{p.name}</h3>
                    {p.category && <Badge tone="blue">{p.category}</Badge>}
                  </div>
                  {p.description && (
                    <p className="mt-1 text-sm text-muted">{p.description}</p>
                  )}
                  {p.scopeNotes && (
                    <p className="mt-2 rounded-lg bg-mist px-3 py-2 text-xs leading-relaxed text-muted">
                      <span className="font-semibold text-ink">Scope notes: </span>
                      {p.scopeNotes}
                    </p>
                  )}
                </div>
                {isLead && (
                  <ConfirmButton
                    label="Delete"
                    confirmLabel="Delete package?"
                    variant="outline"
                    size="sm"
                    className="border-danger/40 text-danger hover:border-danger hover:text-danger"
                    onConfirm={async () => {
                      const r = await deleteWorkPackage({ data: { workspaceId: workspace.id,
                        packageId: p.id, } });
                      if (r.ok) {
                        await onChanged(`“${p.name}” deleted.`);
                      } else {
                        await onChanged(r.error);
                      }
                    }}
                  />
                )}
              </div>
            </Card>
          ))
        )}
      </div>
      {isLead && (
        <div>
          <NewPackageForm workspaceId={workspace.id} onCreated={async (msg) => onChanged(msg)} />
        </div>
      )}
    </div>
  );
}

function NewPackageForm({
  workspaceId,
  onCreated,
}: {
  workspaceId: string;
  onCreated: (message: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [scopeNotes, setScopeNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await createWorkPackage({ data: { workspaceId,
      input: { name, description, scopeNotes, category }, } });
    setPending(false);
    if (result.ok) {
      setName("");
      setCategory("");
      setDescription("");
      setScopeNotes("");
      await onCreated(`Work package “${name}” created ✓`);
    } else {
      setError(result.error);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-lg font-bold">New work package</h2>
      <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4">
        <Field label="Name" htmlFor="pkg-name">
          <Input
            id="pkg-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="HVAC — servicing & repairs"
            required
            maxLength={160}
          />
        </Field>
        <Field label="Category" htmlFor="pkg-cat">
          <Input
            id="pkg-cat"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="HVAC"
            maxLength={100}
          />
        </Field>
        <Field label="Description" htmlFor="pkg-desc">
          <Textarea
            id="pkg-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this package cover?"
            rows={2}
            maxLength={2000}
          />
        </Field>
        <Field label="Scope notes" htmlFor="pkg-scope">
          <Textarea
            id="pkg-scope"
            value={scopeNotes}
            onChange={(e) => setScopeNotes(e.target.value)}
            placeholder="Deliverables, SLAs, exclusions…"
            rows={3}
            maxLength={4000}
          />
        </Field>
        {error && <ErrorText>{error}</ErrorText>}
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Add work package"}
        </Button>
      </form>
    </Card>
  );
}

// ------------------------------------------------------------ documents tab
function DocumentsTab({
  workspace,
  documents,
  isLead,
  onChanged,
}: {
  workspace: PublicWorkspace;
  documents: PublicDocument[];
  isLead: boolean;
  onChanged: (message: string) => Promise<void>;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-6 lg:col-span-2">
        <Card className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">Document library</h2>
            <Badge tone="slate">
              {documents.length} document{documents.length === 1 ? "" : "s"}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted">
            Contract documents shared inside this workspace. Client-visible
            documents also appear in the client portal; company-only documents
            stay private to the company that uploaded them.
          </p>
          {documents.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title="No documents yet"
                body="Add the first document — contracts, SLAs, method statements, licences, insurance…"
              />
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {documents.map((d) => (
                <li key={d.id} className="py-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">{d.name}</p>
                      <p className="mt-1 text-xs text-muted">
                        {DOCUMENT_CATEGORY_LABELS[d.category as DocumentCategory] ??
                          d.category ??
                          "General"}{" "}
                        · uploaded {fmtDate(d.uploadedAt)} by{" "}
                        {d.uploadedByEmail ?? "a participant"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge
                        tone={
                          CLIENT_DOCUMENT_STATUS_TONES[
                            d.status as ClientDocumentStatus
                          ] ?? "slate"
                        }
                      >
                        {CLIENT_DOCUMENT_STATUS_LABELS[
                          d.status as ClientDocumentStatus
                        ] ?? d.status}
                      </Badge>
                      <Badge tone={DOCUMENT_VISIBILITY_TONES[d.visibility]}>
                        {DOCUMENT_VISIBILITY_LABELS[d.visibility]}
                      </Badge>
                    </div>
                  </div>
                  {d.fileUrl ? (
                    <a
                      href={d.fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1.5 inline-block text-xs font-semibold text-brand hover:underline"
                    >
                      View document ↗
                    </a>
                  ) : (
                    <p className="mt-1.5 text-xs text-muted">
                      Metadata record — no file attached.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div>
        <AddDocumentForm
          workspaceId={workspace.id}
          isLead={isLead}
          onAdded={async (msg) => onChanged(msg)}
        />
      </div>
    </div>
  );
}
function AddDocumentForm({
  workspaceId,
  isLead,
  onAdded,
}: {
  workspaceId: string;
  isLead: boolean;
  onAdded: (message: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>("contract");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [accessNote, setAccessNote] = useState("");
  const [visibility, setVisibility] = useState<DocumentVisibility>("workspace");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await addDocument({
      data: {
        workspaceId,
        input: { name, category, description, url, accessNote, visibility },
      },
    });
    setPending(false);
    if (result.ok) {
      setName("");
      setCategory("contract");
      setDescription("");
      setUrl("");
      setAccessNote("");
      setVisibility("workspace");
      await onAdded(`Document “${name}” added ✓`);
    } else {
      setError(
        result.error === "UNAUTHENTICATED"
          ? "Your session expired — please sign in again."
          : result.error,
      );
    }
  }
  return (
    <Card className="p-6">
      <h2 className="text-lg font-bold">Add a document</h2>
      <p className="mt-1 text-sm text-muted">
        Record a document in the workspace library — with or without a file
        link. Metadata-only rows stay visible to the right people.
      </p>
      <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4">
        <Field label="Title" htmlFor="doc-title">
          <Input
            id="doc-title"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="SLA Schedule — Riverside Plaza"
            required
            maxLength={200}
          />
        </Field>
        <Field label="Type" htmlFor="doc-type">
          <Select
            id="doc-type"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {DOCUMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {DOCUMENT_CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Description (optional)" htmlFor="doc-desc">
          <Textarea
            id="doc-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="What this document covers…"
          />
        </Field>
        <Field label="File URL (optional)" htmlFor="doc-url">
          <Input
            id="doc-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            maxLength={1000}
          />
        </Field>
        {isLead && (
          <Field label="Visibility" htmlFor="doc-vis">
            <Select
              id="doc-vis"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as DocumentVisibility)}
            >
              {DOCUMENT_VISIBILITIES.map((v) => (
                <option key={v} value={v}>
                  {DOCUMENT_VISIBILITY_LABELS[v]}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Access note (optional)" htmlFor="doc-note">
          <Input
            id="doc-note"
            value={accessNote}
            onChange={(e) => setAccessNote(e.target.value)}
            placeholder="e.g. shared with the client finance team"
            maxLength={500}
          />
        </Field>
        {error && <ErrorText>{error}</ErrorText>}
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add document"}
        </Button>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------- tasks tab
function TasksTab({
  workspace,
  tasks,
  packages,
  companies,
  onChanged,
}: {
  workspace: PublicWorkspace;
  tasks: PublicTask[];
  packages: PublicWorkPackage[];
  companies: WorkspaceCompany[];
  onChanged: (message: string) => Promise<void>;
}) {
  const [updating, setUpdating] = useState<string | null>(null);
  async function changeStatus(task: PublicTask, status: TaskStatus) {
    if (status === task.status) return;
    setUpdating(task.id);
    const result = await updateTaskStatus({
      data: { workspaceId: workspace.id, taskId: task.id, status },
    });
    setUpdating(null);
    if (result.ok) {
      await onChanged(
        `Task “${task.title}” marked ${TASK_STATUS_LABELS[status].toLowerCase()} ✓`,
      );
    } else {
      await onChanged(
        result.error === "UNAUTHENTICATED"
          ? "Your session expired — please sign in again."
          : result.error,
      );
    }
  }
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-6 lg:col-span-2">
        <Card className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">Task board</h2>
            <Badge tone="slate">
              {tasks.length} task{tasks.length === 1 ? "" : "s"}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted">
            Delivery tasks for this workspace. Anyone in the workspace can
            update a task's status; every change is audit-logged.
          </p>
          {tasks.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title="No tasks yet"
                body="Create the first task — a filter change, a rota draft, a licence renewal…"
              />
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {tasks.map((t) => (
                <li key={t.id} className="py-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">{t.title}</p>
                      {t.description && (
                        <p className="mt-0.5 text-sm text-muted">
                          {t.description}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-muted">
                        {t.workPackageName ?? "No work package"}
                        {t.assigneeCompanyName ? ` · ${t.assigneeCompanyName}` : ""}
                        {t.dueDate ? ` · due ${fmtDate(t.dueDate)}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={TASK_STATUS_TONES[t.status]}>
                        {TASK_STATUS_LABELS[t.status]}
                      </Badge>
                      <Select
                        aria-label={`Status of ${t.title}`}
                        value={t.status}
                        disabled={updating === t.id}
                        onChange={(e) =>
                          changeStatus(t, e.target.value as TaskStatus)
                        }
                        className="w-auto text-xs"
                      >
                        {TASK_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {TASK_STATUS_LABELS[s]}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div>
        <NewTaskForm
          workspaceId={workspace.id}
          packages={packages}
          companies={companies}
          onCreated={async (msg) => onChanged(msg)}
        />
      </div>
    </div>
  );
}
function NewTaskForm({
  workspaceId,
  packages,
  companies,
  onCreated,
}: {
  workspaceId: string;
  packages: PublicWorkPackage[];
  companies: WorkspaceCompany[];
  onCreated: (message: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [workPackageId, setWorkPackageId] = useState("");
  const [assigneeCompanyId, setAssigneeCompanyId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await createTask({
      data: {
        workspaceId,
        input: { title, description, workPackageId, assigneeCompanyId, dueDate },
      },
    });
    setPending(false);
    if (result.ok) {
      setTitle("");
      setDescription("");
      setWorkPackageId("");
      setAssigneeCompanyId("");
      setDueDate("");
      await onCreated(`Task “${title}” created ✓`);
    } else {
      setError(
        result.error === "UNAUTHENTICATED"
          ? "Your session expired — please sign in again."
          : result.error,
      );
    }
  }
  return (
    <Card className="p-6">
      <h2 className="text-lg font-bold">New task</h2>
      <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4">
        <Field label="Title" htmlFor="task-title">
          <Input
            id="task-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Quarterly AHU filter change"
            required
            maxLength={200}
          />
        </Field>
        <Field label="Description (optional)" htmlFor="task-desc">
          <Textarea
            id="task-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="What needs to happen, and by whom…"
          />
        </Field>
        <Field label="Work package (optional)" htmlFor="task-pkg">
          <Select
            id="task-pkg"
            value={workPackageId}
            onChange={(e) => setWorkPackageId(e.target.value)}
          >
            <option value="">No specific package</option>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        {companies.length > 0 && (
          <Field label="Assignee company (optional)" htmlFor="task-company">
            <Select
              id="task-company"
              value={assigneeCompanyId}
              onChange={(e) => setAssigneeCompanyId(e.target.value)}
            >
              <option value="">Unassigned</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Due date (optional)" htmlFor="task-due">
          <Input
            id="task-due"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </Field>
        {error && <ErrorText>{error}</ErrorText>}
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create task"}
        </Button>
      </form>
    </Card>
  );
}

// ----------------------------------------------------------- milestones tab
function MilestonesTab({
  workspace,
  milestones,
  isLead,
  onChanged,
}: {
  workspace: PublicWorkspace;
  milestones: PublicMilestone[];
  isLead: boolean;
  onChanged: (message: string) => Promise<void>;
}) {
  const [updating, setUpdating] = useState<string | null>(null);
  async function changeStatus(m: PublicMilestone, status: MilestoneStatus) {
    if (status === m.status) return;
    setUpdating(m.id);
    const result = await updateMilestoneStatus({
      data: { workspaceId: workspace.id, milestoneId: m.id, status },
    });
    setUpdating(null);
    if (result.ok) {
      await onChanged(
        `Milestone “${m.name}” moved to ${MILESTONE_STATUS_LABELS[status]} ✓`,
      );
    } else {
      await onChanged(
        result.error === "UNAUTHENTICATED"
          ? "Your session expired — please sign in again."
          : result.error,
      );
    }
  }
  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Milestones</h2>
        <Badge tone="slate">
          {milestones.length} milestone{milestones.length === 1 ? "" : "s"}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-muted">
        Delivery milestones for this contract.{" "}
        {isLead
          ? "Update their status from here; formal client review and approval happen in the client portal."
          : "The lead contractor manages status; formal client review and approval happen in the client portal."}
      </p>
      {milestones.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No milestones yet"
            body="Milestones appear here once they're defined for the contract."
          />
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100">
          {milestones.map((m) => {
            const options = (
              MILESTONE_LEAD_STATUSES as readonly MilestoneStatus[]
            ).includes(m.status)
              ? MILESTONE_LEAD_STATUSES
              : ([m.status, ...MILESTONE_LEAD_STATUSES] as MilestoneStatus[]);
            return (
              <li key={m.id} className="py-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-ink">{m.name}</p>
                      <Badge tone={MILESTONE_STATUS_TONES[m.status]}>
                        {MILESTONE_STATUS_LABELS[m.status]}
                      </Badge>
                    </div>
                    {m.description && (
                      <p className="mt-0.5 text-sm text-muted">
                        {m.description}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted">
                      {m.workPackageName ?? "No work package"}
                      {m.dueDate ? ` · due ${fmtDate(m.dueDate)}` : ""}
                      {m.completedAt
                        ? ` · completed ${fmtDate(m.completedAt)}`
                        : ""}
                    </p>
                  </div>
                  {isLead && (
                    <Select
                      aria-label={`Status of ${m.name}`}
                      value={m.status}
                      disabled={updating === m.id}
                      onChange={(e) =>
                        changeStatus(m, e.target.value as MilestoneStatus)
                      }
                      className="w-auto text-xs"
                    >
                      {options.map((s) => (
                        <option key={s} value={s}>
                          {MILESTONE_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </Select>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ------------------------------------------------------------ audit log tab
function AuditLogTab({ audit }: { audit: AuditEntry[] }) {
  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Audit log</h2>
        <Badge tone="slate">
          {audit.length} event{audit.length === 1 ? "" : "s"}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-muted">
        Every action taken in this workspace, newest first. Only the lead
        contractor sees the full trail.
      </p>
      {audit.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No activity yet"
            body="Actions like document uploads, task updates and invitations are logged here automatically."
          />
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100">
          {audit.map((a) => (
            <li key={a.id} className="py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink">
                    {AUDIT_LABELS[a.action] ?? a.action}
                  </p>
                  {a.details && (
                    <p className="mt-0.5 text-xs text-muted">
                      {Object.entries(a.details)
                        .filter(([, v]) => v !== null && v !== "")
                        .map(
                          ([k, v]) =>
                            `${k
                              .replace(/([A-Z])/g, " $1")
                              .toLowerCase()}: ${v}`,
                        )
                        .join(" · ")
                        .slice(0, 240)}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right text-xs text-muted">
                  <p>{a.actorEmail ?? "system"}</p>
                  <p className="mt-0.5">{fmtDateTime(a.createdAt)}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
const AUDIT_LABELS: Record<string, string> = {
  "workspace.create": "Workspace created",
  "workspace.update": "Workspace updated",
  "work_package.create": "Work package created",
  "work_package.delete": "Work package deleted",
  "invitation.send": "Invitation sent",
  "invitation.accept": "Invitation accepted",
  "invitation.decline": "Invitation declined",
  "invitation.verify": "Participant verified",
  "document.create": "Document added",
  "task.create": "Task created",
  "task.update": "Task updated",
  "milestone.update": "Milestone updated",
  "demo.seed": "Demo data seeded",
};
