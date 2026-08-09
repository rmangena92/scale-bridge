/**
 * Authentication server functions (client-safe module).
 *
 * IMPORTANT (TanStack Start constraint): this module must not import
 * server-only modules at the top level — the client build replaces the
 * createServerFn handler bodies below with RPC stubs, and only imports that
 * are referenced *exclusively inside those bodies* get tree-shaken out of the
 * browser bundle. All real logic (crypto, sessions, DB) lives in
 * ./auth-core.ts, which is imported only here and in ./company.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import {
  doSignIn,
  doSignOut,
  doSignUp,
  doUpdateProfile,
  getSessionUserResult,
} from "./auth-core";
import type { AuthResult } from "./auth-core";

export type { AuthResult } from "./auth-core";

export const getSessionUser = createServerFn({ method: "GET" }).handler(() =>
  getSessionUserResult(),
);

export const signUp = createServerFn({ method: "POST" })
  .validator(
    (d: unknown) => d as { email: string; password: string; name: string },
  )
  .handler(({ data }): Promise<AuthResult> => doSignUp(data));

export const signIn = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { email: string; password: string })
  .handler(({ data }): Promise<AuthResult> => doSignIn(data));

export const signOut = createServerFn({ method: "POST" }).handler(() =>
  doSignOut(),
);

export const updateProfile = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { name: string })
  .handler(({ data }): Promise<AuthResult> => doUpdateProfile(data));
