import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import { getAdminSession, listPartnershipWorkspaces } from "~/lib/admin";
import type { AdminPartnershipWorkspaceRow } from "~/lib/admin";
import { WORKSPACE_STATUS_LABELS } from "~/lib/types";
import { Badge, Button, Card, DbSetupPage, EmptyState, ErrorText, Field, Select } from "~/components/ui";

export const Route = createFileRoute("/admin/workspaces")({
  loader: async () => {
    const session = await getAdminSession();
    const result = await listPartnershipWorkspaces({ data: { status: "" } });
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      initial: result.ok ? result.workspaces : [],
      statuses: result.ok ? result.statuses : [],
      loadError: result.ok ? null : result.error,
    };
  },
  component: PartnershipWorkspacesPage,
});

const statusTones: Record<string, "green" | "red" | "amber" | "slate" | "blue" | "teal"> = {
  draft: "slate",
  active: "green",
  on_hold: "amber",
  completed: "blue",
  archived: "slate",
  suspended: "red",
};

function fmtDate(v: string): string {
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function PartnershipWorkspacesPage() {
  const loader = Route.useLoaderData();
  const [workspaces, setWorkspaces] = useState<AdminPartnershipWorkspaceRow[]>(loader.initial);
  const [statuses] = useState(loader.statuses);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(loader.loadError);
  const [pending, setPending] = useState(false);

  if (loader.setupRequired) {
    return (
      <DbSetupPage title="Partnership workspaces">
        Connect a Postgres database (DATABASE_URL) to manage workspaces.
      </DbSetupPage>
    );
  }
  if (!loader.admin) return null;

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await listPartnershipWorkspaces({ data: { status } });
    setPending(false);
    if (result.ok) {
      setWorkspaces(result.workspaces);
    } else {
      setError(result.error);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">
          Partnership Workspaces
        </p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Partnership workspaces</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Every contract workspace where lead contractors coordinate partner
          companies — participants, work packages, client organisations and status.
        </p>
      </div>

      <Card className="p-5">
        <form onSubmit={onSearch} className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Field label="Workspace status" htmlFor="ws-status">
              <Select id="ws-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All statuses</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {WORKSPACE_STATUS_LABELS[s as keyof typeof WORKSPACE_STATUS_LABELS] ?? s}
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
        {workspaces.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No partnership workspaces yet"
              body="Contract workspaces created by lead contractors will appear here with their partner companies."
            />
          </div>
        ) : (
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">Workspace</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Lead contractor</th>
                <th className="px-3 py-3">Client organisations</th>
                <th className="px-3 py-3">Participants</th>
                <th className="px-3 py-3">Work packages</th>
                <th className="px-3 py-3">Industry</th>
                <th className="px-3 py-3">Location</th>
                <th className="px-3 py-3">Contract value</th>
                <th className="px-5 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {workspaces.map((w) => (
                <tr key={w.id} className="hover:bg-mist/60 align-top">
                  <td className="px-5 py-3">
                    <Link
                      to="/admin/contracts/$workspaceId"
                      params={{ workspaceId: w.id }}
                      className="font-semibold text-navy hover:text-brand"
                    >
                      {w.title}
                    </Link>
                  </td>
                  <td className="px-3 py-3">
                    <Badge tone={statusTones[w.status] ?? "slate"}>
                      {WORKSPACE_STATUS_LABELS[w.status as keyof typeof WORKSPACE_STATUS_LABELS] ?? w.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-3">
                    <span className="font-medium text-ink">{w.leadName ?? "—"}</span>
                    <p className="text-xs text-muted">{w.leadEmail}</p>
                  </td>
                  <td className="px-3 py-3 text-muted">
                    {w.clientNames.length > 0 ? w.clientNames.join(", ") : "—"}
                  </td>
                  <td className="px-3 py-3">
                    <span className="font-semibold text-navy">{w.participantCount}</span>
                    <span className="text-muted"> joined/verified</span>
                  </td>
                  <td className="px-3 py-3 text-muted">{w.packageCount}</td>
                  <td className="px-3 py-3 text-muted">{w.industry ?? "—"}</td>
                  <td className="px-3 py-3 text-muted">{w.location ?? "—"}</td>
                  <td className="px-3 py-3 text-muted">
                    {w.contractValue !== null ? `AED ${w.contractValue.toLocaleString()}` : "—"}
                  </td>
                  <td className="px-5 py-3 text-xs text-muted">{fmtDate(w.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
