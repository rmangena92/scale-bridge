/**
 * Shared table for the Master Admin opportunity surfaces (Opportunities,
 * Upsell Opportunities, AI Insights). Each row is one company_services
 * relationship with Approve/Reject/Archive actions (audit-logged server-side).
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { listCatalogueOpportunities } from "~/lib/admin";
import type { CatalogueOpportunityRow } from "~/lib/services";
import {
  ConfidenceBadge,
  DecisionBadge,
  DecisionButtons,
  formatDate,
} from "./CatalogueBits";
import { Badge, Card, EmptyState, ErrorText } from "./ui";

export function OpportunityTable({
  scope,
  initial,
  loadError,
  adminCanMutate,
  showEvidence = false,
}: {
  scope: "open" | "ai" | "upsell";
  initial: CatalogueOpportunityRow[];
  loadError: string | null;
  adminCanMutate: boolean;
  showEvidence?: boolean;
}) {
  const [rows, setRows] = useState<CatalogueOpportunityRow[]>(initial);
  const [error, setError] = useState<string | null>(loadError);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const result = await listCatalogueOpportunities({ data: { scope } });
    if (result.ok) {
      setRows(result.opportunities);
      setError(null);
    } else {
      setError(result.error);
    }
  }

  async function handleDone(ok: boolean, err?: string) {
    if (!ok) {
      setError(err ?? "Could not record the decision.");
      return;
    }
    setError(null);
    setFlash("Decision recorded ✓");
    setBusy(true);
    await refresh();
    setBusy(false);
  }

  return (
    <div>
      {flash && (
        <p className="mb-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm font-medium text-success">
          {flash}
        </p>
      )}
      {error && (
        <div className="mb-4">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      <Card className="overflow-x-auto">
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="Nothing here yet"
              body="Rows appear here as the catalogue records AI discoveries and upsell recommendations."
            />
          </div>
        ) : (
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">Company</th>
                <th className="px-3 py-3">Service</th>
                <th className="px-3 py-3">Source</th>
                <th className="px-3 py-3">Confidence</th>
                <th className="px-3 py-3">Evidence</th>
                <th className="px-3 py-3">Decision</th>
                <th className="px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((o) => (
                <Row
                  key={o.id}
                  o={o}
                  scope={scope}
                  adminCanMutate={adminCanMutate}
                  busy={busy}
                  onDone={handleDone}
                  showEvidence={showEvidence}
                />
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function Row({
  o,
  scope,
  adminCanMutate,
  busy,
  onDone,
  showEvidence,
}: {
  o: CatalogueOpportunityRow;
  scope: "open" | "ai" | "upsell";
  adminCanMutate: boolean;
  busy: boolean;
  onDone: (ok: boolean, err?: string) => void;
  showEvidence: boolean;
}) {
  return (
    <>
      <tr className="align-top hover:bg-mist/60">
        <td className="px-5 py-3">
          <Link
            to="/admin/companies/$companyId"
            params={{ companyId: o.companyId }}
            search={{ notice: undefined }}
            className="font-semibold text-navy hover:text-brand"
          >
            {o.companyName}
          </Link>
          <p className="text-xs text-muted">{o.companyType ?? "—"}</p>
        </td>
        <td className="px-3 py-3">
          <Link
            to="/admin/services/$serviceId"
            params={{ serviceId: o.serviceId }}
            className="font-semibold text-navy hover:text-brand"
          >
            {o.serviceName}
          </Link>
          <p className="text-xs text-muted">{o.serviceCategory}</p>
        </td>
        <td className="px-3 py-3">
          <div className="flex flex-wrap gap-1">
            <Badge tone="slate">{o.source}</Badge>
            {scope === "open" && o.source === "AI discovery" && o.upsellRecommended && (
              <Badge tone="teal">Upsell</Badge>
            )}
          </div>
        </td>
        <td className="px-3 py-3">
          <ConfidenceBadge confidence={o.confidence} />
        </td>
        <td className="max-w-xs px-3 py-3">
          {o.evidenceSummary ? (
            <>
              <p className="text-xs text-ink">{o.evidenceSummary}</p>
              <p className="mt-0.5 text-[11px] text-muted">
                {o.evidenceCount} evidence row{o.evidenceCount === 1 ? "" : "s"} · found{" "}
                {formatDate(o.discoveredAt)}
              </p>
            </>
          ) : (
            <span className="text-xs text-muted">
              {o.evidenceCount} evidence row{o.evidenceCount === 1 ? "" : "s"} · no summary
            </span>
          )}
        </td>
        <td className="px-3 py-3">
          <DecisionBadge decision={o.adminDecision} />
        </td>
        <td className="px-5 py-3">
          {adminCanMutate ? (
            <DecisionButtons relationshipId={o.id} disabled={busy} onDone={onDone} />
          ) : (
            <span className="text-xs text-muted">Read-only</span>
          )}
        </td>
      </tr>
      {showEvidence && o.evidence.length > 0 && (
        <tr className="bg-mist/40">
          <td colSpan={7} className="px-5 py-3">
            <div className="flex flex-col gap-2">
              {o.evidence.map((e) => (
                <div key={e.id} className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
                  <p className="text-xs font-semibold text-ink">{e.title ?? "Untitled"}</p>
                  <p className="text-[11px] text-muted">
                    {e.evidenceType ?? "document"}
                    {e.agentVersion ? ` · agent v${e.agentVersion}` : ""}
                    {e.capturedAt ? ` · captured ${formatDate(e.capturedAt)}` : ""}
                  </p>
                  {e.sourceUrl && (
                    <a
                      href={e.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-0.5 block max-w-full truncate text-[11px] font-semibold text-brand hover:underline"
                    >
                      {e.sourceUrl}
                    </a>
                  )}
                  {e.excerpt && <p className="mt-1 text-xs text-ink">{e.excerpt}</p>}
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** Small summary strip used by page headers to reflect live catalogue state. */
export function OpportunitySummary({ total, label }: { total: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <Badge tone="navy">{total}</Badge>
      <span className="text-sm text-muted">{label}</span>
    </div>
  );
}
