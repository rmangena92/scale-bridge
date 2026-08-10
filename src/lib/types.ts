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

// -------------------------------------------------------------- admin portal
/** Internal ScaleBridge staff roles (admin_roles.role). */
export const ADMIN_ROLES = [
  "super_admin",
  "operations",
  "compliance",
  "finance",
  "support",
  "read_only",
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: "Super admin",
  operations: "Operations",
  compliance: "Compliance",
  finance: "Finance",
  support: "Support",
  read_only: "Read-only",
};

/** Account status for users (spec: Invited / Active / Pending Verification / Suspended / Deactivated). */
export const USER_STATUSES = [
  "active",
  "suspended",
  "deactivated",
  "invited",
  "pending_verification",
] as const;

export type UserStatus = (typeof USER_STATUSES)[number];

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  active: "Active",
  suspended: "Suspended",
  deactivated: "Deactivated",
  invited: "Invited",
  pending_verification: "Pending Verification",
};

/** Company lifecycle (spec statuses + the two legacy self-serve values). */
export const COMPANY_STATUSES = [
  "draft",
  "registered",
  "documents_pending",
  "under_review",
  "verified",
  "rejected",
  "suspended",
  "archived",
  "unverified",
  "pending",
] as const;

export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export const COMPANY_STATUS_LABELS: Record<CompanyStatus, string> = {
  draft: "Draft",
  registered: "Registered",
  documents_pending: "Documents Pending",
  under_review: "Under Review",
  verified: "Verified",
  rejected: "Rejected",
  suspended: "Suspended",
  archived: "Archived",
  unverified: "Not Verified",
  pending: "Verification Pending",
};

/** The session user as resolved for the Admin Portal, with staff roles. */
export type AdminSession = {
  user: PublicUser; // role is always 'sb_admin' here
  staffRoles: AdminRole[];
  canMutate: boolean; // false when the staff member is read_only
};

/** Dashboard stat bundle returned to /admin. */
export type AdminDashboardStats = {
  totalUsers: number;
  totalCompanies: number;
  companiesAwaitingVerification: number;
  activeContracts: number;
  contractsAwaitingResponses: number;
  activeProjectWorkspaces: number;
  openSupportRequests: number;
  openDisputes: number;
  pendingDocumentReviews: number;
  outstandingPayments: number; // sum of unpaid contract invoice amounts
  monthlyRecurringRevenue: number; // 0 until subscriptions ship (Part B)
  recentActivity: {
    id: string;
    action: string;
    actorEmail: string | null;
    details: AuditDetails | null;
    createdAt: string;
  }[];
  expiringLicences: {
    id: string;
    name: string;
    category: string | null;
    expiryDate: string | null;
    companyName: string | null;
  }[];
};

/** Row in the admin users list. */
export type AdminUserSummary = {
  id: string;
  email: string;
  name: string | null;
  systemRole: Role | null;
  status: UserStatus;
  companyId: string | null;
  companyName: string | null;
  staffRoles: AdminRole[];
  createdAt: string;
};

/** Full admin view of one user. */
export type AdminUserDetail = {
  user: AdminUserSummary;
  companies: {
    id: string;
    name: string;
    type: string | null;
    verificationStatus: CompanyStatus;
    createdAt: string;
  }[];
  invitations: {
    id: string;
    workspaceId: string;
    workspaceTitle: string | null;
    email: string;
    companyName: string | null;
    participantRole: ParticipantRole;
    status: InvitationStatus;
    createdAt: string;
    respondedAt: string | null;
  }[];
  sessions: {
    id: string;
    createdAt: string;
    lastUsedAt: string;
    expiresAt: string;
  }[];
  internalNotes: string[];
};

/** Row in the admin companies list. */
export type AdminCompanySummary = {
  id: string;
  name: string;
  type: string | null;
  verificationStatus: CompanyStatus;
  ownerId: string;
  ownerEmail: string | null;
  createdAt: string;
};

/** Full admin view of one company. */
export type AdminCompanyDetail = {
  company: {
    id: string;
    name: string;
    type: string | null;
    description: string | null;
    contactEmail: string | null;
    verificationStatus: CompanyStatus;
    ownerId: string;
    ownerEmail: string | null;
    internalNotes: string[];
    createdAt: string;
    updatedAt: string;
  };
  users: {
    userId: string;
    name: string | null;
    email: string;
    systemRole: Role;
  }[];
  documents: {
    id: string;
    name: string;
    category: string | null;
    visibility: string;
    reviewStatus: string;
    expiryDate: string | null;
    uploadedAt: string;
  }[];
  contracts: {
    id: string;
    title: string;
    status: WorkspaceStatus;
    createdAt: string;
  }[];
};

