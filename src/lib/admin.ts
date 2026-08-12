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
import { asService } from "./db";
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
      const insights = await asService((tx) => doGetAdminServiceInsights(tx));
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
