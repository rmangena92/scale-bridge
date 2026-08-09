import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import { signUp } from "~/lib/auth";
import {
  Button,
  Card,
  ErrorText,
  Field,
  Input,
  Logo,
  SetupNotice,
} from "~/components/ui";

export const Route = createFileRoute("/signup")({
  component: SignUpPage,
});

function SignUpPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await signUp({ data: { name, email, password } });
      if (result.ok) {
        await navigate({ to: "/app" });
        return;
      }
      if (result.setupRequired) {
        setSetupRequired(true);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-mist px-5 py-12">
      <a href="/" className="mb-8">
        <Logo />
      </a>
      <Card className="w-full max-w-md p-8">
        <h1 className="text-2xl font-bold">Create your account</h1>
        <p className="mt-1.5 text-sm text-muted">
          Sign up as a lead contractor — you can set up your company profile
          right after.
        </p>

        {setupRequired && (
          <div className="mt-5">
            <SetupNotice />
          </div>
        )}

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          <Field label="Full name" htmlFor="name">
            <Input
              id="name"
              name="name"
              autoComplete="name"
              placeholder="Jordan Reyes"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={setupRequired}
            />
          </Field>
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
          <Field
            label="Password"
            htmlFor="password"
            hint="At least 8 characters"
          >
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              disabled={setupRequired}
            />
          </Field>

          {error && <ErrorText>{error}</ErrorText>}

          <Button type="submit" size="lg" className="mt-2" disabled={pending || setupRequired}>
            {pending ? "Creating account…" : "Create account"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          Already have an account?{" "}
          <a href="/login" className="font-semibold text-brand hover:underline">
            Sign in
          </a>
        </p>
      </Card>
      <p className="mt-6 text-xs text-muted">
        <a href="/" className="hover:text-brand">← Back to ScaleBridge</a>
      </p>
    </main>
  );
}
