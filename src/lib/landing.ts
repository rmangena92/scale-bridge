/**
 * Public landing-page data (plan item: refreshed landing site).
 *
 * The services section of the public landing page must read from the live
 * service catalogue — NOT hardcoded JSX. This module exposes ONE server
 * function, `listPublishedServices`, that returns the published part of the
 * catalogue (categories + services with a human-approved public status).
 *
 * PUBLIC READ — NO AUTH: unlike every admin/workspace/client server fn, this
 * call deliberately does NOT load a session and does NOT set app.user_id /
 * app.role. It relies on two dedicated RLS policies added in schema.ts:
 *   - service_categories_select_public:  for select to scalebridge_app using (true)
 *   - services_select_public:            for select to scalebridge_app
 *                                         using (status in ('Listed','Verified'))
 * The app connects as the `scalebridge_app` role, so an anonymous visitor's
 * request passes those policies and sees only published catalogue rows. Admin
 * sessions are unaffected (policies OR together; the IS_ADMIN policies still
 * expose every row to sb_admin).
 *
 * This module is a server-function wrapper (createServerFn), so it is safe to
 * import from client components exactly like admin.ts / workspace.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { asService, dbConfigured, ensureSchema } from "./db";

/** Statuses with a human-approved public listing (mirrors the public policy). */
export const PUBLISHED_SERVICE_STATUSES = ["Listed", "Verified"] as const;
export type PublishedServiceStatus = (typeof PUBLISHED_SERVICE_STATUSES)[number];

export type PublishedCategory = {
  id: string;
  name: string;
  slug: string;
};

export type PublishedService = {
  id: string;
  name: string;
  slug: string;
  status: PublishedServiceStatus;
  categoryId: string;
  categorySlug: string;
  categoryName: string;
};

export type PublishedCatalogueResult =
  | { ok: true; categories: PublishedCategory[]; services: PublishedService[] }
  | { ok: false; error: string; setupRequired?: boolean };

async function doListPublishedServices(): Promise<PublishedCatalogueResult> {
  if (!dbConfigured()) {
    return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  }
  try {
    await ensureSchema();
    const [cats, svcs] = (await asService((tx) => [
      tx`select id, name, slug
           from service_categories
          order by sort_order, name`,
      tx`select s.id, s.name, s.slug, s.status,
                s.category_id, c.slug as category_slug, c.name as category_name
           from services s
           join service_categories c on c.id = s.category_id
          where s.status = any(${PUBLISHED_SERVICE_STATUSES as unknown as string[]})
          order by c.sort_order, s.name`,
    ])) as unknown as [
      { id: string; name: string; slug: string }[],
      {
        id: string;
        name: string;
        slug: string;
        status: PublishedServiceStatus;
        category_id: string;
        category_slug: string;
        category_name: string;
      }[],
    ];
    return {
      ok: true,
      categories: cats.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
      services: svcs.map((s) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        status: s.status,
        categoryId: s.category_id,
        categorySlug: s.category_slug,
        categoryName: s.category_name,
      })),
    };
  } catch (err) {
    console.error("listPublishedServices failed:", err);
    return { ok: false, error: "Could not load the partner directory." };
  }
}

/** Public landing-page catalogue read — no auth required. */
export const listPublishedServices = createServerFn({ method: "GET" }).handler(
  doListPublishedServices,
);
