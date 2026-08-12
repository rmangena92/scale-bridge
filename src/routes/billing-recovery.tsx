import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  DbSetupPage,
  ErrorText,
  Logo,
} from "~/components/ui";
import { getSessionUser, signOut } from "~/lib/auth";
import { completeCheckoutFn, getSubscriptionStatusFn } from "~/lib/billing";
import {
  COMMITMENT_NOTICE,
  formatAed,
  formatDate,
  gateDestination,
  intervalLabel,
  isBlockedStatus,
} from "~/lib/membership";

export const Route = createFileRoute("/billing-recovery")({
  loader: async () => {
    const session = await getSessionUser();
    if (session.setupRequired) {
      return { setupRequired: true as const, user: null, gate: null };
    }
    if (!session.user) throw redirect({ to: "/login" });
    const gateResult = await getSubscriptionStatusFn();
    const gate = gateResult.ok ? gateResult.data : null;
    if (gate) {
      // Only blocked subscriptions may see this screen (server-side guard).
      if (!isBlockedStatus(gate.status)) {
        const dest = gateDestination(gate.status);
        if (dest.kind === "dashboard") throw redirect({ to: "/app" });
        if (dest.kind === "resume") throw redirect({ to: "/membership" });
        throw redirect({ to: "/membership" });
      }
    }
    return {
      setupRequired: false as const,
      user: session.user,
      gate,
    };
  },
  component: BillingRecoveryPage,
});

function BillingRecoveryPage() {
  const { setupRequired, user, gate } = Route.useLoaderData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retried, setRetried] = useState(false);

  if (setupRequired || !user) {
    return (
      <DbSetupPage title="Billing recovery">
        Connect a Postgres database (DATABASE_URL) and re-run `bun run publish`
        to resolve billing issues.
      </DbSetupPage>
    );
  }

  const status = gate?.status ?? "payment_failed";
  const canRetry = status === "payment_failed";
  const statusTone =
    status === "suspended" ? "navy" : status === "past_due" ? "amber" : "red";

  async function handleRetry() {
    if (!gate?.subscriptionId) return;
    setError(null);
    setRetried(false);
    setBusy(true);
    try {
      const result = await completeCheckoutFn({
        data: { subscriptionId: gate.subscriptionId, simulate: "success" },
      });
      if (result.ok && result.data.status === "active") {
        window.location.assign("/membership-confirmed");
        return;
      }
      if (result.ok && result.data.status === "payment_failed") {
        setRetried(true);
        setError(
          "The payment was declined again. Access stays paused until the outstanding payment is resolved.",
        );
        return;
      }
      setError(result.ok ? `Unexpected status: ${result.data.status}.` : result.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not retry payment.");
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
        <Card className="w-full max-w-2xl p-8 sm:p-10">
          <div className="flex flex-wrap items-center gap-3">
            <span className="grid size-12 place-items-center rounded-full bg-danger/10 text-danger">
              <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              </svg>
            </span>
            <div>
              <Badge tone={statusTone}>{gate?.statusLabel ?? "Payment Failed"}</Badge>
              <h1 className="mt-1 font-display text-2xl font-bold text-navy">
                Access denied until payment is resolved
              </h1>
            </div>
          </div>

          <p className="mt-5 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm font-medium text-danger">
            Your ScaleBridge membership has an outstanding payment. Platform and
            paid-feature access is paused — the dashboard and workspaces are not
            available until the payment is confirmed as resolved.
          </p>

          {gate && (
            <dl className="mt-6 grid gap-4 rounded-xl bg-mist p-5 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Plan</dt>
                <dd className="mt-0.5 font-semibold text-navy">
                  {gate.planName ?? "—"} {gate.hasSubscription && (
                    <span className="font-normal text-muted">· {intervalLabel(gate.interval)}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Payment due
                </dt>
                <dd className="mt-0.5 font-semibold text-danger">{formatAed(gate.priceAel)}</dd>
              </div>
              {gate.minCommitmentEnd && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Minimum commitment ends
                  </dt>
                  <dd className="mt-0.5 text-ink">{formatDate(gate.minCommitmentEnd)}</dd>
                </div>
              )}
              {gate.nextBillingDate && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Next billing date
                  </dt>
                  <dd className="mt-0.5 text-ink">{formatDate(gate.nextBillingDate)}</dd>
                </div>
              )}
            </dl>
          )}

          <div className="mt-6 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-xs text-[#6b4c00]">
            <p className="font-semibold">Your membership commitment still applies</p>
            <p className="mt-0.5">{COMMITMENT_NOTICE}</p>
          </div>

          {canRetry && (
            <div className="mt-6 flex flex-col gap-3">
              <Button size="lg" disabled={busy} onClick={handleRetry}>
                {busy ? "Processing…" : "Retry payment"}
              </Button>
              {retried && (
                <p className="text-xs text-muted">
                  The sandbox provider declined the payment again. Access is restored only
                  once the outstanding payment is confirmed.
                </p>
              )}
            </div>
          )}
          {!canRetry && (
            <p className="mt-6 rounded-lg bg-mist px-4 py-3 text-sm text-muted">
              {status === "suspended"
                ? "Your account has been suspended. Contact ScaleBridge support to review your account."
                : "Your account is past due. Contact ScaleBridge support to arrange resolution."}
            </p>
          )}

          {error && (
            <div className="mt-4">
              <ErrorText>{error}</ErrorText>
            </div>
          )}

          <div className="mt-8 border-t border-slate-100 pt-5">
            <p className="text-sm font-semibold text-navy">
              Not switching to the free plan
            </p>
            <p className="mt-1 text-xs text-muted">
              ScaleBridge never automatically reverts a membership to the free plan
              because of non-payment, and the free-plan revert path is not available
              while a payment is outstanding. Access is restored only when the
              outstanding payment is resolved.
            </p>
          </div>
        </Card>
      </main>
    </div>
  );
}
