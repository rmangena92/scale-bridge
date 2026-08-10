/**
 * AdminShell — the ScaleBridge Admin Portal frame: dark sidebar with the
 * spec's admin navigation, a top bar with the signed-in staff member, and the
 * route content. Stub sections (not yet built) render the same shell so the
 * navigation is complete from day one.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { signOut } from "~/lib/auth";
import { ADMIN_ROLE_LABELS } from "~/lib/types";
import type { AdminSession } from "~/lib/types";
import { Badge, Button, Logo } from "./ui";

const NAV_ITEMS: { to: string; label: string; built: boolean }[] = [
  { to: "/admin", label: "Admin Dashboard", built: true },
  { to: "/admin/users", label: "Users", built: true },
  { to: "/admin/companies", label: "Companies", built: true },
  { to: "/admin/verification", label: "Verification", built: true },
  { to: "/admin/contracts", label: "Contracts", built: true },
  { to: "/admin/projects", label: "Projects", built: false },
  { to: "/admin/documents", label: "Documents", built: true },
  { to: "/admin/messages", label: "Messages", built: false },
  { to: "/admin/support", label: "Support", built: true },
  { to: "/admin/disputes", label: "Disputes", built: false },
  { to: "/admin/payments", label: "Payments", built: false },
  { to: "/admin/subscriptions", label: "Subscriptions", built: false },
  { to: "/admin/reports", label: "Reports", built: false },
  { to: "/admin/audit-log", label: "Audit Log", built: true },
  { to: "/admin/settings", label: "Platform Settings", built: true },
];

function isActive(pathname: string, to: string): boolean {
  if (to === "/admin") return pathname === "/admin";
  return pathname.startsWith(to);
}

export function AdminShell({
  admin,
  children,
}: {
  admin: AdminSession;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [signingOut, setSigningOut] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    await navigate({ to: "/" });
  }

  const primaryRole = ADMIN_ROLE_LABELS[admin.staffRoles[0] ?? "read_only"];

  const sidebar = (
    <div className="flex h-full flex-col bg-navy text-white">
      <div className="flex h-16 items-center gap-2 px-5">
        <Logo wordmark={false} />
        <div className="leading-tight">
          <p className="text-sm font-bold">ScaleBridge</p>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-teal">
            Admin Portal
          </p>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.to);
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                    active
                      ? "bg-white/10 text-white"
                      : "text-white/60 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {item.label}
                  {!item.built && (
                    <span className="rounded-full bg-teal/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-teal">
                      B
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-white/10 px-5 py-4">
        <p className="truncate text-sm font-semibold">
          {admin.user.name || admin.user.email}
        </p>
        <Badge tone="teal" className="mt-1">
          {primaryRole}
        </Badge>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-mist">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">
        {sidebar}
      </aside>
      {/* mobile sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-navy/50"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-72">{sidebar}</aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-semibold text-navy lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              ☰
            </button>
            <p className="text-sm font-bold uppercase tracking-widest text-teal">
              ScaleBridge Admin
            </p>
          </div>
          <div className="flex items-center gap-3">
            {!admin.canMutate && (
              <Badge tone="amber">Read-only</Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleSignOut}
              disabled={signingOut}
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </Button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">{children}</main>
      </div>
    </div>
  );
}

/** Friendly placeholder for the Admin Portal sections shipping in Part B. */
export function ComingSoon({
  title,
  blurb,
}: {
  title: string;
  blurb: string;
}) {
  return (
    <div className="flex flex-col items-start gap-1 rounded-2xl border border-dashed border-slate-300 bg-white/60 p-10">
      <p className="text-sm font-bold uppercase tracking-widest text-teal">
        {title}
      </p>
      <h1 className="mt-1 text-2xl font-bold">Coming in Part B</h1>
      <p className="mt-2 max-w-xl text-sm text-muted">{blurb}</p>
    </div>
  );
}
