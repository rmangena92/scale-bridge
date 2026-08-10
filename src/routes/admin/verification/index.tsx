import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { getAdminSession, listVerificationQueue } from "~/lib/admin";
import { COMPANY_STATUS_LABELS } from "~/lib/types";
import type { AdminVerificationCompany } from "~/lib/types";
import { Badge, Button, Card, DbSetupPage, EmptyState, ErrorText, Field, Select } from "~/components/ui";

export const Route = createFileRoute("/admin/verification/")({
  loader: async () => {
    const session = await getAdminSession();
    const result = await listVerificationQueue({ data: { status: "" } });
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      initial: result.ok ? result.companies : [],
      loadError: result.ok ? null : result.error,
    };
  },
  component: VerificationQueuePage,
});

const statusTones: Record<string, "amber" | "blue" | "green" | "red" | "slate"> = {
  documents_pending: "amber",
  under_review: "blue",
  verified: "green",
  rejected: "red",
  suspended: "red",
};

function VerificationQueuePage() {
  const loader = Route.useLoaderData();
  const [companies, setCompanies] = useState<AdminVerificationCompany[]>(loader.initial);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(loader.loadError);
  const [pending, setPending] = useState(false);

  if (loader.setupRequired) {
    return (
      <DbSetupPage title="Verification queue">
        Connect a Postgres database (DATABASE_URL) to review company verification.
      </DbSetupPage>
    );
  }
  if (!loader.admin) return null;

  async function onSearch() {
    setPending(true);
    setError(null);
    const result = await listVerificationQueue({ data: { status } });
    setPending(false);
    if (result.ok) setCompanies(result.companies);
    else setError(result.error);
  }

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">Verification</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Company verification queue</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Companies awaiting document review and verification. Open a company to review its
          uploaded documents, approve or reject them, and move the company through the
          verification workflow.
        </p>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Field label="Queue stage" htmlFor="vq-status">
              <Select id="vq-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All in queue</option>
                <option value="documents_pending">Documents pending</option>
                <option value="under_review">Under review</option>
              </Select>
            </Field>
          </div>
          <Button onClick={onSearch} disabled={pending}>
            {pending ? "Loading…" : "Apply filter"}
          </Button>
        </div>
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
              title="Queue is clear"
              body="No companies are currently awaiting verification. New document submissions appear here automatically."
            />
          </div>
        ) : (
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">Company</th>
                <th className="px-3 py-3">Type</th>
                <th className="px-3 py-3">Stage</th>
                <th className="px-3 py-3">Documents</th>
                <th className="px-3 py-3">Pending review</th>
                <th className="px-3 py-3">Expiring ≤90d</th>
                <th className="px-5 py-3">Owner</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {companies.map((c) => (
                <tr key={c.id} className="hover:bg-mist/60">
                  <td className="px-5 py-3">
                    <Link
                      to="/admin/verification/$companyId"
                      params={{ companyId: c.id }}
                      className="font-semibold text-navy hover:text-brand"
                    >
                      {c.name}
                    </Link>
                    <p className="text-xs text-muted">{c.ownerEmail}</p>
                  </td>
                  <td className="px-3 py-3 text-muted">{c.type ?? "—"}</td>
                  <td className="px-3 py-3">
                    <Badge tone={statusTones[c.verificationStatus] ?? "slate"}>
                      {COMPANY_STATUS_LABELS[c.verificationStatus]}
                    </Badge>
                  </td>
                  <td className="px-3 py-3">{c.documentCount}</td>
                  <td className="px-3 py-3">
                    {c.pendingDocumentCount > 0 ? (
                      <Badge tone="amber">{c.pendingDocumentCount} pending</Badge>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {c.expiringDocumentCount > 0 ? (
                      <Badge tone="red">{c.expiringDocumentCount}</Badge>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
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
