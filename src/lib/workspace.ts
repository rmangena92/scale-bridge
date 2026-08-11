/**
 * Workspace / work package / invitation / notification server functions
 * (client-safe module).
 *
 * IMPORTANT (TanStack Start constraint): this module must not import
 * server-only modules at the top level — the client build replaces the
 * createServerFn handler bodies below with RPC stubs, and only imports that
 * are referenced *exclusively inside those bodies* get tree-shaken out of the
 * browser bundle. All real logic (DB, rate limiting) lives in
 * ./workspace-core.ts, which is imported only here and never from client
 * components.
 */
import { createServerFn } from "@tanstack/react-start";
import {
  doAddDocument,
  doCreateInvoice,
  doCreateTask,
  doCreateVariation,
  doCreateWorkPackage,
  doCreateWorkspace,
  doReviewVerificationDocument,
  doDeleteWorkPackage,
  doGetMyInvitations,
  doGetMyNotifications,
  doGetWorkspace,
  doGetWorkspaces,
  doInviteCompany,
  doRespondToInvitation,
  doReviewPricing,
  doSeedDemo,
  doSubmitPricing,
  doUpdateInvoiceStatus,
  doUpdateMilestoneStatus,
  doUpdateTaskStatus,
  doUpdateVariationStatus,
  doUpdateWorkspace,
  doVerifyParticipant,
} from "./workspace-core";
import type {
  DocumentInput,
  InvitationResponse,
  InviteInput,
  MilestoneStatus,
  TaskInput,
  TaskStatus,
  WorkPackageInput,
  WorkspaceInput,
} from "./types";
import type { InvoiceInput, PricingInput, VariationInput } from "./workspace-core";

export type {
  InvitationsResult,
  InviteResult,
  NotificationsResult,
  SimpleResult,
  WorkspaceDetailResult,
  WorkspacesResult,
} from "./workspace-core";

export const listWorkspaces = createServerFn({ method: "GET" }).handler(() =>
  doGetWorkspaces(),
);

export const createWorkspace = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as WorkspaceInput)
  .handler(({ data }) => doCreateWorkspace(data));

export const updateWorkspace = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as { workspaceId: string; input: WorkspaceInput },
  )
  .handler(({ data }) => doUpdateWorkspace(data.workspaceId, data.input));

export const getWorkspace = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { workspaceId: string })
  .handler(({ data }) => doGetWorkspace(data.workspaceId));

export const createWorkPackage = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as { workspaceId: string; input: WorkPackageInput },
  )
  .handler(({ data }) => doCreateWorkPackage(data.workspaceId, data.input));

export const deleteWorkPackage = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) => d as { workspaceId: string; packageId: string },
  )
  .handler(({ data }) => doDeleteWorkPackage(data.workspaceId, data.packageId));

export const inviteCompany = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) => d as { workspaceId: string; input: InviteInput },
  )
  .handler(({ data }) => doInviteCompany(data.workspaceId, data.input));

export const respondToInvitation = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as { invitationId: string; response: InvitationResponse },
  )
  .handler(({ data }) => doRespondToInvitation(data.invitationId, data.response));

export const verifyParticipant = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as { workspaceId: string; invitationId: string },
  )
  .handler(({ data }) => doVerifyParticipant(data.workspaceId, data.invitationId));

export const reviewVerificationDocument = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as {
        workspaceId: string;
        documentId: string;
        decision: "approved" | "needs_changes";
        note: string;
      },
  )
  .handler(({ data }) =>
    doReviewVerificationDocument(
      data.workspaceId,
      data.documentId,
      data.decision,
      data.note,
    ),
  );

export const addDocument = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) => d as { workspaceId: string; input: DocumentInput },
  )
  .handler(({ data }) => doAddDocument(data.workspaceId, data.input));

export const createTask = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) => d as { workspaceId: string; input: TaskInput },
  )
  .handler(({ data }) => doCreateTask(data.workspaceId, data.input));

export const updateTaskStatus = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as { workspaceId: string; taskId: string; status: TaskStatus },
  )
  .handler(({ data }) => doUpdateTaskStatus(data.workspaceId, data.taskId, data.status));

export const updateMilestoneStatus = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as { workspaceId: string; milestoneId: string; status: MilestoneStatus },
  )
  .handler(({ data }) => doUpdateMilestoneStatus(data.workspaceId, data.milestoneId, data.status));

export const listMyInvitations = createServerFn({ method: "GET" }).handler(() =>
  doGetMyInvitations(),
);

export const listMyNotifications = createServerFn({ method: "GET" }).handler(() =>
  doGetMyNotifications(),
);

export const submitPricing = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as { workspaceId: string; input: PricingInput },
  )
  .handler(({ data }) => doSubmitPricing(data.workspaceId, data.input));

export const reviewPricing = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as { workspaceId: string; submissionId: string; decision: "accepted" | "rejected" },
  )
  .handler(({ data }) => doReviewPricing(data.workspaceId, data.submissionId, data.decision));

export const createInvoice = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as { workspaceId: string; input: InvoiceInput },
  )
  .handler(({ data }) => doCreateInvoice(data.workspaceId, data.input));

export const updateInvoiceStatus = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as { workspaceId: string; invoiceId: string; status: string },
  )
  .handler(({ data }) => doUpdateInvoiceStatus(data.workspaceId, data.invoiceId, data.status));

export const createVariation = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as { workspaceId: string; input: VariationInput },
  )
  .handler(({ data }) => doCreateVariation(data.workspaceId, data.input));

export const updateVariationStatus = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as { workspaceId: string; variationId: string; status: string },
  )
  .handler(({ data }) => doUpdateVariationStatus(data.workspaceId, data.variationId, data.status));

export const seedDemoData = createServerFn({ method: "POST" }).handler(() =>
  doSeedDemo(),
);
