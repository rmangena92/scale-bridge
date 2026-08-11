/**
 * Client-safe catalogue enums. These are plain consts/types with no server
 * imports — importing a VALUE from src/lib/services.ts into a client module
 * drags the postgres.js driver into the client bundle, so pages must import
 * SERVICE_STATUSES from here, not from services.ts.
 */
export const SERVICE_STATUSES = [
  "Listed",
  "Pending Review",
  "Verified",
  "AI Suggested",
  "Client Intake Suggested",
  "Rejected",
  "Archived",
] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];
