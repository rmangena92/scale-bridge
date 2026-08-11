import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import { getClientSession } from "~/lib/client";
import { signIn } from "~/lib/auth";
import {
  Button,
  Card,
  ErrorText,
  Field,
  Input,
  Logo,
  SetupNotice,
} from "~/components/ui";

export const Route = createFileRoute("/client/login")({
  loader: async () => {
    const session = await getClientSession();
    if (session.client) throw redirect({ to: "/client", search: { org: undefined } });
    return { setupRequired: session.setupRequired };
  },
  component: ClientLoginPage,
});

function ClientLoginPage() {
  const navigate = useNavigate();
  const { setupRequired } = Route.useLoaderData();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await signIn({ data: { email, password } });
    setPending(false);
    if (result.ok) {
      // Hard redirect: a fresh SSR load guarantees the /client layout loader
      // runs with the new session cookie. Client-side navigation reuses the
      // layout's stale loader data (client: null) and renders a blank page.
      window.location.assign("/client");
      return;
    }
    if (result.setupRequired) {
      setError("Database is not connected yet — see the note below.");
    } else {
      setError(result.error);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-navy px-5 py-12">
      <a href="/" className="mb-8">
        <Logo />
      </a>
      <Card className="w-full max-w-md p-8">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">
          Client portal
        </p>
        <h1 className="mt-1 text-2xl font-bold">Client sign in</h1>
        <p className="mt-1.5 text-sm text-muted">
          Sign in with your ScaleBridge account. Only members of a client
          organisation can continue.
        </p>

        {setupRequired && (
          <div className="mt-5">
            <SetupNotice />
          </div>
        )}

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          <Field label="Work email" htmlFor="email">
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@yourcompany.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={setupRequired}
            />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={setupRequired}
            />
          </Field>

          {error && <ErrorText>{error}</ErrorText>}

          <Button type="submit" size="lg" className="mt-2" disabled={pending || setupRequired}>
            {pending ? "Signing in…" : "Sign in to Client Portal"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          Not a client user?{" "}
          <a href="/login" className="font-semibold text-brand hover:underline">
            Go to the member sign-in
          </a>
        </p>
      </Card>
    </main>
  );
}
