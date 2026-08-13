import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  AI_CONTROL_MUTATE_ROLES,
  AI_CONTROL_SETTING_FIELDS,
  AI_RUN_STATUS_LABELS,
  getAdminAiControlSettings,
  getAdminAiControls,
  getAdminSession,
  retryAiRun,
  setAiDataSourceEnabled,
  updateAdminAiControlSettings,
} from "~/lib/admin";
import type {
  AiAuditRow,
  AiControlSettingsRow,
  AiDataSourceRow,
  AiOptOutRow,
  AiRunListRow,
} from "~/lib/admin";
import { Badge, Button, Card, DbSetupPage, EmptyState, ErrorText } from "~/components/ui";

export const Route = createFileRoute("/admin/ai/")({
  loader: async () => {
    const session = await getAdminSession();
    const [result, settingsResult] = await Promise.all([
      getAdminAiControls(),
      getAdminAiControlSettings(),
    ]);
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      result: result as Awaited<ReturnType<typeof getAdminAiControls>>,
      settingsResult: settingsResult as Awaited<ReturnType<typeof getAdminAiControlSettings>>,
    };
  },
  component: AiControlsPage,
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

function toggleTone(v: boolean): "green" | "red" | "amber" | "slate" | "blue" | "teal" | "navy" {
  return v ? "green" : "red";
}

function DataSourcesCard({
  sources,
  canMutate,
}: {
  sources: AiDataSourceRow[];
  canMutate: boolean;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const toggle = async (s: AiDataSourceRow, enabled: boolean) => {
    if (!window.confirm(
      `${enabled ? "Enable" : "Disable"} "${s.name}" for the AI Service Intelligence agent? ` +
        (enabled
          ? "Companies with consent will be able to use this source again."
          : "The agent will treat this source as not granted even where companies have consented. The action is audited immutably."),
    )) return;
    setBusyId(s.id);
    setFeedback(null);
    try {
      const r = await setAiDataSourceEnabled({ data: { sourceId: s.id, enabled } });
      setFeedback(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      if (r.ok) window.location.reload();
    } catch (e) {
      setFeedback({ ok: false, text: e instanceof Error ? e.message : "Could not update the data source." });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-lg font-bold text-ink">Data sources</h2>
        <p className="mt-1 text-sm text-muted">
          Platform-level permission state for the sources the agent may read. Company-level consent is
          tracked per company — disabling a source here overrides consent everywhere.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Permission state</th>
              <th className="px-4 py-3">Consent</th>
              <th className="px-4 py-3">Last run</th>
              <th className="px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sources.map((s) => (
              <tr key={s.id} className="align-top hover:bg-slate-50">
                <td className="max-w-xs px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-ink">{s.name}</span>
                    {s.consentRequired && <Badge tone="amber">consent required</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-muted">{s.description}</p>
                  {s.sourceUrl ? (
                    <a
                      href={s.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block text-xs font-medium text-blue hover:underline"
                    >
                      {s.sourceUrl}
                    </a>
                  ) : null}
                  <span className="mt-1 block text-xs font-mono text-muted">{s.source}</span>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={toggleTone(s.enabled)}>{s.enabled ? "Enabled" : "Disabled"}</Badge>
                  <span className="mt-1 block text-xs text-muted">
                    {s.grantedCompanies} of {s.companiesWithRows} companies granted
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs font-medium text-ink">
                    {s.consentTracked} consent{s.consentTracked === 1 ? "" : "s"} tracked
                  </span>
                </td>
                <td className="px-4 py-3">
                  {s.lastRunAt ? (
                    <>
                      <Badge tone={statusTone(s.lastRunStatus ?? "")}>
                        {AI_RUN_STATUS_LABELS[s.lastRunStatus ?? ""] ?? s.lastRunStatus}
                      </Badge>
                      <span className="mt-1 block text-xs text-muted">{formatDate(s.lastRunAt)}</span>
                    </>
                  ) : (
                    <span className="text-xs text-muted">No runs yet</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Button
                    variant={s.enabled ? "outline" : "primary"}
                    size="sm"
                    disabled={!canMutate || busyId === s.id}
                    onClick={() => toggle(s, !s.enabled)}
                  >
                    {busyId === s.id ? "Saving…" : s.enabled ? "Disable" : "Enable"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-slate-100 px-5 py-3">
        <ErrorText>{feedback && !feedback.ok ? feedback.text : null}</ErrorText>
        <p className="text-xs text-muted">{feedback?.ok ? feedback.text : ""}</p>
      </div>
    </Card>
  );
}

function EngineLimitsCard({
  settings,
  canMutate,
}: {
  settings: AiControlSettingsRow;
  canMutate: boolean;
}) {
  const [draft, setDraft] = useState<AiControlSettingsRow>(settings);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const changed =
    draft.dailyRunCap !== settings.dailyRunCap ||
    draft.perCompanyDailyCap !== settings.perCompanyDailyCap ||
    draft.minIntervalSeconds !== settings.minIntervalSeconds ||
    draft.autoRunEnabled !== settings.autoRunEnabled;

  const save = async () => {
    if (!window.confirm(
      "Save the AI engine limit changes? The new values take effect immediately for every run " +
        "(including manual re-runs and retries) and are audited immutably.",
    )) return;
    setSaving(true);
    setFeedback(null);
    try {
      const r = await updateAdminAiControlSettings({
        data: {
          dailyRunCap: draft.dailyRunCap,
          perCompanyDailyCap: draft.perCompanyDailyCap,
          minIntervalSeconds: draft.minIntervalSeconds,
          autoRunEnabled: draft.autoRunEnabled,
        },
      });
      setFeedback(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      if (r.ok) setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      setFeedback({ ok: false, text: e instanceof Error ? e.message : "Could not save the engine limits." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-lg font-bold text-ink">Engine limits</h2>
        <p className="mt-1 text-sm text-muted">
          Rate limits and the automation switch enforced by the AI agent before any run starts —
          including manual re-runs and retries. Blocked runs are recorded with a clear &ldquo;rate
          limited&rdquo; error and audited immutably.
        </p>
      </div>
      <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
        {AI_CONTROL_SETTING_FIELDS.map((f) => (
          <div key={f.key}>
            <label className="text-sm font-semibold text-ink" htmlFor={`limit-${f.key}`}>
              {f.label}
            </label>
            <p className="text-xs text-muted">{f.description}</p>
            <div className="mt-2 flex items-center gap-2">
              <input
                id={`limit-${f.key}`}
                type="number"
                min={0}
                step={1}
                disabled={!canMutate || saving}
                value={draft[f.key]}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: Number(e.target.value) }))}
                className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm text-ink focus:border-blue focus:outline-none disabled:bg-slate-50 disabled:text-muted"
              />
              <span className="text-xs text-muted">{f.unit}</span>
            </div>
          </div>
        ))}
        <div>
          <span className="text-sm font-semibold text-ink">Automatic runs</span>
          <p className="text-xs text-muted">
            When off, only manual runs, re-runs and retries can start; profile, intake, document and
            contract triggers are blocked.
          </p>
          <label className="mt-2 inline-flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              disabled={!canMutate || saving}
              checked={draft.autoRunEnabled}
              onChange={(e) => setDraft((d) => ({ ...d, autoRunEnabled: e.target.checked }))}
              className="h-4 w-4 accent-teal"
            />
            <span className="text-sm text-ink">{draft.autoRunEnabled ? "Enabled" : "Disabled"}</span>
          </label>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3">
        <div className="min-w-0">
          <ErrorText>{feedback && !feedback.ok ? feedback.text : null}</ErrorText>
          <p className="text-xs text-success">{feedback?.ok ? feedback.text : ""}</p>
          {settings.updatedAt ? (
            <p className="text-xs text-muted">
              Last updated {formatDate(settings.updatedAt)}
              {settings.updatedBy ? ` by ${settings.updatedBy.slice(0, 8)}…` : ""}
            </p>
          ) : (
            <p className="text-xs text-muted">Defaults in effect — not modified yet.</p>
          )}
        </div>
        <Button
          variant="primary"
          size="sm"
          disabled={!canMutate || saving || !changed}
          onClick={save}
        >
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </Card>
  );
}

function OptOutsCard({ rows }: { rows: AiOptOutRow[] }) {
  const optedOut = rows.filter((r) => r.optOut);
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-lg font-bold text-ink">Company opt-out</h2>
          <p className="mt-1 text-sm text-muted">
            Opt-out is company-controlled and respected by the engine. It is visible and audited here —
            it is never silently re-enabled by admins.
          </p>
        </div>
        <Badge tone={optedOut.length > 0 ? "amber" : "slate"}>
          {optedOut.length} opted out
        </Badge>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">AI opt-out</th>
              <th className="px-4 py-3">Discovery</th>
              <th className="px-4 py-3">Public-source consent</th>
              <th className="px-4 py-3">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((c) => (
              <tr key={c.companyId} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <span className="font-semibold text-ink">{c.companyName ?? "Unknown company"}</span>
                  {c.companyType ? <span className="block text-xs text-muted">{c.companyType}</span> : null}
                </td>
                <td className="px-4 py-3">
                  {c.optOut ? (
                    <Badge tone="amber">Opted out</Badge>
                  ) : (
                    <Badge tone="slate">Active</Badge>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={c.aiDiscoveryEnabled ? "green" : "red"}>
                    {c.aiDiscoveryEnabled ? "Enabled" : "Disabled"}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={c.publicSourceConsent ? "teal" : "slate"}>
                    {c.publicSourceConsent ? "Consented" : "Not consented"}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-muted">{formatDate(c.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function RunHistoryCard({ runs, canMutate }: { runs: AiRunListRow[]; canMutate: boolean }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const retry = async (r: AiRunListRow) => {
    if (!window.confirm(
      `Retry the failed AI run for ${r.companyName ?? "this company"}? A new run will be queued ` +
        "(trigger: retry), executed immediately, and audited immutably. Retries respect the engine limits.",
    )) return;
    setBusyId(r.id);
    setFeedback(null);
    try {
      const res = await retryAiRun({ data: { runId: r.id } });
      setFeedback(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
      if (res.ok) setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setFeedback({ ok: false, text: e instanceof Error ? e.message : "Could not retry the run." });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-lg font-bold text-ink">Run history</h2>
        <p className="mt-1 text-sm text-muted">
          Recent runs of the AI Service Intelligence agent. Open a run to view inputs, outputs, errors
          and its audit events, or re-run the analysis manually. Failed runs can be retried.
        </p>
      </div>
      {runs.length === 0 ? (
        <div className="p-5">
          <EmptyState
            title="No agent runs yet"
            body="Runs appear here when the AI Service Intelligence agent processes a company — after profile updates, client intake, uploaded documents or a manual re-run."
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Trigger</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Model / version</th>
                <th className="px-4 py-3">Timing</th>
                <th className="px-4 py-3">Cost</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {runs.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      to="/admin/ai/$runId"
                      params={{ runId: r.id }}
                      className="font-semibold text-blue hover:underline"
                    >
                      {r.companyName ?? "Unknown company"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted">{r.trigger}</td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(r.status)}>
                      {AI_RUN_STATUS_LABELS[r.status] ?? r.status}
                    </Badge>
                    {r.error ? (
                      <span className="mt-1 block max-w-[16rem] truncate text-xs text-danger" title={r.error}>
                        {r.error}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    <span className="block">{r.promptModel ?? "-"}</span>
                    <span className="block text-xs">v{r.agentVersion}</span>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {r.durationSec !== null ? `${r.durationSec}s` : "-"}
                  </td>
                  <td className="px-4 py-3 text-muted">{r.costUsd !== null ? `$${r.costUsd.toFixed(4)}` : "-"}</td>
                  <td className="px-4 py-3 text-muted">{formatDate(r.createdAt)}</td>
                  <td className="px-4 py-3">
                    {r.status === "failed" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!canMutate || busyId === r.id}
                        onClick={() => retry(r)}
                      >
                        {busyId === r.id ? "Retrying…" : "Retry"}
                      </Button>
                    ) : (
                      <span className="text-xs text-muted">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(feedback || !canMutate) && (
        <div className="border-t border-slate-100 px-5 py-3">
          <ErrorText>{feedback && !feedback.ok ? feedback.text : null}</ErrorText>
          <p className="text-xs text-muted">{feedback?.ok ? feedback.text : ""}</p>
        </div>
      )}
    </Card>
  );
}

function AuditTrailCard({ events }: { events: AiAuditRow[] }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-lg font-bold text-ink">AI audit trail</h2>
        <p className="mt-1 text-sm text-muted">
          Immutable AI audit events — engine runs and admin actions, newest first.
        </p>
      </div>
      {events.length === 0 ? (
        <div className="p-5">
          <EmptyState
            title="No AI audit events yet"
            body="Audit events appear when the agent runs or an admin changes AI controls."
          />
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {events.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-4 px-5 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{e.action}</p>
                <p className="mt-0.5 text-xs text-muted">
                  <span className="font-medium capitalize">{e.actorType}</span>
                  {e.actorId ? ` · ${e.actorId}` : ""}
                  {e.entityType ? ` · ${e.entityType}${e.entityId ? ` / ${e.entityId.slice(0, 8)}` : ""}` : ""}
                </p>
                {e.runId ? (
                  <Link
                    to="/admin/ai/$runId"
                    params={{ runId: e.runId }}
                    className="mt-0.5 inline-block text-xs font-medium text-blue hover:underline"
                  >
                    View run {e.runId.slice(0, 8)}…
                  </Link>
                ) : null}
              </div>
              <span className="shrink-0 text-xs text-muted">{formatDate(e.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AiControlsPage() {
  const loader = Route.useLoaderData();
  const data = loader.result;
  const [refreshing, setRefreshing] = useState(false);

  const canMutate =
    !!loader.admin?.canMutate &&
    (loader.admin.staffRoles ?? []).some((r: string) =>
      (AI_CONTROL_MUTATE_ROLES as readonly string[]).includes(r as never),
    );

  if (loader.setupRequired) {
    return (
      <DbSetupPage title="AI Controls">
        Connect a Postgres database (DATABASE_URL) to view AI controls.
      </DbSetupPage>
    );
  }
  if (!loader.admin) return null;

  if (!data.ok) {
    return (
      <Card>
        <ErrorText>{data.error}</ErrorText>
      </Card>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-teal">AI Controls</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">AI Service Intelligence controls</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Data-source permissions, company opt-out visibility, run history and the immutable audit
            trail for the evidence-based discovery agent. Every recommendation still requires human
            approval before anything is surfaced.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={refreshing}
          onClick={() => {
            setRefreshing(true);
            window.location.reload();
          }}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted">Total runs</p>
          <p className="mt-1 text-2xl font-bold text-ink">{data.totals.runs}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted">Completed</p>
          <p className="mt-1 text-2xl font-bold text-success">{data.totals.completed}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted">Failed</p>
          <p className="mt-1 text-2xl font-bold text-danger">{data.totals.failed}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted">Companies opted out</p>
          <p className="mt-1 text-2xl font-bold text-amber">{data.totals.optedOut}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted">Companies</p>
          <p className="mt-1 text-2xl font-bold text-ink">{data.totals.companies}</p>
        </Card>
      </div>

      <div className="flex flex-col gap-6">
        {loader.settingsResult && loader.settingsResult.ok ? (
          <EngineLimitsCard settings={loader.settingsResult.settings} canMutate={canMutate} />
        ) : (
          <Card className="px-4 py-3">
            <ErrorText>
              {(loader.settingsResult && !loader.settingsResult.ok && loader.settingsResult.error) ||
                "Could not load the engine limits."}
            </ErrorText>
          </Card>
        )}
        <DataSourcesCard sources={data.dataSources} canMutate={canMutate} />
        <OptOutsCard rows={data.optOuts} />
        <RunHistoryCard runs={data.runs} canMutate={canMutate} />
        <AuditTrailCard events={data.auditEvents} />
      </div>

      {!canMutate && (
        <p className="mt-4 text-xs text-muted">
          Read-only view. Data-source toggles, retries, engine-limit edits and manual re-runs require
          an operations, compliance or super_admin staff role.
        </p>
      )}
    </div>
  );
}
