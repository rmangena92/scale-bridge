/**
 * Landing-page copy — SINGLE SOURCE OF TRUTH for the public site.
 *
 * Every word on the landing page comes from the owner's copy file
 * (/home/team/shared/landing-page-copy.md, delivered 2026-08-11) and is kept
 * VERBATIM here — do not rewrite, rephrase or "improve" it. The page
 * (src/routes/index.tsx) renders exclusively from this module, so a future
 * Admin Portal content editor can swap any string here without touching page
 * structure. Icons below are visual assets, not copy, but are kept here so the
 * whole landing is editable from one place.
 *
 * Dynamic data: the partner-directory card NAMES come from the live service
 * catalogue when a matching category exists (see CATEGORY_SLOT_MAP), falling
 * back to the copy names below. The service chips on each card ALWAYS come
 * from the live catalogue (src/lib/landing.ts → listPublishedServices).
 */
export const LANDING = {
  nav: {
    links: [
      { label: "How It Works", href: "#how-it-works" },
      { label: "Partner Ecosystem", href: "#ecosystem" },
      { label: "Services", href: "#services" },
      { label: "For Anchor Partners", href: "#for-anchor-partners" },
      { label: "For Businesses", href: "#for-businesses" },
      { label: "For Clients", href: "#for-clients" },
      { label: "About", href: "#ecosystem" },
    ],
    primaryCta: "Build Your Partner Profile",
    secondaryCta: "Create a Partnership Workspace",
  },

  hero: {
    headlineLead: "Big contracts.",
    headlineAccent: "Open to every capable business.",
    supporting:
      "ScaleBridge connects businesses into trusted commercial partnerships, enabling them to combine capabilities, share responsibility, and fulfil larger contracts without leaving smaller companies behind.",
    primaryCta: "Build Your Partner Profile",
    secondaryCta: "Create a Partnership Workspace",
    microcopy: "Longevity through partnership.",
  },

  ecosystem: {
    eyebrow: "THE SCALEBRIDGE ECOSYSTEM",
    heading: "Stronger contracts are built through stronger connections.",
    paragraphs: [
      "No business should be excluded from meaningful opportunities simply because it is smaller, newer, more specialised, or operating in one location.",
      "ScaleBridge creates the infrastructure for businesses to find one another, form trusted partnerships, combine resources, and contribute to larger commercial outcomes.",
      "We believe contract fulfilment should create room for every capable business.",
    ],
    cards: [
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
    ],
  },

  howItWorks: {
    eyebrow: "HOW PARTNERSHIP WORKS",
    heading: "From individual capability to collective delivery.",
    steps: [
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
    ],
    supportingLine: "One opportunity can become a lasting relationship.",
  },

  services: {
    eyebrow: "THE PARTNER DIRECTORY",
    heading: "Find the capabilities that complete the opportunity.",
    body: "ScaleBridge brings together businesses across complementary industries and service categories, making it easier to identify the right partners for each opportunity.",
    dynamicNote:
      "Service categories should be managed dynamically through the Master Admin Portal so the website can expand as the network grows.",
    cta: "Explore Partner Services",
    /** Card order + copy-file default names/bodies (fallbacks when the live
     *  catalogue has no matching category). */
    slots: [
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
    ],
    /** Live catalogue category slug → landing card key. Decides which
     *  catalogue categories surface on which partner-directory card (multiple
     *  categories can feed one card). The live category name becomes the card
     *  title when present; otherwise the copy default above is used. */
    categorySlotMap: {
      "facilities-management": "facilities-management",
      "building-trades": "construction-fit-out",
      security: "security-services",
      "specialist-services": "technical-services",
      "environmental-waste": "facilities-management",
      "landscaping-grounds": "facilities-management",
      "logistics-transport": "logistics-transport",
      "professional-services": "professional-services",
      "staffing-workforce": "staffing-workforce",
      "events-production": "events-production",
    } as Record<string, string>,
  },

  features: {
    eyebrow: "BUILT FOR COLLABORATION",
    heading: "One workspace for the relationship and the opportunity.",
    items: [
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
    ],
  },

  audiences: {
    anchor: {
      badge: "For anchor partners",
      heading: "Lead the opportunity. Strengthen the partnership.",
      body: "ScaleBridge gives anchor partners a structured way to find businesses, invite them into specific opportunities, allocate contribution areas, collect information, and coordinate fulfilment from one workspace.",
      benefits: [
        "Find relevant capability partners.",
        "Invite existing or new businesses.",
        "Define contribution areas.",
        "Collect documents and pricing.",
        "Manage delivery and milestones.",
        "Track variations and invoices.",
        "Build a reliable partner network.",
      ],
      cta: { label: "Create a Partnership Workspace", to: "/login" },
    },
    businesses: {
      badge: "For partner businesses",
      heading: "Your size should not limit your opportunity.",
      body: "Build a visible business profile, showcase your capabilities, receive partnership invitations, contribute to larger contracts, and develop lasting commercial relationships.",
      benefits: [
        "Present your services clearly.",
        "Display your capacity and experience.",
        "Access relevant opportunities.",
        "Participate in larger fulfilment teams.",
        "Build your delivery record.",
        "Develop repeat partnerships.",
      ],
      cta: { label: "Join the Partner Ecosystem", to: "/signup" },
    },
    clients: {
      badge: "For clients and principals",
      heading: "See how the work is being delivered.",
      body: "Clients and principals can view approved contract information, monitor progress, review milestones, approve documents, raise issues, review variations, and communicate with the anchor partner.",
      benefits: [
        "View approved delivery structures.",
        "Monitor work-package progress.",
        "Review documents and evidence.",
        "Approve milestones.",
        "Manage issues and variations.",
        "Review invoices.",
        "Confirm completion.",
      ],
      cta: { label: "Access the Client Portal", to: "/client/login" },
    },
  },

  intelligence: {
    eyebrow: "PARTNERSHIP INTELLIGENCE",
    heading: "Discover more value inside every relationship.",
    body: "ScaleBridge can identify additional capabilities, complementary services, and future partnership opportunities based on company profiles, client intake, project information, approved documents, and relevant public business information.",
    helpsIdentifyTitle: "The Partnership Intelligence system helps identify:",
    helpsIdentify: [
      "Services a business already provides.",
      "Capabilities not yet listed on its profile.",
      "Services that complement current contracts.",
      "Relevant partner matches.",
      "Opportunities to deepen existing relationships.",
      "Additional ways for businesses to contribute.",
    ],
    supporting:
      "Recommendations are evidence-based, reviewable, and controlled by authorised users. ScaleBridge does not change a company profile or contact a business without appropriate approval.",
    cta: { label: "Discover Partnership Opportunities", to: "/signup" },
  },

  trust: {
    eyebrow: "BUILT ON TRUST",
    heading: "Partnership works when capability is visible.",
    body: "ScaleBridge helps businesses present their capabilities clearly and gives partners greater confidence through structured verification and transparent project records.",
    points: [
      "Business identity.",
      "Company information.",
      "Licences and certifications.",
      "Insurance.",
      "References.",
      "Capacity.",
      "Project participation.",
      "Delivery performance.",
    ],
    supporting:
      "Verification does not replace due diligence. It creates a clearer foundation for businesses to assess one another, define expectations, and collaborate responsibly.",
  },

  finalCta: {
    heading: "The next opportunity may require more than one business.",
    paragraphs: [
      "ScaleBridge helps capable businesses connect, contribute, and create lasting value together.",
      "Whether you are leading an opportunity, providing specialist capability, or commissioning the work, there is a place for you in a more connected commercial ecosystem.",
    ],
    primaryCta: "Build Your Partner Profile",
    secondaryCta: "Create a Partnership Workspace",
    closing: "Longevity through partnership. Inclusive fulfilment through shared capability.",
  },

  footer: {
    tagline: "ScaleBridge — The infrastructure for lasting business partnerships.",
    links: [
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
    ],
    closing:
      "ScaleBridge helps businesses of every size participate in larger opportunities through structured, trusted partnerships.",
  },
} as const;

/** Standalone aliases so page components can destructure sections directly. */
export const NAV_LINKS = LANDING.nav.links;
export const DIRECTORY_SLOTS = LANDING.services.slots;
export const CATEGORY_SLOT_MAP = LANDING.services.categorySlotMap;
export const STEPS = LANDING.howItWorks.steps;
export const ECOSYSTEM_CARDS = LANDING.ecosystem.cards;
export const FEATURES = LANDING.features.items;
export const FOR_ANCHORS = LANDING.audiences.anchor.benefits;
export const FOR_BUSINESSES = LANDING.audiences.businesses.benefits;
export const FOR_CLIENTS = LANDING.audiences.clients.benefits;
export const INTELLIGENCE_ITEMS = LANDING.intelligence.helpsIdentify;
export const TRUST_POINTS = LANDING.trust.points;
export const FOOTER_LINKS = LANDING.footer.links;
