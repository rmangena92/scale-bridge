import postgres, { type Sql } from "postgres";

/**
 * Server-only handle to the team's database (Supabase Postgres, driven by
 * postgres.js over TCP+TLS). The connection string comes from `DATABASE_URL`,
 * which the owner connects via the database card and which is injected into the
 * sandbox and passed to the live host on publish. A single module-level pool is
 * created lazily (on first use, not at module load) so the site still builds and
 * serves before a database is connected — the error only surfaces if a query
 * actually runs without `DATABASE_URL`.
 *
 * Supabase requires TLS and its connection string carries no sslmode parameter,
 * so the pool pins `ssl: "require"`.
 *
 * Use it only inside a `createServerFn()` handler or an `src/routes/api/*` route
 * (never client code):
 *
 *   const getPosts = createServerFn().handler(async () => {
 *     const rows = await sql()`select id, title, created_at from posts`;
 *     // Coerce non-primitive columns (timestamps are JS Dates) to strings before
 *     // returning to the client, or React will refuse to render them:
 *     return rows.map((r) => ({ ...r, created_at: String(r.created_at) }));
 *   });
 */

let pg: Sql | null = null;

/** Lazily create (once) and return the shared postgres.js connection pool. */
export const getPg = (): Sql => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set — connect a database (via the database card) before running queries.",
    );
  }
  return (pg ??= postgres(url, { max: 5, ssl: "require", onnotice: () => {} }));
};

/** Backwards-compatible alias: `sql()` returns the shared pool. */
export const sql = () => getPg();
