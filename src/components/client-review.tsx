/**
 * Client Portal Part B — shared review-form components.
 *
 * Each review form is a self-contained panel that calls the existing Part B
 * server functions (src/lib/client.ts) with the exact payload shapes the
 * backend already accepts, then reports success via onSuccess(decision).
 * Pages embed these inline (approvals hub + per-entity list pages) so a
 * review happens without leaving the list — consistent with the portal's
 * existing inline-action pattern (see /client/messages).
 *
 * Review actions are gated by the acting user's CLIENT role (mirrors the
 * server-side gates in client-core.ts):
 *   document : client_admin | client_reviewer
 *   milestone: client_admin | client_pm     | client_reviewer
 *   variation: client_admin | client_pm
 *   invoice  : client_admin | client_finance
 *   issue    : client_admin | client_pm (raise only — no client-side close)
 */
import { useState } from "react";
import { Button, Card, ErrorText, Field, Select, Textarea } from "./ui";
import {
  raiseClientIssue,
  reviewClientDocument,
  reviewClientInvoice,
  reviewClientMilestone,
  reviewClientVariation,
} from "~/lib/client";
import type {
  ClientDocument,
  ClientDocumentReviewDecision,
  ClientInvoice,
  ClientInvoiceDecision,
  ClientIssueSeverity,
  ClientMilestone,
  ClientMilestoneReviewDecision,
  ClientRole,
  ClientVariation,
  ClientVariationDecision,
} from "~/lib/types";
import { CLIENT_ISSUE_SEVERITY_LABELS } from "~/lib/types";

// ------------------------------------------------------------------ helpers

/** Whether the acting role may submit a review for the given entity kind. */
export function canReview(
  role: ClientRole,
  kind: "document" | "milestone" | "variation" | "invoice" | "issue",
): boolean {
  switch (kind) {
    case "document":
      return role === "client_admin" || role === "client_reviewer";
    case "milestone":
      return role === "client_admin" || role === "client_pm" || role === "client_reviewer";
    case "variation":
      return role === "client_admin" || role === "client_pm";
    case "invoice":
      return role === "client_admin" || role === "client_finance";
    case "issue":
      return role === "client_admin" || role === "client_pm";
  }
}

/** Whether the entity is still pending review (actionable). */
export function isPending(
  kind: "document" | "milestone" | "variation" | "invoice",
  status: string,
): boolean {
  switch (kind) {
    case "document":
      return status === "under_review";
    case "milestone":
      return status === "submitted";
    case "variation":
      return status === "under_review";
    case "invoice":
      return status === "under_review";
  }
}

export function fmtMoneyCents(cents: number, currency = "AED"): string {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return (
    d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) +
    " · " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}

// ------------------------------------------------------------ form scaffolding

function ReviewCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-brand/30 bg-mist/40 p-5">
      <div className="mb-3">
        <p className="text-sm font-bold text-navy">{title}</p>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {children}
    </Card>
  );
}

function DecisionButtons({
  options,
  selected,
  busy,
  onSelect,
}: {
  options: { value: string; label: string; tone?: "green" | "red" | "amber" | "blue" | "teal" }[];
  selected: string | null;
  busy: boolean;
  onSelect: (value: string) => void;
}) {
  const toneClass: Record<string, string> = {
    green: "border-success/40 text-success hover:bg-success/5",
    red: "border-danger/40 text-danger hover:bg-danger/5",
    amber: "border-amber/50 text-[#8a6200] hover:bg-amber/5",
    blue: "border-brand/40 text-brand hover:bg-brand/5",
    teal: "border-teal/40 text-teal hover:bg-teal/5",
  };
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={busy}
          onClick={() => onSelect(o.value)}
          className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
            selected === o.value ? toneClass[o.tone ?? "blue"] : "border-slate-300 text-muted hover:text-navy"
          } ${selected === o.value ? "bg-white shadow-sm" : "bg-white"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ConfirmBar({
  busy,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  busy: boolean;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-3 flex items-center gap-2">
      <Button variant="secondary" size="sm" disabled={busy} onClick={onConfirm}>
        {busy ? "Saving…" : confirmLabel}
      </Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------ documents

export function DocumentReviewForm({
  orgId,
  document,
  onSuccess,
  onCancel,
}: {
  orgId: string;
  document: ClientDocument;
  onSuccess?: (decision: ClientDocumentReviewDecision) => void;
  onCancel?: () => void;
}) {
  const [decision, setDecision] = useState<ClientDocumentReviewDecision | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!decision) return;
    setBusy(true);
    setError(null);
    const r = await reviewClientDocument({
      data: {
        orgId,
        workspaceId: document.workspaceId,
        documentId: document.id,
        decision,
        comment: comment.trim() || undefined,
      },
    });
    setBusy(false);
    if (r.ok) onSuccess?.(decision);
    else setError(r.error);
  }

  return (
    <ReviewCard
      title={`Review — ${document.title}`}
      subtitle={`Document review · ${document.workspaceTitle ?? "Contract"}`}
    >
      <DecisionButtons
        busy={busy}
        selected={decision}
        onSelect={(v) => setDecision(v as ClientDocumentReviewDecision)}
        options={[
          { value: "approved", label: "Approve", tone: "green" },
          { value: "needs_changes", label: "Request changes", tone: "red" },
        ]}
      />
      {decision && (
        <div className="mt-3">
          <Field label="Comment (optional)" htmlFor="doc-review-comment">
            <Textarea
              id="doc-review-comment"
              value={comment}
              maxLength={1000}
              placeholder={
                decision === "needs_changes"
                  ? "Tell the lead contractor what needs to change…"
                  : "Add a note for the record…"
              }
              onChange={(e) => setComment(e.target.value)}
            />
          </Field>
          {error && (
            <div className="mt-2">
              <ErrorText>{error}</ErrorText>
            </div>
          )}
          <ConfirmBar
            busy={busy}
            confirmLabel={decision === "approved" ? "Confirm approval" : "Confirm changes requested"}
            onConfirm={() => void confirm()}
            onCancel={() => {
              setDecision(null);
              setError(null);
              onCancel?.();
            }}
          />
        </div>
      )}
    </ReviewCard>
  );
}

// ---------------------------------------------------------------- milestones

export function MilestoneReviewForm({
  orgId,
  milestone,
  onSuccess,
  onCancel,
}: {
  orgId: string;
  milestone: ClientMilestone;
  onSuccess?: (decision: ClientMilestoneReviewDecision) => void;
  onCancel?: () => void;
}) {
  const [decision, setDecision] = useState<ClientMilestoneReviewDecision | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!decision) return;
    setBusy(true);
    setError(null);
    const r = await reviewClientMilestone({
      data: {
        orgId,
        workspaceId: milestone.workspaceId,
        milestoneId: milestone.id,
        decision,
        comment: comment.trim() || undefined,
      },
    });
    setBusy(false);
    if (r.ok) onSuccess?.(decision);
    else setError(r.error);
  }

  return (
    <ReviewCard
      title={`Sign off — ${milestone.title}`}
      subtitle={`Milestone sign-off · ${milestone.workspaceTitle ?? "Contract"}`}
    >
      <DecisionButtons
        busy={busy}
        selected={decision}
        onSelect={(v) => setDecision(v as ClientMilestoneReviewDecision)}
        options={[
          { value: "approved", label: "Approve & sign off", tone: "green" },
          { value: "needs_changes", label: "Request changes", tone: "red" },
        ]}
      />
      {decision && (
        <div className="mt-3">
          <Field label="Comment (optional)" htmlFor="ms-review-comment">
            <Textarea
              id="ms-review-comment"
              value={comment}
              maxLength={1000}
              placeholder={
                decision === "needs_changes"
                  ? "What still needs to be done before sign-off?…"
                  : "Add a note for the record…"
              }
              onChange={(e) => setComment(e.target.value)}
            />
          </Field>
          {error && (
            <div className="mt-2">
              <ErrorText>{error}</ErrorText>
            </div>
          )}
          <ConfirmBar
            busy={busy}
            confirmLabel={decision === "approved" ? "Confirm sign-off" : "Confirm changes requested"}
            onConfirm={() => void confirm()}
            onCancel={() => {
              setDecision(null);
              setError(null);
              onCancel?.();
            }}
          />
        </div>
      )}
    </ReviewCard>
  );
}

// ---------------------------------------------------------------- variations

const VARIATION_OPTIONS: { value: ClientVariationDecision; label: string; tone: "green" | "red" | "blue" | "teal" }[] = [
  { value: "approved", label: "Approve", tone: "green" },
  { value: "rejected", label: "Reject", tone: "red" },
  { value: "clarification_needed", label: "Ask for clarification", tone: "blue" },
  { value: "conditions", label: "Approve with conditions", tone: "teal" },
];

export function VariationReviewForm({
  orgId,
  variation,
  onSuccess,
  onCancel,
}: {
  orgId: string;
  variation: ClientVariation;
  onSuccess?: (decision: ClientVariationDecision) => void;
  onCancel?: () => void;
}) {
  const [decision, setDecision] = useState<ClientVariationDecision | null>(null);
  const [reason, setReason] = useState("");
  const [conditions, setConditions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!decision) return;
    if (decision === "conditions" && !conditions.trim()) {
      setError("Enter the conditions for approval.");
      return;
    }
    setBusy(true);
    setError(null);
    const r = await reviewClientVariation({
      data: {
        orgId,
        workspaceId: variation.workspaceId,
        variationId: variation.id,
        decision,
        conditions: decision === "conditions" ? conditions.trim() || undefined : undefined,
        reason: reason.trim() || undefined,
      },
    });
    setBusy(false);
    if (r.ok) onSuccess?.(decision);
    else setError(r.error);
  }

  return (
    <ReviewCard
      title={`Decision — ${variation.title}`}
      subtitle={`Variation review · ${variation.workspaceTitle ?? "Contract"}`}
    >
      <DecisionButtons
        busy={busy}
        selected={decision}
        onSelect={(v) => {
          setDecision(v as ClientVariationDecision);
          setError(null);
        }}
        options={VARIATION_OPTIONS}
      />
      {decision && (
        <div className="mt-3 flex flex-col gap-3">
          {(decision === "rejected" || decision === "clarification_needed") && (
            <Field
              label={decision === "rejected" ? "Reason for rejection" : "What needs clarification?"}
              htmlFor="var-reason"
            >
              <Textarea
                id="var-reason"
                value={reason}
                maxLength={1000}
                placeholder={
                  decision === "rejected"
                    ? "Why is this variation being declined?…"
                    : "What information is missing?…"
                }
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          )}
          {decision === "conditions" && (
            <Field
              label="Conditions for approval"
              htmlFor="var-conditions"
              hint="These conditions are recorded against the variation and shared with the lead contractor."
            >
              <Textarea
                id="var-conditions"
                value={conditions}
                maxLength={2000}
                placeholder="e.g. Approved subject to a revised cost breakdown and a completion date of 30 Nov…"
                onChange={(e) => setConditions(e.target.value)}
              />
            </Field>
          )}
          {decision === "approved" && (
            <Field label="Note (optional)" htmlFor="var-note">
              <Textarea
                id="var-note"
                value={reason}
                maxLength={1000}
                placeholder="Add a note for the record…"
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          )}
          {error && <ErrorText>{error}</ErrorText>}
          <ConfirmBar
            busy={busy}
            confirmLabel={`Confirm ${decision === "conditions" ? "conditions" : decision.replace("_", " ")}`}
            onConfirm={() => void confirm()}
            onCancel={() => {
              setDecision(null);
              setReason("");
              setConditions("");
              setError(null);
              onCancel?.();
            }}
          />
        </div>
      )}
    </ReviewCard>
  );
}

// ------------------------------------------------------------------ invoices

const INVOICE_OPTIONS: { value: ClientInvoiceDecision; label: string; tone: "green" | "red" | "blue" }[] = [
  { value: "approved", label: "Approve for payment", tone: "green" },
  { value: "rejected", label: "Reject", tone: "red" },
  { value: "corrections_requested", label: "Request corrections", tone: "blue" },
];

export function InvoiceReviewForm({
  orgId,
  invoice,
  onSuccess,
  onCancel,
}: {
  orgId: string;
  invoice: ClientInvoice;
  onSuccess?: (decision: ClientInvoiceDecision) => void;
  onCancel?: () => void;
}) {
  const [decision, setDecision] = useState<ClientInvoiceDecision | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!decision) return;
    setBusy(true);
    setError(null);
    const r = await reviewClientInvoice({
      data: {
        orgId,
        workspaceId: invoice.workspaceId,
        invoiceId: invoice.id,
        decision,
        reviewNotes: notes.trim() || undefined,
      },
    });
    setBusy(false);
    if (r.ok) onSuccess?.(decision);
    else setError(r.error);
  }

  return (
    <ReviewCard
      title={`Review — ${invoice.invoiceNumber}${invoice.title ? ` · ${invoice.title}` : ""}`}
      subtitle={`Invoice review · ${invoice.workspaceTitle ?? "Contract"}`}
    >
      <DecisionButtons
        busy={busy}
        selected={decision}
        onSelect={(v) => {
          setDecision(v as ClientInvoiceDecision);
          setError(null);
        }}
        options={INVOICE_OPTIONS}
      />
      {decision && (
        <div className="mt-3">
          <Field label="Review notes (optional)" htmlFor="inv-notes">
            <Textarea
              id="inv-notes"
              value={notes}
              maxLength={2000}
              placeholder={
                decision === "approved"
                  ? "Add payment notes for the record…"
                  : "Explain what needs correcting…"
              }
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          {error && (
            <div className="mt-2">
              <ErrorText>{error}</ErrorText>
            </div>
          )}
          <ConfirmBar
            busy={busy}
            confirmLabel={`Confirm ${decision === "corrections_requested" ? "corrections requested" : decision}`}
            onConfirm={() => void confirm()}
            onCancel={() => {
              setDecision(null);
              setNotes("");
              setError(null);
              onCancel?.();
            }}
          />
        </div>
      )}
    </ReviewCard>
  );
}

// -------------------------------------------------------------------- issues

/** Raise a new issue against one of the org's contracts (client_admin/pm). */
export function IssueRaiseForm({
  orgId,
  workspaces,
  onSuccess,
  onCancel,
}: {
  orgId: string;
  workspaces: { workspaceId: string; title: string | null }[];
  onSuccess?: () => void;
  onCancel?: () => void;
}) {
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.workspaceId ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<ClientIssueSeverity>("medium");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!workspaceId) {
      setError("Select the contract this issue relates to.");
      return;
    }
    setBusy(true);
    setError(null);
    const r = await raiseClientIssue({
      data: {
        orgId,
        workspaceId,
        title,
        description,
        severity,
      },
    });
    setBusy(false);
    if (r.ok) {
      onSuccess?.();
      setTitle("");
      setDescription("");
      setSeverity("medium");
    } else {
      setError(r.error);
    }
  }

  return (
    <ReviewCard title="Raise a new issue" subtitle="Reported issues are sent to the lead contractor for action.">
      <div className="flex flex-col gap-3">
        <Field label="Contract" htmlFor="issue-ws">
          <Select
            id="issue-ws"
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
          >
            {workspaces.map((w) => (
              <option key={w.workspaceId} value={w.workspaceId}>
                {w.title ?? "Contract"}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Title" htmlFor="issue-title">
          <input
            id="issue-title"
            className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-ink placeholder:text-slate-400 focus:border-brand focus:outline-2 focus:outline-brand/40"
            value={title}
            maxLength={200}
            placeholder="Short summary of the issue…"
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="Description" htmlFor="issue-desc">
          <Textarea
            id="issue-desc"
            value={description}
            maxLength={4000}
            placeholder="What happened, where, and what impact does it have?…"
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field label="Severity" htmlFor="issue-severity">
          <Select
            id="issue-severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as ClientIssueSeverity)}
          >
            {(["low", "medium", "high"] as const).map((s) => (
              <option key={s} value={s}>
                {CLIENT_ISSUE_SEVERITY_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        {error && <ErrorText>{error}</ErrorText>}
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" disabled={busy || !title.trim() || !description.trim()} onClick={() => void submit()}>
            {busy ? "Submitting…" : "Raise issue"}
          </Button>
          {onCancel && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </ReviewCard>
  );
}
