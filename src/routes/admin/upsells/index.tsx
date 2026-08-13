import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  getAdminSession,
  listAdminUpsellOpportunities,
  UPSELL_MUTATE_ROLES,
  UPSELL_STATUS_LABELS,
  UPSELL_STATUS_TONES,
  UPSELL_STATUSES,
} from "~/lib/admin";
import type { UpsellListFilters, UpsellListRow } from "~/lib/admin";
import { Badge, Button, Card, DbSetupPage, EmptyState, ErrorText, Field, Input, Select } from "~/components/ui";

export const Route = createFileRoute("/admin/upsells/")({
  loader: async () => {
    const session = await getAdminSession();
    const result = await listAdminUpsellOpportunities({ data: { filters: {} } });
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      result: result as Awaited<ReturnType<typeof listAdminUpsellOpportunities>>,
    };
  },
  component: UpsellsPage,
});

function confidenceTone(c: string): "green" | "amber" | "red" | "slate" | "blue" | "teal" | "navy" {
  if (c === "High") return "green";
  if (c === "Medium") return "amber";
  if (c === "Low") return "red";
  return "slate";
}

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function UpsellsPage() {
  const loader = Route.useLoaderData();
  const [filters, setFilters] = useState<UpsellListFilters>({});
  const [data, setData] = useState(loader.result);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canMutate =
    !!loader.admin?.canMutate &&
    (loader.admin.staffRoles ?? []).some((r) =>
      (UPSELL_MUTATE_ROLES as readonly string[]).includes(r as never),
    );

  const rows = useMemo(() => (data.ok ? data.opportunities : []), [data]);
  const companies = useMemo(() => (data.ok ? data.companies : []), [data]);
  const services = useMemo(() => (data.ok ? data.services : []), [data]);

  if (loader.setupRequired) {
    return (
      <DbSetupPage title="Upsell Opportunities">
        Connect a Postgres database (DATABASE_URL) to view upsell opportunities.
      </DbSetupPage>
    );
  }
  if (!loader.admin) return null;

  const applyFilters = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await listAdminUpsellOpportunities({ data: { filters } });
      if (result.ok) setData(result);
      else setError(result.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load upsell opportunities.");
    } finally {
      setBusy(false);
    }
  };

  const resetFilters = async () => {
    setBusy(true);
    setError(null);
    setFilters({});
    try {
      const result = await listAdminUpsellOpportunities({ data: { filters: {} } });
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load upsell opportunities.");
    } finally {
      setBusy(false);
    }
  };

  const statusTone = (s: string) => UPSELL_STATUS_TONES[s as keyof typeof UPSELL_STATUS_TONES] ?? "slate";

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">Upsell Opportunities</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Upsell &amp; cross-sell workflow</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Evidence-backed Partnership Intelligence recommendations. Nothing is sent to a
          company until an operations, compliance or super_admin admin approves and sends it.
        </p>
      </div>

      <Card className="mb-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Status">
            <Select
              value={filters.status ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value || null }))}
            >
              <option value="">All statuses</option>
              {UPSELL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {UPSELL_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Company">
            <Select
              value={filters.companyId ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, companyId: e.target.value || null }))}
            >
              <option value="">All companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Suggested service">
            <Select
              value={filters.suggestedServiceId ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, suggestedServiceId: e.target.value || null }))}
            >
              <option value="">All services</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Confidence min (%)">
            <Input
              type="number"
              min={0}
              max={100}
              value={filters.minConfidence ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, minConfidence: e.target.value === "" ? null : Number(e.target.value) }))}
              placeholder="0"
            />
          </Field>
          <Field label="Confidence max (%)">
            <Input
              type="number"
              min={0}
              max={100}
              value={filters.maxConfidence ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, maxConfidence: e.target.value === "" ? null : Number(e.target.value) }))}
              placeholder="100"
            />
          </Field>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button variant="primary" onClick={applyFilters} disabled={busy}>
            {busy ? "Loading..." : "Apply filters"}
          </Button>
          <Button variant="ghost" onClick={resetFilters} disabled={busy}>
            Reset
          </Button>
          <span className="text-xs text-muted">
            {rows.length} opportunity{rows.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="mt-3">
          <ErrorText>{error}</ErrorText>
        </div>
      </Card>

      {!data.ok ? (
        <Card>
          <ErrorText>{data.error}</ErrorText>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No upsell opportunities"
            body="No opportunities match the current filters. Opportunities appear here when the AI Service Intelligence agent surfaces a human-review recommendation."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Suggested service</th>
                  <th className="px-4 py-3">Confidence</th>
                  <th className="px-4 py-3">Evidence</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((o: UpsellListRow) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        to="/admin/upsells/$opportunityId"
                        params={{ opportunityId: o.id }}
                        className="font-semibold text-blue hover:underline"
                      >
                        {o.companyName ?? "Unknown company"}
                      </Link>
                      {o.companyType ? (
                        <span className="block text-xs text-muted">{o.companyType}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium">{o.suggestedServiceName ?? "-"}</span>
                      {o.existingServiceName ? (
                        <span className="block text-xs text-muted">from {o.existingServiceName}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={confidenceTone(o.confidence)}>{o.confidence}</Badge>
                      <span className="ml-2 text-xs text-muted">{o.confidenceScore}%</span>
                    </td>
                    <td className="px-4 py-3 text-muted">{o.evidenceCount}</td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone(o.status)}>
                        {UPSELL_STATUS_LABELS[o.status as keyof typeof UPSELL_STATUS_LABELS] ?? o.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted">{o.ownerName ?? "-"}</td>
                    <td className="px-4 py-3 text-muted">{formatDate(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!canMutate && rows.length > 0 && (
        <p className="mt-4 text-xs text-muted">
          Read-only view. Status changes and approvals require an operations, compliance or
          super_admin staff role.
        </p>
      )}
    </div>
  );
}
