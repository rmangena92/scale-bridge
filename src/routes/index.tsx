import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Badge, ButtonLink, Logo } from "~/components/ui";
import { listPublishedServices } from "~/lib/landing";
import type { PublishedCategory, PublishedService } from "~/lib/landing";
import {
  CATEGORY_SLOT_MAP,
  DIRECTORY_SLOTS,
  ECOSYSTEM_CARDS,
  FEATURES,
  FOOTER_LINKS,
  FOR_ANCHORS,
  FOR_BUSINESSES,
  FOR_CLIENTS,
  INTELLIGENCE_ITEMS,
  LANDING,
  NAV_LINKS,
  STEPS,
  TRUST_POINTS,
} from "~/lib/landing-copy";

export const Route = createFileRoute("/")({
  // The services section reads from the LIVE service catalogue through the
  // public server function listPublishedServices() (src/lib/landing.ts) — a
  // no-auth read backed by the service_categories_select_public /
  // services_select_public RLS policies. SSR runs the function server-side, so
  // the HTML already contains the catalogue. When the DB is not configured or
  // the call fails, the section gracefully falls back to the copy-file card
  // names with honest empty states.
  loader: async () => {
    const res = await listPublishedServices();
    return {
      categories: res.ok ? res.categories : [],
      services: res.ok ? res.services : [],
      catalogueLive: res.ok,
    };
  },
  component: Home,
});

// ================================================================ helpers
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

function CheckIcon({ className = "mt-0.5 size-5 shrink-0 text-teal" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

// =================================================================== nav
function SiteNav() {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center px-5 sm:px-8">
        <a href="/" aria-label="ScaleBridge home" className="shrink-0">
          <Logo />
        </a>
        <nav className="ml-10 hidden flex-1 items-center justify-center gap-6 text-sm font-semibold text-muted xl:flex">
          {NAV_LINKS.map((link) => (
            <a key={link.label} href={link.href} className="whitespace-nowrap hover:text-brand">
              {link.label}
            </a>
          ))}
        </nav>
        <ButtonLink
          to="/login"
          variant="ghost"
          size="sm"
          className="ml-4 shrink-0 border border-slate-200 bg-white"
        >
          Login
        </ButtonLink>
      </div>
    </header>
  );
}

// ================================================================== hero
const HERO_PARTNERS = [
  { name: "Reyes Facilities Group", pkg: "HVAC — servicing & repairs", status: "Verified" },
  { name: "Clearview Cleaning", pkg: "Cleaning — daily janitorial", status: "Joined" },
  { name: "Northgate Security", pkg: "Security — site access & patrols", status: "Invited" },
];

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
          <h1 className="text-4xl font-extrabold leading-tight text-white sm:text-6xl">
            {LANDING.hero.headlineLead}{" "}
            <span className="text-teal">{LANDING.hero.headlineAccent}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-300">
            {LANDING.hero.supporting}
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <ButtonLink
              to="/signup"
              variant="primary"
              size="lg"
              className="w-full md:min-w-80 sm:w-auto"
            >
              {LANDING.hero.primaryCta}
            </ButtonLink>
            <ButtonLink
              to="/login"
              variant="outline"
              size="lg"
              className="w-full border-white/25 bg-white/5 text-white hover:border-teal hover:text-teal sm:w-auto md:min-w-80"
            >
              {LANDING.hero.secondaryCta}
            </ButtonLink>
          </div>
          <p className="mt-5 text-sm font-medium text-slate-400">
            {LANDING.hero.microcopy}
          </p>
        </div>

        {/* partnership visual: multiple independent businesses contributing to
            one larger contract through a central partnership workspace */}
        <div className="mx-auto mt-14 max-w-3xl">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-teal" aria-hidden="true" />
                <p className="text-sm font-semibold text-white">
                  Riverside Plaza · Facilities management
                </p>
              </div>
              <Badge tone="teal">Active</Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {HERO_PARTNERS.map((c) => (
                <div key={c.name} className="rounded-xl border border-white/10 bg-navy/60 p-3">
                  <p className="truncate text-sm font-semibold text-white">{c.name}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{c.pkg}</p>
                  <div className="mt-3">
                    <Badge tone="onDark">{c.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
              <span className="inline-block h-1.5 flex-1 rounded-full bg-teal/80" />
              <span className="inline-block h-1.5 flex-1 rounded-full bg-teal/60" />
              <span className="inline-block h-1.5 flex-1 rounded-full bg-white/20" />
              <span className="ml-2 font-semibold text-teal">3 contributing partners</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================================== ecosystem
function Ecosystem() {
  return (
    <Section id="ecosystem" className="bg-white">
      <SectionHeading
        eyebrow={LANDING.ecosystem.eyebrow}
        title={LANDING.ecosystem.heading}
      />
      <div className="mx-auto max-w-3xl space-y-4 text-center text-lg text-muted">
        {LANDING.ecosystem.paragraphs.map((p) => (
          <p key={p.slice(0, 24)}>{p}</p>
        ))}
      </div>
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ECOSYSTEM_CARDS.map((card) => (
          <div
            key={card.title}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[var(--shadow-card)]"
          >
            <div className="mb-4 grid size-11 place-items-center rounded-xl bg-navy text-teal">
              <Icon d={card.icon} className="size-6" />
            </div>
            <h3 className="text-base font-bold text-navy">{card.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{card.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ============================================================= how it works
function HowItWorks() {
  return (
    <Section id="how-it-works" className="bg-mist">
      <SectionHeading
        eyebrow={LANDING.howItWorks.eyebrow}
        title={LANDING.howItWorks.heading}
      />
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {STEPS.map((item) => (
          <li
            key={item.step}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)]"
          >
            <span className="mb-4 block font-display text-2xl font-extrabold text-teal">
              {item.step}
            </span>
            <h3 className="text-base font-bold text-navy">{item.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{item.body}</p>
          </li>
        ))}
      </ol>
      <p className="mt-10 text-center text-lg font-medium text-brand">
        {LANDING.howItWorks.supportingLine}
      </p>
    </Section>
  );
}

// ================================================================= services
type DirectoryCard = {
  key: string;
  name: string;
  body: string;
  services: PublishedService[];
  live: boolean;
};

/** Build the 8 partner-directory cards from copy slots + live catalogue. */
function buildDirectory(
  categories: PublishedCategory[],
  services: PublishedService[],
): DirectoryCard[] {
  const bySlot = new Map<string, { category: PublishedCategory; services: PublishedService[] }>();
  for (const category of categories) {
    const slotKey = CATEGORY_SLOT_MAP[category.slug];
    if (!slotKey) continue;
    const listed = services.filter((s) => s.categoryId === category.id);
    const entry = bySlot.get(slotKey);
    if (entry) {
      entry.services.push(...listed);
    } else {
      bySlot.set(slotKey, { category, services: listed });
    }
  }
  return DIRECTORY_SLOTS.map((slot) => {
    const match = bySlot.get(slot.key);
    return {
      key: slot.key,
      // Live catalogue category name wins (so renaming a category in the
      // Master Admin Portal renames the public card); otherwise the copy-file
      // default name is used verbatim.
      name: match?.category.name ?? slot.defaultName,
      body: slot.body,
      services: (match?.services ?? []).sort((a, b) => a.name.localeCompare(b.name)),
      live: Boolean(match),
    };
  });
}

function Services({ categories, services }: { categories: PublishedCategory[]; services: PublishedService[] }) {
  const cards = buildDirectory(categories, services);
  return (
    <Section id="services" className="bg-white">
      <SectionHeading
        eyebrow={LANDING.services.eyebrow}
        title={LANDING.services.heading}
        body={LANDING.services.body}
      />
      <p className="mx-auto -mt-6 mb-8 max-w-2xl text-center text-sm text-muted">
        {LANDING.services.dynamicNote}
      </p>
      <div className="flex justify-center">
        <a
          href="#partner-directory"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-navy transition-colors hover:border-brand hover:text-brand"
        >
          {LANDING.services.cta}
        </a>
      </div>
      <div
        id="partner-directory"
        className="mt-8 grid scroll-mt-20 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {cards.map((card) => (
          <div
            key={card.key}
            className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-[var(--shadow-card)]"
          >
            <h3 className="text-base font-bold text-navy">{card.name}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{card.body}</p>
            <div className="mt-4 flex-1">
              {card.services.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {card.services.map((s) => (
                    <li
                      key={s.slug}
                      className="rounded-full border border-slate-200 bg-mist px-2.5 py-1 text-xs font-semibold text-ink"
                    >
                      {s.name}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted">No services listed yet.</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ================================================================ features
function Features() {
  return (
    <Section className="bg-mist">
      <SectionHeading
        eyebrow={LANDING.features.eyebrow}
        title={LANDING.features.heading}
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

// ================================================================ audience
function Audience() {
  const a = LANDING.audiences;
  return (
    <Section className="bg-white">
      <div className="grid gap-6 lg:grid-cols-3">
        <div id="for-anchor-partners" className="scroll-mt-20 rounded-3xl border border-slate-200 bg-mist p-8 sm:p-10">
          <Badge tone="blue" className="mb-4">
            {a.anchor.badge}
          </Badge>
          <h2 className="text-2xl font-bold sm:text-3xl">{a.anchor.heading}</h2>
          <p className="mt-3 text-muted">{a.anchor.body}</p>
          <ul className="mt-6 space-y-3">
            {FOR_ANCHORS.map((item) => (
              <li key={item} className="flex items-start gap-3 text-sm text-ink">
                <CheckIcon />
                {item}
              </li>
            ))}
          </ul>
          <ButtonLink to={a.anchor.cta.to} variant="secondary" className="mt-8">
            {a.anchor.cta.label}
          </ButtonLink>
        </div>

        <div id="for-businesses" className="scroll-mt-20 rounded-3xl border border-slate-200 bg-navy p-8 text-white sm:p-10">
          <Badge tone="teal" className="mb-4">
            {a.businesses.badge}
          </Badge>
          <h2 className="text-2xl font-bold text-white sm:text-3xl">{a.businesses.heading}</h2>
          <p className="mt-3 text-slate-300">{a.businesses.body}</p>
          <ul className="mt-6 space-y-3">
            {FOR_BUSINESSES.map((item) => (
              <li key={item} className="flex items-start gap-3 text-sm text-slate-200">
                <CheckIcon />
                {item}
              </li>
            ))}
          </ul>
          <ButtonLink to={a.businesses.cta.to} variant="primary" className="mt-8">
            {a.businesses.cta.label}
          </ButtonLink>
        </div>

        <div id="for-clients" className="scroll-mt-20 rounded-3xl border border-slate-200 bg-mist p-8 sm:p-10">
          <Badge tone="blue" className="mb-4">
            {a.clients.badge}
          </Badge>
          <h2 className="text-2xl font-bold sm:text-3xl">{a.clients.heading}</h2>
          <p className="mt-3 text-muted">{a.clients.body}</p>
          <ul className="mt-6 space-y-3">
            {FOR_CLIENTS.map((item) => (
              <li key={item} className="flex items-start gap-3 text-sm text-ink">
                <CheckIcon />
                {item}
              </li>
            ))}
          </ul>
          <ButtonLink to={a.clients.cta.to} variant="secondary" className="mt-8">
            {a.clients.cta.label}
          </ButtonLink>
        </div>
      </div>
    </Section>
  );
}

// =============================================================== intelligence
function Intelligence() {
  return (
    <Section id="intelligence" className="bg-navy">
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <p className="mb-3 text-sm font-bold uppercase tracking-widest text-teal">
          {LANDING.intelligence.eyebrow}
        </p>
        <h2 className="text-3xl font-bold text-white sm:text-4xl">
          {LANDING.intelligence.heading}
        </h2>
      </div>
      <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-2">
        <div className="flex flex-col">
          <p className="text-lg leading-relaxed text-slate-300">
            {LANDING.intelligence.body}
          </p>
          <p className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5 text-sm leading-relaxed text-slate-300">
            {LANDING.intelligence.supporting}
          </p>
          <div className="mt-8">
            <ButtonLink
              to={LANDING.intelligence.cta.to}
              variant="primary"
              size="lg"
              className="w-full sm:w-auto"
            >
              {LANDING.intelligence.cta.label}
            </ButtonLink>
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <p className="text-sm font-bold uppercase tracking-widest text-slate-400">
            {LANDING.intelligence.helpsIdentifyTitle}
          </p>
          <ul className="mt-5 space-y-3">
            {INTELLIGENCE_ITEMS.map((item) => (
              <li key={item} className="flex items-start gap-3 text-sm text-slate-200">
                <CheckIcon className="mt-0.5 size-5 shrink-0 text-teal" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}

// ==================================================================== trust
function Trust() {
  return (
    <Section id="trust" className="bg-white">
      <SectionHeading
        eyebrow={LANDING.trust.eyebrow}
        title={LANDING.trust.heading}
        body={LANDING.trust.body}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TRUST_POINTS.map((point) => (
          <div
            key={point}
            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-mist px-4 py-3.5"
          >
            <CheckIcon />
            <p className="text-sm font-semibold text-navy">{point}</p>
          </div>
        ))}
      </div>
      <p className="mx-auto mt-10 max-w-2xl text-center text-muted">
        {LANDING.trust.supporting}
      </p>
    </Section>
  );
}

// ================================================================ final CTA
function FinalCta() {
  return (
    <section className="bg-mist py-20">
      <div className="container-site">
        <div className="overflow-hidden rounded-3xl bg-navy px-6 py-14 text-center sm:px-12">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            {LANDING.finalCta.heading}
          </h2>
          {LANDING.finalCta.paragraphs.map((p) => (
            <p key={p.slice(0, 24)} className="mx-auto mt-4 max-w-xl text-slate-300">
              {p}
            </p>
          ))}
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <ButtonLink
              to="/signup"
              variant="primary"
              size="lg"
              className="w-full sm:w-auto md:min-w-80"
            >
              {LANDING.finalCta.primaryCta}
            </ButtonLink>
            <ButtonLink
              to="/login"
              variant="outline"
              size="lg"
              className="w-full border-white/25 bg-white/5 text-white hover:border-teal hover:text-teal sm:w-auto md:min-w-80"
            >
              {LANDING.finalCta.secondaryCta}
            </ButtonLink>
          </div>
          <p className="mt-6 text-sm font-semibold text-teal">
            {LANDING.finalCta.closing}
          </p>
        </div>
      </div>
    </section>
  );
}

// ================================================================== footer
function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="container-site flex flex-col items-center gap-8 py-12">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo />
          <p className="max-w-md text-sm font-medium text-muted">{LANDING.footer.tagline}</p>
        </div>
        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm font-semibold text-muted">
          {FOOTER_LINKS.map((link) => (
            <a key={link.label} href={link.href} className="hover:text-brand">
              {link.label}
            </a>
          ))}
        </nav>
        <p className="max-w-2xl text-center text-xs leading-relaxed text-muted">
          {LANDING.footer.closing}
        </p>
        <p className="text-xs text-muted">
          © {new Date().getFullYear()} ScaleBridge. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

// =================================================================== page
function Home() {
  const { categories, services } = Route.useLoaderData();
  return (
    <div className="min-h-dvh bg-white">
      <SiteNav />
      <main>
        <Hero />
        <Ecosystem />
        <HowItWorks />
        <Services categories={categories} services={services} />
        <Features />
        <Audience />
        <Intelligence />
        <Trust />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}
