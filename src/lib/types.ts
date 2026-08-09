/**
 * Shared domain types (client-safe — no server-only imports here).
 */

export const ROLES = [
  "sb_admin",
  "lead_contractor",
  "company_user",
  "buyer",
  "project_user",
  "guest",
] as const;

export type Role = (typeof ROLES)[number];

/** Default role granted to every new sign-up. */
export const DEFAULT_ROLE: Role = "lead_contractor";

export const ROLE_LABELS: Record<Role, string> = {
  sb_admin: "ScaleBridge Admin",
  lead_contractor: "Lead Contractor",
  company_user: "Company User",
  buyer: "Buyer",
  project_user: "Project User",
  guest: "Guest",
};

export type CompanyVerificationStatus = "unverified" | "pending" | "verified";

export const VERIFICATION_LABELS: Record<CompanyVerificationStatus, string> = {
  unverified: "Not verified",
  pending: "Verification pending",
  verified: "Verified",
};

/** The authenticated user as returned by the session server function. */
export type PublicUser = {
  id: string;
  email: string;
  role: Role;
  name: string | null;
  companyId: string | null;
};

export type PublicCompany = {
  id: string;
  name: string;
  type: string | null;
  description: string | null;
  contactEmail: string | null;
  verificationStatus: CompanyVerificationStatus;
};

export type CompanyInput = {
  name: string;
  type: string;
  description: string;
  contactEmail: string;
};

// ------------------------------------------------------------ workspaces
export const WORKSPACE_STATUSES = [
  "draft",
  "active",
  "in_review",
  "completed",
  "archived",
] as const;

export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

export const WORKSPACE_STATUS_LABELS: Record<WorkspaceStatus, string> = {
  draft: "Draft",
  active: "Active",
  in_review: "In review",
  completed: "Completed",
  archived: "Archived",
};

/** Badge tone per workspace status (UI concern, kept here for reuse). */
export const WORKSPACE_BADGE_TONES: Record<
  WorkspaceStatus,
  "blue" | "teal" | "green" | "amber" | "red" | "slate" | "navy"
> = {
  draft: "slate",
  active: "green",
  in_review: "amber",
  completed: "navy",
  archived: "slate",
};

/** How the current user relates to a workspace. */
export type WorkspaceAccess = "lead" | "participant";

export type PublicWorkspace = {
  id: string;
  title: string;
  description: string | null;
  status: WorkspaceStatus;
  access: WorkspaceAccess;
  packageCount: number;
  invitedCount: number;
  joinedCount: number;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceInput = {
  title: string;
  description: string;
  status: WorkspaceStatus;
};

// --------------------------------------------------------- work packages
export const WORK_PACKAGE_STATUSES = [
  "defined",
  "in_progress",
  "completed",
  "on_hold",
] as const;

export type WorkPackageStatus = (typeof WORK_PACKAGE_STATUSES)[number];

export const WORK_PACKAGE_STATUS_LABELS: Record<WorkPackageStatus, string> = {
  defined: "Defined",
  in_progress: "In progress",
  completed: "Completed",
  on_hold: "On hold",
};

export type PublicWorkPackage = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  scopeNotes: string | null;
  category: string | null;
  status: WorkPackageStatus;
  createdAt: string;
  updatedAt: string;
};

export type WorkPackageInput = {
  name: string;
  description: string;
  scopeNotes: string;
  category: string;
};

// ------------------------------------------------------------ invitations
/** Commercial role a participant plays inside a workspace. */
export const PARTICIPANT_ROLES = [
  "primary_contractor",
  "subcontractor",
  "supplier",
  "consultant",
] as const;

export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

export const PARTICIPANT_ROLE_LABELS: Record<ParticipantRole, string> = {
  primary_contractor: "Primary contractor",
  subcontractor: "Subcontractor",
  supplier: "Supplier",
  consultant: "Consultant",
};

export const INVITATION_STATUSES = [
  "invited",
  "joined",
  "verified",
  "declined",
] as const;

export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const INVITATION_STATUS_LABELS: Record<InvitationStatus, string> = {
  invited: "Invited",
  joined: "Joined",
  verified: "Verified",
  declined: "Declined",
};

/** Badge tone per invitation status (UI concern, kept here for reuse). */
export const INVITATION_BADGE_TONES: Record<
  InvitationStatus,
  "blue" | "teal" | "green" | "amber" | "red" | "slate" | "navy"
> = {
  invited: "blue",
  joined: "teal",
  verified: "green",
  declined: "red",
};

export type PublicInvitation = {
  id: string;
  workspaceId: string;
  workspaceTitle: string | null;
  email: string;
  companyName: string | null;
  participantRole: ParticipantRole;
  workPackage: string | null;
  status: InvitationStatus;
  createdAt: string;
  respondedAt: string | null;
};

export type InviteInput = {
  email: string;
  companyName: string;
  participantRole: ParticipantRole;
  workPackage: string;
};

export type InvitationResponse = "accept" | "decline";

// ----------------------------------------------------------- notifications
export type PublicNotification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

// -------------------------------------------------------------- audit log
/** Flat, JSON-safe audit details (strings/numbers/booleans/null only). */
export type AuditDetails = Record<string, string | number | boolean | null>;

export type AuditEntry = {
  id: string;
  action: string;
  details: AuditDetails | null;
  createdAt: string;
};
