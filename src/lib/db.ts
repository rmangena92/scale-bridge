/**
 * Server-only database access layer.
 *
 * SECURITY: Neon’s neondb_owner role has rolbypassrls=true, so RLS is not
 * enforceable for this application. Explicit app-layer SQL predicates are the
 * security boundary; FORCE RLS remains enabled as defense-in-depth.
 *
 * `sql` comes from ~/db (the sandbox's built-in neon helper). This module adds
 * two transaction scopes used by every server function:
 *
 *  - asService(queries):  runs queries with NO RLS context. Used only for
 *    auth-internal reads/writes on the `users` / `sessions` tables (which have
 *    no RLS) and for bootstrap reads keyed on an already-validated session.
 *
 *  - asUser(userId, role, queries): prepends
 *        select set_config('app.user_id', …), set_config('app.role', …)
 *    to a single neon batched transaction, so Row Level Security policies on
 *    the business tables (profiles, companies, contract_workspaces,
 *    invitations, audit_logs) see the acting user. Because the settings are
 *    transaction-local (the `true` argument), they can never leak across the
 *    connection pool into another request.
 *
 * Never call `sql()` directly on an RLS table for user data — without the
 * app.user_id context every policy denies, so reads silently return no rows.
 * Use asUser() with the session's user + role instead.
 *
 * This module imports node/neon and must only be used from server code.
 */
import type { NeonQueryFunctionInTransaction } from "@neondatabase/serverless";
import { sql } from "~/db";
import { SCHEMA_SQL } from "./schema";

export type Tx = NeonQueryFunctionInTransaction<false, false>;
export type TxQuery = ReturnType<Tx>;

export const dbConfigured = (): boolean => Boolean(process.env.DATABASE_URL);

let schemaPromise: Promise<void> | null = null;

/**
 * Apply the (idempotent) schema + RLS policies once per server process.
 * Resets on failure so a transient DB error doesn't wedge later requests.
 */
export function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      // NOTE: @neondatabase/serverless >= 1.0 refuses plain function calls
      // (sql("...")) — only tagged templates or sql.query(text) are accepted.
      // Schema statements are plain SQL strings, so route them through the
      // transaction API's tx.query(text) form. Running every statement inside
      // ONE non-interactive transaction is both faster (~50 HTTP round-trips
      // collapse into one — a fresh schema apply otherwise takes minutes and
      // blows Bun's 10s request timeout) and atomic (any failure rolls back
      // the whole schema).
      const db = sql();
      await db.transaction((tx) =>
        SCHEMA_SQL.map((stmt) => tx.query(stmt)),
      );
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

/** Run a batch of queries with NO RLS context (auth-internal tables only). */
export async function asService(
  build: (tx: Tx) => TxQuery[],
): Promise<unknown[]> {
  const db = sql();
  return db.transaction((tx) => build(tx));
}

/** Run a batch of queries as `userId`/`role`, with RLS enforced. */
export async function asUser(
  userId: string,
  role: string,
  build: (tx: Tx) => TxQuery[],
): Promise<unknown[]> {
  const db = sql();
  return db.transaction((tx) => [
    tx`select
      set_config('app.user_id', ${userId}, true),
      set_config('app.role', ${role}, true)`,
    ...build(tx),
  ]);
}

/** Map a unique-constraint violation to a friendly message where relevant. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err
    ? (err as { code?: string }).code === "23505"
    : false;
}
