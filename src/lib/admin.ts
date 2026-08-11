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
import type {
  AdminRole,
  DocumentReviewAction,
  Role,
  SupportCasePriority,
  SupportCaseStatus,
  UserStatus,
} from "./types";

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
