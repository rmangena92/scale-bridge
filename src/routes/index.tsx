import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Badge, ButtonLink, Logo } from "~/components/ui";

export const Route = createFileRoute("/")({
  component: Home,
});

// ------------------------------------------------------------------ copy
const WORKFLOW = [
  { step: "01", title: "Create Contract", body: "Open a contract workspace in minutes and define the scope, terms and timeline." },
  { step: "02", title: "Define Work Packages", body: "Break the job into clear packages — HVAC, cleaning, security — with deliverables and milestones." },
  { step: "03", title: "Find Companies", body: "Search the business directory for vetted companies that fit each package." },
  { step: "04", title: "Invite", body: "Invite companies to the workspace by email or directory, each with a role and work package." },
  { step: "05", title: "Verify", body: "Track participation status from Invited → Joined → Verified before work begins." },
  { step: "06", title: "Deliver", body: "Run tasks, milestones, variations and documents in one place with full visibility." },
  { step: "07", title: "Approve", body: "Review and approve deliverables, invoices and changes against the contract." },
  { step: "08", title: "Complete", body: "Close the contract, archive the audit trail and keep a record your team can reuse." },
] as const;

const FEATURES = [
  {
    title: "Role-based access",
    body: "Lead contractors, company users, buyers and ScaleBridge admins each see exactly what their role allows — enforced in the database, not just the UI.",
    icon: "M12 3l7 3v5c0 4.4-3 8.4-7 10-4-1.6-7-5.6-7-10V6l7-3z",
  },
  {
    title: "Participant verification",
    body: "Every company moves through a transparent Invited → Joined → Verified status flow before it can deliver on your contract.",
    icon: "M9 12.5l2 2 4-4.5M12 3l7 3v5c0 4.4-3 8.4-7 10-4-1.6-7-5.6-7-10V6l7-3z",
  },
  {
    title: "Full audit trail",
    body: "Every action — invites, status changes, approvals, edits — is logged with actor and timestamp. Contracts keep a complete, reviewable history.",
    icon: "M12 8v4l2.5 2.5M12 3a9 9 0 100 18 9 9 0 000-18z",
  },
  {
    title: "Delivery in one place",
    body: "Tasks, milestones, work packages, documents, variations and invoices live inside the contract workspace — no spreadsheets, no lost emails.",
    icon: "M4 6h16M4 12h16M4 18h10M18 15l3 3-3 3",
  },
  {
    title: "Built for small teams",
    body: "Lightweight enough for a two-person subcontractor, structured enough for a multi-company delivery. No procurement department required.",
    icon: "M12 21s-7-4.6-9.2-9A5.4 5.4 0 0112 6.2 5.4 5.4 0 0121.2 12C19 16.4 12 21 12 21z",
  },
  {
    title: "Secure from day one",
    body: "Session-based authentication, hashed passwords, httpOnly cookies and Postgres Row Level Security keep every contract isolated.",
    icon: "M8 11V7a4 4 0 018 0v4M6 11h12v9H6v-9z",
  },
] as const;

const FOR_LEADS = [
  "Create and manage multiple contract workspaces",
  "Define work packages with deliverables and milestones",
  "Invite companies by email or from the directory",
  "Track participant status: Invited → Joined → Verified",
  "Approve deliverables, variations and invoices",
];

const FOR_COMPANIES = [
  "Build a profile that makes you easy to find and trust",
  "Get verified once, win work repeatedly",
  "See invitations and work packages instantly",
  "Submit documents and pricing without email chaos",
  "Keep one clean record of every engagement",
];

// ------------------------------------------------------------------ icons
function Icon({ d, className = "" }: { d: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

// ------------------------------------------------------------------ layout
function Section({
  id,
  className = "",
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={`py-16 sm:py-24 ${className}`}>
      <div className="container-site">{children}</div>
    </section>
  );
}

function SectionHeading({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body?: string;
}) {
  return (
    <div className="mx-auto mb-12 max-w-2xl text-center">
      <p className="mb-3 text-sm font-bold uppercase tracking-widest text-teal">
        {eyebrow}
      </p>
      <h2 className="text-3xl font-bold sm:text-4xl">{title}</h2>
      {body && <p className="mt-4 text-lg text-muted">{body}</p>}
    </div>
  );
}

// ------------------------------------------------------------------- nav
function SiteNav() {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/85 backdrop-blur">
      <div className="container-site flex h-16 items-center justify-between">
        <a href="/" aria-label="ScaleBridge home">
          <Logo />
        </a>
        <nav className="hidden items-center gap-8 text-sm font-semibold text-muted md:flex">
          <a href="#how-it-works" className="hover:text-brand">
            How it works
          </a>
          <a href="#for-leads" className="hover:text-brand">
            For contractors
          </a>
          <a href="#for-companies" className="hover:text-brand">
            For companies
          </a>
        </nav>
        <div className="flex items-center gap-3">
          <ButtonLink to="/login" variant="ghost" size="sm">
            Sign in
          </ButtonLink>
          <ButtonLink to="/signup" variant="primary" size="sm">
            Sign up free
          </ButtonLink>
        </div>
      </div>
    </header>
  );
}

// ------------------------------------------------------------------- hero
function Hero() {
  return (
    <section className="relative overflow-hidden bg-navy">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-40 -top-40 size-96 rounded-full bg-brand/30 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-48 -left-24 size-96 rounded-full bg-teal/20 blur-3xl"
      />
      <div className="container-site relative py-20 sm:py-28">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-teal">
            <span className="size-1.5 rounded-full bg-teal" aria-hidden="true" />
            Collaborative contracting for small &amp; mid-size business teams
          </span>
          <h1 className="mt-6 text-4xl font-extrabold leading-tight text-white sm:text-6xl">
            Contracts that move.{" "}
            <span className="text-teal">Projects that deliver.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-300">
            ScaleBridge takes a contract from a blank page to a delivered
            project — define work packages, invite the right companies, verify
            every participant, and run tasks, approvals and invoices end to
            end, with a complete audit trail.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <ButtonLink to="/signup" variant="primary" size="lg" className="w-full sm:w-auto">
              Start your first contract
            </ButtonLink>
            <ButtonLink to="/login" variant="outline" size="lg" className="w-full border-white/25 bg-white/5 text-white hover:border-teal hover:text-teal sm:w-auto">
              Sign in
            </ButtonLink>
          </div>
          <p className="mt-4 text-xs text-slate-400">
            Free to start — no credit card required
          </p>
        </div>

        {/* pipeline mock */}
        <div className="mx-auto mt-14 max-w-3xl">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-teal" aria-hidden="true" />
                <p className="text-sm font-semibold text-white">
                  Contract #1042 · Facilities management
                </p>
              </div>
              <Badge tone="teal">Active</Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { name: "Meridian HVAC", pkg: "HVAC", status: "Verified", tone: "green" as const },
                { name: "Clearview Cleaning", pkg: "Cleaning", status: "Joined", tone: "teal" as const },
                { name: "Northgate Security", pkg: "Security", status: "Invited", tone: "blue" as const },
              ].map((c) => (
                <div key={c.name} className="rounded-xl border border-white/10 bg-navy/60 p-3">
                  <p className="truncate text-sm font-semibold text-white">{c.name}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{c.pkg}</p>
                  <div className="mt-3">
                    <Badge tone={c.tone}>{c.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
              <span className="inline-block h-1.5 flex-1 rounded-full bg-teal/80" />
              <span className="inline-block h-1.5 flex-1 rounded-full bg-white/20" />
              <span className="inline-block h-1.5 flex-1 rounded-full bg-white/20" />
              <span className="ml-2 font-semibold text-teal">Phase 2 of 4</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------- how it works
function Workflow() {
  return (
    <Section id="how-it-works" className="bg-white">
      <SectionHeading
        eyebrow="How it works"
        title="From contract to completion, step by step"
        body="One workspace carries the whole engagement — no switching between email, spreadsheets and file shares."
      />
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {WORKFLOW.map((item, i) => (
          <li
            key={item.step}
            className="group relative rounded-2xl border border-slate-200 bg-white p-5 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)]"
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="font-display text-2xl font-extrabold text-teal">
                {item.step}
              </span>
              {i < WORKFLOW.length - 1 && (
                <svg
                  viewBox="0 0 24 24"
                  className="size-5 text-slate-300 lg:hidden"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 5v14m0 0l-5-5m5 5l5-5" />
                </svg>
              )}
            </div>
            <h3 className="text-base font-bold text-navy">{item.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{item.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

// ---------------------------------------------------------------- features
function Features() {
  return (
    <Section className="bg-mist">
      <SectionHeading
        eyebrow="Why ScaleBridge"
        title="Built for how contracting actually works"
        body="Role-based access, verification and a full audit trail — engineered into the platform from the first line of code."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div
            key={f.title}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[var(--shadow-card)]"
          >
            <div className="mb-4 grid size-11 place-items-center rounded-xl bg-navy text-teal">
              <Icon d={f.icon} className="size-6" />
            </div>
            <h3 className="text-base font-bold text-navy">{f.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ------------------------------------------------------- audience two-panel
function Audience() {
  return (
    <Section id="for-leads" className="bg-white">
      <div className="grid gap-6 lg:grid-cols-2">
        <div id="for-companies" className="rounded-3xl border border-slate-200 bg-mist p-8 sm:p-10">
          <Badge tone="blue" className="mb-4">
            For lead contractors
          </Badge>
          <h2 className="text-2xl font-bold sm:text-3xl">
            Run the whole delivery, not just the paperwork
          </h2>
          <p className="mt-3 text-muted">
            Stop stitching contracts together with email threads. ScaleBridge
            gives you one workspace per contract, with every company, package
            and approval in view.
          </p>
          <ul className="mt-6 space-y-3">
            {FOR_LEADS.map((item) => (
              <li key={item} className="flex items-start gap-3 text-sm text-ink">
                <svg viewBox="0 0 24 24" className="mt-0.5 size-5 shrink-0 text-teal" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
          <ButtonLink to="/signup" variant="secondary" className="mt-8">
            Create a contract workspace
          </ButtonLink>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-navy p-8 text-white sm:p-10">
          <Badge tone="teal" className="mb-4">
            For companies
          </Badge>
          <h2 className="text-2xl font-bold text-white sm:text-3xl">
            Get found. Get invited. Get verified.
          </h2>
          <p className="mt-3 text-slate-300">
            One professional profile carries your credibility across every
            contract. Accept invitations, see your work packages and keep a
            clean record of everything you deliver.
          </p>
          <ul className="mt-6 space-y-3">
            {FOR_COMPANIES.map((item) => (
              <li key={item} className="flex items-start gap-3 text-sm text-slate-200">
                <svg viewBox="0 0 24 24" className="mt-0.5 size-5 shrink-0 text-teal" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
          <ButtonLink to="/signup" variant="primary" className="mt-8">
            Create your company profile
          </ButtonLink>
        </div>
      </div>
    </Section>
  );
}

// -------------------------------------------------------------------- CTA
function Cta() {
  return (
    <section className="bg-mist pb-20">
      <div className="container-site">
        <div className="overflow-hidden rounded-3xl bg-navy px-6 py-14 text-center sm:px-12">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            Ready to bridge the gap between scope and delivery?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-slate-300">
            Set up your first contract workspace in minutes — create the
            contract, invite your first companies and watch the project move.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <ButtonLink to="/signup" variant="primary" size="lg" className="w-full sm:w-auto">
              Sign up free
            </ButtonLink>
            <ButtonLink to="/login" variant="outline" size="lg" className="w-full border-white/25 bg-white/5 text-white hover:border-teal hover:text-teal sm:w-auto">
              Sign in to your workspace
            </ButtonLink>
          </div>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ footer
function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="container-site flex flex-col items-center justify-between gap-6 py-10 sm:flex-row">
        <Logo />
        <nav className="flex flex-wrap items-center justify-center gap-6 text-sm font-semibold text-muted">
          <a href="#how-it-works" className="hover:text-brand">
            How it works
          </a>
          <a href="/login" className="hover:text-brand">
            Sign in
          </a>
          <a href="/signup" className="hover:text-brand">
            Sign up
          </a>
        </nav>
        <p className="text-xs text-muted">
          © {new Date().getFullYear()} ScaleBridge. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

// ------------------------------------------------------------------- page
function Home() {
  return (
    <div className="min-h-dvh bg-white">
      <SiteNav />
      <main>
        <Hero />
        <Workflow />
        <Features />
        <Audience />
        <Cta />
      </main>
      <SiteFooter />
    </div>
  );
}
