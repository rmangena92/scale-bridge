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
  "suspended",
  "completed",
  "archived",
] as const;

export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

export const WORKSPACE_STATUS_LABELS: Record<WorkspaceStatus, string> = {
  draft: "Draft",
  active: "Active",
  in_review: "In review",
  suspended: "Suspended",
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
  suspended: "red",
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
    workPackage: string | null;
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


// ------------------------------------------------------- document review (B)
/** Document verification lifecycle (documents.review_status). */
export const DOCUMENT_REVIEW_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "needs_replacement",
  "clarification_requested",
] as const;

export type DocumentReviewStatus = (typeof DOCUMENT_REVIEW_STATUSES)[number];

export const DOCUMENT_REVIEW_LABELS: Record<DocumentReviewStatus, string> = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  needs_replacement: "Replacement requested",
  clarification_requested: "Clarification requested",
};

export const DOCUMENT_REVIEW_BADGE_TONES: Record<
  DocumentReviewStatus,
  "blue" | "teal" | "green" | "amber" | "red" | "slate" | "navy"
> = {
  pending: "amber",
  approved: "green",
  rejected: "red",
  needs_replacement: "red",
  clarification_requested: "blue",
};

/** Document review actions available to an admin. */
export type DocumentReviewAction =
  | "approve"
  | "reject"
  | "needs_replacement"
  | "clarification_requested";

// ----------------------------------------------------------- support cases (B)
export const SUPPORT_CASE_STATUSES = [
  "new",
  "under_review",
  "waiting_info",
  "escalated",
  "resolved",
  "closed",
] as const;

export type SupportCaseStatus = (typeof SUPPORT_CASE_STATUSES)[number];

export const SUPPORT_CASE_STATUS_LABELS: Record<SupportCaseStatus, string> = {
  new: "New",
  under_review: "Under Review",
  waiting_info: "Waiting for Information",
  escalated: "Escalated",
  resolved: "Resolved",
  closed: "Closed",
};

export const SUPPORT_CASE_BADGE_TONES: Record<
  SupportCaseStatus,
  "blue" | "teal" | "green" | "amber" | "red" | "slate" | "navy"
> = {
  new: "blue",
  under_review: "amber",
  waiting_info: "amber",
  escalated: "red",
  resolved: "teal",
  closed: "slate",
};

export const SUPPORT_CASE_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type SupportCasePriority = (typeof SUPPORT_CASE_PRIORITIES)[number];

export const SUPPORT_CASE_PRIORITY_LABELS: Record<SupportCasePriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export const SUPPORT_CASE_PRIORITY_TONES: Record<
  SupportCasePriority,
  "blue" | "teal" | "green" | "amber" | "red" | "slate" | "navy"
> = {
  low: "slate",
  medium: "blue",
  high: "amber",
  urgent: "red",
};

// ----------------------------------------------------------- admin portal (B)
/** One-line description per staff role, shown on the roles & permissions page. */
export const ADMIN_ROLE_DESCRIPTIONS: Record<AdminRole, string> = {
  super_admin: "Full platform access — configuration, users, companies, contracts, billing and security.",
  operations: "Manages onboarding, verification, contracts, projects and support.",
  compliance: "Reviews company documents, licences, insurance, identity and verification status.",
  finance: "Manages subscriptions, invoices, payments, refunds and platform revenue.",
  support: "Handles tickets, user issues, disputes and communication.",
  read_only: "Can view approved operational data but cannot modify records.",
};

/** Row in the admin verification queue. */
export type AdminVerificationCompany = {
  id: string;
  name: string;
  type: string | null;
  verificationStatus: CompanyStatus;
  ownerId: string;
  ownerEmail: string | null;
  createdAt: string;
  documentCount: number;
  pendingDocumentCount: number;
  expiringDocumentCount: number;
};

/** One document on the verification / document review screens. */
export type AdminDocumentRow = {
  id: string;
  name: string;
  category: string | null;
  visibility: string;
  reviewStatus: DocumentReviewStatus;
  reviewComment: string | null;
  reviewedByEmail: string | null;
  reviewedAt: string | null;
  expiryDate: string | null;
  expiryReminderAt: string | null;
  fileUrl: string | null;
  uploadedAt: string;
  companyId: string | null;
  companyName: string | null;
  workspaceId: string | null;
  workspaceTitle: string | null;
};

/** Approval history entry for a company / document (from audit_logs). */
export type AdminApprovalEntry = {
  id: string;
  action: string;
  actorEmail: string | null;
  details: AuditDetails | null;
  createdAt: string;
};

/** Row in the admin contracts list. */
export type AdminContractSummary = {
  id: string;
  title: string;
  description: string | null;
  status: WorkspaceStatus;
  industry: string | null;
  location: string | null;
  contractValue: number | null;
  leadUserId: string;
  leadName: string | null;
  leadEmail: string | null;
  clientNames: string[];
  packageCount: number;
  participantCount: number;
  createdAt: string;
  updatedAt: string;
};

/** Full admin view of one contract workspace. */
export type AdminContractDetail = {
  workspace: {
    id: string;
    title: string;
    description: string | null;
    status: WorkspaceStatus;
    industry: string | null;
    location: string | null;
    contractValue: number | null;
    createdAt: string;
    updatedAt: string;
  };
  lead: { userId: string; name: string | null; email: string; companyName: string | null };
  clients: { orgId: string; name: string; contactEmail: string | null }[];
  supportAssignee: { userId: string; name: string | null; email: string; roles: AdminRole[] } | null;
  internalNotes: string[];
  packages: {
    id: string;
    name: string;
    category: string | null;
    status: WorkPackageStatus;
    completion: number;
  }[];
  participants: {
    invitationId: string;
    companyId: string | null;
    companyName: string | null;
    email: string;
    participantRole: ParticipantRole;
    status: InvitationStatus;
  }[];
  milestones: {
    id: string;
    name: string;
    dueDate: string | null;
    status: string;
  }[];
  issues: {
    id: string;
    title: string;
    severity: string | null;
    status: string;
  }[];
  invoices: {
    id: string;
    invoiceNumber: string;
    title: string | null;
    amount: number;
    status: string;
  }[];
  documents: AdminDocumentRow[];
  audit: AdminApprovalEntry[];
};

/** Row in the admin support case list. */
export type AdminSupportCaseSummary = {
  id: string;
  caseNumber: string;
  category: string;
  description: string | null;
  priority: SupportCasePriority;
  status: SupportCaseStatus;
  reporterEmail: string;
  reporterName: string | null;
  companyName: string | null;
  assigneeEmail: string | null;
  createdAt: string;
  updatedAt: string;
};

/** One message on a support case thread. */
export type AdminCaseMessage = {
  id: string;
  authorEmail: string;
  authorName: string | null;
  body: string;
  internal: boolean;
  createdAt: string;
};

/** Full admin view of one support case. */
export type AdminSupportCaseDetail = {
  id: string;
  caseNumber: string;
  reporter: { userId: string; name: string | null; email: string };
  company: { id: string; name: string } | null;
  workspace: { id: string; title: string } | null;
  category: string;
  description: string | null;
  attachments: { name: string }[];
  priority: SupportCasePriority;
  assignee: { userId: string; name: string | null; email: string } | null;
  status: SupportCaseStatus;
  resolution: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  messages: AdminCaseMessage[];
};

/** Row in the audit log table view. */
export type AdminAuditLogRow = {
  id: string;
  action: string;
  actorEmail: string | null;
  workspaceTitle: string | null;
  details: AuditDetails | null;
  createdAt: string;
};

/** Staff member (admin_roles holder) for assignee pickers. */
export type AdminStaffMember = {
  userId: string;
  email: string;
  name: string | null;
  roles: AdminRole[];
};

// -------------------------------------------------------------- client portal
/** Client-side roles (client_org_members.role). */
export const CLIENT_ROLES = [
  "client_admin",
  "client_pm",
  "client_finance",
  "client_reviewer",
  "client_read_only",
] as const;

export type ClientRole = (typeof CLIENT_ROLES)[number];

export const CLIENT_ROLE_LABELS: Record<ClientRole, string> = {
  client_admin: "Client administrator",
  client_pm: "Project manager",
  client_finance: "Finance user",
  client_reviewer: "Reviewer",
  client_read_only: "Read-only",
};

export const CLIENT_ROLE_BADGE_TONES: Record<
  ClientRole,
  "blue" | "teal" | "green" | "amber" | "red" | "slate" | "navy"
> = {
  client_admin: "navy",
  client_pm: "blue",
  client_finance: "teal",
  client_reviewer: "amber",
  client_read_only: "slate",
};

/** Client organisation lifecycle (client_organizations.status). */
export const CLIENT_ORG_STATUSES = [
  "draft",
  "registered",
  "under_review",
  "verified",
  "suspended",
  "archived",
] as const;

export type ClientOrgStatus = (typeof CLIENT_ORG_STATUSES)[number];

export const CLIENT_ORG_STATUS_LABELS: Record<ClientOrgStatus, string> = {
  draft: "Draft",
  registered: "Registered",
  under_review: "Under Review",
  verified: "Verified",
  suspended: "Suspended",
  archived: "Archived",
};

/** One organisation the signed-in user acts for in the Client Portal. */
export type ClientOrgMembership = {
  orgId: string;
  orgName: string;
  orgStatus: ClientOrgStatus;
  role: ClientRole;
};

/** The session user as resolved for the Client Portal (may span orgs). */
export type ClientSession = {
  user: PublicUser; // role is the user's system profile role
  orgs: ClientOrgMembership[];
  primaryOrg: ClientOrgMembership;
  canMutate: boolean; // true when any membership is not read_only
  isClientAdmin: boolean; // true when any membership is client_admin
};

/** Client org profile (My Organisation). */
export type ClientOrgProfile = {
  id: string;
  name: string;
  registrationNumber: string | null;
  registrationCountry: string | null;
  taxId: string | null;
  address: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  status: ClientOrgStatus;
  createdAt: string;
  updatedAt: string;
};

/** Row in the client dashboard stat bundle. */
export type ClientDashboardStats = {
  orgName: string;
  activeContracts: number;
  contractValue: number;
  completionPct: number;
  upcomingMilestones: {
    id: string;
    name: string;
    dueDate: string | null;
    status: string;
    workspaceTitle: string | null;
  }[];
  pendingApprovals: number;
  documentsAwaitingReview: number;
  openIssues: number;
  variationRequests: number;
  invoicesAwaitingAction: number;
  recentMessages: number; // 0 until messaging ships (Part C)
  recentActivity: {
    id: string;
    action: string;
    actorEmail: string | null;
    details: AuditDetails | null;
    createdAt: string;
  }[];
  contractEndDates: {
    id: string;
    title: string;
    endDate: string | null;
    status: WorkspaceStatus;
  }[];
};

/** Row in the client contracts list. */
export type ClientContractSummary = {
  id: string;
  title: string;
  description: string | null;
  status: WorkspaceStatus;
  industry: string | null;
  location: string | null;
  contractValue: number | null;
  startDate: string | null;
  endDate: string | null;
  completionPct: number;
  leadName: string | null;
  leadEmail: string | null;
  leadCompany: string | null;
  packageCount: number;
  visiblePackageCount: number;
};

/** One client-visible work package (names/scope/status — no pricing). */
export type ClientWorkPackage = {
  id: string;
  name: string;
  description: string | null;
  scopeNotes: string | null;
  category: string | null;
  status: WorkPackageStatus;
  companyName: string | null;
  milestoneCount: number;
  completedMilestoneCount: number;
  completionPct: number;
};

/** Full client view of one contract workspace. */
export type ClientContractDetail = {
  workspace: {
    id: string;
    title: string;
    description: string | null;
    status: WorkspaceStatus;
    industry: string | null;
    location: string | null;
    contractValue: number | null;
    startDate: string | null;
    endDate: string | null;
    createdAt: string;
    updatedAt: string;
  };
  lead: {
    userId: string;
    name: string | null;
    email: string;
    companyName: string | null;
  } | null;
  clientOrg: {
    orgId: string;
    name: string;
    contactEmail: string | null;
  };
  participants: {
    companyId: string | null;
    companyName: string | null;
    participantRole: ParticipantRole | null;
    status: InvitationStatus | null;
  }[];
  workPackages: ClientWorkPackage[];
  milestones: {
    id: string;
    name: string;
    dueDate: string | null;
    status: string;
    workPackageName: string | null;
  }[];
  issues: {
    id: string;
    title: string;
    severity: string | null;
    status: string;
  }[];
  invoices: {
    id: string;
    invoiceNumber: string;
    title: string | null;
    amount: number;
    status: string;
  }[];
  documents: {
    id: string;
    name: string;
    category: string | null;
    reviewStatus: string;
    uploadedAt: string;
  }[];
  audit: {
    id: string;
    action: string;
    actorEmail: string | null;
    details: AuditDetails | null;
    createdAt: string;
  }[];
};

/** Row in the client Team roster. */
export type ClientTeamMember = {
  userId: string;
  email: string;
  name: string | null;
  role: ClientRole;
  userStatus: UserStatus;
  joinedAt: string;
  isSelf: boolean;
};

// ------------------------------------------------- client portal Part B
// Documents / milestones / reports / issues / variations / invoices and the
// approvals hub. Status values are the client-facing lifecycle; the server
// maps the legacy lead-portal statuses onto these enums so the client portal
// sees one consistent vocabulary.

export const CLIENT_DOCUMENT_STATUSES = [
  "draft",
  "published",
  "under_review",
  "approved",
  "needs_changes",
] as const;

export type ClientDocumentStatus = (typeof CLIENT_DOCUMENT_STATUSES)[number];

export const CLIENT_DOCUMENT_STATUS_LABELS: Record<ClientDocumentStatus, string> = {
  draft: "Draft",
  published: "Published",
  under_review: "Under review",
  approved: "Approved",
  needs_changes: "Needs changes",
};

export const CLIENT_DOCUMENT_STATUS_TONES: Record<
  ClientDocumentStatus,
  "blue" | "teal" | "green" | "amber" | "red" | "slate" | "navy"
> = {
  draft: "slate",
  published: "teal",
  under_review: "amber",
  approved: "green",
  needs_changes: "red",
};

export const CLIENT_DOCUMENT_CATEGORIES = [
  "sla",
  "method_statement",
  "safety",
  "report",
  "other",
] as const;

export type ClientDocumentCategory = (typeof CLIENT_DOCUMENT_CATEGORIES)[number];

export const CLIENT_DOCUMENT_CATEGORY_LABELS: Record<ClientDocumentCategory, string> = {
  sla: "SLA",
  method_statement: "Method statement",
  safety: "Safety",
  report: "Report",
  other: "Other",
};

/** One contract document visible to the client org. */
export type ClientDocument = {
  id: string;
  workspaceId: string;
  workspaceTitle: string | null;
  title: string;
  fileName: string | null;
  category: ClientDocumentCategory | null;
  status: ClientDocumentStatus;
  uploadedByUserId: string | null;
  uploadedByEmail: string | null;
  sharedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ClientDocumentReviewDecision = "approved" | "needs_changes";

export const CLIENT_MILESTONE_STATUSES = [
  "planned",
  "in_progress",
  "submitted",
  "approved",
  "needs_changes",
  "completed",
] as const;

export type ClientMilestoneStatus = (typeof CLIENT_MILESTONE_STATUSES)[number];

export const CLIENT_MILESTONE_STATUS_LABELS: Record<ClientMilestoneStatus, string> = {
  planned: "Planned",
  in_progress: "In progress",
  submitted: "Submitted for review",
  approved: "Approved",
  needs_changes: "Needs changes",
  completed: "Completed",
};

export const CLIENT_MILESTONE_STATUS_TONES: Record<
  ClientMilestoneStatus,
  "blue" | "teal" | "green" | "amber" | "red" | "slate" | "navy"
> = {
  planned: "slate",
  in_progress: "blue",
  submitted: "amber",
  approved: "teal",
  needs_changes: "red",
  completed: "green",
};

/** One delivery milestone on the org's contracts. */
export type ClientMilestone = {
  id: string;
  workspaceId: string;
  workspaceTitle: string | null;
  workPackageId: string | null;
  workPackageName: string | null;
  title: string;
  description: string | null;
  dueDate: string | null;
  status: ClientMilestoneStatus;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  reviewedByEmail: string | null;
  createdAt: string;
};

export type ClientMilestoneReviewDecision = "approved" | "needs_changes";

/** One progress report on the org's contracts (read-only for clients). */
export type ClientProgressReport = {
  id: string;
  workspaceId: string;
  workspaceTitle: string | null;
  milestoneId: string | null;
  milestoneTitle: string | null;
  title: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  body: string | null;
  submittedByUserId: string | null;
  submittedByEmail: string | null;
  createdAt: string;
};

export const CLIENT_ISSUE_SEVERITIES = ["low", "medium", "high"] as const;

export type ClientIssueSeverity = (typeof CLIENT_ISSUE_SEVERITIES)[number];

export const CLIENT_ISSUE_SEVERITY_LABELS: Record<ClientIssueSeverity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export const CLIENT_ISSUE_SEVERITY_TONES: Record<
  ClientIssueSeverity,
  "blue" | "teal" | "green" | "amber" | "red" | "slate" | "navy"
> = {
  low: "slate",
  medium: "blue",
  high: "red",
};

export const CLIENT_ISSUE_STATUSES = ["open", "under_review", "responded", "closed"] as const;

export type ClientIssueStatus = (typeof CLIENT_ISSUE_STATUSES)[number];

export const CLIENT_ISSUE_STATUS_LABELS: Record<ClientIssueStatus, string> = {
  open: "Open",
  under_review: "Under review",
  responded: "Responded",
  closed: "Closed",
};

export const CLIENT_ISSUE_STATUS_TONES: Record<
  ClientIssueStatus,
  "blue" | "teal" | "green" | "amber" | "red" | "slate" | "navy"
> = {
  open: "red",
  under_review: "amber",
  responded: "blue",
  closed: "slate",
};

/** One issue on the org's contracts, including any lead response. */
export type ClientIssue = {
  id: string;
  workspaceId: string;
  workspaceTitle: string | null;
  workPackageId: string | null;
  workPackageName: string | null;
  title: string;
  description: string | null;
  severity: ClientIssueSeverity | null;
  status: ClientIssueStatus;
  response: string | null;
  respondedAt: string | null;
  respondedByUserId: string | null;
  respondedByEmail: string | null;
  raisedByUserId: string | null;
  raisedByEmail: string | null;
  createdAt: string;
};

export const CLIENT_VARIATION_STATUSES = [
  "proposed",
  "under_review",
  "approved",
  "rejected",
  "clarification_needed",
  "conditions",
] as const;

export type ClientVariationStatus = (typeof CLIENT_VARIATION_STATUSES)[number];

export const CLIENT_VARIATION_STATUS_LABELS: Record<ClientVariationStatus, string> = {
  proposed: "Proposed",
  under_review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  clarification_needed: "Clarification needed",
  conditions: "Approved with conditions",
};

export const CLIENT_VARIATION_STATUS_TONES: Record<
  ClientVariationStatus,
  "blue" | "teal" | "green" | "amber" | "red" | "slate" | "navy"
> = {
  proposed: "blue",
  under_review: "amber",
  approved: "green",
  rejected: "red",
  clarification_needed: "blue",
  conditions: "teal",
};

/** One contract variation for the client to review/decide. */
export type ClientVariation = {
  id: string;
  workspaceId: string;
  workspaceTitle: string | null;
  workPackageId: string | null;
  workPackageName: string | null;
  title: string;
  description: string | null;
  reason: string | null;
  proposedAmountCents: number | null;
  status: ClientVariationStatus;
  conditions: string | null;
  decidedAt: string | null;
  decidedByUserId: string | null;
  decidedByEmail: string | null;
  createdAt: string;
};

export type ClientVariationDecision =
  | "approved"
  | "rejected"
  | "clarification_needed"
  | "conditions";

export const CLIENT_INVOICE_STATUSES = [
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "corrections_requested",
  "paid",
] as const;

export type ClientInvoiceStatus = (typeof CLIENT_INVOICE_STATUSES)[number];

export const CLIENT_INVOICE_STATUS_LABELS: Record<ClientInvoiceStatus, string> = {
  submitted: "Submitted",
  under_review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  corrections_requested: "Corrections requested",
  paid: "Paid",
};

export const CLIENT_INVOICE_STATUS_TONES: Record<
  ClientInvoiceStatus,
  "blue" | "teal" | "green" | "amber" | "red" | "slate" | "navy"
> = {
  submitted: "blue",
  under_review: "amber",
  approved: "teal",
  rejected: "red",
  corrections_requested: "red",
  paid: "green",
};

/** One invoice on the org's contracts, as seen by the client finance team. */
export type ClientInvoice = {
  id: string;
  workspaceId: string;
  workspaceTitle: string | null;
  workPackageId: string | null;
  workPackageName: string | null;
  invoiceNumber: string;
  title: string | null;
  amountCents: number;
  currency: string;
  status: ClientInvoiceStatus;
  dueDate: string | null;
  paidAt: string | null;
  reviewNotes: string | null;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  reviewedByEmail: string | null;
  supplierCompanyId: string | null;
  supplierCompanyName: string | null;
  createdAt: string;
};

export type ClientInvoiceDecision =
  | "approved"
  | "rejected"
  | "corrections_requested";

/** Approvals hub: pending items needing the client org's attention. */
export type ClientApprovals = {
  counts: {
    variations: number;
    invoices: number;
    milestones: number;
    documents: number;
    issues: number;
  };
  variations: ClientVariation[];
  invoices: ClientInvoice[];
  milestones: ClientMilestone[];
  documents: ClientDocument[];
  issues: ClientIssue[];
};


// ---------------------------------------------------------------------------
// Part C: messaging + notifications (client portal).
// ---------------------------------------------------------------------------
export const CLIENT_MESSAGE_THREAD_TYPES = [
  "general",
  "milestone",
  "document",
  "issue",
  "variation",
  "invoice",
  "report",
  "package",
] as const;
export type ClientMessageThreadType = (typeof CLIENT_MESSAGE_THREAD_TYPES)[number];
export const CLIENT_MESSAGE_THREAD_LABELS: Record<ClientMessageThreadType, string> = {
  general: "General",
  milestone: "Milestone",
  document: "Document",
  issue: "Issue",
  variation: "Variation",
  invoice: "Invoice",
  report: "Report",
  package: "Work package",
};
/** One message in a client<->lead contract thread. */
export type ClientMessage = {
  id: string;
  workspaceId: string;
  threadKey: string;
  threadType: ClientMessageThreadType;
  body: string;
  authorUserId: string;
  authorName: string | null;
  authorEmail: string;
  authorSide: "lead" | "client";
  createdAt: string;
  read: boolean; // whether the CURRENT user has read it (vs their watermark)
};
/** One conversation (thread) shown in the Messages inbox. */
export type ClientConversation = {
  workspaceId: string;
  workspaceTitle: string;
  leadName: string | null;
  leadEmail: string | null;
  leadCompany: string | null;
  threadKey: string;
  threadType: ClientMessageThreadType;
  entityId: string | null;
  entityTitle: string | null;
  lastBody: string | null;
  lastAuthorName: string | null;
  lastAuthorSide: "lead" | "client" | null;
  lastMessageAt: string | null;
  unread: number;
};
/** A full thread: header context + messages + the user's read watermark. */
export type ClientThread = {
  workspaceId: string;
  workspaceTitle: string;
  leadName: string | null;
  leadEmail: string | null;
  leadCompany: string | null;
  threadKey: string;
  threadType: ClientMessageThreadType;
  entityId: string | null;
  entityTitle: string | null;
  messages: ClientMessage[];
  lastReadAt: string | null;
  unread: number;
};
export const CLIENT_NOTIFICATION_TYPES = [
  "invitation",
  "approval_needed",
  "new_message",
  "milestone",
  "document",
  "issue",
  "variation",
  "invoice",
  "report",
  "system",
] as const;
export type ClientNotificationType = (typeof CLIENT_NOTIFICATION_TYPES)[number];
export const CLIENT_NOTIFICATION_TYPE_LABELS: Record<ClientNotificationType, string> = {
  invitation: "Invitation",
  approval_needed: "Approval needed",
  new_message: "New message",
  milestone: "Milestone",
  document: "Document",
  issue: "Issue",
  variation: "Variation",
  invoice: "Invoice",
  report: "Report",
  system: "System",
};
export const CLIENT_NOTIFICATION_TYPE_TONES: Record<
  ClientNotificationType,
  "blue" | "teal" | "green" | "amber" | "red" | "slate" | "navy"
> = {
  invitation: "navy",
  approval_needed: "amber",
  new_message: "blue",
  milestone: "teal",
  document: "slate",
  issue: "red",
  variation: "blue",
  invoice: "teal",
  report: "slate",
  system: "navy",
};
/** One row of the client notification inbox (scoped to the effective org). */
export type ClientNotification = {
  id: string;
  type: ClientNotificationType;
  title: string;
  body: string | null;
  link: string | null;
  workspaceId: string | null;
  workspaceTitle: string | null;
  read: boolean;
  createdAt: string;
};
