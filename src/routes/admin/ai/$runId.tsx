import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  AI_CONTROL_MUTATE_ROLES,
  AI_RUN_STATUS_LABELS,
  getAdminAiRunDetail,
  getAdminSession,
  rerunAiAnalysis,
  retryAiRun,
} from "~/lib/admin";
import { Badge, Button, Card, DbSetupPage, ErrorText, EmptyState } from "~/components/ui";

export const Route = createFileRoute("/admin/ai/$runId")({
  loader: async ({ params }) => {
    const session = await getAdminSession();
    const result = await getAdminAiRunDetail({ data: { runId: params.runId } });
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      result: result as Awaited<ReturnType<typeof getAdminAiRunDetail>>,
    };
  },
  component: AiRunDetailPage,
});

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "-"
    : d.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function statusTone(s: string): "green" | "red" | "amber" | "slate" | "blue" | "teal" | "navy" {
  if (s === "completed") return "green";
  if (s === "failed") return "red";
  if (s === "running") return "blue";
  if (s === "queued") return "amber";
  return "slate";
}

function confidenceTone(c: string): "green" | "amber" | "red" | "slate" {
  if (c === "High") return "green";
  if (c === "Medium") return "amber";
  if (c === "Low") return "red";
  return "slate";
}

function JsonValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-muted">null</span>;
  if (typeof value === "object") {
    return (
      <pre className="max-h-64 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-ink">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  return <span className="text-ink">{String(value)}</span>;
}

function AiRunDetailPage() {
  const loader = Route.useLoaderData();
  const [rerunning, setRerunning] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string; newRunId?: string } | null>(null);
  const result = useMemo(() => loader.result, [loader.result]);
  const run = result.ok ? result.run : null;

  const canMutate =
    !!loader.admin?.canMutate &&
    (loader.admin.staffRoles ?? []).some((r) =>
      (AI_CONTROL_MUTATE_ROLES as readonly string[]).includes(r as never),
    );

  if (loader.setupRequired) {
    return (
      <DbSetupPage title="AI Run">
        Connect a Postgres database (DATABASE_URL) to view this AI run.
      </DbSetupPage>
    );
  }
  if (!loader.admin) return null;
  if (!result.ok) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mb-4">
          <Link to="/admin/ai" className="text-sm font-medium text-blue hover:underline">
            &larr; Back to AI Controls
          </Link>
        </div>
        <Card>
          <ErrorText>{result.error}</ErrorText>
        </Card>
      </div>
    );
  }
  if (!run) return null;

  const doRerun = async () => {
    if (!window.confirm(
      "Re-run the AI Service Intelligence agent for this company now? A new run will be queued " +
        "(trigger: manual_re-run), executed immediately and audited immutably.",
    )) return;
    setRerunning(true);
    setFeedback(null);
    try {
      const r = await rerunAiAnalysis({ data: { runId: run.id } });
      if (r.ok) {
        setFeedback({ ok: true, text: r.message, newRunId: r.id });
        setTimeout(() => window.location.reload(), 1200);
      } else {
        setFeedback({ ok: false, text: r.error });
      }
    } catch (e) {
      setFeedback({ ok: false, text: e instanceof Error ? e.message : "Could not re-run the analysis." });
    } finally {
      setRerunning(false);
    }
  };

  const doRetry = async () => {
    if (!window.confirm(
      "Retry this failed AI run? A new run will be queued (trigger: retry), executed immediately " +
        "and audited immutably. Retries respect the engine limits.",
    )) return;
    setRetrying(true);
    setFeedback(null);
    try {
      const r = await retryAiRun({ data: { runId: run.id } });
      if (r.ok) {
        setFeedback({ ok: true, text: r.message, newRunId: r.id });
        setTimeout(() => window.location.reload(), 1200);
      } else {
        setFeedback({ ok: false, text: r.error });
      }
    } catch (e) {
      setFeedback({ ok: false, text: e instanceof Error ? e.message : "Could not retry the run." });
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link to="/admin/ai" className="text-sm font-medium text-blue hover:underline">
          &larr; Back to AI Controls
        </Link>
        <div className="flex items-center gap-3">
          {canMutate && run.status === "failed" && (
            <Button variant="outline" size="sm" onClick={doRetry} disabled={retrying}>
              {retrying ? "Retrying…" : "Retry"}
            </Button>
          )}
          {canMutate && (
            <Button variant="primary" size="sm" onClick={doRerun} disabled={rerunning}>
              {rerunning ? "Re-running…" : "Re-run analysis"}
            </Button>
          )}
        </div>
      </div>

      {feedback && (
        <Card className={`mb-4 px-4 py-3 ${feedback.ok ? "" : ""}`}>
          {feedback.ok ? (
            <p className="text-sm font-medium text-success">
              {feedback.text}
              {feedback.newRunId ? (
                <>
                  {" "}
                  <Link
                    to="/admin/ai/$runId"
                    params={{ runId: feedback.newRunId }}
                    className="text-blue hover:underline"
                  >
                    View the new run
                  </Link>
                  .
                </>
              ) : null}
            </p>
          ) : (
            <ErrorText>{feedback.text}</ErrorText>
          )}
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-bold uppercase tracking-widest text-teal">AI Run</p>
            <Badge tone={statusTone(run.status)}>
              {AI_RUN_STATUS_LABELS[run.status] ?? run.status}
            </Badge>
            <span className="font-mono text-xs text-muted">{run.id}</span>
          </div>
          <h1 className="mt-2 text-2xl font-bold text-ink">
            {run.companyName ?? "Unknown company"}
          </h1>
          <p className="mt-1 text-sm text-muted">
            Trigger: <span className="font-medium text-ink">{run.trigger}</span> · Agent v
            {run.agentVersion} · Model {run.promptModel ?? "-"} · Created {formatDate(run.createdAt)}
          </p>
        </div>

        <div className="grid gap-px bg-slate-100 sm:grid-cols-2">
          <div className="bg-white px-5 py-4">
            <p className="text-xs font-bold uppercase tracking-widest text-muted">Started</p>
            <p className="mt-1 text-sm font-medium text-ink">{formatDate(run.startedAt)}</p>
          </div>
          <div className="bg-white px-5 py-4">
            <p className="text-xs font-bold uppercase tracking-widest text-muted">Finished</p>
            <p className="mt-1 text-sm font-medium text-ink">{formatDate(run.finishedAt)}</p>
          </div>
          <div className="bg-white px-5 py-4">
            <p className="text-xs font-bold uppercase tracking-widest text-muted">Duration</p>
            <p className="mt-1 text-sm font-medium text-ink">
              {run.durationSec !== null ? `${run.durationSec}s` : "-"}
            </p>
          </div>
          <div className="bg-white px-5 py-4">
            <p className="text-xs font-bold uppercase tracking-widest text-muted">Cost</p>
            <p className="mt-1 text-sm font-medium text-ink">
              {run.costUsd !== null ? (
                <>
                  {"$" + run.costUsd.toFixed(4)}
                  <span className="block text-xs text-muted">
                    {run.tokens !== null ? `${run.tokens.toLocaleString("en-GB")} tokens (estimated)` : ""}
                  </span>
                </>
              ) : (
                <span className="text-muted">Not tracked — no cost recorded for this run.</span>
              )}
            </p>
          </div>
        </div>

        <div className="border-t border-slate-100 px-5 py-4">
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted">Run metadata (outputs)</h2>
          <div className="mt-3">
            <JsonValue value={run.runMetadata} />
          </div>
        </div>

        {run.error && (
          <div className="border-t border-slate-100 px-5 py-4">
            <h2 className="text-sm font-bold uppercase tracking-widest text-danger">Error log</h2>
            <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-danger/5 p-3 text-xs text-danger">
              {run.error}
            </pre>
          </div>
        )}
      </Card>

      <Card className="mt-6 overflow-hidden p-0">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-bold text-ink">Recommendations from this run</h2>
        </div>
        {result.recommendations.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="No recommendations"
              body="This run did not record recommendations. Runs may complete without recommendations when no evidence-backed match cleared the threshold."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3">Service</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Confidence</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.recommendations.map((rec) => (
                  <tr key={rec.id} className="align-top hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-ink">{rec.serviceName ?? "-"}</td>
                    <td className="px-4 py-3 text-muted">{rec.recommendationType}</td>
                    <td className="px-4 py-3">
                      <Badge tone={confidenceTone(rec.confidence)}>{rec.confidence}</Badge>
                      <span className="ml-2 text-xs text-muted">{rec.confidenceScore}%</span>
                    </td>
                    <td className="px-4 py-3 text-muted">{rec.status}</td>
                    <td className="max-w-sm px-4 py-3 text-muted">{rec.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-6 overflow-hidden p-0">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-bold text-ink">Audit events for this run</h2>
        </div>
        {result.auditEvents.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No audit events" body="No audit events were recorded for this run." />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {result.auditEvents.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{e.action}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    <span className="font-medium capitalize">{e.actorType}</span>
                    {e.actorId ? ` · ${e.actorId}` : ""}
                    {e.entityType ? ` · ${e.entityType}` : ""}
                  </p>
                  {Object.keys(e.details).length > 0 && (
                    <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-slate-50 p-2 text-[11px] text-ink">
                      {JSON.stringify(e.details, null, 2)}
                    </pre>
                  )}
                </div>
                <span className="shrink-0 text-xs text-muted">{formatDate(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {!canMutate && (
        <p className="mt-4 text-xs text-muted">
          Read-only view. Manual re-runs and retries require an operations, compliance or super_admin
          staff role.
        </p>
      )}
    </div>
  );
}
