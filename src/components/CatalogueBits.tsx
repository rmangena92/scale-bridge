/**
 * Shared catalogue UI bits for the Master Admin Portal — status/decision
 * badges and the Approve/Reject/Archive action row for company_services
 * relationships. Client-safe (only imports ./ui and ./admin wrapper fns).
 */
import { useState } from "react";
import { setCompanyServiceDecision } from "~/lib/admin";
import type { AdminDecision } from "~/lib/services";
import { Badge, Button } from "./ui";

export const SERVICE_STATUS_TONES: Record<string, "green" | "amber" | "blue" | "teal" | "red" | "slate" | "navy"> = {
  Listed: "blue",
  "Pending Review": "amber",
  Verified: "green",
  "AI Suggested": "teal",
  "Client Intake Suggested": "teal",
  Rejected: "red",
  Archived: "slate",
};

export const DECISION_TONES: Record<string, "green" | "red" | "slate"> = {
  Approved: "green",
  Rejected: "red",
  Archived: "slate",
};

export const VERIFICATION_TONES: Record<string, "green" | "amber" | "red"> = {
  Verified: "green",
  Pending: "amber",
  Rejected: "red",
};

export const CONFIDENCE_TONES: Record<string, "green" | "blue" | "amber" | "slate"> = {
  High: "green",
  Medium: "blue",
  Low: "amber",
  "Requires manual review": "slate",
};

export function ServiceStatusBadge({ status }: { status: string }) {
  return <Badge tone={SERVICE_STATUS_TONES[status] ?? "slate"}>{status}</Badge>;
}

export function DecisionBadge({ decision }: { decision: AdminDecision | string | null }) {
  if (!decision) return <Badge tone="slate">Open</Badge>;
  return <Badge tone={DECISION_TONES[decision] ?? "slate"}>{decision}</Badge>;
}

export function VerificationBadge({ status }: { status: string }) {
  return <Badge tone={VERIFICATION_TONES[status] ?? "amber"}>{status}</Badge>;
}

export function ConfidenceBadge({ confidence }: { confidence: string }) {
  return <Badge tone={CONFIDENCE_TONES[confidence] ?? "slate"}>{confidence}</Badge>;
}

/** Approve / Reject / Archive actions for one company_services row. */
export function DecisionButtons({
  relationshipId,
  disabled,
  onDone,
  allowArchive = true,
}: {
  relationshipId: string;
  disabled?: boolean;
  onDone: (ok: boolean, error?: string) => void;
  allowArchive?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  async function decide(adminDecision: AdminDecision) {
    if (busy) return;
    setBusy(true);
    const result = await setCompanyServiceDecision({
      data: { companyServiceId: relationshipId, adminDecision },
    });
    setBusy(false);
    onDone(result.ok, result.ok ? undefined : result.error);
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" onClick={() => decide("Approved")} disabled={disabled || busy}>
        Approve
      </Button>
      <Button size="sm" variant="outline" onClick={() => decide("Rejected")} disabled={disabled || busy}>
        Reject
      </Button>
      {allowArchive && (
        <Button size="sm" variant="ghost" onClick={() => decide("Archived")} disabled={disabled || busy}>
          Archive
        </Button>
      )}
    </div>
  );
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
