import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { getAdminSession, listAdminCompanies } from "~/lib/admin";
import { COMPANY_STATUS_LABELS, COMPANY_STATUSES } from "~/lib/types";
import type { AdminCompanySummary } from "~/lib/types";
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

export const Route = createFileRoute("/admin/companies/")({
  loader: async () => {
    const session = await getAdminSession();
    const result = await listAdminCompanies({ data: { query: "", status: "" } });
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      initial: result.ok ? result.companies : [],
      loadError: result.ok ? null : result.error,
    };
  },
  component: CompaniesPage,
});

const statusTones: Record<string, "green" | "red" | "amber" | "slate" | "blue" | "teal"> = {
  verified: "green",
  unverified: "slate",
  pending: "amber",
  draft: "slate",
  registered: "blue",
  documents_pending: "amber",
  under_review: "amber",
  rejected: "red",
  suspended: "red",
  archived: "slate",
};

function CompaniesPage() {
  const loader = Route.useLoaderData();
  const [companies, setCompanies] = useState<AdminCompanySummary[]>(loader.initial);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(loader.loadError);
  const [pending, setPending] = useState(false);

  if (loader.setupRequired) {
    return (
      <DbSetupPage title="Company management">
        Connect a Postgres database (DATABASE_URL) to manage companies.
      </DbSetupPage>
    );
  }
  if (!loader.admin) return null;

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await listAdminCompanies({ data: { query, status } });
    setPending(false);
    if (result.ok) {
      setCompanies(result.companies);
    } else {
      setError(result.error);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">
          Companies
        </p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Company management</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Search every registered company, review profiles and manage
          verification and account status.
        </p>
      </div>

      <Card className="p-5">
        <form onSubmit={onSearch} className="flex flex-wrap items-end gap-3">
          <div className="min-w-52 flex-1">
            <Field label="Search" htmlFor="company-search">
              <Input
                id="company-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Company name or owner email…"
              />
            </Field>
          </div>
          <div className="w-52">
            <Field label="Status" htmlFor="company-status">
              <Select
                id="company-status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">All statuses</option>
                {COMPANY_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {COMPANY_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Searching…" : "Search"}
          </Button>
        </form>
      </Card>

      {error && (
        <div className="mt-5">
          <ErrorText>{error}</ErrorText>
        </div>
      )}

      <Card className="mt-5 overflow-x-auto">
        {companies.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No companies found"
              body="Try a different search term or clear the filters."
            />
          </div>
        ) : (
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">Company</th>
                <th className="px-3 py-3">Industry</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Owner</th>
                <th className="px-5 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {companies.map((c) => (
                <tr key={c.id} className="hover:bg-mist/60">
                  <td className="px-5 py-3">
                    <Link
                      to="/admin/companies/$companyId"
                      params={{ companyId: c.id }}
                      className="font-semibold text-navy hover:text-brand"
                    >
                      {c.name}
                    </Link>
                    <p className="text-xs text-muted">{c.type ?? "—"}</p>
                  </td>
                  <td className="px-3 py-3 text-muted">{c.type ?? "—"}</td>
                  <td className="px-3 py-3">
                    <Badge tone={statusTones[c.verificationStatus] ?? "slate"}>
                      {COMPANY_STATUS_LABELS[c.verificationStatus]}
                    </Badge>
                  </td>
                  <td className="px-3 py-3 text-muted">{c.ownerEmail ?? "—"}</td>
                  <td className="px-5 py-3 text-xs text-muted">
                    {new Date(c.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
