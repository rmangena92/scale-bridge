/**
 * AppShell — the authenticated application frame (top nav + content).
 * Used by /app, /workspaces, /workspaces/:id and /invitations. The nav shows
 * the main areas and who is signed in, with sign-out.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { signOut } from "~/lib/auth";
import { ROLE_LABELS } from "~/lib/types";
import type { PublicUser } from "~/lib/types";
import { Badge, Button, Logo } from "./ui";

const navLinkBase =
  "rounded-lg px-3 py-1.5 text-sm font-semibold text-muted transition-colors hover:text-brand";
const navLinkActive =
  "rounded-lg bg-navy/5 px-3 py-1.5 text-sm font-semibold text-navy";

export function AppShell({
  user,
  children,
}: {
  user: PublicUser;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    await navigate({ to: "/" });
  }

  return (
    <div className="min-h-dvh bg-mist">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="container-site flex h-16 items-center justify-between gap-4">
          <a href="/" className="shrink-0">
            <Logo />
          </a>
          <nav className="hidden items-center gap-1 md:flex">
            <Link to="/app" activeProps={{ className: navLinkActive }} className={navLinkBase}>
              Dashboard
            </Link>
            <Link
              to="/workspaces"
              activeOptions={{ exact: false }}
              activeProps={{ className: navLinkActive }}
              className={navLinkBase}
            >
              Workspaces
            </Link>
            <Link to="/invitations" activeProps={{ className: navLinkActive }} className={navLinkBase}>
              Invitations
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold leading-tight text-ink">
                {user.name || user.email}
              </p>
              <Badge tone="navy">{ROLE_LABELS[user.role]}</Badge>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSignOut}
              disabled={signingOut}
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </Button>
          </div>
        </div>
        {/* small-screen nav */}
        <div className="container-site flex items-center gap-1 border-t border-slate-100 py-1.5 md:hidden">
          <Link to="/app" activeProps={{ className: navLinkActive }} className={navLinkBase}>
            Dashboard
          </Link>
          <Link
            to="/workspaces"
            activeOptions={{ exact: false }}
            activeProps={{ className: navLinkActive }}
            className={navLinkBase}
          >
            Workspaces
          </Link>
          <Link to="/invitations" activeProps={{ className: navLinkActive }} className={navLinkBase}>
            Invitations
          </Link>
        </div>
      </header>
      <main className="container-site py-10">{children}</main>
      <footer className="border-t border-slate-200 py-6 text-center text-xs text-muted">
        ScaleBridge — collaborative contracting for small and mid-size business teams
      </footer>
    </div>
  );
}
