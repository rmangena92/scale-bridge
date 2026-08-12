/**
 * AI Service Intelligence — server functions (client-safe module).
 *
 * IMPORTANT (TanStack Start constraint): this module must not import
 * server-only modules at the top level — the client build replaces the
 * createServerFn handler bodies below with RPC stubs, and only imports that
 * are referenced *exclusively inside those bodies* get tree-shaken out of the
 * browser bundle. All real logic lives in ./ai-agent.ts, which is imported
 * only here and never from client components.
 *
 * RBAC: every handler resolves the session admin via loadAdminUser() (the
 * user must have an admin_roles row) and denies otherwise. Read endpoints
 * require any admin role; mutation endpoints (review / trigger / upsell
 * status / preference writes) additionally require canMutate — a read_only
 * staff member cannot approve recommendations or queue agent runs.
 */
import { createServerFn } from "@tanstack/react-start";
import { loadAdminUser } from "./auth-core";
import {
  analyzeCompany,
  createUpsellOpportunity,
  getCompanyAiPreferences,
  listAgentRuns,
  listRecommendations,
  listUpsellOpportunities,
  reviewRecommendation,
  runAnalysisQueue,
  updateCompanyAiPreferences,
  updateUpsellOpportunityStatus,
} from "./ai-agent";
import type {
  AiRecommendationRow,
  AiRunRow,
  AiRunTrigger,
  AnalysisResult,
  UpsellOpportunityInput,
  UpsellOpportunityRow,
  UpsellStatus,
} from "./ai-agent";

/** Admin-only read guard shared by every handler. Returns null when denied. */
async function guardAdmin() {
  const admin = await loadAdminUser();
  return admin;
}

export const listAgentRunsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { companyId?: string })
  .handler(async ({ data }) => {
    const admin = await guardAdmin();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" } as const;
    return listAgentRuns(admin.user.id, data.companyId || undefined);
  });

export const listRecommendationsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { companyId?: string })
  .handler(async ({ data }) => {
    const admin = await guardAdmin();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" } as const;
    return listRecommendations(admin.user.id, data.companyId || undefined);
  });

export const reviewRecommendationFn = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as { recommendationId: string; decision: "Approved" | "Rejected"; adminNotes?: string },
  )
  .handler(async ({ data }) => {
    const admin = await guardAdmin();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" } as const;
    if (!admin.canMutate) return { ok: false, error: "FORBIDDEN_READ_ONLY" } as const;
    return reviewRecommendation(
      admin.user.id,
      data.recommendationId,
      data.decision,
      data.adminNotes,
    );
  });

export const listUpsellOpportunitiesFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { companyId?: string })
  .handler(async ({ data }) => {
    const admin = await guardAdmin();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" } as const;
    return listUpsellOpportunities(admin.user.id, data.companyId || undefined);
  });

export const updateUpsellOpportunityStatusFn = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) => d as { opportunityId: string; status: UpsellStatus; adminNotes?: string },
  )
  .handler(async ({ data }) => {
    const admin = await guardAdmin();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" } as const;
    if (!admin.canMutate) return { ok: false, error: "FORBIDDEN_READ_ONLY" } as const;
    return updateUpsellOpportunityStatus(admin.user.id, data.opportunityId, data.status, data.adminNotes);
  });

export const createUpsellOpportunityFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as UpsellOpportunityInput)
  .handler(async ({ data }) => {
    const admin = await guardAdmin();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" } as const;
    if (!admin.canMutate) return { ok: false, error: "FORBIDDEN_READ_ONLY" } as const;
    return createUpsellOpportunity(admin.user.id, data);
  });

export const getCompanyAiPreferencesFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { companyId: string })
  .handler(async ({ data }) => {
    const admin = await guardAdmin();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" } as const;
    return getCompanyAiPreferences(admin.user.id, data.companyId);
  });

export const updateCompanyAiPreferencesFn = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as {
        companyId: string;
        aiDiscoveryEnabled?: boolean;
        publicSourceConsent?: boolean;
        optOut?: boolean;
      },
  )
  .handler(async ({ data }) => {
    const admin = await guardAdmin();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" } as const;
    if (!admin.canMutate) return { ok: false, error: "FORBIDDEN_READ_ONLY" } as const;
    return updateCompanyAiPreferences(admin.user.id, data.companyId, {
      aiDiscoveryEnabled: data.aiDiscoveryEnabled,
      publicSourceConsent: data.publicSourceConsent,
      optOut: data.optOut,
    });
  });

export const triggerManualAnalysisFn = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as { companyId: string; trigger?: AiRunTrigger | string; dryRun?: boolean },
  )
  .handler(async ({ data }) => {
    const admin = await guardAdmin();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" } as const;
    if (!admin.canMutate) return { ok: false, error: "FORBIDDEN_READ_ONLY" } as const;
    return analyzeCompany(admin.user.id, data.companyId, data.trigger ?? "manual", {
      dryRun: data.dryRun,
    });
  });

export const runAnalysisQueueFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { limit?: number; dryRun?: boolean })
  .handler(async ({ data }) => {
    const admin = await guardAdmin();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" } as const;
    if (!admin.canMutate) return { ok: false, error: "FORBIDDEN_READ_ONLY" } as const;
    return runAnalysisQueue(admin.user.id, { limit: data.limit, dryRun: data.dryRun });
  });

export type {
  AiRecommendationRow,
  AiRunRow,
  AiRunTrigger,
  AnalysisResult,
  UpsellOpportunityInput,
  UpsellOpportunityRow,
  UpsellStatus,
};
