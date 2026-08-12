import { createFileRoute, redirect } from "@tanstack/react-router";
import { Badge, Button, Card, DbSetupPage, Logo } from "~/components/ui";
import { getSessionUser, signOut } from "~/lib/auth";
import { getMyCompany } from "~/lib/company";
import { getSubscriptionStatusFn } from "~/lib/billing";
import {
  COMMITMENT_NOTICE,
  MembershipStepper,
  formatAed,
  formatDate,
  gateDestination,
  intervalLabel,
} from "~/lib/membership";

export const Route = createFileRoute("/membership-confirmed")({
  loader: async () => {
    const session = await getSessionUser();
    if (session.setupRequired) {
      return { setupRequired: true as const, user: null, gate: null, hasCompany: false };
    }
    if (!session.user) throw redirect({ to: "/login" });
    const gateResult = await getSubscriptionStatusFn();
    const gate = gateResult.ok ? gateResult.data : null;
    if (gate) {
      const dest = gateDestination(gate.status);
      // Only an activated subscription may see the confirmation page.
      if (dest.kind !== "dashboard") {
        if (dest.kind === "recovery") throw redirect({ to: "/billing-recovery" });
        throw redirect({ to: "/membership" });
      }
    } else {
      throw redirect({ to: "/membership" });
    }
    const companyResult = await getMyCompany();
    return {
      setupRequired: false as const,
      user: session.user,
      gate,
      hasCompany: companyResult.ok && companyResult.company !== null,
    };
  },
  component: MembershipConfirmedPage,
});

function MembershipConfirmedPage() {
  const { setupRequired, user, gate, hasCompany } = Route.useLoaderData();
  if (setupRequired || !user) {
    return (
      <DbSetupPage title="Payment confirmed">
        Connect a Postgres database (DATABASE_URL) and re-run `bun run publish`
        to complete onboarding.
      </DbSetupPage>
    );
  }
  const plan = gate?.planName ?? "your membership";
  const price = gate ? formatAed(gate.priceAel) : "—";
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
            onClick={async () => {
              await signOut();
              window.location.assign("/");
            }}
          >
            Sign out
          </Button>
        </div>
      </header>

      <main className="container-site flex flex-col items-center py-12">
        <MembershipStepper step={2} />

        <Card className="mt-8 w-full max-w-2xl p-8 text-center sm:p-10">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-success/10 text-success">
            <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
          <p className="mt-5 text-sm font-bold uppercase tracking-widest text-teal">
            Payment confirmed
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold text-navy">
            Your {plan} membership is active
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted">
            Thank you — your payment was processed and your ScaleBridge membership
            is now active. Account entitlements have been applied.
          </p>

          <dl className="mx-auto mt-8 grid max-w-md gap-3 rounded-xl bg-mist p-5 text-left text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Plan</dt>
              <dd className="mt-0.5 font-semibold text-navy">{plan}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Billing</dt>
              <dd className="mt-0.5 font-semibold text-navy">
                {gate ? intervalLabel(gate.interval) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Price</dt>
              <dd className="mt-0.5 font-semibold text-navy">{price}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Status</dt>
              <dd className="mt-0.5">
                <Badge tone="green">{gate?.statusLabel ?? "Active"}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                Next payment due
              </dt>
              <dd className="mt-0.5 text-ink">{formatDate(gate?.nextBillingDate)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                Minimum commitment ends
              </dt>
              <dd className="mt-0.5 text-ink">{formatDate(gate?.minCommitmentEnd)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                Downgrade available
              </dt>
              <dd className="mt-0.5 text-ink">{formatDate(gate?.downgradeEligibleDate)}</dd>
            </div>
          </dl>

          <div className="mx-auto mt-6 max-w-md rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-xs text-[#6b4c00]">
            {COMMITMENT_NOTICE}
          </div>

          <a
            href={hasCompany ? "/app" : "/onboarding"}
            className="mt-8 inline-flex h-12 w-full items-center justify-center rounded-lg bg-brand px-6 text-base font-semibold text-white transition-colors hover:bg-[#145a93] sm:max-w-xs"
          >
            {hasCompany ? "Go to your dashboard →" : "Continue to business profile →"}
          </a>
          <p className="mt-3 text-xs text-muted">
            {hasCompany
              ? "Your company profile is already set up."
              : "Next: complete your business profile, then access the dashboard."}
          </p>
        </Card>
      </main>
    </div>
  );
}
