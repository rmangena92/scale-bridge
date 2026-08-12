import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  getAdminSession,
  getAdminUpsellOpportunity,
  updateAdminUpsellNotes,
  updateAdminUpsellStatus,
  UPSELL_MUTATE_ROLES,
  UPSELL_STATUS_LABELS,
  UPSELL_STATUS_TONES,
  UPSELL_TRANSITIONS,
} from "~/lib/admin";
import type { UpsellWorkflowStatus } from "~/lib/admin";
import { Badge, Button, Card, DbSetupPage, ErrorText, EmptyState, Textarea } from "~/components/ui";

export const Route = createFileRoute("/admin/upsells/$opportunityId")({
  loader: async ({ params }) => {
    const session = await getAdminSession();
    const result = await getAdminUpsellOpportunity({ data: { opportunityId: params.opportunityId } });
    return { setupRequired: session.setupRequired, admin: session.admin, result };
  },
  component: UpsellDetailPage,
});

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "-"
    : d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function confidenceTone(c: string): "green" | "amber" | "red" | "slate" {
  if (c === "High") return "green";
  if (c === "Medium") return "amber";
  if (c === "Low") return "red";
  return "slate";
}

function UpsellDetailPage() {
  const loader = Route.useLoaderData();
  const [notes, setNotes] = useState<string>("");
  const [busyTarget, setBusyTarget] = useState<string | null>(null);
  const [savingNotes, setSavingNotes] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const result = useMemo(() => loader.result, [loader.result]);
  const opp = result.ok ? result.opportunity : null;
  const [notesInitialized, setNotesInitialized] = useState(false);
  if (opp && !notesInitialized) {
    setNotesInitialized(true);
    setNotes(opp.adminNotes ?? "");
  }

  const canMutate =
    !!loader.admin?.canMutate &&
    (loader.admin.staffRoles ?? []).some((r) =>
      (UPSELL_MUTATE_ROLES as readonly string[]).includes(r as never),
    );

  if (loader.setupRequired) {
    return (
      <DbSetupPage title="Upsell Opportunity">
        Connect a Postgres database (DATABASE_URL) to view this opportunity.
      </DbSetupPage>
    );
  }
  if (!loader.admin) return null;

  if (!result.ok) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mb-4">
          <Link to="/admin/upsells" className="text-sm font-medium text-blue hover:underline">
            &larr; Back to upsell opportunities
          </Link>
        </div>
        <Card>
          <ErrorText>{result.error}</ErrorText>
        </Card>
      </div>
    );
  }

  if (!opp) return null;
  const statusTone = UPSELL_STATUS_TONES[opp.status] ?? "slate";
  const transitions = UPSELL_TRANSITIONS[opp.status] ?? [];
  const statusLabel = UPSELL_STATUS_LABELS[opp.status] ?? opp.status;

  const saveNotes = async () => {
    setSavingNotes(true);
    setFeedback(null);
    try {
      const r = await updateAdminUpsellNotes({ data: { opportunityId: opp.id, notes } });
      setFeedback(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      if (r.ok) window.location.reload();
    } catch (e) {
      setFeedback({ ok: false, text: e instanceof Error ? e.message : "Could not save notes." });
    } finally {
      setSavingNotes(false);
    }
  };

  const transition = async (target: UpsellWorkflowStatus) => {
    if (target === "Sent") {
      const okSend = window.confirm(
        "Send this recommendation to the company owner? This is the human-approval gate: the company will be notified and the action is audited immutably.",
      );
      if (!okSend) return;
    }
    setBusyTarget(target);
    setFeedback(null);
    try {
      const r = await updateAdminUpsellStatus({ data: { opportunityId: opp.id, status: target } });
      setFeedback(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      if (r.ok) window.location.reload();
    } catch (e) {
      setFeedback({ ok: false, text: e instanceof Error ? e.message : "Could not update status." });
    } finally {
      setBusyTarget(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4">
        <Link to="/admin/upsells" className="text-sm font-medium text-blue hover:underline">
          &larr; Back to upsell opportunities
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-teal">Upsell Opportunity</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{opp.companyName ?? "Unknown company"}</h1>
          <p className="mt-1 text-sm text-muted">
            {opp.companyType ? `${opp.companyType} \u00b7 ` : ""}
            Created {formatDate(opp.createdAt)} {opp.ownerName ? `\u00b7 owner ${opp.ownerName}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={confidenceTone(opp.confidence)}>{opp.confidence} {opp.confidenceScore}%</Badge>
          <Badge tone={statusTone as never}>{statusLabel}</Badge>
        </div>
      </div>

      <div className="mb-4">
        <ErrorText>{feedback ? (feedback.ok ? null : feedback.text) : null}</ErrorText>
        {feedback?.ok && <p className="text-sm font-medium text-success">{feedback.text}</p>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card><h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Recommendation</h3>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="font-semibold text-ink">Suggested service</dt>
              <dd className="mt-0.5 text-muted">{opp.suggestedServiceName ?? "-"}</dd>
            </div>
            {opp.existingServiceName ? (
              <div>
                <dt className="font-semibold text-ink">Existing service</dt>
                <dd className="mt-0.5 text-muted">{opp.existingServiceName}</dd>
              </div>
            ) : null}
            <div>
              <dt className="font-semibold text-ink">Relationship</dt>
              <dd className="mt-0.5 text-muted">{opp.relationship ?? "-"}</dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Why</dt>
              <dd className="mt-0.5 text-muted">{opp.evidence ?? "-"}</dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Suggested timing</dt>
              <dd className="mt-0.5 text-muted">{opp.timing ?? "-"}</dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Proposed message</dt>
              <dd className="mt-0.5 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-muted">
                {opp.suggestedMessage ?? "No message drafted yet."}
              </dd>
            </div>
          </dl>
        </Card>

        <Card><h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Company</h3>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="font-semibold text-ink">Verification status</dt>
              <dd className="mt-0.5 text-muted">{opp.companyStatus ?? "-"}</dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Owner</dt>
              <dd className="mt-0.5 text-muted">{opp.ownerName ?? "No owner assigned"}</dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Existing service relationships</dt>
              <dd className="mt-0.5">
                {opp.existingRelationships.length === 0 ? (
                  <span className="text-muted">None recorded</span>
                ) : (
                  <ul className="space-y-1">
                    {opp.existingRelationships.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2">
                        <span className="font-medium">{r.serviceName}</span>
                        <Badge tone={confidenceTone(r.confidence) as never}>{r.confidence}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      <Card className="mt-4"><h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Evidence (${opp.evidenceItems.length})</h3>
        {opp.evidenceItems.length === 0 ? (
          <EmptyState title="No evidence attached" body="This opportunity has no source evidence items recorded." />
        ) : (
          <ul className="space-y-3">
            {opp.evidenceItems.map((e) => (
              <li key={e.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{e.title}</span>
                  <Badge tone={confidenceTone(e.confidence ?? "Medium") as never}>{e.confidence ?? "-"}</Badge>
                  <Badge>{e.evidenceType ?? "evidence"}</Badge>
                </div>
                {e.excerpt ? <p className="mt-2 text-sm text-muted">{e.excerpt}</p> : null}
                {e.sourceUrl ? (
                  <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-medium text-blue hover:underline">
                    {e.sourceUrl}
                  </a>
                ) : (
                  <p className="mt-1 text-xs text-muted">Source: {e.sourceUrl ?? "-"}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {opp.relevantOpportunities.length > 0 ? (
        <Card className="mt-4"><h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Relevant opportunities</h3>
          <ul className="space-y-2">
            {opp.relevantOpportunities.map((r, i) => (
              <li key={i} className="rounded-lg bg-slate-50 p-3 text-sm">
                <span className="font-medium">{r.serviceName ?? "Service"}</span>
                {r.confidence ? <span className="ml-2 text-xs text-muted">confidence {r.confidence}</span> : null}
                {r.reason ? <p className="mt-1 text-muted">{r.reason}</p> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="mt-4"><h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Workflow</h3>
        <p className="mb-3 text-sm text-muted">
          Current status: <span className="font-semibold text-ink">{statusLabel}</span>.{" "}
          {canMutate
            ? "All status changes are written to the immutable audit trail."
            : "Read-only: status changes require an operations, compliance or super_admin role."}
        </p>
        {canMutate && transitions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {transitions.map((t) => (
              <Button
                key={t}
                variant={t === "Sent" || t === "Approved" ? "primary" : t === "Rejected" || t === "Declined" ? "secondary" : "secondary"}
                disabled={busyTarget !== null}
                className={t === "Rejected" || t === "Declined" ? "text-red-700" : ""}
                onClick={() => transition(t)}
              >
                {busyTarget === t ? "Updating..." : t === "Sent" ? `Approve & send to ${opp.companyName ?? "company"}` : UPSELL_STATUS_LABELS[t]}
              </Button>
            ))}
          </div>
        ) : null}
        {canMutate && transitions.length === 0 ? (
          <p className="text-sm text-muted">No further transitions from {statusLabel}.</p>
        ) : null}
      </Card>

      <Card className="mt-4"><h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Admin notes</h3>
        <Textarea
          rows={4}
          value={notes}
          placeholder="Internal notes for this opportunity (visible to Master Admins only)."
          onChange={(e) => setNotes(e.target.value)}
          disabled={!canMutate || savingNotes}
        />
        <div className="mt-3 flex items-center gap-3">
          <Button variant="primary" onClick={saveNotes} disabled={!canMutate || savingNotes || notes.trim() === ""}>
            {savingNotes ? "Saving..." : "Save notes"}
          </Button>
          <span className="text-xs text-muted">
            {opp.adminNotes ? "Existing notes preserved until you save." : "No notes saved yet."}
          </span>
        </div>
      </Card>

      <Card className="mt-4"><h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Audit trail</h3>
        {opp.history.length === 0 ? (
          <EmptyState title="No audit events" body="No status or send events have been recorded for this opportunity." />
        ) : (
          <ol className="space-y-3">
            {opp.history.map((h) => (
              <li key={h.id} className="flex gap-3 text-sm">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-teal" />
                <div className="min-w-0">
                  <p className="font-medium">{h.action}</p>
                  <p className="text-xs text-muted">
                    {h.actorType} {h.actorId ? `(${h.actorId})` : ""} {" \u00b7 "} {formatDate(h.createdAt)}
                  </p>
                  {Object.keys(h.details).length > 0 ? (
                    <pre className="mt-1 overflow-x-auto rounded-md bg-slate-50 p-2 text-xs text-muted">
                      {JSON.stringify(h.details, null, 2)}
                    </pre>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
