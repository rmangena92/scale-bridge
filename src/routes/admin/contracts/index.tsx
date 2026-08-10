import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { getAdminSession, listAdminContracts } from "~/lib/admin";
import {
  WORKSPACE_STATUSES,
  WORKSPACE_STATUS_LABELS,
  WORKSPACE_BADGE_TONES,
} from "~/lib/types";
import type { AdminContractSummary } from "~/lib/types";
import {
  Badge,
  Button,
  Card,
  DbSetupPage,
  EmptyState,
  ErrorText,
  Field,
  Input,
  Select,
} from "~/components/ui";

export const Route = createFileRoute("/admin/contracts/")({
  loader: async () => {
    const session = await getAdminSession();
    const result = await listAdminContracts({
      data: { status: "", industry: "", location: "", minValue: "", maxValue: "", lead: "", client: "" },
    });
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      initial: result.ok ? result.contracts : [],
      industries: result.ok ? result.industries : [],
      locations: result.ok ? result.locations : [],
      loadError: result.ok ? null : result.error,
    };
  },
  component: ContractsPage,
});

function fmtValue(v: number | null): string {
  return v === null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(v);
}

function ContractsPage() {
  const loader = Route.useLoaderData();
  const [contracts, setContracts] = useState<AdminContractSummary[]>(loader.initial);
  const [industries, setIndustries] = useState<string[]>(loader.industries);
  const [locations, setLocations] = useState<string[]>(loader.locations);
  const [status, setStatus] = useState("");
  const [industry, setIndustry] = useState("");
  const [location, setLocation] = useState("");
  const [minValue, setMinValue] = useState("");
  const [maxValue, setMaxValue] = useState("");
  const [lead, setLead] = useState("");
  const [client, setClient] = useState("");
  const [error, setError] = useState<string | null>(loader.loadError);
  const [pending, setPending] = useState(false);

  if (loader.setupRequired) {
    return (
      <DbSetupPage title="Contract administration">
        Connect a Postgres database (DATABASE_URL) to manage contracts.
      </DbSetupPage>
    );
  }
  if (!loader.admin) return null;

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await listAdminContracts({
      data: { status, industry, location, minValue, maxValue, lead, client },
    });
    setPending(false);
    if (result.ok) {
      setContracts(result.contracts);
      setIndustries(result.industries);
      setLocations(result.locations);
    } else {
      setError(result.error);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">Contracts</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Contract administration</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Every contract workspace on the platform. Filter by status, industry, location, value,
          lead contractor or client, then open a contract for the read-only administration view.
        </p>
      </div>

      <Card className="p-5">
        <form onSubmit={onSearch} className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Field label="Status" htmlFor="c-status">
              <Select id="c-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All statuses</option>
                {WORKSPACE_STATUSES.map((s) => (
                  <option key={s} value={s}>{WORKSPACE_STATUS_LABELS[s]}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="w-44">
            <Field label="Industry" htmlFor="c-industry">
              <Select id="c-industry" value={industry} onChange={(e) => setIndustry(e.target.value)}>
                <option value="">All industries</option>
                {industries.map((i) => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="w-44">
            <Field label="Location" htmlFor="c-location">
              <Select id="c-location" value={location} onChange={(e) => setLocation(e.target.value)}>
                <option value="">All locations</option>
                {locations.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="w-32">
            <Field label="Min value" htmlFor="c-min">
              <Input id="c-min" type="number" min="0" value={minValue} onChange={(e) => setMinValue(e.target.value)} placeholder="£" />
            </Field>
          </div>
          <div className="w-32">
            <Field label="Max value" htmlFor="c-max">
              <Input id="c-max" type="number" min="0" value={maxValue} onChange={(e) => setMaxValue(e.target.value)} placeholder="£" />
            </Field>
          </div>
          <div className="w-48">
            <Field label="Lead contractor" htmlFor="c-lead">
              <Input id="c-lead" value={lead} onChange={(e) => setLead(e.target.value)} placeholder="Name or email…" />
            </Field>
          </div>
          <div className="w-48">
            <Field label="Client" htmlFor="c-client">
              <Input id="c-client" value={client} onChange={(e) => setClient(e.target.value)} placeholder="Client organisation…" />
            </Field>
          </div>
          <Button type="submit" disabled={pending}>{pending ? "Searching…" : "Search"}</Button>
        </form>
      </Card>

      {error && (
        <div className="mt-5"><ErrorText>{error}</ErrorText></div>
      )}

      <Card className="mt-5 overflow-x-auto">
        {contracts.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No contracts found" body="Try clearing filters, or contracts appear here once lead contractors create workspaces." />
          </div>
        ) : (
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">Contract</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Industry</th>
                <th className="px-3 py-3">Location</th>
                <th className="px-3 py-3">Value</th>
                <th className="px-3 py-3">Lead contractor</th>
                <th className="px-3 py-3">Client</th>
                <th className="px-3 py-3">Packages</th>
                <th className="px-5 py-3">Participants</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {contracts.map((c) => (
                <tr key={c.id} className="hover:bg-mist/60">
                  <td className="px-5 py-3">
                    <Link
                      to="/admin/contracts/$workspaceId"
                      params={{ workspaceId: c.id }}
                      className="font-semibold text-navy hover:text-brand"
                    >
                      {c.title}
                    </Link>
                    {c.description && <p className="max-w-72 truncate text-xs text-muted">{c.description}</p>}
                  </td>
                  <td className="px-3 py-3">
                    <Badge tone={WORKSPACE_BADGE_TONES[c.status]}>{WORKSPACE_STATUS_LABELS[c.status]}</Badge>
                  </td>
                  <td className="px-3 py-3 text-muted">{c.industry ?? "—"}</td>
                  <td className="px-3 py-3 text-muted">{c.location ?? "—"}</td>
                  <td className="px-3 py-3 font-semibold">{fmtValue(c.contractValue)}</td>
                  <td className="px-3 py-3 text-muted">{c.leadName ?? c.leadEmail}</td>
                  <td className="px-3 py-3 text-muted">{c.clientNames.length > 0 ? c.clientNames.join(", ") : "—"}</td>
                  <td className="px-3 py-3">{c.packageCount}</td>
                  <td className="px-5 py-3">{c.participantCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
