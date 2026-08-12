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
  Select,
  Textarea,
} from "~/components/ui";
import { getSessionUser, signOut } from "~/lib/auth";
import { getMyCompany, saveCompany } from "~/lib/company";
import { getSubscriptionStatusFn } from "~/lib/billing";
import { MembershipStepper, gateDestination } from "~/lib/membership";
import type { PublicCompany } from "~/lib/types";

export const Route = createFileRoute("/onboarding")({
  loader: async () => {
    const session = await getSessionUser();
    if (session.setupRequired) {
      return { setupRequired: true as const, user: null, company: null };
    }
    if (!session.user) throw redirect({ to: "/login" });
    const gateResult = await getSubscriptionStatusFn();
    const gate = gateResult.ok ? gateResult.data : null;
    if (gate) {
      const dest = gateDestination(gate.status);
      if (dest.kind === "recovery") throw redirect({ to: "/billing-recovery" });
      if (dest.kind === "pricing" || dest.kind === "resume") {
        throw redirect({ to: "/membership" });
      }
      // dashboard kinds pass through
    }
    const companyResult = await getMyCompany();
    if (companyResult.ok && companyResult.company) {
      // Profile already complete — straight to the dashboard.
      throw redirect({ to: "/app" });
    }
    return {
      setupRequired: false as const,
      user: session.user,
      company: companyResult.ok ? companyResult.company : null,
    };
  },
  component: OnboardingPage,
});

function OnboardingPage() {
  const { setupRequired, user, company } = Route.useLoaderData();
  if (setupRequired || !user) {
    return (
      <DbSetupPage title="Business profile">
        Connect a Postgres database (DATABASE_URL) and re-run `bun run publish`
        to complete onboarding.
      </DbSetupPage>
    );
  }
  return <OnboardingBody userEmail={user.email} company={company} />;
}

function OnboardingBody({
  userEmail,
  company,
}: {
  userEmail: string;
  company: PublicCompany | null;
}) {
  const [name, setName] = useState(company?.name ?? "");
  const [type, setType] = useState(company?.type ?? "");
  const [description, setDescription] = useState(company?.description ?? "");
  const [contactEmail, setContactEmail] = useState(company?.contactEmail ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await saveCompany({
      data: { name, type, description, contactEmail },
    });
    setPending(false);
    if (result.ok) {
      // Hard redirect: fresh SSR load guarantees the /app loader re-runs the
      // subscription gate with the updated profile.
      window.location.assign("/app");
      return;
    }
    if (result.error === "UNAUTHENTICATED") {
      setError("Your session expired — please sign in again.");
    } else {
      setError(result.error);
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
        <div className="w-full max-w-2xl">
          <MembershipStepper step={3} />
        </div>

        <Card className="mt-8 w-full max-w-2xl p-8 sm:p-10">
          <p className="text-sm font-bold uppercase tracking-widest text-teal">
            Onboarding · Step 3 of 4
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold text-navy">
            Complete your business profile
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            This is how lead contractors find and evaluate your company. You can
            refine it any time from the dashboard.
          </p>

          <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
            <Field label="Company name" htmlFor="company-name">
              <Input
                id="company-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Meridian HVAC Ltd."
                required
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Type of business" htmlFor="company-type">
                <Select id="company-type" value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="">Select a type…</option>
                  <option value="hvac">HVAC</option>
                  <option value="cleaning">Cleaning &amp; facilities</option>
                  <option value="security">Security</option>
                  <option value="electrical">Electrical</option>
                  <option value="plumbing">Plumbing</option>
                  <option value="construction">Construction</option>
                  <option value="it">IT &amp; technology</option>
                  <option value="other">Other</option>
                </Select>
              </Field>
              <Field label="Contact email" htmlFor="company-email">
                <Input
                  id="company-email"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder={userEmail}
                />
              </Field>
            </div>
            <Field
              label="Description"
              htmlFor="company-description"
              hint="A short paragraph on what your company does and its specialties."
            >
              <Textarea
                id="company-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="We design, install and maintain systems for commercial buildings across the region…"
                rows={4}
              />
            </Field>

            {error && <ErrorText>{error}</ErrorText>}

            <div className="mt-2 flex flex-col gap-3">
              <Button type="submit" size="lg" disabled={pending}>
                {pending ? "Saving…" : "Save profile & continue to dashboard"}
              </Button>
            </div>
          </form>

          <div className="mt-8 flex items-center gap-2 rounded-xl bg-mist px-4 py-3 text-xs text-muted">
            <Badge tone="teal">Verification</Badge>
            <span>
              Verification review arrives in a later phase. Your profile is live now;
              verification adds the check-mark badge.
            </span>
          </div>
        </Card>
      </main>
    </div>
  );
}
