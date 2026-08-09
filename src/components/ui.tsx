/**
 * ScaleBridge UI primitives — the shared design-system building blocks.
 * All styled with the design-system tokens defined in src/styles/app.css.
 */
import type { ComponentProps, ReactNode } from "react";
import { useState } from "react";
import { Link } from "@tanstack/react-router";

// ------------------------------------------------------------------- Logo
export function Logo({
  className = "",
  wordmark = true,
}: {
  className?: string;
  wordmark?: boolean;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-navy">
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
          <path
            d="M3 16.5c3-4.5 5.5-6.5 9-6.5s6 2 9 6.5"
            fill="none"
            stroke="#16A6A0"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <path
            d="M3 20c3-4.5 5.5-6.5 9-6.5s6 2 9 6.5"
            fill="none"
            stroke="#fff"
            strokeWidth="2.4"
            strokeLinecap="round"
            opacity="0.55"
          />
        </svg>
      </span>
      {wordmark && (
        <span className="font-display text-lg font-bold tracking-tight text-navy">
          Scale<span className="text-brand">Bridge</span>
        </span>
      )}
    </span>
  );
}

// ------------------------------------------------------------------ Button
type ButtonVariant = "primary" | "secondary" | "outline" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-white hover:bg-[#145a93] focus-visible:outline-brand shadow-sm",
  secondary:
    "bg-navy text-white hover:bg-[#0a1830] focus-visible:outline-navy shadow-sm",
  outline:
    "border border-slate-300 bg-white text-navy hover:border-brand hover:text-brand focus-visible:outline-brand",
  ghost: "text-navy hover:bg-mist focus-visible:outline-brand",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${buttonVariants[variant]} ${buttonSizes[size]} ${className}`}
      {...props}
    />
  );
}

export function ButtonLink({
  to,
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${buttonVariants[variant]} ${buttonSizes[size]} ${className}`}
      {...props}
    >
      {children}
    </Link>
  );
}

// -------------------------------------------------------------------- Card
export function Card({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-white shadow-[var(--shadow-card)] ${className}`}
    >
      {children}
    </div>
  );
}

// ------------------------------------------------------------------- Badge
const badgeTones: Record<string, string> = {
  blue: "bg-brand/10 text-brand ring-brand/20",
  teal: "bg-teal/10 text-teal ring-teal/25",
  green: "bg-success/10 text-success ring-success/20",
  amber: "bg-amber/15 text-[#8a6200] ring-amber/30",
  red: "bg-danger/10 text-danger ring-danger/20",
  slate: "bg-slate-100 text-muted ring-slate-200",
  navy: "bg-navy/10 text-navy ring-navy/20",
};

export function Badge({
  tone = "slate",
  className = "",
  children,
}: {
  tone?: keyof typeof badgeTones;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${badgeTones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

// ------------------------------------------------------------------- Forms
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-semibold text-ink">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p className="text-xs font-medium text-danger">{error}</p>}
    </div>
  );
}

const inputClasses =
  "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-ink placeholder:text-slate-400 focus:border-brand focus:outline-2 focus:outline-brand/40 disabled:bg-slate-50 disabled:text-muted";

export function Input(props: ComponentProps<"input">) {
  return <input className={inputClasses} {...props} />;
}

export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea className={`${inputClasses} h-auto min-h-24 py-2`} {...props} />;
}

export function Select(props: ComponentProps<"select">) {
  return <select className={inputClasses} {...props} />;
}

// ------------------------------------------------------------ Setup notice
export function SetupNotice({ children }: { children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 text-sm text-[#6b4c00]">
      <p className="font-semibold">Database not connected</p>
      <p>
        {children ??
          "Connect a Postgres database (DATABASE_URL) and re-run `bun run publish` to enable accounts and company profiles."}
      </p>
    </div>
  );
}

// -------------------------------------------------------------- Error text
export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
      {children}
    </p>
  );
}

// ------------------------------------------------------------- Empty state
export function EmptyState({
  title,
  body,
  children,
}: {
  title: string;
  body?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-mist/60 px-6 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-xl bg-white text-teal shadow-[var(--shadow-card)]">
        <svg
          viewBox="0 0 24 24"
          className="size-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 12h6m-3-3v6m8-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </span>
      <h3 className="mt-4 text-base font-bold text-navy">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>}
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}

// ------------------------------------------------ Database-setup-required page
/**
 * Full-page state shown when a DB-backed flow is opened before DATABASE_URL
 * has been connected. Keeps every authenticated page bootable without a DB.
 */
export function DbSetupPage({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-mist px-5">
      <Card className="w-full max-w-lg p-8">
        <h1 className="text-xl font-bold">{title}</h1>
        <div className="mt-4">
          <SetupNotice>
            {children ??
              "Connect a Postgres database (DATABASE_URL) and re-run `bun run publish` to enable this flow."}
          </SetupNotice>
        </div>
        <a href="/" className="mt-6 inline-block text-sm font-semibold text-brand hover:underline">
          ← Back to ScaleBridge
        </a>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------ Confirm prompt
/** Two-step confirmation trigger for destructive actions (no window.confirm). */
export function ConfirmButton({
  label,
  confirmLabel = "Are you sure?",
  onConfirm,
  disabled,
  variant = "outline",
  size = "sm",
  className = "",
}: {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
  disabled?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <Button
      variant={variant}
      size={size}
      disabled={disabled}
      className={className}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          setTimeout(() => setArmed(false), 4000);
          return;
        }
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? confirmLabel : label}
    </Button>
  );
}
