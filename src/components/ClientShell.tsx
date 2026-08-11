/**
 * ClientShell — the ScaleBridge Client Portal frame: navy sidebar with the
 * spec's client navigation, a top bar with the signed-in user + org switcher,
 * and the route content. Stub sections (Parts B/C — not yet built) render the
 * same shell so the navigation is complete from day one.
 */
import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { signOut } from "~/lib/auth";
import { CLIENT_ROLE_LABELS } from "~/lib/types";
import type { ClientOrgMembership, ClientSession, ClientRole } from "~/lib/types";
import { Badge, Button, Logo, Select } from "./ui";

const NAV_ITEMS: { to: string; label: string; built: boolean; part: string }[] = [
  { to: "/client", label: "Dashboard", built: true, part: "A" },
  { to: "/client/organisation", label: "My Organisation", built: true, part: "A" },
  { to: "/client/contracts", label: "Contracts", built: true, part: "A" },
  { to: "/client/projects", label: "Projects", built: false, part: "B" },
  { to: "/client/milestones", label: "Milestones", built: false, part: "B" },
  { to: "/client/documents", label: "Documents", built: false, part: "B" },
  { to: "/client/approvals", label: "Approvals", built: false, part: "B" },
  { to: "/client/issues", label: "Issues", built: false, part: "B" },
  { to: "/client/variations", label: "Variations", built: false, part: "B" },
  { to: "/client/invoices", label: "Invoices", built: false, part: "B" },
  { to: "/client/messages", label: "Messages", built: false, part: "C" },
  { to: "/client/reports", label: "Reports", built: false, part: "B" },
  { to: "/client/team", label: "Team", built: true, part: "A" },
  { to: "/client/settings", label: "Settings", built: true, part: "A" },
];

function isActive(pathname: string, to: string): boolean {
  if (to === "/client") return pathname === "/client";
  return pathname.startsWith(to);
}

// --------------------------------------------------------------- org context
export type ClientPortalCtx = {
  client: ClientSession;
  org: ClientOrgMembership; // the effective (selected) org for this page
};

const PortalContext = createContext<ClientPortalCtx | null>(null);

export function ClientPortalProvider({
  client,
  org,
  children,
}: ClientPortalCtx & { children: ReactNode }) {
  return (
    <PortalContext.Provider value={{ client, org }}>
      {children}
    </PortalContext.Provider>
  );
}

/** Access the signed-in client session + effective org (shell context). */
export function useClientPortal(): ClientPortalCtx {
  const ctx = useContext(PortalContext);
  if (!ctx) throw new Error("useClientPortal must be used inside ClientShell");
  return ctx;
}

export function ClientShell({
  client,
  org,
  children,
}: ClientPortalCtx & { children: ReactNode }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [signingOut, setSigningOut] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    await navigate({ to: "/" });
  }

  function switchOrg(orgId: string) {
    // Re-run the current page against the new org (search change reloads the
    // route loaders — each page resolves its effective org from the `org`
    // search param).
    void navigate({ to: pathname, search: { org: orgId }, replace: true });
  }

  const roleBadge = (
    {
      client_admin: { label: "Client admin", tone: "navy" },
      client_pm: { label: "Project manager", tone: "blue" },
      client_finance: { label: "Finance", tone: "teal" },
      client_reviewer: { label: "Reviewer", tone: "amber" },
      client_read_only: { label: "Read-only", tone: "slate" },
    } as const
  )[org.role as ClientRole];

  const sidebar = (
    <div className="flex h-full flex-col bg-navy text-white">
      <div className="flex h-16 items-center gap-2 px-5">
        <Logo wordmark={false} />
        <div className="leading-tight">
          <p className="text-sm font-bold">ScaleBridge</p>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-teal">
            Client Portal
          </p>
        </div>
      </div>
      <div className="border-b border-white/10 px-5 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-white/50">
          Acting for
        </p>
        <p className="mt-0.5 truncate text-sm font-bold text-white">{org.orgName}</p>
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
                      {item.part}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-white/10 px-5 py-4">
        <p className="truncate text-sm font-semibold">{client.user.name || client.user.email}</p>
        <Badge tone={roleBadge.tone} className="mt-1">
          {roleBadge.label}
        </Badge>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-mist">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{sidebar}</aside>
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
            <p className="hidden text-sm font-bold uppercase tracking-widest text-teal sm:block">
              ScaleBridge Client
            </p>
            {org.orgStatus !== "verified" && (
              <Badge tone="amber">{org.orgStatus}</Badge>
            )}
          </div>
          <div className="flex items-center gap-3">
            {client.orgs.length > 1 && (
              <div className="hidden items-center gap-2 sm:flex">
                <span className="text-xs font-semibold text-muted">Org</span>
                <Select
                  aria-label="Switch organisation"
                  className="h-9 w-48"
                  value={org.orgId}
                  onChange={(e) => switchOrg(e.target.value)}
                >
                  {client.orgs.map((o) => (
                    <option key={o.orgId} value={o.orgId}>
                      {o.orgName}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <Badge tone={roleBadge.tone} className="hidden sm:inline-flex">
              {CLIENT_ROLE_LABELS[org.role]}
            </Badge>
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

/** Friendly placeholder for the client sections shipping in Parts B/C. */
export function ClientComingSoon({
  title,
  blurb,
}: {
  title: string;
  blurb: string;
}) {
  return (
    <div className="flex flex-col items-start gap-1 rounded-2xl border border-dashed border-slate-300 bg-white/60 p-10">
      <p className="text-sm font-bold uppercase tracking-widest text-teal">{title}</p>
      <h1 className="mt-1 text-2xl font-bold">Coming in Parts B/C</h1>
      <p className="mt-2 max-w-xl text-sm text-muted">{blurb}</p>
    </div>
  );
}
