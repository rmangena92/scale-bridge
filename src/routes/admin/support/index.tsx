import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import {
  getAdminSession,
  listSupportCases,
  createSupportCase,
  listAdminUsers,
} from "~/lib/admin";
import {
  SUPPORT_CASE_PRIORITIES,
  SUPPORT_CASE_PRIORITY_LABELS,
  SUPPORT_CASE_PRIORITY_TONES,
  SUPPORT_CASE_STATUSES,
  SUPPORT_CASE_STATUS_LABELS,
  SUPPORT_CASE_BADGE_TONES,
} from "~/lib/types";
import type { AdminSupportCaseSummary } from "~/lib/types";
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

export const Route = createFileRoute("/admin/support/")({
  loader: async () => {
    const session = await getAdminSession();
    const result = await listSupportCases({ data: { status: "", priority: "" } });
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      initial: result.ok ? result.cases : [],
      loadError: result.ok ? null : result.error,
    };
  },
  component: SupportCasesPage,
});

function SupportCasesPage() {
  const loader = Route.useLoaderData();
  const navigate = useNavigate();
  const [cases, setCases] = useState<AdminSupportCaseSummary[]>(loader.initial);
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [error, setError] = useState<string | null>(loader.loadError);
  const [pending, setPending] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  // create form state
  const [reporterEmail, setReporterEmail] = useState("");
  const [category, setCategory] = useState("general");
  const [description, setDescription] = useState("");
  const [createPriority, setCreatePriority] = useState("medium");
  const [creating, setCreating] = useState(false);

  if (loader.setupRequired) {
    return (
      <DbSetupPage title="Support cases">
        Connect a Postgres database (DATABASE_URL) to manage support cases.
      </DbSetupPage>
    );
  }
  if (!loader.admin) return null;
  const canMutate = loader.admin.canMutate;

  async function onSearch() {
    setPending(true);
    setError(null);
    const result = await listSupportCases({ data: { status, priority } });
    setPending(false);
    if (result.ok) setCases(result.cases);
    else setError(result.error);
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    // Resolve the reporter to a user id by email.
    const users = await listAdminUsers({ data: { query: reporterEmail, status: "", role: "" } });
    const user = users.ok ? users.users.find((u) => u.email.toLowerCase() === reporterEmail.trim().toLowerCase()) : undefined;
    if (!user) {
      setError("Reporter not found — enter an existing user email (e.g. admin.demo@scalebridge.test).");
      setCreating(false);
      return;
    }
    const result = await createSupportCase({
      data: {
        reporterUserId: user.id,
        category,
        description,
        priority: createPriority as never,
      },
    });
    setCreating(false);
    if (!result.ok) { setError(result.error ?? "Could not create the case."); return; }
    await navigate({ to: "/admin/support/$caseId", params: { caseId: result.caseId } });
  }

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">Support</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Support cases</h1>
            <p className="mt-2 max-w-xl text-sm text-muted">
              Tickets, user issues and disputes. Open a case to read the thread, communicate with
              the reporter and record internal notes.
            </p>
          </div>
          <Button disabled={!canMutate} onClick={() => setShowCreate((s) => !s)}>
            {showCreate ? "Close form" : "+ New case"}
          </Button>
        </div>
      </div>

      {showCreate && (
        <Card className="mb-5 p-5">
          <p className="text-sm font-bold uppercase tracking-widest text-teal">Create a support case</p>
          <form onSubmit={onCreate} className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <Field label="Reporter (existing user email)" htmlFor="sc-reporter">
                <Input id="sc-reporter" value={reporterEmail} onChange={(e) => setReporterEmail(e.target.value)} placeholder="admin.demo@scalebridge.test" required />
              </Field>
            </div>
            <div>
              <Field label="Issue category" htmlFor="sc-category">
                <Select id="sc-category" value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="general">General</option>
                  <option value="verification">Verification</option>
                  <option value="contract">Contract</option>
                  <option value="billing">Billing</option>
                  <option value="dispute">Dispute</option>
                  <option value="technical">Technical</option>
                </Select>
              </Field>
            </div>
            <div>
              <Field label="Priority" htmlFor="sc-priority">
                <Select id="sc-priority" value={createPriority} onChange={(e) => setCreatePriority(e.target.value)}>
                  {SUPPORT_CASE_PRIORITIES.map((p) => (
                    <option key={p} value={p}>{SUPPORT_CASE_PRIORITY_LABELS[p]}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Description" htmlFor="sc-desc">
                <Textarea id="sc-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is the issue?" required />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={creating}>{creating ? "Creating…" : "Create case"}</Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48">
            <Field label="Status" htmlFor="sc-status">
              <Select id="sc-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All statuses</option>
                {SUPPORT_CASE_STATUSES.map((s) => (
                  <option key={s} value={s}>{SUPPORT_CASE_STATUS_LABELS[s]}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="w-40">
            <Field label="Priority" htmlFor="sc-priority-filter">
              <Select id="sc-priority-filter" value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="">All priorities</option>
                {SUPPORT_CASE_PRIORITIES.map((p) => (
                  <option key={p} value={p}>{SUPPORT_CASE_PRIORITY_LABELS[p]}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Button onClick={onSearch} disabled={pending}>{pending ? "Loading…" : "Apply filters"}</Button>
        </div>
      </Card>

      {error && <div className="mt-5"><ErrorText>{error}</ErrorText></div>}

      <Card className="mt-5 overflow-x-auto">
        {cases.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No support cases" body="Create a case or adjust the filters." />
          </div>
        ) : (
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">Case</th>
                <th className="px-3 py-3">Category</th>
                <th className="px-3 py-3">Priority</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Reporter</th>
                <th className="px-3 py-3">Company</th>
                <th className="px-3 py-3">Assignee</th>
                <th className="px-5 py-3">Opened</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cases.map((c) => (
                <tr key={c.id} className="hover:bg-mist/60">
                  <td className="px-5 py-3">
                    <Link
                      to="/admin/support/$caseId"
                      params={{ caseId: c.id }}
                      className="font-semibold text-navy hover:text-brand"
                    >
                      {c.caseNumber}
                    </Link>
                    {c.description && <p className="max-w-64 truncate text-xs text-muted">{c.description}</p>}
                  </td>
                  <td className="px-3 py-3 text-muted">{c.category}</td>
                  <td className="px-3 py-3">
                    <Badge tone={SUPPORT_CASE_PRIORITY_TONES[c.priority]}>{SUPPORT_CASE_PRIORITY_LABELS[c.priority]}</Badge>
                  </td>
                  <td className="px-3 py-3">
                    <Badge tone={SUPPORT_CASE_BADGE_TONES[c.status]}>{SUPPORT_CASE_STATUS_LABELS[c.status]}</Badge>
                  </td>
                  <td className="px-3 py-3 text-muted">{c.reporterName ?? c.reporterEmail}</td>
                  <td className="px-3 py-3 text-muted">{c.companyName ?? "—"}</td>
                  <td className="px-3 py-3 text-muted">{c.assigneeEmail ?? "—"}</td>
                  <td className="px-5 py-3 text-xs text-muted">{new Date(c.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
