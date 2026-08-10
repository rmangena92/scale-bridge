import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import { getAdminSession, listAuditLog } from "~/lib/admin";
import type { AdminAuditLogRow } from "~/lib/types";
import {
  Button,
  Card,
  DbSetupPage,
  EmptyState,
  ErrorText,
  Field,
  Input,
  Select,
} from "~/components/ui";

export const Route = createFileRoute("/admin/audit-log")({
  loader: async () => {
    const session = await getAdminSession();
    const result = await listAuditLog({ data: { actor: "", action: "", workspace: "", from: "", to: "", page: 1, pageSize: 25 } });
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      initial: result.ok ? result : null,
      loadError: result.ok ? null : result.error,
    };
  },
  component: AuditLogPage,
});

function AuditLogPage() {
  const loader = Route.useLoaderData();
  const [entries, setEntries] = useState<AdminAuditLogRow[]>(loader.initial?.entries ?? []);
  const [total, setTotal] = useState(loader.initial?.total ?? 0);
  const [page, setPage] = useState(1);
  const [actions, setActions] = useState<string[]>(loader.initial?.actions ?? []);
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(loader.loadError);
  const [pending, setPending] = useState(false);
  const pageSize = 25;

  if (loader.setupRequired) {
    return (
      <DbSetupPage title="Audit log">
        Connect a Postgres database (DATABASE_URL) to view the audit log.
      </DbSetupPage>
    );
  }
  if (!loader.admin) return null;

  async function search(pageNum: number, e?: FormEvent) {
    if (e) e.preventDefault();
    setPending(true);
    setError(null);
    const result = await listAuditLog({ data: { actor, action, workspace, from, to, page: pageNum, pageSize } });
    setPending(false);
    if (result.ok) {
      setEntries(result.entries);
      setTotal(result.total);
      setPage(result.page);
      setActions(result.actions);
    } else {
      setError(result.error);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">Audit Log</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Platform audit log</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Every administrative decision and platform event, recorded immutably. Filter by actor,
          action type, workspace or date range.
        </p>
      </div>

      <Card className="p-5">
        <form onSubmit={(e) => search(1, e)} className="flex flex-wrap items-end gap-3">
          <div className="w-52">
            <Field label="Actor" htmlFor="al-actor">
              <Input id="al-actor" value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Email…" />
            </Field>
          </div>
          <div className="w-56">
            <Field label="Action type" htmlFor="al-action">
              <Select id="al-action" value={action} onChange={(e) => setAction(e.target.value)}>
                <option value="">All actions</option>
                {actions.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="w-52">
            <Field label="Workspace" htmlFor="al-workspace">
              <Input id="al-workspace" value={workspace} onChange={(e) => setWorkspace(e.target.value)} placeholder="Contract title…" />
            </Field>
          </div>
          <div className="w-40">
            <Field label="From" htmlFor="al-from">
              <Input id="al-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
          </div>
          <div className="w-40">
            <Field label="To" htmlFor="al-to">
              <Input id="al-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
          <Button type="submit" disabled={pending}>{pending ? "Searching…" : "Search"}</Button>
        </form>
      </Card>

      {error && <div className="mt-5"><ErrorText>{error}</ErrorText></div>}

      <Card className="mt-5 overflow-x-auto">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">
            {total} event{total === 1 ? "" : "s"} · page {page} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1 || pending} onClick={() => search(page - 1)}>← Prev</Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages || pending} onClick={() => search(page + 1)}>Next →</Button>
          </div>
        </div>
        {entries.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No audit events" body="Try adjusting the filters." />
          </div>
        ) : (
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">When</th>
                <th className="px-3 py-3">Action</th>
                <th className="px-3 py-3">Actor</th>
                <th className="px-3 py-3">Workspace</th>
                <th className="px-5 py-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((e) => (
                <tr key={e.id} className="align-top hover:bg-mist/60">
                  <td className="whitespace-nowrap px-5 py-3 text-xs text-muted">
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-3 font-mono text-xs font-semibold text-navy">{e.action}</td>
                  <td className="px-3 py-3 text-xs">{e.actorEmail ?? "system"}</td>
                  <td className="px-3 py-3 text-xs text-muted">{e.workspaceTitle ?? "—"}</td>
                  <td className="max-w-md px-5 py-3">
                    {e.details ? (
                      <code className="break-all text-xs text-muted">{JSON.stringify(e.details)}</code>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
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
