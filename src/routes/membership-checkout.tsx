import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import {
  Badge,
  Button,
  Card,
  DbSetupPage,
  ErrorText,
  Field,
  Input,
  Logo,
} from "~/components/ui";
import { getSessionUser, signOut } from "~/lib/auth";
import {
  completeCheckoutFn,
  getSubscriptionStatusFn,
  listPlans,
  selectPlanFn,
} from "~/lib/billing";
import type { BillingInterval, PlanPublic, SubscriptionGate } from "~/lib/billing";
import {
  COMMITMENT_NOTICE,
  MembershipStepper,
  estimatedCommitmentEnd,
  estimatedNextBilling,
  formatAed,
  formatDate,
  gateDestination,
  intervalLabel,
} from "~/lib/membership";

export const Route = createFileRoute("/membership-checkout")({
  validateSearch: (search: Record<string, unknown>) => ({
    plan: typeof search.plan === "string" ? search.plan : undefined,
    interval:
      search.interval === "annual"
        ? ("annual" as const)
        : search.interval === "monthly"
          ? ("monthly" as const)
          : undefined,
    resume: typeof search.resume === "string" ? search.resume : undefined,
  }),
  loaderDeps: ({ search }) => ({
    plan: search.plan,
    interval: search.interval,
    resume: search.resume,
  }),
  loader: async ({ deps }) => {
    const search = deps;
    const session = await getSessionUser();
    if (session.setupRequired) {
      return {
        setupRequired: true as const,
        user: null,
        gate: null,
        plans: null,
        planId: undefined as string | undefined,
        interval: "monthly" as const,
      };
    }
    if (!session.user) throw redirect({ to: "/login" });
    const [gateResult, plansResult] = await Promise.all([
      getSubscriptionStatusFn(),
      listPlans(),
    ]);
    const gate = gateResult.ok ? gateResult.data : null;
    if (gate) {
      const dest = gateDestination(gate.status);
      if (dest.kind === "recovery") throw redirect({ to: "/billing-recovery" });
      if (dest.kind === "dashboard") throw redirect({ to: "/app" });
    }
    // Plan + interval resolution. Explicit search params win; otherwise fall
    // back to the pending selection carried by the subscription (resume flow),
    // then to safe defaults. The page must render correctly even when search
    // params are missing on the client (hydration/loaderDeps quirks) — this
    // route never redirects to /membership; the component renders a recovery
    // state instead when no plan can be resolved.
    const planId = search.plan ?? gate?.planId ?? undefined;
    const interval: BillingInterval =
      search.interval ?? gate?.interval ?? "monthly";
    return {
      setupRequired: false as const,
      user: session.user,
      gate,
      plans: plansResult.ok ? plansResult.data : null,
      plansError: plansResult.ok ? null : plansResult.error,
      planId,
      interval,
    };
  },
  component: MembershipCheckoutPage,
});

type CheckoutStep = "review" | "payment";

function MembershipCheckoutPage() {
  const { setupRequired, user, gate, plans, plansError, planId, interval } =
    Route.useLoaderData();
  const [step, setStep] = useState<CheckoutStep>("review");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (setupRequired || !user) {
    return (
      <DbSetupPage title="Membership checkout">
        Connect a Postgres database (DATABASE_URL) and re-run `bun run publish`
        to complete membership checkout.
      </DbSetupPage>
    );
  }

  const plan = (plans ?? []).find((p) => p.id === planId) ?? null;

  if (!plan) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-mist px-5">
        <Card className="w-full max-w-md p-8 text-center">
          <p className="font-display text-xl font-bold text-navy">No plan selected</p>
          <p className="mt-2 text-sm text-muted">
            Choose a membership plan to continue.
          </p>
          <a
            href="/membership"
            className="mt-5 inline-block text-sm font-semibold text-brand hover:underline"
          >
            ← Back to membership pricing
          </a>
        </Card>
      </div>
    );
  }

  const selectedPlan = plan;
  const price = interval === "annual" ? plan.priceAnnualAel : plan.priceMonthlyAel;

  async function handlePay(simulate: "success" | "failure") {
    setError(null);
    setBusy(true);
    try {
      const sel = await selectPlanFn({
        data: { planId: selectedPlan.id, billingInterval: interval },
      });
      if (!sel.ok) {
        if (sel.code === "ALREADY_ACTIVE") {
          window.location.assign("/app");
          return;
        }
        setError(sel.error);
        setBusy(false);
        return;
      }
      const cc = await completeCheckoutFn({
        data: { subscriptionId: sel.data.subscriptionId, simulate },
      });
      if (cc.ok && cc.data.status === "active") {
        window.location.assign("/membership-confirmed");
        return;
      }
      if (cc.ok && cc.data.status === "payment_failed") {
        window.location.assign("/billing-recovery");
        return;
      }
      setError(cc.ok ? `Unexpected checkout status: ${cc.data.status}.` : cc.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-mist">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="container-site flex h-16 items-center justify-between gap-4">
          <a href="/" className="shrink-0">
            <Logo />
          </a>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={async () => {
              await signOut();
              window.location.assign("/");
            }}
          >
            Sign out
          </Button>
        </div>
      </header>

      <main className="container-site py-10">
        <MembershipStepper step={step === "review" ? 1 : 2} />

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_380px]">
          <div className="flex flex-col gap-6">
            {step === "review" ? (
              <ReviewStep
                plan={plan}
                interval={interval}
                gate={gate}
                confirmed={confirmed}
                setConfirmed={setConfirmed}
                onContinue={() => {
                  setError(null);
                  setStep("payment");
                }}
              />
            ) : (
              <PaymentStep
                plan={plan}
                interval={interval}
                price={price}
                busy={busy}
                onBack={() => setStep("review")}
                onPay={() => handlePay("success")}
                onSimulateFailure={() => handlePay("failure")}
              />
            )}
          </div>

          <OrderSummary plan={plan} interval={interval} gate={gate} />
        </div>

        {error && <div className="mt-6 max-w-2xl"><ErrorText>{error}</ErrorText></div>}

        {plansError && (
          <p className="mt-6 max-w-2xl text-sm text-muted">
            Plan data unavailable ({plansError}).
          </p>
        )}
      </main>
    </div>
  );
}

// ------------------------------------------------------------- review step
function ReviewStep({
  plan,
  interval,
  gate,
  confirmed,
  setConfirmed,
  onContinue,
}: {
  plan: PlanPublic;
  interval: BillingInterval;
  gate: SubscriptionGate | null;
  confirmed: boolean;
  setConfirmed: (v: boolean) => void;
  onContinue: () => void;
}) {
  const price = interval === "annual" ? plan.priceAnnualAel : plan.priceMonthlyAel;
  return (
    <Card className="p-6 sm:p-8">
      <p className="text-sm font-bold uppercase tracking-widest text-teal">
        Step 1 · Review your plan
      </p>
      <h1 className="mt-1 text-2xl font-bold text-navy">Confirm your membership</h1>
      <p className="mt-1.5 text-sm text-muted">
        {gate?.hasSubscription && gate.status !== "pending_plan_selection"
          ? "You have a pending checkout — reviewing again will resume it with the details below."
          : "Review the terms, confirm the minimum commitment, then continue to payment."}
      </p>

      <dl className="mt-6 grid gap-4 rounded-xl bg-mist p-5 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Plan</dt>
          <dd className="mt-0.5 font-semibold text-navy">{plan.name}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Billing</dt>
          <dd className="mt-0.5 font-semibold text-navy">{intervalLabel(interval)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Price</dt>
          <dd className="mt-0.5 font-semibold text-navy">
            {price === null ? "Custom" : formatAed(price)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Taxes</dt>
          <dd className="mt-0.5 text-sm text-ink">Included in the price</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            First payment
          </dt>
          <dd className="mt-0.5 text-sm text-ink">
            Taken now — {price === null ? "custom amount" : formatAed(price)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Next billing date
          </dt>
          <dd className="mt-0.5 text-sm text-ink">
            {gate?.nextBillingDate
              ? formatDate(gate.nextBillingDate)
              : `${estimatedNextBilling(interval)} (estimated)`}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Minimum service period
          </dt>
          <dd className="mt-0.5 text-sm text-ink">
            {interval === "annual" ? "36 months" : "3 months"} from activation
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Downgrade eligibility
          </dt>
          <dd className="mt-0.5 text-sm text-ink">
            {estimatedCommitmentEnd(interval)} (after the minimum period)
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Cancellation
          </dt>
          <dd className="mt-0.5 text-sm text-ink">
            Requestable at any time; access continues until the applicable end date.
          </dd>
        </div>
      </dl>

      <div className="mt-6">
        <p className="text-sm font-bold text-navy">What's included</p>
        <ul className="mt-3 grid gap-2 text-sm text-ink sm:grid-cols-2">
          {(plan.features ?? []).map((f) => (
            <li key={f} className="flex items-start gap-2">
              <span className="mt-0.5 text-teal">✓</span>
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>

      <label className="mt-8 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-mist/60 p-4">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[#1769aa]"
        />
        <span className="text-sm text-ink">
          I confirm that{" "}
          <span className="font-semibold text-navy">{COMMITMENT_NOTICE}</span>
        </span>
      </label>

      <Button
        size="lg"
        className="mt-5 w-full"
        disabled={!confirmed}
        onClick={onContinue}
      >
        Continue to payment
      </Button>
      <p className="mt-3 text-center text-xs text-muted">
        {confirmed
          ? "You'll review and simulate payment on the next step."
          : "Tick the confirmation above to continue."}
      </p>
    </Card>
  );
}

// ------------------------------------------------------------ payment step
function PaymentStep({
  plan,
  interval,
  price,
  busy,
  onBack,
  onPay,
  onSimulateFailure,
}: {
  plan: PlanPublic;
  interval: BillingInterval;
  price: number | null;
  busy: boolean;
  onBack: () => void;
  onPay: () => void;
  onSimulateFailure: () => void;
}) {
  return (
    <Card className="p-6 sm:p-8">
      <p className="text-sm font-bold uppercase tracking-widest text-teal">
        Step 2 · Payment
      </p>
      <h1 className="mt-1 text-2xl font-bold text-navy">Complete your payment</h1>
      <p className="mt-1.5 text-sm text-muted">
        {plan.name} · {intervalLabel(interval)}
      </p>

      <div className="mt-6 rounded-xl border border-slate-200 bg-mist/60 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          Sandbox payment — simulated
        </p>
        <p className="mt-1 text-xs text-muted">
          ScaleBridge is running in sandbox billing mode. No real money moves:
          the form below is pre-filled and disabled for demonstration.
        </p>
      </div>

      <form
        className="mt-5 flex flex-col gap-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onPay();
        }}
      >
        <Field label="Card number" htmlFor="card-number">
          <Input
            id="card-number"
            value="4242 4242 4242 4242"
            disabled
            placeholder="4242 4242 4242 4242"
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Expiry" htmlFor="card-expiry">
            <Input id="card-expiry" value="12/28" disabled />
          </Field>
          <Field label="CVC" htmlFor="card-cvc">
            <Input id="card-cvc" value="123" disabled />
          </Field>
        </div>
        <Field label="Name on card" htmlFor="card-name">
          <Input id="card-name" value="ScaleBridge Sandbox" disabled />
        </Field>

        <div className="mt-2 flex flex-col gap-3">
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? "Processing…" : `Pay ${price === null ? "custom amount" : formatAed(price)}`}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={busy}
            onClick={onSimulateFailure}
          >
            Simulate declined payment
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onBack}>
            ← Back to review
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ----------------------------------------------------------- order summary
function OrderSummary({
  plan,
  interval,
  gate,
}: {
  plan: PlanPublic;
  interval: BillingInterval;
  gate: SubscriptionGate | null;
}) {
  const price = interval === "annual" ? plan.priceAnnualAel : plan.priceMonthlyAel;
  return (
    <Card className="h-fit p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-navy">Order summary</h2>
        <Badge tone="blue">{plan.category === "anchor" ? "Anchor" : "Partner"}</Badge>
      </div>
      <dl className="mt-5 flex flex-col gap-3 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-muted">Plan</dt>
          <dd className="font-semibold text-navy">{plan.name}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-muted">Billing</dt>
          <dd className="font-semibold text-navy">{interval === "annual" ? "Annual" : "Monthly"}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-muted">Due now</dt>
          <dd className="font-semibold text-navy">
            {price === null ? "Custom" : formatAed(price)}
          </dd>
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
          <dt className="font-semibold text-navy">Total</dt>
          <dd className="font-display text-lg font-bold text-navy">
            {price === null ? "Custom" : formatAed(price)}
          </dd>
        </div>
      </dl>
      {gate?.hasSubscription && (
        <p className="mt-4 rounded-lg bg-mist px-3 py-2 text-xs text-muted">
          Resuming checkout · your earlier selection ({formatAed(gate.priceAel)}{" "}
          {gate.interval === "annual" ? "annual" : "monthly"}) will be replaced by
          this one.
        </p>
      )}
      <div className="mt-4 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-xs text-[#6b4c00]">
        <p className="font-semibold">Minimum commitment</p>
        <p className="mt-0.5">{COMMITMENT_NOTICE}</p>
      </div>
    </Card>
  );
}
