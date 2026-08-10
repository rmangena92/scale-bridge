import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  getAdminSession,
  getAdminContract,
  setAdminContractStatus,
  assignAdminContractSupport,
  addAdminContractNote,
  listAdminStaff,
} from "~/lib/admin";
import {
  INVITATION_STATUS_LABELS,
  INVITATION_BADGE_TONES,
  PARTICIPANT_ROLE_LABELS,
  WORK_PACKAGE_STATUS_LABELS,
  WORKSPACE_STATUS_LABELS,
  WORKSPACE_BADGE_TONES,
} from "~/lib/types";
import type { AdminContractDetail } from "~/lib/types";
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

export const Route = createFileRoute("/admin/contracts/$workspaceId")({
  loader: async ({ params }) => {
    const session = await getAdminSession();
    const result = await getAdminContract({ data: { workspaceId: params.workspaceId } });
    const staff = await listAdminStaff();
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      initial: result.ok ? result.detail : null,
      staff: staff.ok ? staff.staff : [],
      loadError: result.ok ? null : result.error,
    };
  },
  component: ContractDetailPage,
});

function fmtValue(v: number | null): string {
  return v === null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(v);
}

function ContractDetailPage() {
  const loader = Route.useLoaderData();
  const [detail, setDetail] = useState<AdminContractDetail | null>(loader.initial);
  const [staff] = useState(loader.staff);
  const [error, setError] = useState<string | null>(loader.loadError);
  const [note, setNote] = useState("");
  const [assignee, setAssignee] = useState(loader.initial?.supportAssignee?.userId ?? "");
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  if (loader.setupRequired) {
    return (
      <DbSetupPage title="Contract detail">
        Connect a Postgres database (DATABASE_URL) to view contracts.
      </DbSetupPage>
    );
  }
  if (!loader.admin) return null;
  if (!detail) {
    return (
      <div>
        <ErrorText>{error ?? "Could not load this contract."}</ErrorText>
        <Link to="/admin/contracts" className="mt-4 inline-block text-sm font-semibold text-brand hover:underline">← Back to contracts</Link>
      </div>
    );
  }

  const canMutate = loader.admin.canMutate;
  const ws = detail.workspace;

  async function refresh() {
    const fresh = await getAdminContract({ data: { workspaceId: ws.id } });
    if (fresh.ok) setDetail(fresh.detail);
    else setError(fresh.error ?? "Could not refresh the contract.");
  }

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, key: string) {
    setPendingAction(key);
    setError(null);
    const result = await fn();
    setPendingAction(null);
    if (!result.ok) { setError(result.error ?? "Action failed."); return; }
    await refresh();
  }

  const setStatus = (action: "suspend" | "archive" | "activate" | "complete") =>
    run(() => setAdminContractStatus({ data: { workspaceId: ws.id, action } }), `status:${action}`);

  return (
    <div>
      <div className="mb-6">
        <Link to="/admin/contracts" className="text-sm font-semibold text-brand hover:underline">← Contracts</Link>
        <p className="mt-3 text-sm font-bold uppercase tracking-widest text-teal">Contract administration</p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold sm:text-3xl">{ws.title}</h1>
          <Badge tone={WORKSPACE_BADGE_TONES[ws.status]}>{WORKSPACE_STATUS_LABELS[ws.status]}</Badge>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          {ws.description ?? "No description."}
          {ws.industry ? ` · ${ws.industry}` : ""}
          {ws.location ? ` · ${ws.location}` : ""}
          {ws.contractValue ? ` · ${fmtValue(ws.contractValue)}` : ""}
        </p>
      </div>

      {error && <div className="mb-5"><ErrorText>{error}</ErrorText></div>}

      {!canMutate && (
        <div className="mb-5"><Badge tone="amber">Read-only — you can view this contract but not modify records.</Badge></div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Overview */}
        <Card className="p-5 lg:col-span-2">
          <p className="text-sm font-bold uppercase tracking-widest text-teal">Overview</p>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <div><dt className="text-xs font-semibold uppercase text-muted">Status</dt><dd className="mt-0.5 font-semibold text-ink">{WORKSPACE_STATUS_LABELS[ws.status]}</dd></div>
            <div><dt className="text-xs font-semibold uppercase text-muted">Value</dt><dd className="mt-0.5 font-semibold text-ink">{fmtValue(ws.contractValue)}</dd></div>
            <div><dt className="text-xs font-semibold uppercase text-muted">Industry</dt><dd className="mt-0.5 text-ink">{ws.industry ?? "—"}</dd></div>
            <div><dt className="text-xs font-semibold uppercase text-muted">Location</dt><dd className="mt-0.5 text-ink">{ws.location ?? "—"}</dd></div>
            <div><dt className="text-xs font-semibold uppercase text-muted">Created</dt><dd className="mt-0.5 text-ink">{new Date(ws.createdAt).toLocaleDateString()}</dd></div>
            <div><dt className="text-xs font-semibold uppercase text-muted">Last updated</dt><dd className="mt-0.5 text-ink">{new Date(ws.updatedAt).toLocaleDateString()}</dd></div>
          </dl>

          <div className="mt-5 border-t border-slate-100 pt-4">
            <p className="text-xs font-bold uppercase tracking-wider text-muted">Lead contractor</p>
            <p className="mt-1 text-sm font-semibold text-ink">{detail.lead.name ?? detail.lead.email}</p>
            <p className="text-xs text-muted">{detail.lead.email}{detail.lead.companyName ? ` · ${detail.lead.companyName}` : ""}</p>
          </div>

          <div className="mt-4 border-t border-slate-100 pt-4">
            <p className="text-xs font-bold uppercase tracking-wider text-muted">Client organisations</p>
            {detail.clients.length === 0 ? (
              <p className="mt-1 text-sm text-muted">No client linked yet.</p>
            ) : (
              detail.clients.map((cl) => (
                <p key={cl.orgId} className="mt-1 text-sm text-ink">{cl.name}{cl.contactEmail ? ` · ${cl.contactEmail}` : ""}</p>
              ))
            )}
          </div>
        </Card>

        {/* Admin actions */}
        <Card className="p-5">
          <p className="text-sm font-bold uppercase tracking-widest text-teal">Admin actions</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {ws.status === "suspended" ? (
              <Button size="sm" disabled={!canMutate || pendingAction !== null} onClick={() => setStatus("activate")}>Reactivate</Button>
            ) : (
              <ConfirmButton label="Suspend contract" confirmLabel="Confirm suspension?" disabled={!canMutate || pendingAction !== null} onConfirm={() => setStatus("suspend")} />
            )}
            {ws.status !== "archived" && (
              <ConfirmButton label="Archive contract" confirmLabel="Confirm archive?" disabled={!canMutate || pendingAction !== null} onConfirm={() => setStatus("archive")} />
            )}
            {ws.status === "active" && (
              <Button size="sm" variant="outline" disabled={!canMutate || pendingAction !== null} onClick={() => setStatus("complete")}>Mark completed</Button>
            )}
          </div>

          <div className="mt-5 border-t border-slate-100 pt-4">
            <Field label="Internal support staff" htmlFor="ct-assignee">
              <Select
                id="ct-assignee"
                value={assignee}
                disabled={!canMutate}
                onChange={(e) => setAssignee(e.target.value)}
              >
                <option value="">Unassigned</option>
                {staff.map((s) => (
                  <option key={s.userId} value={s.userId}>{s.name ?? s.email} ({s.roles.join(", ")})</option>
                ))}
              </Select>
            </Field>
            <Button
              className="mt-3"
              size="sm"
              disabled={!canMutate || assignee === (detail.supportAssignee?.userId ?? "")}
              onClick={async () => {
                const result = await assignAdminContractSupport({ data: { workspaceId: ws.id, staffUserId: assignee || null } });
                if (!result.ok) { setError(result.error ?? "Could not assign support staff."); return; }
                await refresh();
              }}
            >
              Assign support staff
            </Button>
            {detail.supportAssignee && (
              <p className="mt-2 text-xs text-muted">
                Assigned: <span className="font-semibold text-ink">{detail.supportAssignee.name ?? detail.supportAssignee.email}</span>
              </p>
            )}
          </div>
        </Card>
      </div>

      {/* Work packages + participants */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card className="overflow-x-auto">
          <div className="border-b border-slate-200 px-5 py-4">
            <p className="text-sm font-bold uppercase tracking-widest text-teal">Work packages</p>
          </div>
          {detail.packages.length === 0 ? (
            <div className="p-5"><EmptyState title="No work packages" body="The lead contractor has not defined work packages yet." /></div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                  <th className="px-5 py-2.5">Package</th>
                  <th className="px-3 py-2.5">Category</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-5 py-2.5">Completion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detail.packages.map((p) => (
                  <tr key={p.id}>
                    <td className="px-5 py-2.5 font-semibold text-navy">{p.name}</td>
                    <td className="px-3 py-2.5 text-muted">{p.category ?? "—"}</td>
                    <td className="px-3 py-2.5"><Badge tone="slate">{WORK_PACKAGE_STATUS_LABELS[p.status]}</Badge></td>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-200">
                          <div className="h-full rounded-full bg-teal" style={{ width: `${p.completion}%` }} />
                        </div>
                        <span className="text-xs text-muted">{p.completion}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="overflow-x-auto">
          <div className="border-b border-slate-200 px-5 py-4">
            <p className="text-sm font-bold uppercase tracking-widest text-teal">Participating companies</p>
          </div>
          {detail.participants.length === 0 ? (
            <div className="p-5"><EmptyState title="No participants yet" body="Invitations will appear here." /></div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                  <th className="px-5 py-2.5">Company</th>
                  <th className="px-3 py-2.5">Role</th>
                  <th className="px-5 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detail.participants.map((i) => (
                  <tr key={i.invitationId}>
                    <td className="px-5 py-2.5">
                      <p className="font-semibold text-navy">{i.companyName ?? i.email}</p>
                      <p className="text-xs text-muted">{i.email}</p>
                    </td>
                    <td className="px-3 py-2.5 text-muted">{PARTICIPANT_ROLE_LABELS[i.participantRole]}</td>
                    <td className="px-5 py-2.5"><Badge tone={INVITATION_BADGE_TONES[i.status]}>{INVITATION_STATUS_LABELS[i.status]}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* Milestones / issues / invoices */}
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="p-5">
          <p className="text-sm font-bold uppercase tracking-widest text-teal">Milestones</p>
          {detail.milestones.length === 0 ? (
            <p className="mt-3 text-sm text-muted">None recorded.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {detail.milestones.slice(0, 8).map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-ink">{m.name}</span>
                  <Badge tone="slate">{m.status.replaceAll("_", " ")}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-5">
          <p className="text-sm font-bold uppercase tracking-widest text-teal">Issues</p>
          {detail.issues.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No issues recorded.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {detail.issues.slice(0, 8).map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-ink">{i.title}</span>
                  <Badge tone={i.status === "open" ? "amber" : i.status === "resolved" || i.status === "closed" ? "green" : "blue"}>
                    {i.severity ?? "—"} · {i.status.replaceAll("_", " ")}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-5">
          <p className="text-sm font-bold uppercase tracking-widest text-teal">Invoices</p>
          {detail.invoices.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No invoices recorded.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {detail.invoices.slice(0, 8).map((iv) => (
                <li key={iv.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-ink">{iv.invoiceNumber}</span>
                  <span className="text-xs text-muted">{fmtValue(iv.amount)} · {iv.status.replaceAll("_", " ")}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Documents */}
      <Card className="mt-5 overflow-x-auto">
        <div className="border-b border-slate-200 px-5 py-4">
          <p className="text-sm font-bold uppercase tracking-widest text-teal">Document activity</p>
        </div>
        {detail.documents.length === 0 ? (
          <div className="p-5"><EmptyState title="No documents" body="No documents have been uploaded to this workspace." /></div>
        ) : (
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-2.5">Document</th>
                <th className="px-3 py-2.5">Type</th>
                <th className="px-3 py-2.5">Company</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-5 py-2.5">Uploaded</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {detail.documents.map((d) => (
                <tr key={d.id}>
                  <td className="px-5 py-2.5 font-semibold text-navy">{d.name}</td>
                  <td className="px-3 py-2.5 text-muted">{d.category ?? "—"}</td>
                  <td className="px-3 py-2.5 text-muted">{d.companyName ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={d.reviewStatus === "approved" ? "green" : d.reviewStatus === "pending" ? "amber" : "red"}>
                      {d.reviewStatus.replaceAll("_", " ")}
                    </Badge>
                  </td>
                  <td className="px-5 py-2.5 text-xs text-muted">{new Date(d.uploadedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Internal notes + approval history */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <p className="text-sm font-bold uppercase tracking-widest text-teal">Internal notes</p>
          {detail.internalNotes.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2">
              {detail.internalNotes.map((n, i) => (
                <li key={i} className="rounded-lg bg-mist px-3 py-2 text-sm text-ink">{n}</li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex items-start gap-2">
            <div className="flex-1">
              <Field label="Add an internal note" htmlFor="ct-note">
                <Textarea id="ct-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Visible to ScaleBridge staff only…" />
              </Field>
            </div>
            <Button
              className="mt-7"
              disabled={!canMutate || !note.trim()}
              onClick={async () => {
                const result = await addAdminContractNote({ data: { workspaceId: ws.id, note } });
                if (!result.ok) { setError(result.error ?? "Could not save the note."); return; }
                setNote("");
                await refresh();
              }}
            >
              Add note
            </Button>
          </div>
        </Card>

        <Card className="overflow-x-auto">
          <div className="border-b border-slate-200 px-5 py-4">
            <p className="text-sm font-bold uppercase tracking-widest text-teal">Approval history</p>
          </div>
          {detail.audit.length === 0 ? (
            <div className="p-5"><EmptyState title="No audit events" body="Workspace activity will appear here." /></div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                  <th className="px-5 py-2.5">When</th>
                  <th className="px-3 py-2.5">Action</th>
                  <th className="px-5 py-2.5">Actor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detail.audit.slice(0, 12).map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap px-5 py-2.5 text-xs text-muted">{new Date(a.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-navy">{a.action}</td>
                    <td className="px-5 py-2.5 text-xs">{a.actorEmail ?? "system"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
