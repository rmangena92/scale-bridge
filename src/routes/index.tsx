import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Badge, ButtonLink, Logo } from "~/components/ui";
import { listServiceCategories, listServices } from "~/lib/admin";
import type { ServiceCategoryRow, ServiceRow } from "~/lib/services";

export const Route = createFileRoute("/")({
  // The services section reads from the live service catalogue (same server
  // functions the admin Services page uses — run inside the route loader so
  // SSR renders real catalogue data). The page is public, so when the calls
  // come back { ok: false } (anonymous visitor / DB not configured), the
  // section gracefully falls back to the copy-file category names and honest
  // empty states.
  loader: async () => {
    const [categories, services] = await Promise.all([
      listServiceCategories(),
      listServices({ data: {} }),
    ]);
    return {
      categories: categories.ok ? categories.categories : [],
      services: services.ok ? services.services : [],
      catalogueLive: categories.ok && services.ok,
    };
  },
  component: Home,
});

// ================================================================ copy
// All landing-page copy is the owner's wording (landing-page-copy.md, verbatim).
// The copy file supplies the section order, the marketing prose, and the
// partner-directory card order + fallback names; the live service catalogue is
// the source of truth for category names and the services listed on each card.

// ------------------------------------------------------------------- nav
const NAV_LINKS = [
  { label: "How It Works", href: "#how-it-works" },
  { label: "Partner Ecosystem", href: "#ecosystem" },
  { label: "Services", href: "#services" },
  { label: "For Anchor Partners", href: "#for-anchor-partners" },
  { label: "For Businesses", href: "#for-businesses" },
  { label: "For Clients", href: "#for-clients" },
  { label: "About", href: "#ecosystem" },
] as const;

// ------------------------------------------------------- partner directory
// Card order + default (fallback) names + card body copy come from the copy
// file. CATEGORY_SLOT_MAP maps live catalogue category slugs to these cards so
// the section stays fully catalogue-driven; a card with no matching catalogue
// category renders its copy-file default name with an honest empty state.
const DIRECTORY_SLOTS = [
  {
    key: "construction-fit-out",
    defaultName: "Construction and fit-out",
    body: "Connect with businesses supporting construction, renovation, interiors, installation, and specialist works.",
  },
  {
    key: "facilities-management",
    defaultName: "Facilities management",
    body: "Build partnerships across cleaning, maintenance, building operations, support services, and property care.",
  },
  {
    key: "security-services",
    defaultName: "Security services",
    body: "Coordinate security, monitoring, access control, personnel, and specialist protection services.",
  },
  {
    key: "logistics-transport",
    defaultName: "Logistics and transport",
    body: "Combine fleet capacity, delivery operations, warehousing, distribution, and transport coverage.",
  },
  {
    key: "technical-services",
    defaultName: "Technical services",
    body: "Find businesses providing engineering, technology, installation, systems, and specialist technical expertise.",
  },
  {
    key: "professional-services",
    defaultName: "Professional services",
    body: "Connect with consultants, advisors, project managers, legal, financial, marketing, and operational specialists.",
  },
  {
    key: "staffing-workforce",
    defaultName: "Staffing and workforce",
    body: "Access complementary workforce capacity, staffing support, temporary personnel, and specialist teams.",
  },
  {
    key: "events-production",
    defaultName: "Events and production",
    body: "Bring together event planning, production, equipment, staffing, venues, logistics, and technical delivery.",
  },
] as const;

// Catalogue category slug → landing card key. This map decides which live
// catalogue categories surface on which partner-directory card (multiple
// categories can feed one card, e.g. facilities-management + waste + grounds).
// Catalogue categories not listed here are not yet part of the public directory.
const CATEGORY_SLOT_MAP: Record<string, string> = {
  "facilities-management": "facilities-management",
  "building-trades": "construction-fit-out",
  security: "security-services",
  "specialist-services": "technical-services",
  "environmental-waste": "facilities-management",
  "landscaping-grounds": "facilities-management",
};

/** Statuses that count as "listed" on the public directory (mirrors the admin
 *  dashboard: listed + pending review, excludes Rejected / Archived). */
const HIDDEN_SERVICE_STATUSES = new Set(["Rejected", "Archived"]);

// -------------------------------------------------------------- how it works
const STEPS = [
  {
    step: "01",
    title: "Build your profile",
    body: "Show the market what your business provides, where you operate, what capacity you have, and what kind of partnerships you are looking to build.",
  },
  {
    step: "02",
    title: "Discover aligned businesses",
    body: "Find companies with complementary services, relevant experience, shared locations, and compatible ambitions.",
  },
  {
    step: "03",
    title: "Form a partnership",
    body: "Invite the right businesses into a structured Partnership Workspace and define each company's contribution, responsibilities, documents, and commercial terms.",
  },
  {
    step: "04",
    title: "Coordinate fulfilment",
    body: "Manage services, work packages, tasks, milestones, documents, approvals, variations, and invoices through one shared environment.",
  },
  {
    step: "05",
    title: "Build continuity",
    body: "Complete the opportunity, record performance, and create a foundation for future collaboration.",
  },
] as const;

// ------------------------------------------------------------ ecosystem cards
const ECOSYSTEM_CARDS = [
  {
    title: "Shared capability",
    body: "Bring together complementary services, expertise, people, equipment, and operational capacity.",
    icon: "M12 3l7 3v5c0 4.4-3 8.4-7 10-4-1.6-7-5.6-7-10V6l7-3z",
  },
  {
    title: "Inclusive fulfilment",
    body: "Give smaller and specialist businesses a structured way to contribute to contracts that may be too large to deliver alone.",
    icon: "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM22 21v-2a4 4 0 00-3-3.9",
  },
  {
    title: "Trusted relationships",
    body: "Build partnerships supported by verified profiles, clear responsibilities, transparent communication, and shared records.",
    icon: "M9 12.5l2 2 4-4.5M12 3l7 3v5c0 4.4-3 8.4-7 10-4-1.6-7-5.6-7-10V6l7-3z",
  },
  {
    title: "Long-term value",
    body: "Turn individual opportunities into lasting commercial relationships, repeat work, referrals, and shared growth.",
    icon: "M3 17l6-6 4 4 8-8M15 7h6v6",
  },
] as const;

// --------------------------------------------------------- platform features
const FEATURES = [
  {
    title: "Partnership Workspace",
    body: "Create a shared workspace for each opportunity, partnership, or contract.",
    icon: "M4 6h16M4 12h16M4 18h10M18 15l3 3-3 3",
  },
  {
    title: "Partner invitations",
    body: "Invite businesses from the ScaleBridge ecosystem or bring in a trusted company directly by email.",
    icon: "M12 21s-7-4.6-9.2-9A5.4 5.4 0 0112 6.2 5.4 5.4 0 0121.2 12C19 16.4 12 21 12 21z",
  },
  {
    title: "Contribution areas",
    body: "Define what each partner contributes, including services, responsibilities, capacity, deliverables, and deadlines.",
    icon: "M8 7h8m-4-4v8M5 12a7 7 0 1014 0M12 21v-4",
  },
  {
    title: "Documents and verification",
    body: "Collect licences, insurance, capability statements, pricing, agreements, and project documents in one place.",
    icon: "M8 11V7a4 4 0 018 0v4M6 11h12v9H6v-9z",
  },
  {
    title: "Shared fulfilment",
    body: "Coordinate tasks, milestones, progress updates, variations, approvals, invoices, and completion.",
    icon: "M4 6h16M4 12h16M4 18h10M12 3v6",
  },
  {
    title: "Partnership intelligence",
    body: "Identify complementary services, undiscovered capabilities, relevant opportunities, and ways to deepen existing business relationships.",
    icon: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 8v4l2.5 2.5",
  },
] as const;

// --------------------------------------------------------------- audiences
const FOR_ANCHORS = [
  "Find relevant capability partners.",
  "Invite existing or new businesses.",
  "Define contribution areas.",
  "Collect documents and pricing.",
  "Manage delivery and milestones.",
  "Track variations and invoices.",
  "Build a reliable partner network.",
];

const FOR_BUSINESSES = [
  "Present your services clearly.",
  "Display your capacity and experience.",
  "Access relevant opportunities.",
  "Participate in larger fulfilment teams.",
  "Build your delivery record.",
  "Develop repeat partnerships.",
];

const FOR_CLIENTS = [
  "View approved delivery structures.",
  "Monitor work-package progress.",
  "Review documents and evidence.",
  "Approve milestones.",
  "Manage issues and variations.",
  "Review invoices.",
  "Confirm completion.",
];

// ------------------------------------------------------- intelligence list
const INTELLIGENCE_ITEMS = [
  "Services a business already provides.",
  "Capabilities not yet listed on its profile.",
  "Services that complement current contracts.",
  "Relevant partner matches.",
  "Opportunities to deepen existing relationships.",
  "Additional ways for businesses to contribute.",
];

// ------------------------------------------------------------ trust points
const TRUST_POINTS = [
  "Business identity.",
  "Company information.",
  "Licences and certifications.",
  "Insurance.",
  "References.",
  "Capacity.",
  "Project participation.",
  "Delivery performance.",
];

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
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-5 sm:px-8">
        <a href="/" aria-label="ScaleBridge home">
          <Logo />
        </a>
        <nav className="hidden items-center gap-5 text-sm font-semibold text-muted xl:flex">
          {NAV_LINKS.map((link) => (
            <a key={link.label} href={link.href} className="whitespace-nowrap hover:text-brand">
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <ButtonLink to="/signup" variant="primary" size="sm">
            Build Your Partner Profile
          </ButtonLink>
          <ButtonLink
            to="/login"
            variant="ghost"
            size="sm"
            className="hidden border border-slate-200 bg-white sm:inline-flex"
          >
            Create a Partnership Workspace
          </ButtonLink>
        </div>
      </div>
    </header>
  );
}

// ================================================================== hero
const HERO_PARTNERS = [
  { name: "Reyes Facilities Group", pkg: "HVAC — servicing & repairs", status: "Verified", tone: "green" as const },
  { name: "Clearview Cleaning", pkg: "Cleaning — daily janitorial", status: "Joined", tone: "teal" as const },
  { name: "Northgate Security", pkg: "Security — site access & patrols", status: "Invited", tone: "blue" as const },
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
            Big contracts.{" "}
            <span className="text-teal">Open to every capable business.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-300">
            ScaleBridge connects businesses into trusted commercial partnerships,
            enabling them to combine capabilities, share responsibility, and
            fulfil larger contracts without leaving smaller companies behind.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <ButtonLink to="/signup" variant="primary" size="lg" className="w-full sm:w-auto">
              Build Your Partner Profile
            </ButtonLink>
            <ButtonLink
              to="/login"
              variant="outline"
              size="lg"
              className="w-full border-white/25 bg-white/5 text-white hover:border-teal hover:text-teal sm:w-auto"
            >
              Create a Partnership Workspace
            </ButtonLink>
          </div>
          <p className="mt-5 text-sm font-medium text-slate-400">
            Longevity through partnership.
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
                    <Badge tone={c.tone}>{c.status}</Badge>
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
        eyebrow="THE SCALEBRIDGE ECOSYSTEM"
        title="Stronger contracts are built through stronger connections."
      />
      <div className="mx-auto max-w-3xl space-y-4 text-center text-lg text-muted">
        <p>
          No business should be excluded from meaningful opportunities simply
          because it is smaller, newer, more specialised, or operating in one
          location.
        </p>
        <p>
          ScaleBridge creates the infrastructure for businesses to find one
          another, form trusted partnerships, combine resources, and contribute
          to larger commercial outcomes.
        </p>
        <p>We believe contract fulfilment should create room for every capable business.</p>
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
        eyebrow="HOW PARTNERSHIP WORKS"
        title="From individual capability to collective delivery."
      />
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {STEPS.map((item) => (
          <li
            key={item.step}
            className="group relative rounded-2xl border border-slate-200 bg-white p-5 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)]"
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="font-display text-2xl font-extrabold text-teal">
                {item.step}
              </span>
            </div>
            <h3 className="text-base font-bold text-navy">{item.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{item.body}</p>
          </li>
        ))}
      </ol>
      <p className="mt-10 text-center text-lg font-medium text-brand">
        One opportunity can become a lasting relationship.
      </p>
    </Section>
  );
}

// ================================================================= services
type DirectoryCard = {
  key: string;
  name: string;
  body: string;
  services: ServiceRow[];
  live: boolean;
};

function buildDirectory(
  categories: ServiceCategoryRow[],
  services: ServiceRow[],
): DirectoryCard[] {
  const bySlot = new Map<string, { category: ServiceCategoryRow; services: ServiceRow[] }>();
  for (const category of categories) {
    const slotKey = CATEGORY_SLOT_MAP[category.slug];
    if (!slotKey) continue;
    const listed = services.filter(
      (s) => s.categoryId === category.id && !HIDDEN_SERVICE_STATUSES.has(s.status),
    );
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
      name: match?.category.name ?? slot.defaultName,
      body: slot.body,
      services: (match?.services ?? []).sort((a, b) => a.name.localeCompare(b.name)),
      live: Boolean(match),
    };
  });
}

function Services({ categories, services }: { categories: ServiceCategoryRow[]; services: ServiceRow[] }) {
  const cards = buildDirectory(categories, services);
  return (
    <Section id="services" className="bg-white">
      <SectionHeading
        eyebrow="THE PARTNER DIRECTORY"
        title="Find the capabilities that complete the opportunity."
        body="ScaleBridge brings together businesses across complementary industries and service categories, making it easier to identify the right partners for each opportunity."
      />
      <p className="mx-auto -mt-6 mb-12 max-w-2xl text-center text-sm text-muted">
        Service categories should be managed dynamically through the Master Admin
        Portal so the website can expand as the network grows.
      </p>
      <div className="flex justify-center">
        <a
          href="#partner-directory"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-navy transition-colors hover:border-brand hover:text-brand"
        >
          Explore Partner Services
        </a>
      </div>
      <div
        id="partner-directory"
        className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {cards.map((card) => (
          <div
            key={card.key}
            className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-[var(--shadow-card)]"
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
        eyebrow="BUILT FOR COLLABORATION"
        title="One workspace for the relationship and the opportunity."
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
  return (
    <Section className="bg-white">
      <div className="grid gap-6 lg:grid-cols-3">
        <div id="for-anchor-partners" className="rounded-3xl border border-slate-200 bg-mist p-8 sm:p-10">
          <Badge tone="blue" className="mb-4">
            For anchor partners
          </Badge>
          <h2 className="text-2xl font-bold sm:text-3xl">
            Lead the opportunity. Strengthen the partnership.
          </h2>
          <p className="mt-3 text-muted">
            ScaleBridge gives anchor partners a structured way to find businesses,
            invite them into specific opportunities, allocate contribution areas,
            collect information, and coordinate fulfilment from one workspace.
          </p>
          <ul className="mt-6 space-y-3">
            {FOR_ANCHORS.map((item) => (
              <li key={item} className="flex items-start gap-3 text-sm text-ink">
                <CheckIcon />
                {item}
              </li>
            ))}
          </ul>
          <ButtonLink to="/login" variant="secondary" className="mt-8">
            Create a Partnership Workspace
          </ButtonLink>
        </div>

        <div id="for-businesses" className="rounded-3xl border border-slate-200 bg-navy p-8 text-white sm:p-10">
          <Badge tone="teal" className="mb-4">
            For partner businesses
          </Badge>
          <h2 className="text-2xl font-bold text-white sm:text-3xl">
            Your size should not limit your opportunity.
          </h2>
          <p className="mt-3 text-slate-300">
            Build a visible business profile, showcase your capabilities, receive
            partnership invitations, contribute to larger contracts, and develop
            lasting commercial relationships.
          </p>
          <ul className="mt-6 space-y-3">
            {FOR_BUSINESSES.map((item) => (
              <li key={item} className="flex items-start gap-3 text-sm text-slate-200">
                <CheckIcon />
                {item}
              </li>
            ))}
          </ul>
          <ButtonLink to="/signup" variant="primary" className="mt-8">
            Join the Partner Ecosystem
          </ButtonLink>
        </div>

        <div id="for-clients" className="rounded-3xl border border-slate-200 bg-mist p-8 sm:p-10">
          <Badge tone="blue" className="mb-4">
            For clients and principals
          </Badge>
          <h2 className="text-2xl font-bold sm:text-3xl">
            See how the work is being delivered.
          </h2>
          <p className="mt-3 text-muted">
            Clients and principals can view approved contract information, monitor
            progress, review milestones, approve documents, raise issues, review
            variations, and communicate with the anchor partner.
          </p>
          <ul className="mt-6 space-y-3">
            {FOR_CLIENTS.map((item) => (
              <li key={item} className="flex items-start gap-3 text-sm text-ink">
                <CheckIcon />
                {item}
              </li>
            ))}
          </ul>
          <ButtonLink to="/client/login" variant="secondary" className="mt-8">
            Access the Client Portal
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
          PARTNERSHIP INTELLIGENCE
        </p>
        <h2 className="text-3xl font-bold text-white sm:text-4xl">
          Discover more value inside every relationship.
        </h2>
      </div>
      <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-2">
        <div className="flex flex-col">
          <p className="text-lg leading-relaxed text-slate-300">
            ScaleBridge can identify additional capabilities, complementary
            services, and future partnership opportunities based on company
            profiles, client intake, project information, approved documents, and
            relevant public business information.
          </p>
          <p className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5 text-sm leading-relaxed text-slate-300">
            Recommendations are evidence-based, reviewable, and controlled by
            authorised users. ScaleBridge does not change a company profile or
            contact a business without appropriate approval.
          </p>
          <div className="mt-8">
            <ButtonLink
              to="/signup"
              variant="primary"
              size="lg"
              className="w-full sm:w-auto"
            >
              Discover Partnership Opportunities
            </ButtonLink>
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <p className="text-sm font-bold uppercase tracking-widest text-slate-400">
            The Partnership Intelligence system helps identify:
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
        eyebrow="BUILT ON TRUST"
        title="Partnership works when capability is visible."
        body="ScaleBridge helps businesses present their capabilities clearly and gives partners greater confidence through structured verification and transparent project records."
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
        Verification does not replace due diligence. It creates a clearer
        foundation for businesses to assess one another, define expectations, and
        collaborate responsibly.
      </p>
    </Section>
  );
}

// ================================================================ final CTA
function FinalCta() {
  return (
    <section className="bg-mist pb-20">
      <div className="container-site">
        <div className="overflow-hidden rounded-3xl bg-navy px-6 py-14 text-center sm:px-12">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            The next opportunity may require more than one business.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-slate-300">
            ScaleBridge helps capable businesses connect, contribute, and create
            lasting value together.
          </p>
          <p className="mx-auto mt-3 max-w-xl text-slate-300">
            Whether you are leading an opportunity, providing specialist
            capability, or commissioning the work, there is a place for you in a
            more connected commercial ecosystem.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <ButtonLink to="/signup" variant="primary" size="lg" className="w-full sm:w-auto">
              Build Your Partner Profile
            </ButtonLink>
            <ButtonLink
              to="/login"
              variant="outline"
              size="lg"
              className="w-full border-white/25 bg-white/5 text-white hover:border-teal hover:text-teal sm:w-auto"
            >
              Create a Partnership Workspace
            </ButtonLink>
          </div>
          <p className="mt-6 text-sm font-semibold text-teal">
            Longevity through partnership. Inclusive fulfilment through shared capability.
          </p>
        </div>
      </div>
    </section>
  );
}

// ================================================================== footer
const FOOTER_LINKS = [
  { label: "How It Works", href: "#how-it-works" },
  { label: "Partner Ecosystem", href: "#ecosystem" },
  { label: "Services", href: "#services" },
  { label: "For Anchor Partners", href: "#for-anchor-partners" },
  { label: "For Businesses", href: "#for-businesses" },
  { label: "For Clients", href: "#for-clients" },
  { label: "Verification", href: "#trust" },
  { label: "About", href: "#ecosystem" },
  { label: "Contact", href: "#" },
  { label: "Privacy", href: "#" },
  { label: "Terms", href: "#" },
] as const;

function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="container-site flex flex-col items-center gap-8 py-12">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo />
          <p className="max-w-md text-sm font-medium text-muted">
            ScaleBridge — The infrastructure for lasting business partnerships.
          </p>
        </div>
        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm font-semibold text-muted">
          {FOOTER_LINKS.map((link) => (
            <a key={link.label} href={link.href} className="hover:text-brand">
              {link.label}
            </a>
          ))}
        </nav>
        <p className="max-w-2xl text-center text-xs leading-relaxed text-muted">
          ScaleBridge helps businesses of every size participate in larger
          opportunities through structured, trusted partnerships.
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
