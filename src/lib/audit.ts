/**
 * Audit logging helper. Returns a single transaction query; append it to any
 * asUser() batch so the insert happens atomically with the action itself.
 * The actor context (app.user_id) is set by the enclosing asUser() scope, so
 * the audit_logs insert policy (any authenticated server call may append) is
 * satisfied.
 *
 * workspaceId scopes the row to a contract workspace (lead/participant
 * visibility); orgId (Client Portal) scopes it to a client org so the org's
 * members see the activity on their dashboard/contract views. Pass whichever
 * applies — both may be set for client-facing contract activity.
 */
import { randomUUID } from "node:crypto";
import type { Tx } from "./db";

export function auditQuery(
  tx: Tx,
  actorId: string,
  action: string,
  details?: Record<string, unknown>,
  workspaceId?: string | null,
  orgId?: string | null,
): ReturnType<Tx> {
  // Bind the details object directly to the jsonb column (postgres.js serializes
  // objects to jsonb). Stringifying first double-encodes it (jsonb stores the
  // string, jsonb_typeof = 'string') — the same bug fixed in ai-agent.ts /
  // admin-upsells-core.ts. Read-side consumers guard with
  // typeof details === "string" ? JSON.parse : as-is, so legacy rows stay readable.
  return tx`insert into audit_logs (id, actor_id, workspace_id, client_org_id, action, details)
    values (${randomUUID()}, ${actorId}, ${workspaceId ?? null}, ${orgId ?? null}, ${action}, ${(details ?? {}) as never})`;
}
