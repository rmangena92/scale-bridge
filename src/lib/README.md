# ScaleBridge data access & Row Level Security

This is the reference for how every future phase should access the database.
Read it before adding queries — the pattern below is what makes the
role-based access control real, not cosmetic.

## The stack

- Postgres (Neon) via the sandbox helper `import { sql } from "~/db"` — server
  only, never import `~/db` from client components.
- `src/lib/db.ts` adds two transaction scopes on top of `sql()`:
  - `asService(build)` — a single neon batched transaction with **no** RLS
    context. Only for auth-internal tables (`users`, `sessions`) and bootstrap
    reads keyed on an already-validated session token.
  - `asUser(userId, role, build)` — a single neon batched transaction whose
    first query is
    `select set_config('app.user_id', $1, true), set_config('app.role', $2, true)`
    followed by your queries. RLS policies on the business tables see the
    acting user; `true` makes the settings **transaction-local**, so they can
    never leak across Neon's connection pool into another request.

## The rule

Every read/write of a business table (`profiles`, `companies`,
`contract_workspaces`, `invitations`, `audit_logs`) must go through
`asUser(user.id, user.role, ...)`, where `user` comes from
`loadSessionUser()` (validates the `sb_session` httpOnly cookie against the
`sessions` table on every call).

Never call `sql()` directly on an RLS table for user data — with no
`app.user_id` context every policy denies, so reads silently return zero
rows and writes fail. That is intentional (safe default), not a bug.

## Why this design

- **Defense in depth.** Even if a future server function forgets to scope a
  query, RLS limits it to rows the acting user is allowed to see. This
  protects contract-level data isolation at the database, not just in UI
  code.
- **No client DB access.** The browser only ever talks to server functions,
  so `app.user_id` is set exclusively by trusted server code.
- **Pool-safe.** `set_config(..., true)` (transaction-local) + a batched
  neon transaction means each request is atomic and settings never persist
  on a reused connection.

## The tables

| Table               | RLS   | Who can touch it per policy (via asUser context)                  |
| ------------------- | ----- | ----------------------------------------------------------------- |
| users               | off   | Auth internals only (email/password lookup, by unguessable token) |
| sessions            | off   | Auth internals only (lookup/delete by token hash)                 |
| profiles            | on    | Own profile; sb_admin all                                         |
| companies           | on    | Owner (CRUD); sb_admin all; verified companies readable           |
| contract_workspaces | on    | Lead (CRUD); sb_admin all; invited/joined/verified participants read |
| invitations         | on    | Workspace lead (CRUD); invited company / email (read); the invited user may move an OPEN invite to joined/declined (`invitations_respond`); sb_admin |
| work_packages       | on    | Workspace lead (CRUD); sb_admin all; participants read            |
| notifications       | on    | Own inbox (read/update); inserts only from trusted server functions (self, lead→invitee, invitee→lead) |
| audit_logs          | on    | Any authenticated call may append; lead/admin read                |

`users` and `sessions` are deliberately exempt: they are internal, only ever
queried by server code with parameterized, unguessable lookups, and they
store no business data. The session token is stored as a SHA-256 hash, so a
leaked database yields nothing usable.

Policies live in `src/lib/schema.ts` (idempotent, applied by
`ensureSchema()` once per server process). The role names are
`sb_admin | lead_contractor | company_user | buyer | project_user | guest`;
new sign-ups default to `lead_contractor`.

Notes specific to the workspace/invitation phase:
- Policy expressions (and their subqueries) run with the privileges of the
  table owner, so RLS is NOT applied recursively inside a policy — the
  predicate itself is what scopes the rows (e.g. the workspace select
  policy's invitations subquery filters by the caller's email).
- `invitations_respond` is the accept/decline path: the invited user may
  UPDATE an invitation only while it is `invited`, and the new row must still
  carry their own email with a status of `joined` or `declined` — they cannot
  re-route the invite, change role/package, or self-verify.
- `notifications_insert` deliberately allows three shapes: notifying yourself,
  a lead notifying someone they invited into one of their workspaces, and an
  invitee notifying the lead of the workspace they just answered. The
  accept/decline/verify flows write the invitation row first, then the
  notification, in the same transaction so the policy's subqueries see the
  new status.

## Adding a query in a future phase

```ts
import { asUser } from "~/lib/db";
import { auditQuery } from "~/lib/audit";
import { loadSessionUser } from "~/lib/auth";

const user = await loadSessionUser();          // 401 if null
await asUser(user.id, user.role, (tx) => [
  tx`select ... from contract_workspaces where id = ${id}`,   // RLS scoped
  auditQuery(tx, user.id, "workspace.view", { workspaceId: id }),
]);
```

Notes:
- neon's `transaction()` batches queries as one non-interactive transaction —
  queries in one batch cannot use each other's *results* (only `set_config`
  state). Split into two batches when you need a value from an earlier query
  (see `saveCompany` in `src/lib/company.ts` for the pattern).
- Always append an `auditQuery(...)` to state-changing batches.
- Coerce non-primitive columns (timestamps are JS `Date`s) to strings before
  returning them to the client.
