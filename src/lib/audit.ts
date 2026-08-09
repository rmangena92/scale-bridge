/**
 * Audit logging helper. Returns a single transaction query; append it to any
 * asUser() batch so the insert happens atomically with the action itself.
 * The actor context (app.user_id) is set by the enclosing asUser() scope, so
 * the audit_logs insert policy (any authenticated server call may append) is
 * satisfied.
 */
import { randomUUID } from "node:crypto";
import type { Tx } from "./db";

export function auditQuery(
  tx: Tx,
  actorId: string,
  action: string,
  details?: Record<string, unknown>,
  workspaceId?: string | null,
): ReturnType<Tx> {
  return tx`insert into audit_logs (id, actor_id, workspace_id, action, details)
    values (${randomUUID()}, ${actorId}, ${workspaceId ?? null}, ${action}, ${JSON.stringify(details ?? {})})`;
}
