import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
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

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await signIn({ data: { email, password } });
    setPending(false);
    if (result.ok) {
      // Hard redirect: a fresh SSR load re-runs the /app loader (subscription
      // gate) with the new session cookie, so the client lands on the right
      // destination (dashboard, pricing window, resume, or billing recovery).
      window.location.assign("/app");
      return;
    }
    if (result.setupRequired) {
      setSetupRequired(true);
    } else {
      setError(result.error);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-mist px-5 py-12">
      <a href="/" className="mb-8">
        <Logo />
      </a>
      <Card className="w-full max-w-md p-8">
        <h1 className="text-2xl font-bold">Welcome back</h1>
        <p className="mt-1.5 text-sm text-muted">
          Sign in to your ScaleBridge workspace.
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
              placeholder="jordan@company.com"
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
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          New to ScaleBridge?{" "}
          <a href="/signup" className="font-semibold text-brand hover:underline">
            Create an account
          </a>
        </p>
      </Card>
      <p className="mt-6 text-xs text-muted">
        <a href="/" className="hover:text-brand">← Back to ScaleBridge</a>
      </p>
    </main>
  );
}
