/**
 * View as Client server functions (client-safe module).
 *
 * IMPORTANT (TanStack Start constraint): this module must not import
 * server-only modules at the top level — the client build replaces the
 * createServerFn handler bodies below with RPC stubs. All real logic lives in
 * ./admin-view-core.ts, imported only here and never from client components.
 */
import { createServerFn } from "@tanstack/react-start";
import {
  doEnterViewAsClient,
  doExitViewAsClient,
  doGetViewAsClientContract,
  doGetViewAsClientContracts,
  doGetViewAsClientDashboard,
  doGetViewAsClientOrg,
  doGetViewAsClientSession,
  doListViewAsClientConversations,
  doListViewAsClientMessages,
  doListViewAsClientNotifications,
  doListViewAsClientTeam,
} from "./admin-view-core";

export type {
  ViewAsClientEnterResult,
  ViewAsClientSessionInfo,
  ViewAsClientSessionResult,
} from "./admin-view-core";

/** Open a temporary View as Client session for a company (audited). */
export const enterViewAsClient = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) =>
      d as { companyId: string; reason: string; orgId?: string | null },
  )
  .handler(({ data }) => doEnterViewAsClient(data));

/** Resolve the active View as Client session (banner + route guard). */
export const getViewAsClientSession = createServerFn({ method: "GET" }).handler(
  () => doGetViewAsClientSession(),
);

/** End the View as Client session (audited with duration) and clear the token. */
export const exitViewAsClient = createServerFn({ method: "POST" }).handler(() =>
  doExitViewAsClient(),
);

// ------------------------------------------------------------ view data fns
export const getViewAsClientDashboard = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { orgId: string })
  .handler(({ data }) => doGetViewAsClientDashboard(data.orgId));

export const listViewAsClientContracts = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { orgId: string })
  .handler(({ data }) => doGetViewAsClientContracts(data.orgId));

export const getViewAsClientContract = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { orgId: string; workspaceId: string })
  .handler(({ data }) => doGetViewAsClientContract(data.orgId, data.workspaceId));

export const getViewAsClientOrg = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { orgId: string })
  .handler(({ data }) => doGetViewAsClientOrg(data.orgId));

export const listViewAsClientTeam = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { orgId: string })
  .handler(({ data }) => doListViewAsClientTeam(data.orgId));

export const listViewAsClientNotifications = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { orgId: string })
  .handler(({ data }) => doListViewAsClientNotifications(data.orgId));

export const listViewAsClientConversations = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { orgId: string })
  .handler(({ data }) => doListViewAsClientConversations(data.orgId));

export const listViewAsClientMessages = createServerFn({ method: "GET" })
  .validator(
    (d: unknown) =>
      d as { orgId: string; workspaceId: string; threadKey: string },
  )
  .handler(({ data }) => doListViewAsClientMessages(data));
