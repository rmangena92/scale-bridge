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
  doAddCompanyNote,
  doAddUserNote,
  doGetAdminDashboard,
  doGetAdminSession,
  doGetCompanyDetail,
  doGetUserDetail,
  doListCompanies,
  doListUsers,
  doSetAdminRoles,
  doSetCompanyStatus,
  doSetUserStatus,
  doSetUserSystemRole,
} from "./admin-core";
import type {
  AdminRole,
  Role,
  UserStatus,
} from "./types";

export type {
  AdminSessionResult,
  CompaniesResult,
  CompanyDetailResult,
  DashboardResult,
  SimpleResult,
  UserDetailResult,
  UsersResult,
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
  .validator((d: unknown) => d as { query: string; status: string })
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
