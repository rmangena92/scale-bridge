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
  doGetClientContract,
  doGetClientDashboard,
  doGetClientOrg,
  doGetClientSession,
  doGetClientSettings,
  doInviteClientMember,
  doListClientContracts,
  doListClientTeam,
  doUpdateClientMemberRole,
  doUpdateClientOrg,
  doUpdateClientProfile,

} from "./client-core";
import type { ClientRole } from "./types";
import type { ClientOrgMembership, ClientSession } from "./types";

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
