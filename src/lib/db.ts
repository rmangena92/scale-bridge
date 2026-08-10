/**
 * Server-only database access layer.
 *
 * SECURITY: RLS IS NOW ENFORCED. The app connects as the `scalebridge_app`
 * role, which has rolbypassrls=false, and every business table has
 * FORCE ROW LEVEL SECURITY enabled — so even the table owner (this role) is
 * subject to the policies. Explicit app-layer SQL predicates are retained as
 * defense-in-depth.
 *
 * `sql` comes from ~/db (the postgres.js pool). This module adds two
 * transaction scopes used by every server function:
 *
 *  - asService(queries):  runs queries with NO RLS context. Used only for
 *    auth-internal reads/writes on the `users` / `sessions` tables (which have
 *    no RLS) and for bootstrap reads keyed on an already-validated session.
 *
 *  - asUser(userId, role, queries): prepends
 *        select set_config('app.user_id', …), set_config('app.role', …)
 *    to a single postgres.js transaction, so Row Level Security policies on
 *    the business tables (profiles, companies, contract_workspaces,
 *    invitations, audit_logs) see the acting user. Because the settings are
 *    transaction-local (the `true` argument), they can never leak across the
 *    connection pool into another request.
 *
 * Never call `sql()` directly on an RLS table for user data — without the
 * app.user_id context every policy denies, so reads silently return no rows.
 * Use asUser() with the session's user + role instead.
 *
 * This module imports postgres.js and must only be used from server code.
 */
import type { TransactionSql } from "postgres";
import { getPg } from "~/db";
import { SCHEMA_SQL } from "./schema";

/** A postgres.js transaction client (what `begin()` passes to its callback). */
export type Tx = TransactionSql;
/** A query issued on a transaction — a promise resolving to rows. */
export type TxQuery = Promise<readonly unknown[]>;

export const dbConfigured = (): boolean => Boolean(process.env.DATABASE_URL);

let schemaPromise: Promise<void> | null = null;

/**
 * Apply the (idempotent) schema + RLS policies once per server process.
 * Resets on failure so a transient DB error doesn't wedge later requests.
 */
export function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      // postgres.js unsafe() sends raw SQL via the simple query protocol, so a
      // multi-statement string is fine. SCHEMA_SQL statements are individually
      // idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS), so re-running after
      // a partial failure is safe.
      await getPg().unsafe(SCHEMA_SQL.join(";\n"));
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
  return await getPg().begin(async (tx) => Promise.all(build(tx)));
}

/** Run a batch of queries as `userId`/`role`, with RLS enforced. */
export async function asUser(
  userId: string,
  role: string,
  build: (tx: Tx) => TxQuery[],
): Promise<unknown[]> {
  return await getPg().begin(async (tx) => {
    await tx`select
      set_config('app.user_id', ${userId}, true),
      set_config('app.role', ${role}, true)`;
    return Promise.all(build(tx));
  });
}

/** Map a unique-constraint violation to a friendly message where relevant. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err
    ? (err as { code?: string }).code === "23505"
    : false;
}
