import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { getClientSession, listClientInvoices, resolveClientOrg } from "~/lib/client";
import type { ClientInvoice } from "~/lib/types";
import {
  CLIENT_INVOICE_STATUS_LABELS,
  CLIENT_INVOICE_STATUS_TONES,
} from "~/lib/types";
import { Badge, Card, DbSetupPage, EmptyState, ErrorText, Select } from "~/components/ui";
import { canReview, fmtDate, fmtMoneyCents, InvoiceReviewForm, isPending } from "~/components/client-review";
import { useClientPortal } from "~/components/ClientShell";

export const Route = createFileRoute("/client/invoices")({
  validateSearch: (search: Record<string, unknown>) => ({
    org: typeof search.org === "string" ? search.org : undefined,
    review: typeof search.review === "string" ? search.review : undefined,
  }),
  loaderDeps: ({ search }) => ({ org: search.org }),
  loader: async ({ deps }) => {
    const session = await getClientSession();
    if (!session.client) {
      return { setupRequired: session.setupRequired, orgId: null, invoices: [], loadError: null };
    }
    const org = resolveClientOrg(session.client, deps.org);
    const result = await listClientInvoices({ data: { orgId: org.orgId } });
    return {
      setupRequired: session.setupRequired,
      orgId: org.orgId,
      invoices: result.ok ? result.data : [],
      loadError: result.ok ? null : result.error,
    };
  },
  component: InvoicesPage,
});

function InvoicesPage() {
  const { setupRequired, orgId, invoices: initial, loadError } = Route.useLoaderData();
  const { org } = useClientPortal();
  const [invoices, setInvoices] = useState<ClientInvoice[]>(initial);
  const [ws, setWs] = useState("all");
  const [openId, setOpenId] = useState<string | null>(Route.useSearch().review ?? null);
  const [notice, setNotice] = useState<string | null>(null);

  const workspaces = useMemo(() => {
    const seen = new Map<string, string | null>();
    for (const i of invoices) {
      if (!seen.has(i.workspaceId)) seen.set(i.workspaceId, i.workspaceTitle);
    }
    return [...seen.entries()].map(([workspaceId, title]) => ({ workspaceId, title }));
  }, [invoices]);

  const visible = ws === "all" ? invoices : invoices.filter((i) => i.workspaceId === ws);
  const canAct = canReview(org.role, "invoice");

  if (setupRequired) {
    return (
      <DbSetupPage title="Invoices">
        Connect a Postgres database (DATABASE_URL) to view invoices.
      </DbSetupPage>
    );
  }
  if (!orgId) return null;
  if (loadError) {
    return (
      <div>
        <ErrorText>{loadError}</ErrorText>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-teal">Invoices</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Invoices</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Review submitted invoices, approve them for payment or send them back for
            corrections.
          </p>
        </div>
        {workspaces.length > 1 && (
          <Select className="w-64" value={ws} onChange={(e) => setWs(e.target.value)} aria-label="Filter by contract">
            <option value="all">All contracts</option>
            {workspaces.map((w) => (
              <option key={w.workspaceId} value={w.workspaceId}>
                {w.title ?? "Contract"}
              </option>
            ))}
          </Select>
        )}
      </div>

      {notice && (
        <div className="mb-6 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm font-medium text-success">
          {notice}
          <button
            type="button"
            className="ml-3 font-semibold underline-offset-2 hover:underline"
            onClick={() => setNotice(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState
          title="No invoices yet"
          body="Invoices submitted by participating companies will appear here for finance review."
        />
      ) : (
        <Card className="divide-y divide-slate-100 p-0">
          {visible.map((i) => {
            const pending = isPending("invoice", i.status);
            const open = openId === i.id;
            return (
              <div key={i.id} className="px-6 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-navy">
                      {i.invoiceNumber}
                      {i.title ? ` · ${i.title}` : ""}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                      <span>{i.workspaceTitle ?? "Contract"}</span>
                      {i.supplierCompanyName && <span>{i.supplierCompanyName}</span>}
                      <span>Due {fmtDate(i.dueDate)}</span>
                      {i.reviewedByEmail && <span>Reviewed by {i.reviewedByEmail}</span>}
                    </p>
                    {i.reviewNotes && (
                      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
                        Notes: {i.reviewNotes}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-bold text-ink">
                      {fmtMoneyCents(i.amountCents, i.currency)}
                    </span>
                    <Badge tone={CLIENT_INVOICE_STATUS_TONES[i.status]}>
                      {CLIENT_INVOICE_STATUS_LABELS[i.status]}
                    </Badge>
                    {pending && canAct && (
                      <button
                        type="button"
                        onClick={() => setOpenId(open ? null : i.id)}
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-navy transition-colors hover:border-brand hover:text-brand"
                      >
                        {open ? "Close review" : "Review"}
                      </button>
                    )}
                  </div>
                </div>
                {open && pending && (
                  <div className="mt-3">
                    <InvoiceReviewForm
                      orgId={orgId}
                      invoice={i}
                      onCancel={() => setOpenId(null)}
                      onSuccess={(decision) => {
                        setInvoices((prev) =>
                          prev.map((x) =>
                            x.id === i.id ? { ...x, status: decision } : x,
                          ),
                        );
                        setOpenId(null);
                        setNotice(
                          `${i.invoiceNumber} — ${
                            decision === "approved"
                              ? "approved for payment"
                              : decision === "rejected"
                                ? "rejected"
                                : "corrections requested"
                          }.`,
                        );
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}

      <p className="mt-4 text-xs text-muted">
        Invoices relate to{" "}
        <Link to="/client/contracts" search={{ org: orgId }} className="font-semibold text-brand hover:underline">
          your contracts
        </Link>
        .
      </p>
    </div>
  );
}
