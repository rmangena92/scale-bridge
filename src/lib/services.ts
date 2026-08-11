/**
 * Central service catalogue — ALL server-only logic (DB access via ~/db +
 * asUser, admin authorization, audit logging). Imported exclusively from
 * ./admin.ts (server-function wrappers), so this module and its server-only
 * imports never reach the browser bundle. Do not import it from client
 * components.
 *
 * SECURITY MODEL (same as ./admin-core.ts):
 *  - Every entry point calls loadAdminUser() (auth-core): the session user must
 *    have a row in admin_roles, otherwise the call is denied.
 *  - Queries run via asUser(admin.id, 'sb_admin', …) so RLS policies gate on
 *    current_setting('app.role') = 'sb_admin' — the same gate every catalogue
 *    policy uses (service_categories / services / company_services /
 *    service_evidence are sb_admin-only, mirroring company_notes).
 *  - Mutations additionally require canMutate (the staff member is not
 *    read_only) and append an audit_logs row (admin.service.* /
 *    admin.company_service.*) in the same transaction as the change.
 */
import { asUser, dbConfigured, ensureSchema, isUniqueViolation } from "./db";
import type { Tx, TxQuery } from "./db";
import { auditQuery } from "./audit";
import { loadAdminUser } from "./auth-core";
import { SERVICE_STATUSES } from "./service-types";

// ------------------------------------------------------------- catalogue enums
export { SERVICE_STATUSES, type ServiceStatus } from "./service-types";

export const SERVICE_SOURCES = [
  "company profile",
  "website",
  "client intake form",
  "uploaded documents",
  "contract participation",
  "manual entry",
  "AI discovery",
  "service proposal",
  "company communication",
] as const;
export type ServiceSource = (typeof SERVICE_SOURCES)[number];

export const SERVICE_CONFIDENCES = [
  "High",
  "Medium",
  "Low",
  "Requires manual review",
] as const;
export type ServiceConfidence = (typeof SERVICE_CONFIDENCES)[number];

export const COMPANY_SERVICE_VERIFICATIONS = ["Verified", "Pending", "Rejected"] as const;
export type CompanyServiceVerification = (typeof COMPANY_SERVICE_VERIFICATIONS)[number];

export const ADMIN_DECISIONS = ["Approved", "Rejected", "Archived"] as const;
export type AdminDecision = (typeof ADMIN_DECISIONS)[number];

/** Snapshot of a service row the way the admin UI consumes it. */
export type ServiceRow = {
  id: string;
  name: string;
  slug: string;
  categoryId: string;
  categoryName: string;
  description: string | null;
  industry: string | null;
  requiredQualifications: string[];
  status: ServiceStatus;
  capacity: string | null;
  geographicCoverage: string | null;
  relatedServiceIds: string[];
  upsellServiceIds: string[];
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  providerCount: number; // company_services rows with verification_status='Verified'
  potentialProviderCount: number; // company_services rows not verified
  activeDemandCount: number; // company_services rows with active_with_scalebridge
};

export type ServiceCategoryRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
  createdAt: string;
};

export type ServiceEvidenceRow = {
  id: string;
  companyServiceId: string;
  evidenceType: string | null;
  title: string | null;
  sourceUrl: string | null;
  excerpt: string | null;
  capturedAt: string | null;
  agentVersion: string | null;
  createdAt: string;
};

export type CompanyServiceRow = {
  id: string;
  companyId: string;
  serviceId: string;
  source: ServiceSource;
  confidence: ServiceConfidence;
  verificationStatus: CompanyServiceVerification;
  evidenceSummary: string | null;
  discoveredAt: string | null;
  activeWithScalebridge: boolean;
  upsellRecommended: boolean;
  adminDecision: AdminDecision | null;
  notes: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  service: {
    id: string;
    name: string;
    slug: string;
    categoryId: string;
    categoryName: string;
    status: ServiceStatus;
    description: string | null;
    industry: string | null;
  };
  evidence: ServiceEvidenceRow[];
};

// ------------------------------------------------------------- result types
export type ServiceCategoriesResult =
  | { ok: true; categories: ServiceCategoryRow[]; total: number }
  | { ok: false; error: string; setupRequired?: boolean };

export type ServicesResult =
  | { ok: true; services: ServiceRow[]; total: number }
  | { ok: false; error: string; setupRequired?: boolean };

export type ServiceDetailResult =
  | {
      ok: true;
      service: ServiceRow;
      providers: {
        id: string;
        companyId: string;
        companyName: string;
        companyType: string | null;
        companyVerificationStatus: string;
        source: ServiceSource;
        confidence: ServiceConfidence;
        verificationStatus: CompanyServiceVerification;
        evidenceSummary: string | null;
        discoveredAt: string | null;
        activeWithScalebridge: boolean;
        upsellRecommended: boolean;
        adminDecision: AdminDecision | null;
        notes: string | null;
        createdAt: string;
      }[];
      related: ServiceRow[];
      upsells: ServiceRow[];
    }
  | { ok: false; error: string; setupRequired?: boolean };

export type CompanyServicesResult =
  | { ok: true; relationships: CompanyServiceRow[]; total: number }
  | { ok: false; error: string; setupRequired?: boolean };

export type SimpleResult =
  | { ok: true; id?: string }
  | { ok: false; error: string; setupRequired?: boolean };

// ------------------------------------------------------------------ helpers
/** Slugify a service name: lowercase, non-alphanumerics → '-', collapsed. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

type ServiceDbRow = {
  id: string;
  name: string;
  slug: string;
  category_id: string;
  category_name: string;
  description: string | null;
  industry: string | null;
  required_qualifications: string[] | null;
  status: ServiceStatus;
  capacity: string | null;
  geographic_coverage: string | null;
  related_service_ids: string[] | null;
  upsell_service_ids: string[] | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  provider_count?: number;
  potential_provider_count?: number;
  active_demand_count?: number;
};

function toServiceRow(r: ServiceDbRow): ServiceRow {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    categoryId: r.category_id,
    categoryName: r.category_name,
    description: r.description,
    industry: r.industry,
    requiredQualifications: r.required_qualifications ?? [],
    status: r.status,
    capacity: r.capacity,
    geographicCoverage: r.geographic_coverage,
    relatedServiceIds: r.related_service_ids ?? [],
    upsellServiceIds: r.upsell_service_ids ?? [],
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    createdBy: r.created_by,
    providerCount: Number(r.provider_count ?? 0),
    potentialProviderCount: Number(r.potential_provider_count ?? 0),
    activeDemandCount: Number(r.active_demand_count ?? 0),
  };
}

// ------------------------------------------------------------ categories
export async function doListServiceCategories(): Promise<ServiceCategoriesResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };

    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select id, name, slug, description, sort_order, created_at
         from service_categories
         order by sort_order asc, name asc`,
    ]))[1] as {
      id: string;
      name: string;
      slug: string;
      description: string | null;
      sort_order: number;
      created_at: string;
    }[];
    const categories: ServiceCategoryRow[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      sortOrder: Number(r.sort_order ?? 0),
      createdAt: String(r.created_at),
    }));
    return { ok: true, categories, total: categories.length };
  } catch (err) {
    console.error("listServiceCategories failed:", err);
    return { ok: false, error: "Could not load service categories." };
  }
}

// ---------------------------------------------------------------- services
export async function doListServices(input: {
  status?: string;
  categoryId?: string;
  industry?: string;
  search?: string;
}): Promise<ServicesResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const status = input.status && SERVICE_STATUSES.includes(input.status as never) ? input.status : "";
  const categoryIdRaw = (input.categoryId ?? "").trim().slice(0, 64);
  // Bind the category filter as a real uuid (or NULL) — comparing a uuid
  // column against an empty string errors with "invalid input syntax for
  // type uuid", and Postgres may evaluate either side of an OR.
  const categoryId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    categoryIdRaw,
  )
    ? categoryIdRaw
    : null;
  const industry = (input.industry ?? "").trim().slice(0, 100);
  const search = (input.search ?? "").trim().slice(0, 100);
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };

    const pattern = `%${search}%`;
    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select s.id, s.name, s.slug, s.category_id, sc.name as category_name,
                s.description, s.industry, s.required_qualifications,
                s.status, s.capacity, s.geographic_coverage,
                s.related_service_ids, s.upsell_service_ids,
                s.created_at, s.updated_at, s.created_by,
                (select count(*)::int from company_services cs
                  where cs.service_id = s.id and cs.verification_status = 'Verified') as provider_count,
                (select count(*)::int from company_services cs
                  where cs.service_id = s.id and cs.verification_status <> 'Verified') as potential_provider_count,
                (select count(*)::int from company_services cs
                  where cs.service_id = s.id and cs.active_with_scalebridge = true) as active_demand_count
         from services s
         join service_categories sc on sc.id = s.category_id
         where (${status} = '' or s.status = ${status})
           and (${categoryId}::uuid is null or s.category_id = ${categoryId}::uuid)
           and (${industry} = '' or coalesce(s.industry, '') ilike ${`%${industry}%`})
           and (${search} = '' or s.name ilike ${pattern} or coalesce(s.description, '') ilike ${pattern})
         order by s.name asc
         limit 300`,
    ]))[1] as ServiceDbRow[];
    const services = rows.map(toServiceRow);
    return { ok: true, services, total: services.length };
  } catch (err) {
    console.error("listServices failed:", err);
    return { ok: false, error: "Could not load services." };
  }
}

export async function doGetServiceDetail(serviceId: string): Promise<ServiceDetailResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };

    const rows = await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select s.id, s.name, s.slug, s.category_id, sc.name as category_name,
                s.description, s.industry, s.required_qualifications,
                s.status, s.capacity, s.geographic_coverage,
                s.related_service_ids, s.upsell_service_ids,
                s.created_at, s.updated_at, s.created_by,
                (select count(*)::int from company_services cs
                  where cs.service_id = s.id and cs.verification_status = 'Verified') as provider_count,
                (select count(*)::int from company_services cs
                  where cs.service_id = s.id and cs.verification_status <> 'Verified') as potential_provider_count,
                (select count(*)::int from company_services cs
                  where cs.service_id = s.id and cs.active_with_scalebridge = true) as active_demand_count
         from services s
         join service_categories sc on sc.id = s.category_id
         where s.id = ${serviceId}`,
      tx`select cs.id, cs.company_id, c.name as company_name, c.type as company_type,
                c.verification_status as company_verification_status,
                cs.source, cs.confidence, cs.verification_status,
                cs.evidence_summary, cs.discovered_at,
                cs.active_with_scalebridge, cs.upsell_recommended,
                cs.admin_decision, cs.notes, cs.created_at
         from company_services cs
         join companies c on c.id = cs.company_id
         where cs.service_id = ${serviceId}
         order by c.name asc`,
      tx`select s2.id, s2.name, s2.slug, s2.category_id, sc2.name as category_name,
                s2.description, s2.industry, s2.required_qualifications,
                s2.status, s2.capacity, s2.geographic_coverage,
                s2.related_service_ids, s2.upsell_service_ids,
                s2.created_at, s2.updated_at, s2.created_by,
                (select count(*)::int from company_services cs
                  where cs.service_id = s2.id and cs.verification_status = 'Verified') as provider_count,
                (select count(*)::int from company_services cs
                  where cs.service_id = s2.id and cs.verification_status <> 'Verified') as potential_provider_count,
                (select count(*)::int from company_services cs
                  where cs.service_id = s2.id and cs.active_with_scalebridge = true) as active_demand_count
         from services s2
         join service_categories sc2 on sc2.id = s2.category_id
         where s2.id = any(
           (select unnest(related_service_ids) from services where id = ${serviceId})
         )
         order by s2.name asc`,
      tx`select s3.id, s3.name, s3.slug, s3.category_id, sc3.name as category_name,
                s3.description, s3.industry, s3.required_qualifications,
                s3.status, s3.capacity, s3.geographic_coverage,
                s3.related_service_ids, s3.upsell_service_ids,
                s3.created_at, s3.updated_at, s3.created_by,
                (select count(*)::int from company_services cs
                  where cs.service_id = s3.id and cs.verification_status = 'Verified') as provider_count,
                (select count(*)::int from company_services cs
                  where cs.service_id = s3.id and cs.verification_status <> 'Verified') as potential_provider_count,
                (select count(*)::int from company_services cs
                  where cs.service_id = s3.id and cs.active_with_scalebridge = true) as active_demand_count
         from services s3
         join service_categories sc3 on sc3.id = s3.category_id
         where s3.id = any(
           (select unnest(upsell_service_ids) from services where id = ${serviceId})
         )
         order by s3.name asc`,
    ]);
    const serviceRows = rows[1] as ServiceDbRow[];
    const svc = serviceRows[0];
    if (!svc) return { ok: false, error: "Service not found." };

    const providerRows = rows[2] as {
      id: string;
      company_id: string;
      company_name: string;
      company_type: string | null;
      company_verification_status: string;
      source: ServiceSource;
      confidence: ServiceConfidence;
      verification_status: CompanyServiceVerification;
      evidence_summary: string | null;
      discovered_at: string | null;
      active_with_scalebridge: boolean;
      upsell_recommended: boolean;
      admin_decision: AdminDecision | null;
      notes: string | null;
      created_at: string;
    }[];
    const relatedRows = rows[3] as ServiceDbRow[];
    const upsellRows = rows[4] as ServiceDbRow[];

    return {
      ok: true,
      service: toServiceRow(svc),
      providers: providerRows.map((r) => ({
        id: r.id,
        companyId: r.company_id,
        companyName: r.company_name,
        companyType: r.company_type,
        companyVerificationStatus: r.company_verification_status,
        source: r.source,
        confidence: r.confidence,
        verificationStatus: r.verification_status,
        evidenceSummary: r.evidence_summary,
        discoveredAt: r.discovered_at ? String(r.discovered_at) : null,
        activeWithScalebridge: r.active_with_scalebridge,
        upsellRecommended: r.upsell_recommended,
        adminDecision: r.admin_decision,
        notes: r.notes,
        createdAt: String(r.created_at),
      })),
      related: relatedRows.map(toServiceRow),
      upsells: upsellRows.map(toServiceRow),
    };
  } catch (err) {
    console.error("getServiceDetail failed:", err);
    return { ok: false, error: "Could not load the service." };
  }
}

// ------------------------------------------------------- service mutations
export type ServiceInput = {
  name: string;
  categoryId: string;
  slug?: string;
  description?: string | null;
  industry?: string | null;
  requiredQualifications?: string[];
  status?: ServiceStatus;
  capacity?: string | null;
  geographicCoverage?: string | null;
  relatedServiceIds?: string[];
  upsellServiceIds?: string[];
};

export async function doCreateService(input: ServiceInput): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const name = (input.name ?? "").trim().slice(0, 200);
  const categoryId = (input.categoryId ?? "").trim();
  const status: ServiceStatus =
    input.status && SERVICE_STATUSES.includes(input.status) ? input.status : "Listed";
  if (!name || !categoryId) {
    return { ok: false, error: "Service name and category are required." };
  }
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };
    if (!admin.canMutate) return { ok: false, error: "FORBIDDEN_READ_ONLY" };

    const slug = (input.slug ?? "").trim().slice(0, 80) || slugify(name);
    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select id from service_categories where id = ${categoryId}`,
      tx`insert into services (name, slug, category_id, description, industry,
                               required_qualifications, status, capacity,
                               geographic_coverage, related_service_ids,
                               upsell_service_ids, created_by)
         values (${name}, ${slug}, ${categoryId},
                 ${input.description?.trim().slice(0, 4000) ?? null},
                 ${input.industry?.trim().slice(0, 200) ?? null},
                 ${input.requiredQualifications ?? []},
                 ${status},
                 ${input.capacity?.trim().slice(0, 200) ?? null},
                 ${input.geographicCoverage?.trim().slice(0, 200) ?? null},
                 ${input.relatedServiceIds ?? []},
                 ${input.upsellServiceIds ?? []},
                 ${admin.user.id})
         returning id`,
      auditQuery(tx, admin.user.id, "admin.service.create", {
        name,
        slug,
        categoryId,
        status,
      }),
    ])) as unknown[];
    const inserted = rows[2] as { id: string }[];
    return { ok: true, id: inserted[0]?.id };
  } catch (err) {
    console.error("createService failed:", err);
    if (isUniqueViolation(err)) {
      return { ok: false, error: "A service with this slug already exists." };
    }
    return { ok: false, error: "Could not create the service." };
  }
}

export async function doUpdateService(
  serviceId: string,
  input: ServiceInput,
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const name = (input.name ?? "").trim().slice(0, 200);
  const categoryId = (input.categoryId ?? "").trim();
  const status: ServiceStatus =
    input.status && SERVICE_STATUSES.includes(input.status) ? input.status : "Listed";
  if (!name || !categoryId) {
    return { ok: false, error: "Service name and category are required." };
  }
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };
    if (!admin.canMutate) return { ok: false, error: "FORBIDDEN_READ_ONLY" };

    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select id, name, status from services where id = ${serviceId}`,
    ]))[1] as { id: string; name: string; status: string }[];
    if (!rows[0]) return { ok: false, error: "Service not found." };

    await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`update services set
            name = ${name},
            category_id = ${categoryId},
            description = ${input.description?.trim().slice(0, 4000) ?? null},
            industry = ${input.industry?.trim().slice(0, 200) ?? null},
            required_qualifications = ${input.requiredQualifications ?? []},
            status = ${status},
            capacity = ${input.capacity?.trim().slice(0, 200) ?? null},
            geographic_coverage = ${input.geographicCoverage?.trim().slice(0, 200) ?? null},
            related_service_ids = ${input.relatedServiceIds ?? []},
            upsell_service_ids = ${input.upsellServiceIds ?? []},
            updated_at = now()
         where id = ${serviceId}`,
      auditQuery(tx, admin.user.id, "admin.service.update", {
        serviceId,
        from: { name: rows[0].name, status: rows[0].status },
        to: { name, status },
      }),
    ]);
    return { ok: true, id: serviceId };
  } catch (err) {
    console.error("updateService failed:", err);
    return { ok: false, error: "Could not update the service." };
  }
}

export async function doSetServiceStatus(
  serviceId: string,
  status: ServiceStatus,
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  if (!SERVICE_STATUSES.includes(status as never)) {
    return { ok: false, error: "Invalid service status." };
  }
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };
    if (!admin.canMutate) return { ok: false, error: "FORBIDDEN_READ_ONLY" };

    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select id, name, status from services where id = ${serviceId}`,
    ]))[1] as { id: string; name: string; status: string }[];
    if (!rows[0]) return { ok: false, error: "Service not found." };
    const from = rows[0].status;

    await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`update services set status = ${status}, updated_at = now()
         where id = ${serviceId}`,
      auditQuery(tx, admin.user.id, "admin.service.status_change", {
        serviceId,
        serviceName: rows[0].name,
        from,
        to: status,
      }),
    ]);
    return { ok: true, id: serviceId };
  } catch (err) {
    console.error("setServiceStatus failed:", err);
    return { ok: false, error: "Could not update the service status." };
  }
}

export async function doMergeServices(
  keepId: string,
  mergeIds: string[],
): Promise<ServiceDetailResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const ids = [...new Set((mergeIds ?? []).filter((id) => id && id !== keepId))];
  if (ids.length === 0) {
    return { ok: false, error: "Choose at least one service to merge." };
  }
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };
    if (!admin.canMutate) return { ok: false, error: "FORBIDDEN_READ_ONLY" };

    // Validate the target exists and the merge set is real services.
    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select id, name from services where id = ${keepId}`,
      tx`select id, name from services where id = any(${ids})`,
    ])) as unknown[];
    if (!(rows[1] as { id: string }[])[0]) return { ok: false, error: "Service not found." };
    const found = (rows[2] as { id: string; name: string }[]).map((r) => r.name);
    const missing = ids.filter((id) => !(rows[2] as { id: string }[]).some((r) => r.id === id));
    if (missing.length > 0) {
      return { ok: false, error: "One or more services to merge were not found." };
    }

    // Reassign relationships to the surviving service (unique conflicts keep the
    // existing row), then archive the merged-out services.
    await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`update company_services
         set service_id = ${keepId}
         where service_id = any(${ids})
           and not exists (
             select 1 from company_services cs2
             where cs2.company_id = company_services.company_id
               and cs2.service_id = ${keepId}
           )`,
      tx`update services set status = 'Archived', updated_at = now()
         where id = any(${ids})`,
      auditQuery(tx, admin.user.id, "admin.service.merge", {
        keepId,
        merged: ids,
        mergedNames: found,
      }),
    ]);
    return await doGetServiceDetail(keepId);
  } catch (err) {
    console.error("mergeServices failed:", err);
    return { ok: false, error: "Could not merge the services." };
  }
}

// ------------------------------------------------------- company services
export async function doListCompanyServices(
  companyId: string,
): Promise<CompanyServicesResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };

    const rows = await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select cs.id, cs.company_id, cs.service_id, cs.source, cs.confidence,
                cs.verification_status, cs.evidence_summary, cs.discovered_at,
                cs.active_with_scalebridge, cs.upsell_recommended,
                cs.admin_decision, cs.notes, cs.reviewed_by, cs.reviewed_at,
                cs.created_at,
                s.id as s_id, s.name as s_name, s.slug as s_slug,
                s.category_id as s_category_id, sc.name as s_category_name,
                s.status as s_status, s.description as s_description,
                s.industry as s_industry
         from company_services cs
         join services s on s.id = cs.service_id
         join service_categories sc on sc.id = s.category_id
         where cs.company_id = ${companyId}
         order by s.name asc`,
      tx`select se.id, se.company_service_id, se.evidence_type, se.title,
                se.source_url, se.excerpt, se.captured_at, se.agent_version,
                se.created_at
         from service_evidence se
         where se.company_service_id in (
           select cs2.id from company_services cs2 where cs2.company_id = ${companyId}
         )
         order by se.created_at desc`,
    ]);
    const relRows = rows[1] as unknown[];
    const evRows = rows[2] as {
      id: string;
      company_service_id: string;
      evidence_type: string | null;
      title: string | null;
      source_url: string | null;
      excerpt: string | null;
      captured_at: string | null;
      agent_version: string | null;
      created_at: string;
    }[];

    const evidenceByRel = new Map<string, ServiceEvidenceRow[]>();
    for (const e of evRows) {
      const list = evidenceByRel.get(e.company_service_id) ?? [];
      list.push({
        id: e.id,
        companyServiceId: e.company_service_id,
        evidenceType: e.evidence_type,
        title: e.title,
        sourceUrl: e.source_url,
        excerpt: e.excerpt,
        capturedAt: e.captured_at ? String(e.captured_at) : null,
        agentVersion: e.agent_version,
        createdAt: String(e.created_at),
      });
      evidenceByRel.set(e.company_service_id, list);
    }

    const relationships: CompanyServiceRow[] = (relRows as {
      id: string;
      company_id: string;
      service_id: string;
      source: ServiceSource;
      confidence: ServiceConfidence;
      verification_status: CompanyServiceVerification;
      evidence_summary: string | null;
      discovered_at: string | null;
      active_with_scalebridge: boolean;
      upsell_recommended: boolean;
      admin_decision: AdminDecision | null;
      notes: string | null;
      reviewed_by: string | null;
      reviewed_at: string | null;
      created_at: string;
      s_id: string;
      s_name: string;
      s_slug: string;
      s_category_id: string;
      s_category_name: string;
      s_status: ServiceStatus;
      s_description: string | null;
      s_industry: string | null;
    }[]).map((r) => ({
      id: r.id,
      companyId: r.company_id,
      serviceId: r.service_id,
      source: r.source,
      confidence: r.confidence,
      verificationStatus: r.verification_status,
      evidenceSummary: r.evidence_summary,
      discoveredAt: r.discovered_at ? String(r.discovered_at) : null,
      activeWithScalebridge: r.active_with_scalebridge,
      upsellRecommended: r.upsell_recommended,
      adminDecision: r.admin_decision,
      notes: r.notes,
      reviewedBy: r.reviewed_by,
      reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
      createdAt: String(r.created_at),
      service: {
        id: r.s_id,
        name: r.s_name,
        slug: r.s_slug,
        categoryId: r.s_category_id,
        categoryName: r.s_category_name,
        status: r.s_status,
        description: r.s_description,
        industry: r.s_industry,
      },
      evidence: evidenceByRel.get(r.id) ?? [],
    }));
    return { ok: true, relationships, total: relationships.length };
  } catch (err) {
    console.error("listCompanyServices failed:", err);
    return { ok: false, error: "Could not load the company's services." };
  }
}

export type CompanyServiceInput = {
  companyId: string;
  serviceId: string;
  source: ServiceSource;
  confidence?: ServiceConfidence;
  verificationStatus?: CompanyServiceVerification;
  evidenceSummary?: string | null;
  discoveredAt?: Date | null;
  activeWithScalebridge?: boolean;
  upsellRecommended?: boolean;
  adminDecision?: AdminDecision | null;
  notes?: string | null;
};

export async function doCreateOrUpdateCompanyService(
  input: CompanyServiceInput,
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const companyId = (input.companyId ?? "").trim();
  const serviceId = (input.serviceId ?? "").trim();
  const source = input.source && SERVICE_SOURCES.includes(input.source) ? input.source : "";
  const confidence = input.confidence && SERVICE_CONFIDENCES.includes(input.confidence)
    ? input.confidence
    : "Medium";
  const verificationStatus =
    input.verificationStatus && COMPANY_SERVICE_VERIFICATIONS.includes(input.verificationStatus)
      ? input.verificationStatus
      : "Pending";
  const adminDecision = input.adminDecision && ADMIN_DECISIONS.includes(input.adminDecision)
    ? input.adminDecision
    : null;
  if (!companyId || !serviceId || !source) {
    return { ok: false, error: "Company, service and source are required." };
  }
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };
    if (!admin.canMutate) return { ok: false, error: "FORBIDDEN_READ_ONLY" };

    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select id from companies where id = ${companyId}`,
      tx`select id from services where id = ${serviceId}`,
    ])) as unknown[];
    if (!(rows[1] as { id: string }[])[0]) return { ok: false, error: "Company not found." };
    if (!(rows[2] as { id: string }[])[0]) return { ok: false, error: "Service not found." };

    const inserted = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`insert into company_services (
            company_id, service_id, source, confidence, verification_status,
            evidence_summary, discovered_at, active_with_scalebridge,
            upsell_recommended, admin_decision, notes)
         values (${companyId}, ${serviceId}, ${source}, ${confidence},
                 ${verificationStatus},
                 ${input.evidenceSummary?.trim().slice(0, 2000) ?? null},
                 ${input.discoveredAt ?? null},
                 ${input.activeWithScalebridge ?? false},
                 ${input.upsellRecommended ?? false},
                 ${adminDecision},
                 ${input.notes?.trim().slice(0, 2000) ?? null})
         on conflict (company_id, service_id) do update set
           source = excluded.source,
           confidence = excluded.confidence,
           verification_status = excluded.verification_status,
           evidence_summary = excluded.evidence_summary,
           discovered_at = excluded.discovered_at,
           active_with_scalebridge = excluded.active_with_scalebridge,
           upsell_recommended = excluded.upsell_recommended,
           admin_decision = excluded.admin_decision,
           notes = excluded.notes
         returning id`,
      auditQuery(tx, admin.user.id, "admin.company_service.upsert", {
        companyId,
        serviceId,
        source,
        confidence,
        verificationStatus,
        adminDecision,
      }),
    ])) as unknown[];
    return { ok: true, id: (inserted[1] as { id: string }[])[0]?.id };
  } catch (err) {
    console.error("createOrUpdateCompanyService failed:", err);
    return { ok: false, error: "Could not save the company service relationship." };
  }
}

export type ServiceEvidenceInput = {
  evidenceType?: string | null;
  title?: string | null;
  sourceUrl?: string | null;
  excerpt?: string | null;
  agentVersion?: string | null;
  capturedAt?: Date | null;
};

export async function doAddServiceEvidence(
  companyServiceId: string,
  input: ServiceEvidenceInput,
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const companyServiceIdClean = (companyServiceId ?? "").trim();
  if (!companyServiceIdClean) return { ok: false, error: "Relationship is required." };
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };
    if (!admin.canMutate) return { ok: false, error: "FORBIDDEN_READ_ONLY" };

    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select id from company_services where id = ${companyServiceIdClean}`,
    ]))[1] as { id: string }[];
    if (!rows[0]) return { ok: false, error: "Company service relationship not found." };

    const inserted = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`insert into service_evidence (
            company_service_id, evidence_type, title, source_url, excerpt,
            captured_at, agent_version)
         values (${companyServiceIdClean},
                 ${input.evidenceType?.trim().slice(0, 100) ?? null},
                 ${input.title?.trim().slice(0, 300) ?? null},
                 ${input.sourceUrl?.trim().slice(0, 1000) ?? null},
                 ${input.excerpt?.trim().slice(0, 3000) ?? null},
                 ${input.capturedAt ?? null},
                 ${input.agentVersion?.trim().slice(0, 50) ?? null})
         returning id`,
      auditQuery(tx, admin.user.id, "admin.company_service.evidence", {
        companyServiceId: companyServiceIdClean,
        evidenceType: input.evidenceType ?? null,
        title: input.title ?? null,
        agentVersion: input.agentVersion ?? null,
      }),
    ])) as unknown[];
    return { ok: true, id: (inserted[1] as { id: string }[])[0]?.id };
  } catch (err) {
    console.error("addServiceEvidence failed:", err);
    return { ok: false, error: "Could not add the evidence row." };
  }
}

export async function doSetCompanyServiceDecision(
  companyServiceId: string,
  input: {
    adminDecision: AdminDecision;
    reviewedBy?: string | null;
    notes?: string | null;
  },
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  if (!ADMIN_DECISIONS.includes(input.adminDecision as never)) {
    return { ok: false, error: "Invalid admin decision." };
  }
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };
    if (!admin.canMutate) return { ok: false, error: "FORBIDDEN_READ_ONLY" };

    const reviewedBy = input.reviewedBy ?? admin.user.id;
    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select id, company_id, service_id, admin_decision
         from company_services where id = ${companyServiceId}`,
    ]))[1] as { id: string; company_id: string; service_id: string; admin_decision: string | null }[];
    if (!rows[0]) return { ok: false, error: "Company service relationship not found." };
    const from = rows[0].admin_decision;

    await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`update company_services
         set admin_decision = ${input.adminDecision},
             reviewed_by = ${reviewedBy},
             reviewed_at = now(),
             notes = ${input.notes?.trim().slice(0, 2000) ?? null}
         where id = ${companyServiceId}`,
      auditQuery(tx, admin.user.id, "admin.company_service.decision", {
        companyServiceId,
        companyId: rows[0].company_id,
        serviceId: rows[0].service_id,
        from,
        to: input.adminDecision,
        reviewedBy,
      }),
    ]);
    return { ok: true, id: companyServiceId };
  } catch (err) {
    console.error("setCompanyServiceDecision failed:", err);
    return { ok: false, error: "Could not record the admin decision." };
  }
}

// -------------------------------------------------- catalogue opportunities
/** Cross-company opportunity/decision rows for the Master Admin Opportunity
 *  surfaces. scope 'open' = AI-discovery + upsell rows still awaiting an admin
 *  decision (the dashboard's opportunitiesOpen); 'ai' = all AI-discovery rows;
 *  'upsell' = all upsell-recommended rows. */
export type CatalogueOpportunityRow = {
  id: string;
  companyId: string;
  companyName: string;
  companyType: string | null;
  serviceId: string;
  serviceName: string;
  serviceCategory: string;
  source: ServiceSource;
  confidence: ServiceConfidence;
  verificationStatus: CompanyServiceVerification;
  evidenceSummary: string | null;
  discoveredAt: string | null;
  activeWithScalebridge: boolean;
  upsellRecommended: boolean;
  adminDecision: AdminDecision | null;
  notes: string | null;
  createdAt: string;
  evidenceCount: number;
  evidence: ServiceEvidenceRow[];
};

export type CatalogueOpportunitiesResult =
  | { ok: true; opportunities: CatalogueOpportunityRow[]; total: number }
  | { ok: false; error: string; setupRequired?: boolean };

export async function doListCatalogueOpportunities(input: {
  scope: "open" | "ai" | "upsell";
}): Promise<CatalogueOpportunitiesResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const scope = input.scope === "ai" || input.scope === "upsell" ? input.scope : "open";
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };

    // Scope conditions are written literally per branch — postgres.js
    // parameterises interpolated strings, so a SELECT list or WHERE fragment
    // cannot come from a JS const.
    const shapeRel = (r: unknown) => r as {
      id: string;
      company_id: string;
      company_name: string;
      company_type: string | null;
      service_id: string;
      service_name: string;
      service_category: string;
      source: ServiceSource;
      confidence: ServiceConfidence;
      verification_status: CompanyServiceVerification;
      evidence_summary: string | null;
      discovered_at: string | null;
      active_with_scalebridge: boolean;
      upsell_recommended: boolean;
      admin_decision: AdminDecision | null;
      notes: string | null;
      created_at: string;
      evidence_count: number;
    }[];
    const shapeEv = (r: unknown) => r as {
      id: string;
      company_service_id: string;
      evidence_type: string | null;
      title: string | null;
      source_url: string | null;
      excerpt: string | null;
      captured_at: string | null;
      agent_version: string | null;
      created_at: string;
    }[];

    const run = (build: (tx: Tx) => TxQuery[]) =>
      asUser(admin.user.id, admin.user.role, (tx) => build(tx));

    let rows: unknown[];
    if (scope === "ai") {
      rows = await run((tx) => [
        tx`select cs.id, cs.company_id, c.name as company_name, c.type as company_type,
                  cs.service_id, s.name as service_name, sc.name as service_category,
                  cs.source, cs.confidence, cs.verification_status,
                  cs.evidence_summary, cs.discovered_at,
                  cs.active_with_scalebridge, cs.upsell_recommended,
                  cs.admin_decision, cs.notes, cs.created_at,
                  (select count(*)::int from service_evidence se
                    where se.company_service_id = cs.id) as evidence_count
         from company_services cs
         join companies c on c.id = cs.company_id
         join services s on s.id = cs.service_id
         join service_categories sc on sc.id = s.category_id
         where cs.source = 'AI discovery'
         order by cs.created_at desc`,
        tx`select se.id, se.company_service_id, se.evidence_type, se.title,
                  se.source_url, se.excerpt, se.captured_at, se.agent_version,
                  se.created_at
         from service_evidence se
         where se.company_service_id in (
           select cs2.id from company_services cs2 where cs2.source = 'AI discovery'
         )
         order by se.created_at desc`,
      ]);
    } else if (scope === "upsell") {
      rows = await run((tx) => [
        tx`select cs.id, cs.company_id, c.name as company_name, c.type as company_type,
                  cs.service_id, s.name as service_name, sc.name as service_category,
                  cs.source, cs.confidence, cs.verification_status,
                  cs.evidence_summary, cs.discovered_at,
                  cs.active_with_scalebridge, cs.upsell_recommended,
                  cs.admin_decision, cs.notes, cs.created_at,
                  (select count(*)::int from service_evidence se
                    where se.company_service_id = cs.id) as evidence_count
         from company_services cs
         join companies c on c.id = cs.company_id
         join services s on s.id = cs.service_id
         join service_categories sc on sc.id = s.category_id
         where cs.upsell_recommended = true
         order by cs.created_at desc`,
        tx`select se.id, se.company_service_id, se.evidence_type, se.title,
                  se.source_url, se.excerpt, se.captured_at, se.agent_version,
                  se.created_at
         from service_evidence se
         where se.company_service_id in (
           select cs2.id from company_services cs2 where cs2.upsell_recommended = true
         )
         order by se.created_at desc`,
      ]);
    } else {
      rows = await run((tx) => [
        tx`select cs.id, cs.company_id, c.name as company_name, c.type as company_type,
                  cs.service_id, s.name as service_name, sc.name as service_category,
                  cs.source, cs.confidence, cs.verification_status,
                  cs.evidence_summary, cs.discovered_at,
                  cs.active_with_scalebridge, cs.upsell_recommended,
                  cs.admin_decision, cs.notes, cs.created_at,
                  (select count(*)::int from service_evidence se
                    where se.company_service_id = cs.id) as evidence_count
         from company_services cs
         join companies c on c.id = cs.company_id
         join services s on s.id = cs.service_id
         join service_categories sc on sc.id = s.category_id
         where (cs.source = 'AI discovery' or cs.upsell_recommended = true)
           and cs.admin_decision is null
         order by cs.created_at desc`,
        tx`select se.id, se.company_service_id, se.evidence_type, se.title,
                  se.source_url, se.excerpt, se.captured_at, se.agent_version,
                  se.created_at
         from service_evidence se
         where se.company_service_id in (
           select cs2.id from company_services cs2
           where (cs2.source = 'AI discovery' or cs2.upsell_recommended = true)
             and cs2.admin_decision is null
         )
         order by se.created_at desc`,
      ]);
    }

    const relRows = shapeRel(rows[1]);
    const evRows = shapeEv(rows[2]);

    const evidenceByRel = new Map<string, ServiceEvidenceRow[]>();
    for (const e of evRows) {
      const list = evidenceByRel.get(e.company_service_id) ?? [];
      list.push({
        id: e.id,
        companyServiceId: e.company_service_id,
        evidenceType: e.evidence_type,
        title: e.title,
        sourceUrl: e.source_url,
        excerpt: e.excerpt,
        capturedAt: e.captured_at ? String(e.captured_at) : null,
        agentVersion: e.agent_version,
        createdAt: String(e.created_at),
      });
      evidenceByRel.set(e.company_service_id, list);
    }

    const opportunities: CatalogueOpportunityRow[] = relRows.map((r) => ({
      id: r.id,
      companyId: r.company_id,
      companyName: r.company_name,
      companyType: r.company_type,
      serviceId: r.service_id,
      serviceName: r.service_name,
      serviceCategory: r.service_category,
      source: r.source,
      confidence: r.confidence,
      verificationStatus: r.verification_status,
      evidenceSummary: r.evidence_summary,
      discoveredAt: r.discovered_at ? String(r.discovered_at) : null,
      activeWithScalebridge: r.active_with_scalebridge,
      upsellRecommended: r.upsell_recommended,
      adminDecision: r.admin_decision,
      notes: r.notes,
      createdAt: String(r.created_at),
      evidenceCount: Number(r.evidence_count ?? 0),
      evidence: evidenceByRel.get(r.id) ?? [],
    }));
    return { ok: true, opportunities, total: opportunities.length };
  } catch (err) {
    console.error("listCatalogueOpportunities failed:", err);
    return { ok: false, error: "Could not load catalogue opportunities." };
  }
}

// ------------------------------------------------- service evidence (service-scoped)
export type ServiceEvidenceListResult =
  | {
      ok: true;
      evidence: {
        id: string;
        companyServiceId: string;
        companyId: string;
        companyName: string;
        evidenceType: string | null;
        title: string | null;
        sourceUrl: string | null;
        excerpt: string | null;
        capturedAt: string | null;
        agentVersion: string | null;
        createdAt: string;
      }[];
      total: number;
    }
  | { ok: false; error: string; setupRequired?: boolean };

/** Evidence rows across every company relationship of one service. */
export async function doListServiceEvidence(serviceId: string): Promise<ServiceEvidenceListResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };

    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select se.id, se.company_service_id, se.evidence_type, se.title,
                se.source_url, se.excerpt, se.captured_at, se.agent_version,
                se.created_at, cs.company_id, c.name as company_name
         from service_evidence se
         join company_services cs on cs.id = se.company_service_id
         join companies c on c.id = cs.company_id
         where cs.service_id = ${serviceId}
         order by se.created_at desc`,
    ]))[1] as {
      id: string;
      company_service_id: string;
      evidence_type: string | null;
      title: string | null;
      source_url: string | null;
      excerpt: string | null;
      captured_at: string | null;
      agent_version: string | null;
      created_at: string;
      company_id: string;
      company_name: string;
    }[];
    const evidence = rows.map((r) => ({
      id: r.id,
      companyServiceId: r.company_service_id,
      companyId: r.company_id,
      companyName: r.company_name,
      evidenceType: r.evidence_type,
      title: r.title,
      sourceUrl: r.source_url,
      excerpt: r.excerpt,
      capturedAt: r.captured_at ? String(r.captured_at) : null,
      agentVersion: r.agent_version,
      createdAt: String(r.created_at),
    }));
    return { ok: true, evidence, total: evidence.length };
  } catch (err) {
    console.error("listServiceEvidence failed:", err);
    return { ok: false, error: "Could not load evidence for the service." };
  }
}

// -------------------------------------------------------------- categories
export type ServiceCategoryInput = {
  name: string;
  description?: string | null;
  sortOrder?: number;
};

export async function doCreateServiceCategory(input: ServiceCategoryInput): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const name = (input.name ?? "").trim().slice(0, 100);
  if (!name) return { ok: false, error: "Category name is required." };
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };
    if (!admin.canMutate) return { ok: false, error: "FORBIDDEN_READ_ONLY" };

    const slug = slugify(name);
    const sortOrder = Number.isFinite(input.sortOrder) ? Math.trunc(Number(input.sortOrder)) : 0;
    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`insert into service_categories (name, slug, description, sort_order)
         values (${name}, ${slug},
                 ${input.description?.trim().slice(0, 500) ?? null},
                 ${sortOrder})
         returning id`,
      auditQuery(tx, admin.user.id, "admin.category.create", {
        name,
        slug,
        sortOrder,
      }),
    ])) as unknown[];
    return { ok: true, id: (rows[1] as { id: string }[])[0]?.id };
  } catch (err) {
    console.error("createServiceCategory failed:", err);
    if (isUniqueViolation(err)) {
      return { ok: false, error: "A category with this name already exists." };
    }
    return { ok: false, error: "Could not create the category." };
  }
}

export async function doUpdateServiceCategory(
  categoryId: string,
  input: ServiceCategoryInput,
): Promise<SimpleResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const name = (input.name ?? "").trim().slice(0, 100);
  if (!name) return { ok: false, error: "Category name is required." };
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };
    if (!admin.canMutate) return { ok: false, error: "FORBIDDEN_READ_ONLY" };

    const rows = (await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select id, name, slug, sort_order from service_categories where id = ${categoryId}`,
    ]))[1] as { id: string; name: string; slug: string; sort_order: number }[];
    if (!rows[0]) return { ok: false, error: "Category not found." };
    const from = rows[0];
    const slug = slugify(name);
    const sortOrder = Number.isFinite(input.sortOrder) ? Math.trunc(Number(input.sortOrder)) : from.sort_order;

    await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`update service_categories
         set name = ${name}, slug = ${slug},
             description = ${input.description?.trim().slice(0, 500) ?? null},
             sort_order = ${sortOrder}
         where id = ${categoryId}`,
      auditQuery(tx, admin.user.id, "admin.category.update", {
        categoryId,
        from: { name: from.name, sortOrder: Number(from.sort_order) },
        to: { name, sortOrder },
      }),
    ]);
    return { ok: true, id: categoryId };
  } catch (err) {
    console.error("updateServiceCategory failed:", err);
    if (isUniqueViolation(err)) {
      return { ok: false, error: "A category with this name already exists." };
    }
    return { ok: false, error: "Could not update the category." };
  }
}
