/**
 * AdminShell — the ScaleBridge Master Admin Portal frame: dark sidebar with the
 * owner-specified 16-section navigation, a top bar with the signed-in staff
 * member, and the route content. Sections whose data lands in later build items
 * (services catalogue, AI layers) render honest empty states inside their own
 * pages — the shell never fabricates records.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { signOut } from "~/lib/auth";
import { ADMIN_ROLE_LABELS } from "~/lib/types";
import type { AdminSession } from "~/lib/types";
import { Badge, Button, Logo } from "./ui";

export const ADMIN_NAV: { to: string; label: string }[] = [
  { to: "/admin", label: "Master Dashboard" },
  { to: "/admin/companies", label: "Companies" },
  { to: "/admin/services", label: "Services" },
  { to: "/admin/subscriptions", label: "Subscriptions" },
  { to: "/admin/contracts", label: "Contracts" },
  { to: "/admin/opportunities", label: "Opportunities" },
  { to: "/admin/workspaces", label: "Partnership Workspaces" },
  { to: "/admin/client-portals", label: "Client Portals" },
  { to: "/admin/documents", label: "Documents" },
  { to: "/admin/verification", label: "Verification" },
  { to: "/admin/ai-insights", label: "AI Insights" },
  { to: "/admin/upsells", label: "Upsell Opportunities" },
  { to: "/admin/users", label: "Users" },
  { to: "/admin/support", label: "Support" },
  { to: "/admin/disputes", label: "Disputes" },
  { to: "/admin/finance", label: "Finance" },
  { to: "/admin/reports", label: "Reports" },
  { to: "/admin/audit-log", label: "Audit Log" },
  { to: "/admin/settings", label: "Settings" },
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
            Master Admin
          </p>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="flex flex-col gap-0.5">
          {ADMIN_NAV.map((item) => {
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
              ScaleBridge Master Admin
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

/** Friendly placeholder for Master Admin sections that land in later builds. */
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
      <h1 className="mt-1 text-2xl font-bold">Coming in a later build step</h1>
      <p className="mt-2 max-w-xl text-sm text-muted">{blurb}</p>
    </div>
  );
}
