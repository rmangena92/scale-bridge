import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  getAdminSession,
  getSupportCase,
  updateSupportCase,
  addSupportCaseMessage,
  closeSupportCase,
  listAdminStaff,
} from "~/lib/admin";
import {
  SUPPORT_CASE_PRIORITIES,
  SUPPORT_CASE_PRIORITY_LABELS,
  SUPPORT_CASE_PRIORITY_TONES,
  SUPPORT_CASE_STATUSES,
  SUPPORT_CASE_STATUS_LABELS,
  SUPPORT_CASE_BADGE_TONES,
} from "~/lib/types";
import type { AdminSupportCaseDetail } from "~/lib/types";
import {
  Badge,
  Button,
  Card,
  DbSetupPage,
  EmptyState,
  ErrorText,
  Field,
  Select,
  Textarea,
} from "~/components/ui";

export const Route = createFileRoute("/admin/support/$caseId")({
  loader: async ({ params }) => {
    const session = await getAdminSession();
    const result = await getSupportCase({ data: { caseId: params.caseId } });
    const staff = await listAdminStaff();
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      initial: result.ok ? result.detail : null,
      staff: staff.ok ? staff.staff : [],
      loadError: result.ok ? null : result.error,
    };
  },
  component: SupportCaseDetailPage,
});

function SupportCaseDetailPage() {
  const loader = Route.useLoaderData();
  const [detail, setDetail] = useState<AdminSupportCaseDetail | null>(loader.initial);
  const [staff] = useState(loader.staff);
  const [error, setError] = useState<string | null>(loader.loadError);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [resolution, setResolution] = useState("");
  const [statusSel, setStatusSel] = useState<string>(loader.initial?.status ?? "new");
  const [prioritySel, setPrioritySel] = useState<string>(loader.initial?.priority ?? "medium");
  const [assigneeSel, setAssigneeSel] = useState(loader.initial?.assignee?.userId ?? "");
  const [pending, setPending] = useState(false);

  if (loader.setupRequired) {
    return (
      <DbSetupPage title="Support case">
        Connect a Postgres database (DATABASE_URL) to view support cases.
      </DbSetupPage>
    );
  }
  if (!loader.admin) return null;
  if (!detail) {
    return (
      <div>
        <ErrorText>{error ?? "Could not load this support case."}</ErrorText>
        <Link to="/admin/support" className="mt-4 inline-block text-sm font-semibold text-brand hover:underline">← Back to support cases</Link>
      </div>
    );
  }

  const d = detail;
  const canMutate = loader.admin.canMutate;
  const closed = d.status === "closed";

  async function refresh() {
    const fresh = await getSupportCase({ data: { caseId: d.id } });
    if (fresh.ok) {
      setDetail(fresh.detail);
      setStatusSel(fresh.detail.status);
      setPrioritySel(fresh.detail.priority);
      setAssigneeSel(fresh.detail.assignee?.userId ?? "");
    } else {
      setError(fresh.error ?? "Could not refresh the case.");
    }
  }

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, success?: () => void) {
    setPending(true);
    setError(null);
    const result = await fn();
    setPending(false);
    if (!result.ok) { setError(result.error ?? "Action failed."); return; }
    if (success) success();
    await refresh();
  }

  return (
    <div>
      <div className="mb-6">
        <Link to="/admin/support" className="text-sm font-semibold text-brand hover:underline">← Support cases</Link>
        <p className="mt-3 text-sm font-bold uppercase tracking-widest text-teal">Support case</p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold sm:text-3xl">{detail.caseNumber}</h1>
          <Badge tone={SUPPORT_CASE_PRIORITY_TONES[detail.priority]}>{SUPPORT_CASE_PRIORITY_LABELS[detail.priority]}</Badge>
          <Badge tone={SUPPORT_CASE_BADGE_TONES[detail.status]}>{SUPPORT_CASE_STATUS_LABELS[detail.status]}</Badge>
          {closed && detail.closedAt && (
            <span className="text-xs text-muted">Closed {new Date(detail.closedAt).toLocaleString()}</span>
          )}
        </div>
      </div>

      {error && <div className="mb-5"><ErrorText>{error}</ErrorText></div>}

      {!canMutate && (
        <div className="mb-5"><Badge tone="amber">Read-only — you can view this case but not update it.</Badge></div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Case fields */}
        <Card className="p-5 lg:col-span-2">
          <p className="text-sm font-bold uppercase tracking-widest text-teal">Case details</p>
          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs font-semibold uppercase text-muted">Reporter</dt><dd className="mt-0.5 font-medium text-ink">{detail.reporter.name ?? detail.reporter.email} <span className="text-xs text-muted">({detail.reporter.email})</span></dd></div>
            <div><dt className="text-xs font-semibold uppercase text-muted">Category</dt><dd className="mt-0.5 font-medium text-ink">{detail.category}</dd></div>
            <div><dt className="text-xs font-semibold uppercase text-muted">Company</dt><dd className="mt-0.5 font-medium text-ink">{detail.company ? detail.company.name : "—"}</dd></div>
            <div><dt className="text-xs font-semibold uppercase text-muted">Contract</dt><dd className="mt-0.5 font-medium text-ink">{detail.workspace ? detail.workspace.title : "—"}</dd></div>
            <div><dt className="text-xs font-semibold uppercase text-muted">Assignee</dt><dd className="mt-0.5 font-medium text-ink">{detail.assignee ? detail.assignee.name ?? detail.assignee.email : "Unassigned"}</dd></div>
            <div><dt className="text-xs font-semibold uppercase text-muted">Opened</dt><dd className="mt-0.5 font-medium text-ink">{new Date(detail.createdAt).toLocaleString()}</dd></div>
          </dl>
          {detail.description && (
            <div className="mt-4 rounded-xl bg-mist px-4 py-3 text-sm text-ink">
              <p className="text-xs font-bold uppercase tracking-wider text-muted">Description</p>
              <p className="mt-1 whitespace-pre-wrap">{detail.description}</p>
            </div>
          )}
          {detail.attachments.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-bold uppercase tracking-wider text-muted">Attachments</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {detail.attachments.map((a, i) => (
                  <Badge key={i} tone="slate">{a.name}</Badge>
                ))}
              </div>
            </div>
          )}
          {detail.resolution && (
            <div className="mt-4 rounded-xl bg-success/10 px-4 py-3 text-sm text-ink">
              <p className="text-xs font-bold uppercase tracking-wider text-success">Resolution</p>
              <p className="mt-1 whitespace-pre-wrap">{detail.resolution}</p>
            </div>
          )}
        </Card>

        {/* Admin controls */}
        <Card className="p-5">
          <p className="text-sm font-bold uppercase tracking-widest text-teal">Case management</p>
          <div className="mt-4 flex flex-col gap-4">
            <Field label="Status" htmlFor="scd-status">
              <Select id="scd-status" value={statusSel} disabled={!canMutate || closed} onChange={(e) => setStatusSel(e.target.value)}>
                {SUPPORT_CASE_STATUSES.filter((s) => s !== "closed").map((s) => (
                  <option key={s} value={s}>{SUPPORT_CASE_STATUS_LABELS[s]}</option>
                ))}
              </Select>
            </Field>
            <Field label="Priority" htmlFor="scd-priority">
              <Select id="scd-priority" value={prioritySel} disabled={!canMutate || closed} onChange={(e) => setPrioritySel(e.target.value)}>
                {SUPPORT_CASE_PRIORITIES.map((p) => (
                  <option key={p} value={p}>{SUPPORT_CASE_PRIORITY_LABELS[p]}</option>
                ))}
              </Select>
            </Field>
            <Field label="Assignee (staff)" htmlFor="scd-assignee">
              <Select id="scd-assignee" value={assigneeSel} disabled={!canMutate || closed} onChange={(e) => setAssigneeSel(e.target.value)}>
                <option value="">Unassigned</option>
                {staff.map((s) => (
                  <option key={s.userId} value={s.userId}>{s.name ?? s.email} ({s.roles.join(", ")})</option>
                ))}
              </Select>
            </Field>
            <Button
              disabled={!canMutate || closed || pending}
              onClick={() => run(() => updateSupportCase({ data: { caseId: detail.id, status: statusSel as never, priority: prioritySel as never, assigneeUserId: assigneeSel || null } }))}
            >
              Save changes
            </Button>
            <div className="border-t border-slate-100 pt-4">
              <Field label="Resolution (required to close)" htmlFor="scd-resolution">
                <Textarea id="scd-resolution" value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="How was this resolved?" />
              </Field>
              <Button
                className="mt-3"
                variant="outline"
                disabled={!canMutate || closed || pending || !resolution.trim()}
                onClick={() => run(() => closeSupportCase({ data: { caseId: detail.id, resolution } }))}
              >
                Close case
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* Message thread */}
      <Card className="mt-5">
        <div className="border-b border-slate-200 px-5 py-4">
          <p className="text-sm font-bold uppercase tracking-widest text-teal">Communication history</p>
          <p className="mt-1 text-xs text-muted">
            External messages are visible to the reporter; internal notes are visible to ScaleBridge staff only.
          </p>
        </div>
        {detail.messages.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No messages yet" body="Add the first message below." />
          </div>
        ) : (
          <ul className="flex flex-col gap-3 px-5 py-4">
            {detail.messages.map((m) => (
              <li
                key={m.id}
                className={`max-w-2xl rounded-xl border px-4 py-3 text-sm ${m.internal ? "border-amber/40 bg-amber/10" : "border-slate-200 bg-white"}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-navy">{m.authorName ?? m.authorEmail}</span>
                  <span className="text-xs text-muted">{new Date(m.createdAt).toLocaleString()}</span>
                  {m.internal && <Badge tone="amber">Internal note</Badge>}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-ink">{m.body}</p>
              </li>
            ))}
          </ul>
        )}
        {!closed && (
          <div className="border-t border-slate-200 p-5">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm font-semibold text-ink">
                <input
                  type="checkbox"
                  checked={internal}
                  disabled={!canMutate}
                  onChange={(e) => setInternal(e.target.checked)}
                  className="size-4 accent-[#1769AA]"
                />
                Internal note (staff only)
              </label>
            </div>
            <div className="mt-3 flex items-start gap-2">
              <div className="flex-1">
                <Field label="Message" htmlFor="scd-body">
                  <Textarea id="scd-body" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Type a message…" />
                </Field>
              </div>
              <Button
                className="mt-7"
                disabled={!canMutate || !body.trim() || pending}
                onClick={() =>
                  run(
                    () => addSupportCaseMessage({ data: { caseId: detail.id, body, internal } }),
                    () => setBody(""),
                  )
                }
              >
                Send
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
