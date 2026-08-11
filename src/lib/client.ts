/**
 * Client Portal server functions (client-safe module).
 *
 * IMPORTANT (TanStack Start constraint): this module must not import
 * server-only modules at the top level — the client build replaces the
 * createServerFn handler bodies below with RPC stubs, and only imports that
 * are referenced *exclusively inside those bodies* get tree-shaken out of the
 * browser bundle. All real logic lives in ./client-core.ts, which is imported
 * only here and never from client components.
 */
import { createServerFn } from "@tanstack/react-start";
import {
  doGetClientApprovals,
  doGetClientContract,
  doGetClientDashboard,
  doGetClientOrg,
  doGetClientProgressReport,
  doGetClientSession,
  doGetClientSettings,
  doListClientConversations,
  doListClientMessages,
  doListClientNotifications,
  doMarkAllClientNotificationsRead,
  doMarkClientMessagesRead,
  doMarkClientNotificationRead,
  doSendClientMessage,
  doInviteClientMember,
  doListClientContracts,
  doListClientDocuments,
  doListClientInvoices,
  doListClientIssues,
  doListClientMilestones,
  doListClientProgressReports,
  doListClientTeam,
  doListClientVariations,
  doRaiseClientIssue,
  doReviewClientDocument,
  doReviewClientInvoice,
  doReviewClientMilestone,
  doReviewClientVariation,
  doUpdateClientMemberRole,
  doUpdateClientOrg,
  doUpdateClientProfile,

} from "./client-core";
import type { ClientRole } from "./types";
import type {
  ClientDocumentReviewDecision,
  ClientInvoiceDecision,
  ClientIssueSeverity,
  ClientMessageThreadType,
  ClientMilestoneReviewDecision,
  ClientOrgMembership,
  ClientSession,
  ClientVariationDecision,
} from "./types";

export type {
  ClientResult,
  ClientSessionResult,
  SimpleResult,
} from "./client-core";

/** Resolve the effective org for a page: the `org` search param if it is one of
 *  the user's orgs, else their primary org. Pure (no DB) — safe on both client
 *  and server, so route loaders can call it directly. */
export function resolveClientOrg(
  client: ClientSession,
  orgId: string | undefined,
): ClientOrgMembership {
  const found = orgId ? client.orgs.find((o) => o.orgId === orgId) : undefined;
  return found ?? client.primaryOrg;
}

export const getClientSession = createServerFn({ method: "GET" }).handler(() =>
  doGetClientSession(),
);

export const getClientDashboard = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { orgId: string })
  .handler(({ data }) => doGetClientDashboard(data.orgId));

export const listClientContracts = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { orgId: string })
  .handler(({ data }) => doListClientContracts(data.orgId));

export const getClientContract = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { orgId: string; workspaceId: string })
  .handler(({ data }) => doGetClientContract(data.orgId, data.workspaceId));

export const getClientOrg = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { orgId: string })
  .handler(({ data }) => doGetClientOrg(data.orgId));

export const updateClientOrg = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as {
        orgId: string;
        registrationNumber: string;
        registrationCountry: string;
        taxId: string;
        address: string;
        contactEmail: string;
        contactPhone: string;
      },
  )
  .handler(({ data }) =>
    doUpdateClientOrg(data.orgId, {
      registrationNumber: data.registrationNumber,
      registrationCountry: data.registrationCountry,
      taxId: data.taxId,
      address: data.address,
      contactEmail: data.contactEmail,
      contactPhone: data.contactPhone,
    }),
  );

export const listClientTeam = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { orgId: string })
  .handler(({ data }) => doListClientTeam(data.orgId));

export const inviteClientMember = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) => d as { orgId: string; email: string; name: string; role: ClientRole },
  )
  .handler(({ data }) => doInviteClientMember(data.orgId, data));

export const updateClientMemberRole = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) => d as { orgId: string; userId: string; role: ClientRole },
  )
  .handler(({ data }) => doUpdateClientMemberRole(data.orgId, data.userId, data.role));

export const getClientSettings = createServerFn({ method: "GET" }).handler(() =>
  doGetClientSettings(),
);

export const updateClientProfile = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { name: string })
  .handler(({ data }) => doUpdateClientProfile(data));

// ------------------------------------------------------- client portal Part B

export const listClientDocuments = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { orgId: string; workspaceId?: string })
  .handler(({ data }) => doListClientDocuments(data.orgId, data.workspaceId));

export const reviewClientDocument = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as {
        orgId: string;
        workspaceId: string;
        documentId: string;
        decision: ClientDocumentReviewDecision;
        comment?: string;
      },
  )
  .handler(({ data }) => doReviewClientDocument(data));

export const listClientMilestones = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { orgId: string; workspaceId?: string })
  .handler(({ data }) => doListClientMilestones(data.orgId, data.workspaceId));

export const reviewClientMilestone = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as {
        orgId: string;
        workspaceId: string;
        milestoneId: string;
        decision: ClientMilestoneReviewDecision;
        comment?: string;
      },
  )
  .handler(({ data }) => doReviewClientMilestone(data));

export const listClientProgressReports = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { orgId: string; workspaceId?: string })
  .handler(({ data }) => doListClientProgressReports(data.orgId, data.workspaceId));

export const getClientProgressReport = createServerFn({ method: "GET" })
  .validator(
    (d: unknown) => d as { orgId: string; workspaceId: string; reportId: string },
  )
  .handler(({ data }) => doGetClientProgressReport(data));

export const listClientIssues = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { orgId: string; workspaceId?: string })
  .handler(({ data }) => doListClientIssues(data.orgId, data.workspaceId));

export const raiseClientIssue = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as {
        orgId: string;
        workspaceId: string;
        workPackageId?: string | null;
        title: string;
        description: string;
        severity: ClientIssueSeverity;
      },
  )
  .handler(({ data }) => doRaiseClientIssue(data));

export const listClientVariations = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { orgId: string; workspaceId?: string })
  .handler(({ data }) => doListClientVariations(data.orgId, data.workspaceId));

export const reviewClientVariation = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as {
        orgId: string;
        workspaceId: string;
        variationId: string;
        decision: ClientVariationDecision;
        conditions?: string;
        reason?: string;
      },
  )
  .handler(({ data }) => doReviewClientVariation(data));

export const listClientInvoices = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { orgId: string; workspaceId?: string })
  .handler(({ data }) => doListClientInvoices(data.orgId, data.workspaceId));

export const reviewClientInvoice = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as {
        orgId: string;
        workspaceId: string;
        invoiceId: string;
        decision: ClientInvoiceDecision;
        reviewNotes?: string;
      },
  )
  .handler(({ data }) => doReviewClientInvoice(data));

export const getClientApprovals = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { orgId: string })
  .handler(({ data }) => doGetClientApprovals(data.orgId));

// ------------------------------------------------------- client portal Part C
export const listClientConversations = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { orgId: string })
  .handler(({ data }) => doListClientConversations(data.orgId));
export const listClientMessages = createServerFn({ method: "GET" })
  .validator(
    (d: unknown) => d as { orgId: string; workspaceId: string; threadKey: string },
  )
  .handler(({ data }) => doListClientMessages(data));
export const sendClientMessage = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as {
        orgId: string;
        workspaceId: string;
        threadType: ClientMessageThreadType;
        threadEntityId?: string | null;
        body: string;
      },
  )
  .handler(({ data }) => doSendClientMessage(data));
export const markClientMessagesRead = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) => d as { orgId: string; workspaceId: string; threadKey: string },
  )
  .handler(({ data }) => doMarkClientMessagesRead(data));
export const listClientNotifications = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { orgId: string })
  .handler(({ data }) => doListClientNotifications(data.orgId));
export const markClientNotificationRead = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { orgId: string; notificationId: string })
  .handler(({ data }) => doMarkClientNotificationRead(data));
export const markAllClientNotificationsRead = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { orgId: string })
  .handler(({ data }) => doMarkAllClientNotificationsRead(data.orgId));
