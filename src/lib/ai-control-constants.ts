/**
 * Shared Master Admin AI Controls constants.
 * PURE module: no server-only imports. Client bundles can import these safely;
 * admin-ai-controls-core.ts is server-only (imports postgres via db.ts) and must
 * NOT be reachable from client code, or vite tries to bundle postgres into the
 * browser graph and the build fails. Keep everything in this file import-free.
 */

/** Staff roles allowed to mutate AI Controls (toggle data sources, re-run the
 *  agent). Other staff roles get a read-only view. */
export const AI_CONTROL_MUTATE_ROLES = ["operations", "compliance", "super_admin"] as const;

/** Human-friendly labels for the platform data-source registry rows. */
export const AI_SOURCE_LABELS: Record<string, string> = {
  internal_data: "Internal company data",
  website: "Company website",
  public_source: "Public sources",
};

/** Human-friendly labels for AI run triggers. */
export const AI_TRIGGER_LABELS: Record<string, string> = {
  profile_update: "Profile update",
  intake: "Client intake",
  uploaded_document: "Uploaded document",
  contract_participation: "Contract participation",
  manual: "Manual",
  "manual_re-run": "Manual re-run",
};

/** Human-friendly labels for AI run statuses. */
export const AI_RUN_STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
};
