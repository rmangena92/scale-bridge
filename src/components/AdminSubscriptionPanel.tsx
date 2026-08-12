/**
 * Master Admin Portal - Stage 3 part 1: subscription management panel (spec §6).
 *
 * Full billing panel for a company's Subscription tab: current plan, price,
 * interval, status, start, current billing period, minimum commitment
 * start/end, downgrade eligibility, next billing date, payment method,
 * outstanding balance, failed payment status, pending upgrade/downgrade,
 * cancellation status, provider IDs, invoices, payment events, webhook
 * history and commitment-override history.
 *
 * Action flows (spec §5 + §10) each end in a CONFIRMATION SCREEN that shows
 * exactly what will change (prev plan -> new plan, price diff, proration,
 * effective date, commitment effect) before the write happens:
 *   - Upgrade: pick plan -> adminUpgradePreview -> confirm -> adminExecuteUpgrade
 *   - Downgrade: locked until minimum commitment completes (eligibility date
 *     shown, no action); eligible -> adminDowngradePreview -> confirm ->
 *     adminScheduleDowngrade (scheduled at period end)
 *   - Senior actions (commitment override / immediate downgrade) require
 *     super_admin; the gate is surfaced in the UI when it is unavailable.
 *   - Cancel: end_of_period vs immediate -> confirm -> adminCancelSubscription
 *
 * All writes go through server functions in ~/lib/admin, which enforce the
 * session, actor role and RLS. The panel reloads after every action.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  adminCancelSubscription,
  adminCommitmentOverride,
  adminDowngradePreview,
  adminExecuteUpgrade,
  adminGetBillingPanel,
  adminImmediateDowngrade,
  adminScheduleDowngrade,
  adminUpgradePreview,
} from "~/lib/admin";
import type {
  AdminBillingActionResult,
  AdminBillingPanel,
  DowngradePreview,
  UpgradePreview,
} from "~/lib/admin";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  Field,
  Input,
  Select,
  Textarea,
} from "~/components/ui";

// Spec §5 override reasons (kept in sync with the backend constant in
// admin-subscriptions-actions.ts).
const OVERRIDE_REASONS = [
  "approved commercial exception",
  "service failure",
  "duplicate subscription",
  "billing error",
  "regulatory requirement",
  "client settlement",
  "internal migration",
  "administrative correction",
] as const;

const FINANCIAL_TREATMENTS = [
  "No financial adjustment",
  "Credit applied",
  "Refund issued",
  "Waiver of fee",
  "Invoice adjustment",
];

const SUB_STATUS_TONES: Record<string, "green" | "amber" | "red" | "slate" | "blue" | "teal"> = {
  active: "green",
  trialing: "blue",
  pending_plan_selection: "amber",
  checkout_started: "amber",
  payment_pending: "amber",
  upgrade_pending: "blue",
  downgrade_scheduled: "blue",
  past_due: "amber",
  payment_failed: "red",
  cancellation_requested: "amber",
  cancel_at_period_end: "amber",
  cancelled: "slate",
  expired: "slate",
  suspended: "red",
};

const fmtDate = (v: string | null | undefined): string => {
  if (!v) return "-";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "-" : d.toLocaleDateString();
};

const fmtAed = (v: number | null | undefined): string => {
  if (v === null || v === undefined) return "-";
  return `AED ${Number(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}

function SectionHeading({ title, body }: { title: string; body?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-bold">{title}</h2>
      {body && <p className="mt-1 text-sm text-muted">{body}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- modal shell
function ModalShell({
  eyebrow,
  title,
  onClose,
  children,
}: {
  eyebrow: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy/60 p-4">
      <div className="my-8 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold uppercase tracking-widest text-amber">{eyebrow}</p>
            <h2 className="mt-1 text-xl font-bold">{title}</h2>
          </div>
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-2 py-1 text-sm font-semibold text-muted hover:bg-mist"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

function ConfirmRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-slate-100 py-2 last:border-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={`text-sm font-semibold ${accent ? "text-brand" : "text-ink"}`}>{value}</dd>
    </div>
  );
}

function EntitlementDiff({ added, removed }: { added: string[]; removed: string[] }) {
  if (added.length === 0 && removed.length === 0) {
    return <p className="text-sm text-muted">No entitlement changes for this plan change.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {added.length > 0 && (
        <p className="text-sm">
          <span className="font-semibold text-success">Added: </span>
          {added.map((k) => k.replace(/_/g, " ")).join(", ")}
        </p>
      )}
      {removed.length > 0 && (
        <p className="text-sm">
          <span className="font-semibold text-danger">Removed: </span>
          {removed.map((k) => k.replace(/_/g, " ")).join(", ")}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------- upgrade flow
function UpgradeFlowModal({
  companyId,
  panel,
  onDone,
  onClose,
}: {
  companyId: string;
  panel: AdminBillingPanel;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const [planId, setPlanId] = useState("");
  const [preview, setPreview] = useState<UpgradePreview | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targets = panel.availablePlans.filter((p) => p.id !== panel.plan?.id);

  const runPreview = async () => {
    if (!planId) return;
    setBusy(true);
    setError(null);
    const res = await adminUpgradePreview({ data: { companyId, newPlanId: planId } });
    if (res.ok) setPreview(res.preview);
    else setError(res.error);
    setBusy(false);
  };

  const execute = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    const res = await adminExecuteUpgrade({
      data: { companyId, newPlanId: preview.newPlanId, internalReason: reason },
    });
    if (res.ok) onDone(res.message);
    else {
      setError(res.error);
      setBusy(false);
    }
  };

  return (
    <ModalShell eyebrow="Manual upgrade" title="Change membership plan" onClose={onClose}>
      {!preview ? (
        <div className="flex flex-col gap-4">
          <Field label="Target plan" hint={`Current plan: ${panel.plan?.name ?? "None"}`}>
            <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">Select a plan to upgrade to...</option>
              {targets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} - {fmtAed(p.priceMonthlyAel ?? p.priceAnnualAel)}/month
                </option>
              ))}
            </Select>
          </Field>
          {error && <ErrorText>{error}</ErrorText>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={!planId || busy} onClick={() => void runPreview()}>
              {busy ? "Preparing..." : "Preview upgrade"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-slate-200 bg-mist/50 p-4">
            <SectionHeading title="Confirm plan change" body="Review exactly what will change, then confirm to execute." />
            <dl>
              <ConfirmRow label="Current plan" value={preview.currentPlan} />
              <ConfirmRow label="New plan" value={preview.newPlan} accent />
              <ConfirmRow label="Price difference" value={fmtAed(preview.priceDiffAel)} accent />
              <ConfirmRow label="Prorated charge (this period)" value={fmtAed(preview.prorationAmountAel)} accent />
              <ConfirmRow label="Effective date" value={fmtDate(preview.effectiveDate)} />
              <ConfirmRow label="Next invoice amount" value={fmtAed(preview.nextInvoiceAmountAel)} />
              <ConfirmRow
                label="Minimum commitment"
                value={`Resets - new commitment ends ${fmtDate(preview.newCommitmentEnd)}`}
              />
            </dl>
            <div className="mt-3">
              <EntitlementDiff
                added={preview.newEntitlements.filter((k) => !preview.currentEntitlements.includes(k))}
                removed={preview.currentEntitlements.filter((k) => !preview.newEntitlements.includes(k))}
              />
            </div>
          </div>
          <Field label="Internal reason (required)" hint="Recorded in the audit log; the client receives a notification.">
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Company requested Growth to Strategic for a new contract pipeline"
              rows={3}
            />
          </Field>
          {error && <ErrorText>{error}</ErrorText>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setPreview(null)}>
              Back
            </Button>
            <Button type="button" size="sm" disabled={!reason.trim() || busy} onClick={() => void execute()}>
              {busy ? "Executing..." : "Confirm upgrade"}
            </Button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

// ----------------------------------------------------------- downgrade flow
function DowngradeFlowModal({
  companyId,
  panel,
  onDone,
  onClose,
}: {
  companyId: string;
  panel: AdminBillingPanel;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const [planId, setPlanId] = useState("");
  const [preview, setPreview] = useState<DowngradePreview | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locked = panel.minCommitment?.downgradeLocked ?? false;
  const eligibleDate = panel.minCommitment?.downgradeEligibleDate ?? null;
  const targets = panel.availablePlans.filter((p) => p.id !== panel.plan?.id);

  const runPreview = async () => {
    if (!planId) return;
    setBusy(true);
    setError(null);
    const res = await adminDowngradePreview({ data: { companyId, newPlanId: planId } });
    if (res.ok) setPreview(res.preview);
    else setError(res.error);
    setBusy(false);
  };

  const execute = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    const res = await adminScheduleDowngrade({
      data: { companyId, newPlanId: preview.newPlanId, internalReason: reason },
    });
    if (res.ok) onDone(res.message);
    else {
      setError(res.error);
      setBusy(false);
    }
  };

  return (
    <ModalShell eyebrow="Manual downgrade" title="Schedule a plan downgrade" onClose={onClose}>
      {locked && (
        <div className="rounded-xl border border-amber/40 bg-amber/10 p-4 text-sm text-[#6b4c00]">
          <p className="font-semibold">Downgrade locked</p>
          <p className="mt-1">
            This company is inside its three-month minimum commitment. Downgrades become
            eligible on {fmtDate(eligibleDate)}. Use the senior authorisation flow for an
            exceptional immediate downgrade.
          </p>
        </div>
      )}
      {!preview ? (
        <div className="flex flex-col gap-4">
          <Field label="Target plan" hint={`Current plan: ${panel.plan?.name ?? "None"}`}>
            <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">Select a plan to downgrade to...</option>
              {targets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} - {fmtAed(p.priceMonthlyAel ?? p.priceAnnualAel)}/month
                </option>
              ))}
            </Select>
          </Field>
          {error && <ErrorText>{error}</ErrorText>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={!planId || busy || locked} onClick={() => void runPreview()}>
              {busy ? "Preparing..." : "Preview downgrade"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-slate-200 bg-mist/50 p-4">
            <SectionHeading title="Confirm scheduled downgrade" body="Scheduled for the end of the current billing period." />
            <dl>
              <ConfirmRow label="Current plan" value={preview.currentPlan} />
              <ConfirmRow label="New plan" value={preview.newPlan} accent />
              <ConfirmRow label="Effective date" value={fmtDate(preview.effectiveDate)} />
              <ConfirmRow label="Future billing amount" value={fmtAed(preview.futureBillingAmountAel)} />
              <ConfirmRow label="Current plan active until" value="End of current billing period" />
            </dl>
            <div className="mt-3">
              <EntitlementDiff added={[]} removed={preview.featuresRemoved} />
            </div>
          </div>
          <Field label="Internal reason (required)" hint="Recorded in the audit log; the client receives a notification.">
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Company reducing scope - moving Verified to Open Partner"
              rows={3}
            />
          </Field>
          {error && <ErrorText>{error}</ErrorText>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setPreview(null)}>
              Back
            </Button>
            <Button type="button" size="sm" disabled={!reason.trim() || busy} onClick={() => void execute()}>
              {busy ? "Scheduling..." : "Confirm downgrade"}
            </Button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

// ------------------------------------- senior: override / immediate downgrade
function SeniorFlowModal({
  companyId,
  panel,
  isSuperAdmin,
  onDone,
  onClose,
}: {
  companyId: string;
  panel: AdminBillingPanel;
  isSuperAdmin: boolean;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<"override" | "immediate">("override");
  const [planId, setPlanId] = useState("");
  const [reason, setReason] = useState<string>(OVERRIDE_REASONS[0]);
  const [note, setNote] = useState("");
  const [treatment, setTreatment] = useState(FINANCIAL_TREATMENTS[0]);
  const [effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isSuperAdmin) {
    return (
      <ModalShell eyebrow="Senior authorisation" title="Commitment override / immediate downgrade" onClose={onClose}>
        <div className="rounded-xl border border-amber/40 bg-amber/10 p-4 text-sm text-[#6b4c00]">
          <p className="font-semibold">Unavailable - super_admin role required</p>
          <p className="mt-1">
            Waiving the three-month minimum commitment or applying an immediate downgrade
            requires a senior authoriser (super_admin role). Your current admin role does
            not include super_admin, so these actions are disabled.
          </p>
        </div>
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </ModalShell>
    );
  }

  const targets = panel.availablePlans.filter((p) => p.id !== panel.plan?.id);
  const targetName = targets.find((p) => p.id === planId)?.name;

  const execute = async () => {
    setBusy(true);
    setError(null);
    let res: AdminBillingActionResult;
    if (kind === "override") {
      res = await adminCommitmentOverride({
        data: { companyId, reason, clientRequestNote: note, financialTreatment: treatment, effectiveDate },
      });
    } else {
      if (!planId) {
        setError("Select a target plan for the immediate downgrade.");
        setBusy(false);
        return;
      }
      res = await adminImmediateDowngrade({
        data: { companyId, newPlanId: planId, reason, clientRequestNote: note, financialTreatment: treatment, effectiveDate },
      });
    }
    if (res.ok) onDone(res.message);
    else {
      setError(res.error);
      setBusy(false);
    }
  };

  return (
    <ModalShell eyebrow="Senior authorisation" title="Commitment override / immediate downgrade" onClose={onClose}>
      {!review ? (
        <div className="flex flex-col gap-4">
          <Field label="Action" hint="Override waives the commitment lock; immediate downgrade also changes the plan now.">
            <Select value={kind} onChange={(e) => setKind(e.target.value as "override" | "immediate")}>
              <option value="override">Commitment override only (waive minimum lock)</option>
              <option value="immediate">Immediate downgrade (waive lock + change plan now)</option>
            </Select>
          </Field>
          {kind === "immediate" && (
            <Field label="Target plan" hint="Applied immediately under the approved exception.">
              <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
                <option value="">Select a lower plan...</option>
                {targets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} - {fmtAed(p.priceMonthlyAel ?? p.priceAnnualAel)}/month
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Reason" hint="One of the approved exception reasons (spec §5).">
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>
              {OVERRIDE_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Client request / supporting note" hint="What the client asked for, or the context of the exception.">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional - reference the client request or supporting evidence"
              rows={2}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Financial treatment">
              <Select value={treatment} onChange={(e) => setTreatment(e.target.value)}>
                {FINANCIAL_TREATMENTS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Effective date">
              <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
            </Field>
          </div>
          {error && <ErrorText>{error}</ErrorText>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={kind === "immediate" && !planId}
              onClick={() => setReview(true)}
            >
              Review change
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-slate-200 bg-mist/50 p-4">
            <SectionHeading title="Confirm senior-authorised change" body="This action is recorded with your identity, the reason and the financial treatment." />
            <dl>
              <ConfirmRow label="Action" value={kind === "override" ? "Commitment override" : "Immediate downgrade"} accent />
              {kind === "immediate" && <ConfirmRow label="Current plan" value={panel.plan?.name ?? "-"} />}
              {kind === "immediate" && <ConfirmRow label="New plan" value={targetName ?? "-"} accent />}
              <ConfirmRow label="Reason" value={reason} />
              <ConfirmRow label="Client request note" value={note || "-"} />
              <ConfirmRow label="Financial treatment" value={treatment} />
              <ConfirmRow label="Effective date" value={fmtDate(effectiveDate)} />
              <ConfirmRow
                label="Commitment effect"
                value={kind === "override" ? `Minimum lock waived from ${fmtDate(effectiveDate)}` : `Minimum lock waived from ${fmtDate(effectiveDate)}; plan changes immediately`}
              />
            </dl>
          </div>
          {error && <ErrorText>{error}</ErrorText>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setReview(false)}>
              Back
            </Button>
            <Button type="button" size="sm" disabled={busy} onClick={() => void execute()}>
              {busy ? "Applying..." : "Confirm and apply"}
            </Button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

// ------------------------------------------------------------ cancel flow
function CancelFlowModal({
  companyId,
  panel,
  onDone,
  onClose,
}: {
  companyId: string;
  panel: AdminBillingPanel;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"end_of_period" | "immediate">("end_of_period");
  const [reason, setReason] = useState("");
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = async () => {
    setBusy(true);
    setError(null);
    const res = await adminCancelSubscription({ data: { companyId, mode, reason } });
    if (res.ok) onDone(res.message);
    else {
      setError(res.error);
      setBusy(false);
    }
  };

  return (
    <ModalShell eyebrow="Subscription cancellation" title="Cancel membership" onClose={onClose}>
      {!review ? (
        <div className="flex flex-col gap-4">
          <Field label="Cancellation mode" hint="Period-end keeps access until the next billing date.">
            <Select value={mode} onChange={(e) => setMode(e.target.value as "end_of_period" | "immediate")}>
              <option value="end_of_period">At end of current billing period</option>
              <option value="immediate">Immediate (access ends now)</option>
            </Select>
          </Field>
          <Field label="Reason (required)" hint="Recorded in the audit log; the client receives a notification.">
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Company closing operations - requested cancellation"
              rows={3}
            />
          </Field>
          {error && <ErrorText>{error}</ErrorText>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={!reason.trim()} onClick={() => setReview(true)}>
              Review cancellation
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-slate-200 bg-mist/50 p-4">
            <SectionHeading title="Confirm cancellation" body="This notifies the client and is written to the audit log." />
            <dl>
              <ConfirmRow label="Current plan" value={panel.plan?.name ?? "-"} />
              <ConfirmRow label="Mode" value={mode === "immediate" ? "Immediate" : "End of billing period"} accent />
              <ConfirmRow
                label="Access continues"
                value={mode === "immediate" ? "No - access ends immediately" : `Until ${fmtDate(panel.subscription?.nextBillingDate)}`}
              />
              <ConfirmRow label="Reason" value={reason} />
            </dl>
          </div>
          {error && <ErrorText>{error}</ErrorText>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setReview(false)}>
              Back
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void execute()}>
              {busy ? "Cancelling..." : "Confirm cancellation"}
            </Button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

// ------------------------------------------------------------------- panel
export function AdminSubscriptionPanel({
  companyId,
  staffRoles,
  adminCanMutate,
}: {
  companyId: string;
  staffRoles: string[];
  adminCanMutate: boolean;
}) {
  const [panel, setPanel] = useState<AdminBillingPanel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<"upgrade" | "downgrade" | "senior" | "cancel" | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const res = await adminGetBillingPanel({ data: { companyId } });
    if (res.ok) setPanel(res.panel);
    else setError(res.error);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  if (loading && !panel) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted">Loading billing panel...</p>
      </Card>
    );
  }
  if (error && !panel) {
    return (
      <Card className="p-6">
        <ErrorText>{error}</ErrorText>
      </Card>
    );
  }
  if (!panel || !panel.subscription) {
    return (
      <Card className="p-6">
        <EmptyState
          title="No subscription record"
          body="This company has no subscription yet. Memberships appear once a client selects a plan and completes checkout."
        />
      </Card>
    );
  }

  const sub = panel.subscription;
  const plan = panel.plan;
  const mc = panel.minCommitment;
  const pm = panel.paymentMethod;
  const isSuperAdmin = staffRoles.includes("super_admin");

  return (
    <div className="flex flex-col gap-6">
      {notice && (
        <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm font-medium text-success">
          {notice}
        </p>
      )}
      {!adminCanMutate && (
        <p className="rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-sm font-medium text-[#6b4c00]">
          Read-only mode: this admin account cannot mutate company data, so the management
          actions below are disabled.
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <SectionHeading title="Subscription" body="Live billing panel for this company (spec §6)." />
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Fact label="Current plan" value={plan ? `${plan.name} (${plan.code})` : "-"} />
            <Fact label="Plan price" value={plan ? `${fmtAed(plan.priceAel)} / ${plan.interval}` : "-"} />
            <Fact label="Billing interval" value={sub.billingInterval === "annual" ? "Annual" : "Monthly"} />
            <div>
              <dt className="text-xs font-bold uppercase tracking-wider text-muted">Subscription status</dt>
              <dd className="mt-0.5">
                <Badge tone={SUB_STATUS_TONES[sub.status] ?? "slate"}>{sub.status.replace(/_/g, " ")}</Badge>
              </dd>
            </div>
            <Fact label="Subscription start" value={fmtDate(sub.startedAt)} />
            <Fact label="Current billing period" value={`${fmtDate(sub.currentPeriodStart)} - ${fmtDate(sub.currentPeriodEnd)}`} />
            <Fact label="Next billing date" value={fmtDate(sub.nextBillingDate)} />
            <Fact label="Payment method" value={pm ? `${pm.brand ?? pm.type} •••• ${pm.last4 ?? ""}${pm.expiry ? ` (${pm.expiry})` : ""}` : "None on file"} />
            <Fact label="Outstanding balance" value={fmtAed(panel.outstandingBalanceAel)} />
            <Fact label="Failed payment" value={panel.failedPayment ? "Yes - action required" : "No"} />
            <Fact label="Pending upgrade" value={panel.pendingUpgrade ? `${panel.pendingUpgrade.toPlanName ?? ""} (${panel.pendingUpgrade.status})` : "-"} />
            <Fact label="Pending downgrade" value={panel.pendingDowngrade ? `${panel.pendingDowngrade.toPlanName ?? ""} (${panel.pendingDowngrade.status})` : "-"} />
            <Fact
              label="Cancellation status"
              value={
                panel.cancellation
                  ? `${panel.cancellation.status.replace(/_/g, " ")} (${panel.cancellation.mode.replace(/_/g, " ")})`
                  : sub.status === "cancelled" || sub.status === "cancel_at_period_end"
                    ? sub.status.replace(/_/g, " ")
                    : "-"
              }
            />
            <Fact label="Stripe customer ID" value={panel.customer?.providerCustomerId ?? "- (sandbox)"} />
            <Fact label="Stripe subscription ID" value={sub.providerSubscriptionId ?? "- (sandbox)"} />
          </dl>
        </Card>
        <div className="flex flex-col gap-6">
          <Card className="p-6">
            <SectionHeading title="Minimum commitment" body="Three-month minimum service commitment." />
            {mc ? (
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <Fact label="Commitment start" value={fmtDate(mc.commitmentStart)} />
                <Fact label="Commitment end" value={fmtDate(mc.commitmentEnd)} />
                <Fact label="Cycles required" value={String(mc.cyclesRequired)} />
                <Fact label="Completed" value={mc.completed ? `Yes${mc.completedAt ? ` (${fmtDate(mc.completedAt)})` : ""}` : "No"} />
                <Fact label="Downgrade eligibility" value={fmtDate(mc.downgradeEligibleDate)} />
                <div>
                  <dt className="text-xs font-bold uppercase tracking-wider text-muted">Downgrade lock</dt>
                  <dd className="mt-0.5">
                    {mc.downgradeLocked ? (
                      <Badge tone="amber">Locked until {fmtDate(mc.downgradeEligibleDate)}</Badge>
                    ) : (
                      <Badge tone="green">Eligible</Badge>
                    )}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted">No minimum commitment recorded.</p>
            )}
          </Card>
          <Card className="p-6">
            <SectionHeading title="Management actions" body="Every action requires confirmation and writes an audit entry + client notification." />
            <div className="grid gap-3 sm:grid-cols-2">
              <Button type="button" size="sm" disabled={!adminCanMutate} onClick={() => setModal("upgrade")}>
                Upgrade plan
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={!adminCanMutate} onClick={() => setModal("downgrade")}>
                Downgrade plan
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!adminCanMutate}
                onClick={() => setModal("senior")}
                title={isSuperAdmin ? "Commitment override / immediate downgrade" : "Requires super_admin role"}
              >
                Senior actions
              </Button>
              <Button type="button" size="sm" variant="secondary" disabled={!adminCanMutate} onClick={() => setModal("cancel")}>
                Cancel subscription
              </Button>
            </div>
            {!isSuperAdmin && (
              <p className="mt-3 text-xs text-muted">
                Senior actions (commitment override / immediate downgrade) require the super_admin role.
              </p>
            )}
            {(panel.pendingUpgrade || panel.pendingDowngrade || panel.cancellation) && (
              <div className="mt-4 flex flex-col gap-2 rounded-xl border border-amber/40 bg-amber/10 p-3 text-xs text-[#6b4c00]">
                {panel.pendingUpgrade && (
                  <p>Pending upgrade to {panel.pendingUpgrade.toPlanName ?? "plan"} (effective {fmtDate(panel.pendingUpgrade.effectiveDate)}).</p>
                )}
                {panel.pendingDowngrade && (
                  <p>Pending downgrade to {panel.pendingDowngrade.toPlanName ?? "plan"} (effective {fmtDate(panel.pendingDowngrade.effectiveDate)}).</p>
                )}
                {panel.cancellation && (
                  <p>Cancellation {panel.cancellation.status} ({panel.cancellation.mode.replace(/_/g, " ")}; effective {fmtDate(panel.cancellation.effectiveDate)}).</p>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
      <Card className="p-6">
        <SectionHeading title="Invoices" body="Subscription invoices from the billing provider (sandbox)." />
        {panel.invoices.length === 0 ? (
          <p className="text-sm text-muted">No invoices yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                  <th className="py-2 pr-3">Number</th>
                  <th className="py-2 pr-3">Period</th>
                  <th className="py-2 pr-3">Total</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Due</th>
                  <th className="py-2">Paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {panel.invoices.map((i) => (
                  <tr key={i.id}>
                    <td className="py-2 pr-3 font-medium text-navy">{i.invoiceNumber}</td>
                    <td className="py-2 pr-3 text-muted">{fmtDate(i.billingPeriodStart)} - {fmtDate(i.billingPeriodEnd)}</td>
                    <td className="py-2 pr-3">{fmtAed(i.totalAel)}</td>
                    <td className="py-2 pr-3">
                      <Badge tone={i.status === "Open" ? "amber" : i.status === "Failed" ? "red" : "green"}>{i.status}</Badge>
                    </td>
                    <td className="py-2 pr-3 text-muted">{fmtDate(i.dueDate)}</td>
                    <td className="py-2 text-muted">{fmtDate(i.paidAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <SectionHeading title="Payment events" body="Latest payment events for this customer." />
          {panel.paymentEvents.length === 0 ? (
            <p className="text-sm text-muted">No payment events yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {panel.paymentEvents.map((e) => (
                <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-medium text-ink">{e.eventType.replace(/_/g, " ")}</span>
                  <span className="text-xs text-muted">{fmtAed(e.amountAel)} · {fmtDate(e.occurredAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-6">
          <SectionHeading title="Webhook history" body="Latest billing-provider webhook events for this subscription." />
          {panel.webhooks.length === 0 ? (
            <p className="text-sm text-muted">No webhook events yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {panel.webhooks.map((w) => (
                <li key={w.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-medium text-ink">{w.eventType}</span>
                  <span className="text-xs text-muted">{w.processed ? "processed" : "unprocessed"} · {fmtDate(w.receivedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card className="p-6">
        <SectionHeading title="Commitment override history" body="Senior-authorised exceptions to the three-month minimum (spec §5)." />
        {panel.overrides.length === 0 ? (
          <p className="text-sm text-muted">No commitment overrides recorded.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {panel.overrides.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="font-medium text-ink">{o.reason}</span>
                <span className="text-xs text-muted">
                  {o.financialTreatment} · effective {fmtDate(o.effectiveDate)} · {o.seniorAdminName ?? "admin"} · {fmtDate(o.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="p-6">
        <SectionHeading title="Plan entitlements" body="Entitlements included in the current plan, marked Plan Included." />
        {plan && plan.entitlements.length === 0 ? (
          <p className="text-sm text-muted">This plan has no entitlements configured.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(plan?.entitlements ?? []).map((e) => (
              <span key={e.key} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-mist px-3 py-1 text-xs font-semibold text-ink">
                {e.key.replace(/_/g, " ")}
                <Badge tone="teal">Plan Included</Badge>
              </span>
            ))}
          </div>
        )}
      </Card>
      {modal === "upgrade" && (
        <UpgradeFlowModal
          companyId={companyId}
          panel={panel}
          onClose={() => setModal(null)}
          onDone={(msg) => {
            setModal(null);
            setNotice(msg);
            void load();
          }}
        />
      )}
      {modal === "downgrade" && (
        <DowngradeFlowModal
          companyId={companyId}
          panel={panel}
          onClose={() => setModal(null)}
          onDone={(msg) => {
            setModal(null);
            setNotice(msg);
            void load();
          }}
        />
      )}
      {modal === "senior" && (
        <SeniorFlowModal
          companyId={companyId}
          panel={panel}
          isSuperAdmin={isSuperAdmin}
          onClose={() => setModal(null)}
          onDone={(msg) => {
            setModal(null);
            setNotice(msg);
            void load();
          }}
        />
      )}
      {modal === "cancel" && (
        <CancelFlowModal
          companyId={companyId}
          panel={panel}
          onClose={() => setModal(null)}
          onDone={(msg) => {
            setModal(null);
            setNotice(msg);
            void load();
          }}
        />
      )}
    </div>
  );
}
