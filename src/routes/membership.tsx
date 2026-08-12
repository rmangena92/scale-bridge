import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { Badge, Button, Card, DbSetupPage, Logo, SetupNotice } from "~/components/ui";
import { getSessionUser, signOut } from "~/lib/auth";
import { getSubscriptionStatusFn, listPlans } from "~/lib/billing";
import type { PlanPublic } from "~/lib/billing";
import {
  COMMITMENT_NOTICE,
  MembershipStepper,
  formatAed,
  gateDestination,
  intervalLabel,
} from "~/lib/membership";
import type { SubscriptionGate } from "~/lib/billing";

export const Route = createFileRoute("/membership")({
  validateSearch: (search: Record<string, unknown>): { resume?: string } => ({
    resume: typeof search.resume === "string" ? search.resume : undefined,
  }),
  loaderDeps: ({ search }) => ({ resume: search.resume }),
  loader: async ({ deps }) => {
    const session = await getSessionUser();
    if (session.setupRequired) {
      return { setupRequired: true as const, user: null, gate: null, plans: null, resume: null };
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
    return {
      setupRequired: false as const,
      user: session.user,
      gate,
      plans: plansResult.ok ? plansResult.data : null,
      plansError: plansResult.ok ? null : plansResult.error,
      resume: deps.resume ?? null,
    };
  },
  component: MembershipPage,
});

function MembershipPage() {
  const { setupRequired, user, gate, plans, plansError, resume } = Route.useLoaderData();
  if (setupRequired || !user) {
    return (
      <DbSetupPage title="Membership pricing">
        Connect a Postgres database (DATABASE_URL) and re-run `bun run publish`
        to choose a ScaleBridge membership.
      </DbSetupPage>
    );
  }
  return (
    <div className="min-h-dvh bg-mist">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="container-site flex h-16 items-center justify-between gap-4">
          <a href="/" className="shrink-0">
            <Logo />
          </a>
          <SignOutButton />
        </div>
      </header>

      <section className="bg-navy py-14 text-white">
        <div className="container-site">
          <MembershipStepper step={1} />
          <p className="mt-6 text-sm font-bold uppercase tracking-widest text-teal">
            ScaleBridge membership
          </p>
          <h1 className="mt-2 max-w-2xl font-display text-3xl font-bold leading-tight sm:text-4xl">
            Choose the membership that fits your business
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-white/70">
            Every plan starts with a free tier. Paid plans add verification,
            visibility, contract coordination and AI partnership intelligence —
            and small businesses are never charged for basic participation in a
            contract.
          </p>
        </div>
      </section>

      <main className="container-site py-10">
        {/* Three-month minimum service notice — always visible (§3, §10). */}
        <div className="mb-8 rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 text-sm text-[#6b4c00]">
          <p className="font-semibold">Three-month minimum service period</p>
          <p className="mt-0.5">{COMMITMENT_NOTICE}</p>
        </div>

        {resume && <ResumeBanner gate={gate} />}
        {!resume && gate && gateDestination(gate.status).kind === "resume" && (
          <ResumeBanner gate={gate} />
        )}

        {plansError && (
          <div className="mb-6">
            <SetupNotice>{plansError}</SetupNotice>
          </div>
        )}

        {plans && plans.length > 0 && <PlanGrid plans={plans} />}
        {plans && plans.length === 0 && (
          <p className="text-sm text-muted">No membership plans are available yet.</p>
        )}

        <p className="mt-10 text-xs text-muted">
          Prices in UAE Dirhams (AED), excluding VAT where applicable. Annual billing
          includes two months free versus monthly. Anchor Enterprise is priced
          individually — contact ScaleBridge for a custom proposal.
        </p>
      </main>
    </div>
  );
}

function ResumeBanner({ gate }: { gate: SubscriptionGate | null }) {
  const planName = gate?.planName ?? "your selected plan";
  const price = gate ? formatAed(gate.priceAel) : "—";
  const interval = gate ? intervalLabel(gate.interval) : "";
  const resumeHref = gate?.subscriptionId
    ? `/membership-checkout?resume=${encodeURIComponent(gate.subscriptionId)}`
    : "/membership-checkout";
  return (
    <div className="mb-8 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-brand/30 bg-brand/5 px-5 py-4">
      <div>
        <p className="text-sm font-bold text-navy">You have a checkout in progress</p>
        <p className="mt-0.5 text-sm text-muted">
          {planName} · {price} {interval} — your membership starts as soon as payment
          is confirmed.
        </p>
      </div>
      <a
        href={resumeHref}
        className="inline-flex h-10 items-center justify-center rounded-lg bg-navy px-4 text-sm font-semibold text-white transition-colors hover:bg-[#0a1830]"
      >
        Resume checkout →
      </a>
    </div>
  );
}

function SignOutButton() {
  const [signingOut, setSigningOut] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={signingOut}
      onClick={async () => {
        setSigningOut(true);
        await signOut();
        window.location.assign("/");
      }}
    >
      {signingOut ? "Signing out…" : "Sign out"}
    </Button>
  );
}

function PlanGrid({ plans }: { plans: PlanPublic[] }) {
  const [interval, setInterval] = useState<"monthly" | "annual">("monthly");
  const partner = plans.filter((p) => p.category === "partner");
  const anchor = plans.filter((p) => p.category === "anchor");

  return (
    <div className="flex flex-col gap-10">
      <div className="flex justify-end">
        <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1 text-sm font-semibold">
          {(["monthly", "annual"] as const).map((iv) => (
            <button
              key={iv}
              type="button"
              onClick={() => setInterval(iv)}
              className={`rounded-md px-4 py-1.5 transition-colors ${
                interval === iv ? "bg-navy text-white" : "text-muted hover:text-navy"
              }`}
            >
              {iv === "monthly" ? "Monthly" : "Annual (2 months free)"}
            </button>
          ))}
        </div>
      </div>

      <section>
        <h2 className="text-lg font-bold text-navy">Partner business plans</h2>
        <p className="mt-0.5 text-sm text-muted">
          For companies building their presence and participating in contracts.
        </p>
        <div className="mt-4 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {partner.map((p) => (
            <PlanCard key={p.id} plan={p} interval={interval} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-bold text-navy">Anchor partner plans</h2>
        <p className="mt-0.5 text-sm text-muted">
          For lead contractors coordinating multi-company contract delivery.
        </p>
        <div className="mt-4 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {anchor.map((p) => (
            <PlanCard key={p.id} plan={p} interval={interval} />
          ))}
        </div>
      </section>
    </div>
  );
}

function PlanCard({
  plan,
  interval,
}: {
  plan: PlanPublic;
  interval: "monthly" | "annual";
}) {
  const price =
    interval === "annual" ? plan.priceAnnualAel : plan.priceMonthlyAel;
  const isCustom = price === null;
  const free = price === 0;
  const offered = plan.billingIntervals.includes(interval);
  const href = `/membership-checkout?plan=${encodeURIComponent(plan.id)}&interval=${interval}`;
  return (
    <Card className="flex flex-col p-6">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-lg font-bold text-navy">{plan.name}</h3>
        <Badge tone={plan.category === "anchor" ? "navy" : "teal"}>
          {plan.category === "anchor" ? "Anchor" : "Partner"}
        </Badge>
      </div>
      <p className="mt-2 min-h-10 text-sm text-muted">{plan.description}</p>
      <div className="mt-4">
        {isCustom ? (
          <p className="font-display text-2xl font-bold text-navy">Custom pricing</p>
        ) : (
          <p className="font-display text-2xl font-bold text-navy">
            {free ? "Free" : formatAed(price)}
            {!free && (
              <span className="text-sm font-semibold text-muted">
                {" "}
                / {interval === "annual" ? "year" : "month"}
              </span>
            )}
          </p>
        )}
        {!isCustom && !offered && (
          <p className="mt-1 text-xs text-muted">
            Not available on {interval} billing.
          </p>
        )}
        {!isCustom && interval === "annual" && price !== null && price > 0 && (
          <p className="mt-1 text-xs text-success">
            ≈ {formatAed(Math.round(price / 12))}/mo billed annually
          </p>
        )}
      </div>
      <ul className="mt-5 flex flex-col gap-2 text-sm text-ink">
        {(plan.features ?? []).slice(0, 8).map((f) => (
          <li key={f} className="flex items-start gap-2">
            <span className="mt-0.5 text-teal">✓</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-6">
        {isCustom ? (
          <Button variant="outline" size="lg" className="w-full" disabled title="Contact ScaleBridge for a custom proposal">
            Custom pricing — contact us
          </Button>
        ) : (
          <a
            href={href}
            className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-brand px-6 text-base font-semibold text-white transition-colors hover:bg-[#145a93]"
          >
            {free ? "Choose Free" : "Choose plan"}
          </a>
        )}
      </div>
    </Card>
  );
}
