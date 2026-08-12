/**
 * Shared upsell workflow constants (statuses, labels, tones, transitions, roles).
 * PURE module: no server-only imports. Client bundles can import these safely;
 * admin-upsells-core.ts is server-only (imports postgres via db.ts) and must
 * NOT be reachable from client code, or vite tries to bundle postgres into the
 * browser graph and the build fails ("performance is not exported by
 * __vite-browser-external"). Keep everything in this file import-free.
 */
export const UPSELL_MUTATE_ROLES = ["operations", "compliance", "super_admin"] as const;

/** DB status values for the upsell workflow (matches the table check clause). */
export const UPSELL_STATUSES = [
  "Suggested",
  "Under_Review",
  "Approved",
  "Rejected",
  "Awaiting_Company_Confirmation",
  "Sent",
  "Interested",
  "Declined",
  "Converted",
  "Closed",
] as const;
export type UpsellWorkflowStatus = (typeof UPSELL_STATUSES)[number];

export const UPSELL_STATUS_LABELS: Record<UpsellWorkflowStatus, string> = {
  Suggested: "Suggested",
  Under_Review: "Under Review",
  Approved: "Approved",
  Rejected: "Rejected",
  Awaiting_Company_Confirmation: "Awaiting Company Confirmation",
  Sent: "Sent",
  Interested: "Interested",
  Declined: "Declined",
  Converted: "Converted",
  Closed: "Closed",
};

export const UPSELL_STATUS_TONES: Record<
  UpsellWorkflowStatus,
  "green" | "red" | "amber" | "slate" | "blue" | "teal" | "navy"
> = {
  Suggested: "slate",
  Under_Review: "blue",
  Approved: "teal",
  Rejected: "red",
  Awaiting_Company_Confirmation: "amber",
  Sent: "navy",
  Interested: "green",
  Declined: "red",
  Converted: "green",
  Closed: "slate",
};

/**
 * Allowed transitions. Terminal states (Converted, Closed) are absent.
 * Sent is gated on prior approval: only Approved and
 * Awaiting_Company_Confirmation (itself only reachable from Approved) may
 * transition to Sent.
 */
export const UPSELL_TRANSITIONS: Record<UpsellWorkflowStatus, UpsellWorkflowStatus[]> = {
  Suggested: ["Under_Review", "Rejected"],
  Under_Review: ["Approved", "Rejected"],
  Approved: ["Sent", "Awaiting_Company_Confirmation", "Rejected"],
  Awaiting_Company_Confirmation: ["Sent", "Declined"],
  Sent: ["Interested", "Declined"],
  Interested: ["Converted", "Closed"],
  Declined: ["Closed"],
  Rejected: ["Closed"],
  Converted: [],
  Closed: [],
};
