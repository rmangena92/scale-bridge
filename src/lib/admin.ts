/**
 * Admin Portal server functions (client-safe module).
 *
 * IMPORTANT (TanStack Start constraint): this module must not import
 * server-only modules at the top level — the client build replaces the
 * createServerFn handler bodies below with RPC stubs, and only imports that
 * are referenced *exclusively inside those bodies* get tree-shaken out of the
 * browser bundle. All real logic lives in ./admin-core.ts, which is imported
 * only here and never from client components.
 */
import { createServerFn } from "@tanstack/react-start";
import { asUser } from "./db";
import { doGetAdminServiceInsights } from "./admin-platform-core";
import {
  doAddCaseMessage,
  doAddCompanyNote,
  doCreateCompanyNote,
  doGetFinanceSummary,
  doListDisputes,
  doUpdateCompanyNote,
  doAddContractNote,
  doAddUserNote,
  doAssignContractSupport,
  doCloseSupportCase,
  doCreateSupportCase,
  doGetAdminContract,
  doGetAdminDashboard,
  doGetAdminSession,
  doGetCompanyDetail,
  doGetDocumentDetail,
  doGetSupportCase,
  doGetUserDetail,
  doGetVerificationCompany,
  doListAdminContracts,
  doListAdminStaff,
  doListAuditLogs,
  doListCompanies,
  doListPendingDocuments,
  doListSupportCases,
  doListUsers,
  doListVerificationQueue,
  doReviewDocument,
  doSetAdminRoles,
  doSetCompanyStatus,
  doSetContractStatus,
  doSetExpiryReminder,
  doSetUserStatus,
  doSetUserSystemRole,
  doUpdateSupportCase,
} from "./admin-core";
import {
  doAddServiceEvidence,
  doCreateOrUpdateCompanyService,
  doCreateService,
  doCreateServiceCategory,
  doGetServiceDetail,
  doListCatalogueOpportunities,
  doListCompanyServices,
  doListServiceCategories,
  doListServiceEvidence,
  doListServices,
  doMergeServices,
  doSetCompanyServiceDecision,
  doSetServiceStatus,
  doUpdateService,
  doUpdateServiceCategory,
} from "./services";
import {
  doGetAdminCompanySubscription,
  doListAdminSubscriptions,
  doListClientPortals,
  doListPartnershipWorkspaces,
} from "./admin-subscriptions-core";
import {
  doAdminGrantEntitlement,
  doAdminListCompanyEntitlements,
  doAdminRevokeEntitlement,
} from "./admin-entitlements-actions";
import type { EntitlementGrantType } from "./admin-entitlements-actions";
import { doGetAdminReports } from "./admin-reports-core";
export type { AdminReportsData, AdminReportsResult } from "./admin-reports-core";
import type {
  AdminRole,
  DocumentReviewAction,
  Role,
  SupportCasePriority,
  SupportCaseStatus,
  UserStatus,
} from "./types";
import type {
  AdminDecision,
  CompanyServiceInput,
  ServiceEvidenceInput,
  ServiceInput,
  ServiceStatus,
} from "./services";

export type {
  AdminContractDetailResult,
  AdminContractsResult,
  DisputesResult,
  FinanceSummaryResult,
  AdminSessionResult,
  AuditLogResult,
  CompaniesResult,
  CompanyDetailResult,
  DashboardResult,
  DocumentDetailResult,
  PendingDocumentsResult,
  SimpleResult,
  StaffListResult,
  SupportCaseDetailResult,
  SupportCasesResult,
  UserDetailResult,
  UsersResult,
  VerificationCompanyResult,
  VerificationQueueResult,
} from "./admin-core";
export type {
  CompanyServicesResult,
  CatalogueOpportunitiesResult,
  ServiceCategoriesResult,
  ServiceDetailResult,
  ServiceEvidenceListResult,
  ServicesResult,
} from "./services";
export type {
  AdminClientPortalRow,
  AdminClientPortalsResult,
  AdminCompanySubscriptionDetail,
  AdminCompanySubscriptionResult,
  AdminEntitlementView,
  AdminPartnershipWorkspaceRow,
  AdminPartnershipWorkspacesResult,
  AdminSubscriptionListResult,
  AdminSubscriptionRow,
} from "./admin-subscriptions-core";
export type {
  AdminBillingActionResult,
  AdminBillingPanel,
  DowngradePreview,
  UpgradePreview,
} from "./admin-subscriptions-actions";
export type {
  CompanyEntitlementsResult,
  CompanyEntitlementRow,
  EntitlementGrantType,
  EntitlementStatusMark,
} from "./admin-entitlements-actions";

export const getAdminSession = createServerFn({ method: "GET" }).handler(() =>
  doGetAdminSession(),
);

export const getAdminDashboard = createServerFn({ method: "GET" }).handler(() =>
  doGetAdminDashboard(),
);

export const listAdminUsers = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { query: string; status: string; role: string })
  .handler(({ data }) => doListUsers(data));

export const getAdminUserDetail = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { userId: string })
  .handler(({ data }) => doGetUserDetail(data.userId));

export const setAdminUserStatus = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { userId: string; status: UserStatus })
  .handler(({ data }) => doSetUserStatus(data.userId, data.status));

export const addAdminUserNote = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { userId: string; note: string })
  .handler(({ data }) => doAddUserNote(data.userId, data.note));

export const setAdminUserSystemRole = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { userId: string; role: Role })
  .handler(({ data }) => doSetUserSystemRole(data.userId, data.role));

export const setAdminRoles = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { userId: string; roles: AdminRole[] })
  .handler(({ data }) => doSetAdminRoles(data.userId, data.roles));

export const listAdminCompanies = createServerFn({ method: "GET" })
  .validator(
    (d: unknown) =>
      d as {
        query: string;
        status: string;
        industry: string;
        activeStatus: string;
        participation: string;
        membershipPlan: string;
        subscriptionStatus: string;
      },
  )
  .handler(({ data }) => doListCompanies(data));

export const getAdminCompanyDetail = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { companyId: string })
  .handler(({ data }) => doGetCompanyDetail(data.companyId));

export const setAdminCompanyStatus = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as { companyId: string; action: "verify" | "reject" | "suspend" | "restore" },
  )
  .handler(({ data }) => doSetCompanyStatus(data.companyId, data.action));

export const addAdminCompanyNote = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { companyId: string; note: string })
  .handler(({ data }) => doAddCompanyNote(data.companyId, data.note));

export const createAdminCompanyNote = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { companyId: string; body: string })
  .handler(({ data }) => doCreateCompanyNote(data.companyId, data.body));

export const updateAdminCompanyNote = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { noteId: string; body: string })
  .handler(({ data }) => doUpdateCompanyNote(data.noteId, data.body));

export const getFinanceSummary = createServerFn({ method: "GET" }).handler(() =>
  doGetFinanceSummary(),
);
export const getAdminReports = createServerFn({ method: "GET" }).handler(() =>
  doGetAdminReports(),
);

export const listDisputes = createServerFn({ method: "GET" }).handler(() =>
  doListDisputes(),
);

// ---------------------------------------------------------------- Part B fns
export const listVerificationQueue = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { status: string })
  .handler(({ data }) => doListVerificationQueue(data));

export const getVerificationCompany = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { companyId: string })
  .handler(({ data }) => doGetVerificationCompany(data.companyId));

export const reviewDocument = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as { documentId: string; action: DocumentReviewAction; comment: string },
  )
  .handler(({ data }) => doReviewDocument(data.documentId, data.action, data.comment));

export const setDocumentExpiryReminder = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { documentId: string })
  .handler(({ data }) => doSetExpiryReminder(data.documentId));

export const listAdminContracts = createServerFn({ method: "GET" })
  .validator(
    (d: unknown) =>
      d as {
        status: string;
        industry: string;
        location: string;
        minValue: string;
        maxValue: string;
        lead: string;
        client: string;
      },
  )
  .handler(({ data }) => doListAdminContracts(data));

export const getAdminContract = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { workspaceId: string })
  .handler(({ data }) => doGetAdminContract(data.workspaceId));

export const setAdminContractStatus = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as { workspaceId: string; action: "suspend" | "archive" | "activate" | "complete" },
  )
  .handler(({ data }) => doSetContractStatus(data.workspaceId, data.action));

export const assignAdminContractSupport = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { workspaceId: string; staffUserId: string | null })
  .handler(({ data }) => doAssignContractSupport(data.workspaceId, data.staffUserId));

export const addAdminContractNote = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { workspaceId: string; note: string })
  .handler(({ data }) => doAddContractNote(data.workspaceId, data.note));

export const listPendingDocuments = createServerFn({ method: "GET" }).handler(() =>
  doListPendingDocuments(),
);

export const getDocumentDetail = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { documentId: string })
  .handler(({ data }) => doGetDocumentDetail(data.documentId));

export const listSupportCases = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { status: string; priority: string })
  .handler(({ data }) => doListSupportCases(data));

export const getSupportCase = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { caseId: string })
  .handler(({ data }) => doGetSupportCase(data.caseId));

export const createSupportCase = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as {
        reporterUserId: string;
        companyId?: string;
        workspaceId?: string;
        category: string;
        description: string;
        priority: SupportCasePriority;
      },
  )
  .handler(({ data }) => doCreateSupportCase(data));

export const updateSupportCase = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as {
        caseId: string;
        status?: SupportCaseStatus;
        priority?: SupportCasePriority;
        assigneeUserId?: string | null;
      },
  )
  .handler(({ data }) => doUpdateSupportCase(data.caseId, data));

export const addSupportCaseMessage = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { caseId: string; body: string; internal: boolean })
  .handler(({ data }) => doAddCaseMessage(data.caseId, data.body, data.internal));

export const closeSupportCase = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { caseId: string; resolution: string })
  .handler(({ data }) => doCloseSupportCase(data.caseId, data.resolution));

export const listAuditLog = createServerFn({ method: "GET" })
  .validator(
    (d: unknown) =>
      d as {
        actor: string;
        action: string;
        workspace: string;
        from: string;
        to: string;
        page: number;
        pageSize: number;
      },
  )
  .handler(({ data }) => doListAuditLogs(data));

export const listAdminStaff = createServerFn({ method: "GET" }).handler(() =>
  doListAdminStaff(),
);

// ---------------------------------------------------- catalogue fns (plan item 2)
export const listServiceCategories = createServerFn({ method: "GET" }).handler(() =>
  doListServiceCategories(),
);

export const listServices = createServerFn({ method: "GET" })
  .validator(
    (d: unknown) =>
      d as { status?: string; categoryId?: string; industry?: string; search?: string },
  )
  .handler(({ data }) => doListServices(data));

export const getServiceDetail = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { serviceId: string })
  .handler(({ data }) => doGetServiceDetail(data.serviceId));

export const createService = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as ServiceInput)
  .handler(({ data }) => doCreateService(data));

export const updateService = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { serviceId: string; input: ServiceInput })
  .handler(({ data }) => doUpdateService(data.serviceId, data.input));

export const setServiceStatus = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { serviceId: string; status: ServiceStatus })
  .handler(({ data }) => doSetServiceStatus(data.serviceId, data.status));

export const mergeServices = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { keepId: string; mergeIds: string[] })
  .handler(({ data }) => doMergeServices(data.keepId, data.mergeIds));

export const listCompanyServices = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { companyId: string })
  .handler(({ data }) => doListCompanyServices(data.companyId));

export const createOrUpdateCompanyService = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as CompanyServiceInput)
  .handler(({ data }) => doCreateOrUpdateCompanyService(data));

export const addServiceEvidence = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) => d as { companyServiceId: string; input: ServiceEvidenceInput },
  )
  .handler(({ data }) => doAddServiceEvidence(data.companyServiceId, data.input));

export const setCompanyServiceDecision = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as {
        companyServiceId: string;
        adminDecision: AdminDecision;
        reviewedBy?: string | null;
        notes?: string | null;
      },
  )
  .handler(({ data }) =>
    doSetCompanyServiceDecision(data.companyServiceId, {
      adminDecision: data.adminDecision,
      reviewedBy: data.reviewedBy,
      notes: data.notes,
    }),
  );

export const listCatalogueOpportunities = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { scope: "open" | "ai" | "upsell" })
  .handler(({ data }) => doListCatalogueOpportunities(data));

export const getServiceEvidence = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { serviceId: string })
  .handler(({ data }) => doListServiceEvidence(data.serviceId));

export const createServiceCategory = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as { name: string; description?: string | null; sortOrder?: number },
  )
  .handler(({ data }) => doCreateServiceCategory(data));

export const updateServiceCategory = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as {
        categoryId: string;
        name: string;
        description?: string | null;
        sortOrder?: number;
      },
  )
  .handler(({ data }) =>
    doUpdateServiceCategory(data.categoryId, {
      name: data.name,
      description: data.description,
      sortOrder: data.sortOrder,
    }),
  );

// ------------------------------------------------ subscriptions (Stage 1 MAP)
export const listAdminSubscriptions = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { status: string; planId: string })
  .handler(({ data }) => doListAdminSubscriptions(data));

export const getAdminCompanySubscription = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { companyId: string })
  .handler(({ data }) => doGetAdminCompanySubscription(data.companyId));

export const getAdminServiceInsights = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as Record<string, never> | undefined)
  .handler(async () => {
    const session = await getAdminSession();
    if (session.setupRequired || !session.admin) {
      return { ok: false as const, error: "Admin session required." };
    }
    try {
      const out = await asUser(session.admin.user.id, "sb_admin", (tx) => [
        doGetAdminServiceInsights(tx) as unknown as Promise<readonly unknown[]>,
      ]);
      const insights = out[1] as import("./admin-platform-core").AdminServiceInsights;
      return { ok: true as const, insights };
    } catch (e) {
      return { ok: false as const, error: String(e) };
    }
  });

export const listPartnershipWorkspaces = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { status: string })
  .handler(({ data }) => doListPartnershipWorkspaces(data));

export const listClientPortals = createServerFn({ method: "GET" }).handler(() =>
  doListClientPortals(),
);

// ------------------------------------------------------------- Stage 3 part 1
// Subscription management panel + manual workflows (spec sections 5, 6, 10, 11).
import {
  doAdminCancelSubscription,
  doAdminCommitmentOverride,
  doAdminDowngradePreview,
  doAdminExecuteUpgrade,
  doAdminGetBillingPanel,
  doAdminImmediateDowngrade,
  doAdminScheduleDowngrade,
  doAdminUpgradePreview,
} from "./admin-subscriptions-actions";
import type { AdminActor } from "./admin-subscriptions-actions";

async function resolveAdminActor(session: Awaited<ReturnType<typeof doGetAdminSession>>): Promise<AdminActor | null> {
  if (session.setupRequired || !session.admin) return null;
  return {
    id: session.admin.user.id,
    role: session.admin.user.role,
    staffRoles: (session.admin as { staffRoles?: string[] }).staffRoles ?? [],
  };
}

export const adminGetBillingPanel = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { companyId: string })
  .handler(async ({ data }) => {
    const session = await getAdminSession();
    const actor = await resolveAdminActor(session);
    if (!actor) return { ok: false as const, error: "Admin session required." };
    return doAdminGetBillingPanel(actor, data.companyId);
  });

export const adminUpgradePreview = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { companyId: string; newPlanId: string })
  .handler(async ({ data }) => {
    const session = await getAdminSession();
    const actor = await resolveAdminActor(session);
    if (!actor) return { ok: false as const, error: "Admin session required." };
    return doAdminUpgradePreview(actor, data.companyId, data.newPlanId);
  });

export const adminExecuteUpgrade = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { companyId: string; newPlanId: string; internalReason: string })
  .handler(async ({ data }) => {
    const session = await getAdminSession();
    const actor = await resolveAdminActor(session);
    if (!actor) return { ok: false as const, error: "Admin session required." };
    return doAdminExecuteUpgrade(actor, data.companyId, data.newPlanId, data.internalReason);
  });

export const adminDowngradePreview = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { companyId: string; newPlanId: string })
  .handler(async ({ data }) => {
    const session = await getAdminSession();
    const actor = await resolveAdminActor(session);
    if (!actor) return { ok: false as const, error: "Admin session required." };
    return doAdminDowngradePreview(actor, data.companyId, data.newPlanId);
  });

export const adminScheduleDowngrade = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { companyId: string; newPlanId: string; internalReason: string })
  .handler(async ({ data }) => {
    const session = await getAdminSession();
    const actor = await resolveAdminActor(session);
    if (!actor) return { ok: false as const, error: "Admin session required." };
    return doAdminScheduleDowngrade(actor, data.companyId, data.newPlanId, data.internalReason);
  });

export const adminImmediateDowngrade = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as {
        companyId: string;
        newPlanId: string;
        reason: string;
        clientRequestNote?: string;
        financialTreatment: string;
        effectiveDate: string;
      },
  )
  .handler(async ({ data }) => {
    const session = await getAdminSession();
    const actor = await resolveAdminActor(session);
    if (!actor) return { ok: false as const, error: "Admin session required." };
    return doAdminImmediateDowngrade(actor, data.companyId, data.newPlanId, {
      reason: data.reason,
      clientRequestNote: data.clientRequestNote,
      financialTreatment: data.financialTreatment,
      effectiveDate: data.effectiveDate,
    });
  });

export const adminCommitmentOverride = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as {
        companyId: string;
        reason: string;
        clientRequestNote?: string;
        financialTreatment: string;
        effectiveDate: string;
      },
  )
  .handler(async ({ data }) => {
    const session = await getAdminSession();
    const actor = await resolveAdminActor(session);
    if (!actor) return { ok: false as const, error: "Admin session required." };
    return doAdminCommitmentOverride(actor, data.companyId, {
      reason: data.reason,
      clientRequestNote: data.clientRequestNote,
      financialTreatment: data.financialTreatment,
      effectiveDate: data.effectiveDate,
    });
  });

export const adminCancelSubscription = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { companyId: string; mode: "end_of_period" | "immediate"; reason: string })
  .handler(async ({ data }) => {
    const session = await getAdminSession();
    const actor = await resolveAdminActor(session);
    if (!actor) return { ok: false as const, error: "Admin session required." };
    return doAdminCancelSubscription(actor, data.companyId, data.mode, data.reason);
  });
// -------------------------------------------------- feature entitlements (spec 7)
export const adminListCompanyEntitlements = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { companyId: string })
  .handler(async ({ data }) => {
    const session = await getAdminSession();
    const actor = await resolveAdminActor(session);
    if (!actor) return { ok: false as const, error: "Admin session required." };
    return doAdminListCompanyEntitlements(actor, data.companyId);
  });
export const adminGrantEntitlement = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as {
        companyId: string;
        entitlementKey: string;
        grantType: EntitlementGrantType;
        reason: string;
        expiresAt?: string | null;
        effectiveFrom?: string | null;
        notify: boolean;
      },
  )
  .handler(async ({ data }) => {
    const session = await getAdminSession();
    const actor = await resolveAdminActor(session);
    if (!actor) return { ok: false as const, error: "Admin session required." };
    return doAdminGrantEntitlement(actor, data.companyId, {
      entitlementKey: data.entitlementKey,
      grantType: data.grantType,
      reason: data.reason,
      expiresAt: data.expiresAt ?? null,
      effectiveFrom: data.effectiveFrom ?? null,
      notify: data.notify,
    });
  });
export const adminRevokeEntitlement = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as { companyId: string; grantId: string; reason: string; notify: boolean },
  )
  .handler(async ({ data }) => {
    const session = await getAdminSession();
    const actor = await resolveAdminActor(session);
    if (!actor) return { ok: false as const, error: "Admin session required." };
    return doAdminRevokeEntitlement(actor, data.companyId, data.grantId, data.reason, data.notify);
  });

// ------------------------------------------------------------- Platform Settings
// Master Admin Portal Settings (owner-approved scope 2026-08-12): fees & plan
// pricing, workspace fees, success-fee caps, landing content, preferences.
import {
  doGetAdminSettings,
  doUpdateLandingContent,
  doUpdateMembershipPlan,
  doUpdatePlatformPreference,
  doUpdateSuccessFeeCap,
  doUpdateWorkspaceFeeTier,
} from "./admin-settings-core";
import type {
  JsonValue,
  MembershipPlanInput,
  SuccessFeeCapInput,
  WorkspaceFeeInput,
} from "./admin-settings-core";
export type {
  AdminSettingsData,
  JsonValue,
  SettingsActionResult,
  SettingsFeeTier,
  SettingsPlan,
  SettingsSuccessCap,
} from "./admin-settings-core";

export const getAdminSettings = createServerFn({ method: "GET" }).handler(async () => {
  const session = await getAdminSession();
  const actor = await resolveAdminActor(session);
  if (!actor) return { ok: false as const, error: "Admin session required." };
  return doGetAdminSettings(actor);
});

export const updateMembershipPlan = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as { planId: string; input: MembershipPlanInput },
  )
  .handler(async ({ data }) => {
    const session = await getAdminSession();
    const actor = await resolveAdminActor(session);
    if (!actor) return { ok: false as const, error: "Admin session required." };
    return doUpdateMembershipPlan(actor, data.planId, data.input);
  });

export const updateWorkspaceFeeTier = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as { tierId: string; input: WorkspaceFeeInput },
  )
  .handler(async ({ data }) => {
    const session = await getAdminSession();
    const actor = await resolveAdminActor(session);
    if (!actor) return { ok: false as const, error: "Admin session required." };
    return doUpdateWorkspaceFeeTier(actor, data.tierId, data.input);
  });

export const updateSuccessFeeCap = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as { capId: string; input: SuccessFeeCapInput },
  )
  .handler(async ({ data }) => {
    const session = await getAdminSession();
    const actor = await resolveAdminActor(session);
    if (!actor) return { ok: false as const, error: "Admin session required." };
    return doUpdateSuccessFeeCap(actor, data.capId, data.input);
  });

export const updateLandingContent = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as { key: string; content: JsonValue },
  )
  .handler(async ({ data }) => {
    const session = await getAdminSession();
    const actor = await resolveAdminActor(session);
    if (!actor) return { ok: false as const, error: "Admin session required." };
    return doUpdateLandingContent(actor, data.key, data.content);
  });

export const updatePlatformPreference = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as { key: string; value: string; description: string | null },
  )
  .handler(async ({ data }) => {
    const session = await getAdminSession();
    const actor = await resolveAdminActor(session);
    if (!actor) return { ok: false as const, error: "Admin session required." };
    return doUpdatePlatformPreference(actor, data.key, data.value, data.description);
  });

// ------------------------------------------------------------- AI upsell workflow
// Master Admin upsell & cross-sell workflow: list/detail/status/notes/create
// with the human-approval gate, immutable audit and owner notifications.
// Backend: src/lib/admin-upsells-core.ts (mirrors admin-settings-core pattern).
// NOTE: only the server-only do* functions come from the core. The workflow
// constants come from the pure upsell-constants module so client bundles can
// import them without pulling postgres into the browser graph.
import {
  doCreateUpsellOpportunity,
  doGetUpsellOpportunity,
  doListUpsellOpportunities,
  doUpdateUpsellNotes,
  doUpdateUpsellStatus,
} from "./admin-upsells-core";
import {
  UPSELL_MUTATE_ROLES,
  UPSELL_STATUSES,
  UPSELL_STATUS_LABELS,
  UPSELL_STATUS_TONES,
  UPSELL_TRANSITIONS,
} from "./upsell-constants";
import type { UpsellCreateInput, UpsellListFilters } from "./admin-upsells-core";
export type {
  UpsellActionResult,
  UpsellCreateInput,
  UpsellDetailResult,
  UpsellDetailRow,
  UpsellEvidenceItem,
  UpsellListFilters,
  UpsellListResult,
  UpsellListRow,
  UpsellWorkflowStatus,
} from "./admin-upsells-core";
export { UPSELL_MUTATE_ROLES, UPSELL_STATUS_LABELS, UPSELL_STATUS_TONES, UPSELL_TRANSITIONS, UPSELL_STATUSES };
export const listAdminUpsellOpportunities = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { filters: UpsellListFilters })
  .handler(async ({ data }) => {
    const session = await getAdminSession();
    const actor = await resolveAdminActor(session);
    if (!actor) return { ok: false as const, error: "Admin session required." };
    return doListUpsellOpportunities(actor, data.filters);
  });
export const getAdminUpsellOpportunity = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { opportunityId: string })
  .handler(async ({ data }) => {
    const session = await getAdminSession();
    const actor = await resolveAdminActor(session);
    if (!actor) return { ok: false as const, error: "Admin session required." };
    return doGetUpsellOpportunity(actor, data.opportunityId);
  });
export const createAdminUpsellOpportunity = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { input: UpsellCreateInput })
  .handler(async ({ data }) => {
    const session = await getAdminSession();
    const actor = await resolveAdminActor(session);
    if (!actor) return { ok: false as const, error: "Admin session required." };
    return doCreateUpsellOpportunity(actor, data.input);
  });
export const updateAdminUpsellStatus = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) => d as { opportunityId: string; status: string; notes?: string | null },
  )
  .handler(async ({ data }) => {
    const session = await getAdminSession();
    const actor = await resolveAdminActor(session);
    if (!actor) return { ok: false as const, error: "Admin session required." };
    return doUpdateUpsellStatus(actor, data.opportunityId, data.status, data.notes ?? null);
  });
export const updateAdminUpsellNotes = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { opportunityId: string; notes: string })
  .handler(async ({ data }) => {
    const session = await getAdminSession();
    const actor = await resolveAdminActor(session);
    if (!actor) return { ok: false as const, error: "Admin session required." };
    return doUpdateUpsellNotes(actor, data.opportunityId, data.notes);
  });

// ------------------------------------------------------------- AI Controls
// Master Admin AI Controls: platform data-source registry (enable/disable),
// company opt-out visibility, run history + manual re-run, AI audit trail.
// Backend: src/lib/admin-ai-controls-core.ts (mirrors admin-upsells-core
// pattern: every mutation runs in an asUser(admin, 'sb_admin') batch and
// writes immutable audit rows in the same transaction).
import {
  doDeleteCompanyAiData,
  doGetAiControlSettings,
  doGetAiControlsOverview,
  doGetAiCostOverview,
  doGetAiRunDetail,
  doReRunAiAnalysis,
  doRetryAiRun,
  doToggleAiDataSource,
  doUpdateAiControlSettings,
} from "./admin-ai-controls-core";
import {
  AI_CONTROL_MUTATE_ROLES,
  AI_CONTROL_SETTING_FIELDS,
  AI_RUN_STATUS_LABELS,
  AI_SOURCE_LABELS,
  AI_TRIGGER_LABELS,
} from "./ai-control-constants";
export type {
  AiAuditRow,
  AiControlResult,
  AiControlSettingsResult,
  AiControlSettingsRow,
  AiControlsOverview,
  AiCostByModelRow,
  AiCostOverviewResult,
  AiDataSourceRow,
  AiDeleteAiDataResult,
  AiOptOutRow,
  AiRecentCostRow,
  AiRetryResult,
  AiRunDetailResult,
  AiRunListRow,
} from "./admin-ai-controls-core";
export {
  AI_CONTROL_MUTATE_ROLES,
  AI_CONTROL_SETTING_FIELDS,
  AI_RUN_STATUS_LABELS,
  AI_SOURCE_LABELS,
  AI_TRIGGER_LABELS,
};
export const getAdminAiControls = createServerFn({ method: "GET" }).handler(async () => {
  const session = await getAdminSession();
  const actor = await resolveAdminActor(session);
  if (!actor) return { ok: false as const, error: "Admin session required." };
  return doGetAiControlsOverview(actor);
});
export const setAiDataSourceEnabled = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { sourceId: string; enabled: boolean; reason?: string | null })
  .handler(async ({ data }) => {
    const session = await getAdminSession();
    const actor = await resolveAdminActor(session);
    if (!actor) return { ok: false as const, error: "Admin session required." };
    return doToggleAiDataSource(actor, data.sourceId, data.enabled, data.reason ?? null);
  });
export const getAdminAiRunDetail = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { runId: string })
  .handler(async ({ data }) => {
    const session = await getAdminSession();
    const actor = await resolveAdminActor(session);
    if (!actor) return { ok: false as const, error: "Admin session required." };
    return doGetAiRunDetail(actor, data.runId);
  });
export const rerunAiAnalysis = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { runId: string })
  .handler(async ({ data }) => {
    const session = await getAdminSession();
    const actor = await resolveAdminActor(session);
    if (!actor) return { ok: false as const, error: "Admin session required." };
    return doReRunAiAnalysis(actor, data.runId);
  });
export const retryAiRun = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { runId: string })
  .handler(async ({ data }) => {
    const session = await getAdminSession();
    const actor = await resolveAdminActor(session);
    if (!actor) return { ok: false as const, error: "Admin session required." };
    return doRetryAiRun(actor, data.runId);
  });
export const getAdminAiControlSettings = createServerFn({ method: "GET" }).handler(async () => {
  const session = await getAdminSession();
  const actor = await resolveAdminActor(session);
  if (!actor) return { ok: false as const, error: "Admin session required." };
  return doGetAiControlSettings(actor);
});
export const updateAdminAiControlSettings = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as {
        dailyRunCap?: number | null;
        perCompanyDailyCap?: number | null;
        minIntervalSeconds?: number | null;
        autoRunEnabled?: boolean | null;
      },
  )
  .handler(async ({ data }) => {
    const session = await getAdminSession();
    const actor = await resolveAdminActor(session);
    if (!actor) return { ok: false as const, error: "Admin session required." };
    return doUpdateAiControlSettings(actor, data);
  });
export const getAdminAiCostOverview = createServerFn({ method: "GET" }).handler(async () => {
  const session = await getAdminSession();
  const actor = await resolveAdminActor(session);
  if (!actor) return { ok: false as const, error: "Admin session required." };
  return doGetAiCostOverview(actor);
});
export const deleteCompanyAiData = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) => d as { companyId: string; confirmName: string; reason: string },
  )
  .handler(async ({ data }) => {
    const session = await getAdminSession();
    const actor = await resolveAdminActor(session);
    if (!actor) return { ok: false as const, error: "Admin session required." };
    return doDeleteCompanyAiData(actor, data.companyId, data.confirmName, data.reason);
  });
