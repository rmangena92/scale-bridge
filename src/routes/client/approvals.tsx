import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { getClientApprovals, getClientSession, resolveClientOrg } from "~/lib/client";
import type { ClientApprovals, ClientDocument, ClientInvoice, ClientIssue, ClientMilestone, ClientVariation } from "~/lib/types";
import {
  CLIENT_DOCUMENT_STATUS_LABELS,
  CLIENT_DOCUMENT_STATUS_TONES,
  CLIENT_INVOICE_STATUS_LABELS,
  CLIENT_INVOICE_STATUS_TONES,
  CLIENT_ISSUE_SEVERITY_LABELS,
  CLIENT_ISSUE_STATUS_LABELS,
  CLIENT_ISSUE_STATUS_TONES,
  CLIENT_MILESTONE_STATUS_LABELS,
  CLIENT_MILESTONE_STATUS_TONES,
  CLIENT_VARIATION_STATUS_LABELS,
  CLIENT_VARIATION_STATUS_TONES,
} from "~/lib/types";
import { Badge, Card, DbSetupPage, EmptyState, ErrorText } from "~/components/ui";
import {
  canReview,
  DocumentReviewForm,
  fmtDate,
  fmtDateTime,
  fmtMoneyCents,
  InvoiceReviewForm,
  MilestoneReviewForm,
  VariationReviewForm,
} from "~/components/client-review";
import { useClientPortal } from "~/components/ClientShell";

export const Route = createFileRoute("/client/approvals")({
  validateSearch: (search: Record<string, unknown>) => ({
    org: typeof search.org === "string" ? search.org : undefined,
  }),
  loaderDeps: ({ search }) => ({ org: search.org }),
  loader: async ({ deps }) => {
    const session = await getClientSession();
    if (!session.client) {
      return { setupRequired: session.setupRequired, orgId: null, approvals: null, loadError: null };
    }
    const org = resolveClientOrg(session.client, deps.org);
    const result = await getClientApprovals({ data: { orgId: org.orgId } });
    return {
      setupRequired: session.setupRequired,
      orgId: org.orgId,
      approvals: result.ok ? result.data : null,
      loadError: result.ok ? null : result.error,
    };
  },
  component: ApprovalsPage,
});

type SectionKey = "variations" | "invoices" | "milestones" | "documents" | "issues";

const SECTION_META: Record<
  SectionKey,
  { label: string; to: string; blurb: string; tone: "amber" | "red" | "blue" | "teal" | "green" }
> = {
  variations: { label: "Variations", to: "/client/variations", blurb: "Scope or price changes awaiting your decision", tone: "amber" },
  invoices: { label: "Invoices", to: "/client/invoices", blurb: "Submitted invoices under review", tone: "amber" },
  milestones: { label: "Milestones", to: "/client/milestones", blurb: "Delivery milestones submitted for sign-off", tone: "blue" },
  documents: { label: "Documents", to: "/client/documents", blurb: "Shared documents awaiting your review", tone: "teal" },
  issues: { label: "Issues", to: "/client/issues", blurb: "Open issues raised on your contracts", tone: "red" },
};

function ApprovalsPage() {
  const { setupRequired, orgId, approvals: initial, loadError } = Route.useLoaderData();
  const { org } = useClientPortal();
  const [approvals, setApprovals] = useState<ClientApprovals | null>(initial);
  const [openReview, setOpenReview] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refetching, setRefetching] = useState(false);

  const can = useMemo(
    () => ({
      variations: canReview(org.role, "variation"),
      invoices: canReview(org.role, "invoice"),
      milestones: canReview(org.role, "milestone"),
      documents: canReview(org.role, "document"),
      issues: canReview(org.role, "issue"),
    }),
    [org.role],
  );

  if (setupRequired) {
    return (
      <DbSetupPage title="Approvals">
        Connect a Postgres database (DATABASE_URL) to load your approval queue.
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
  if (!approvals) return null;

  async function refresh() {
    setRefetching(true);
    const r = await getClientApprovals({ data: { orgId } });
    if (r.ok) setApprovals(r.data);
    setRefetching(false);
  }

  function handleReviewed(message: string) {
    setOpenReview(null);
    setNotice(message);
    void refresh();
  }

  const total = Object.values(approvals.counts).reduce((a, b) => a + b, 0);

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">Approvals</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Approval queue</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Everything waiting on your organisation — review, approve or request changes without
          leaving this page.
        </p>
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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {(Object.keys(SECTION_META) as SectionKey[]).map((key) => (
          <Link key={key} to={SECTION_META[key].to} search={{ org: orgId }}>
            <Card className="p-4 transition-shadow hover:shadow-md">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wider text-muted">
                  {SECTION_META[key].label}
                </p>
                <Badge tone={approvals.counts[key] > 0 ? SECTION_META[key].tone : "slate"}>
                  {approvals.counts[key]}
                </Badge>
              </div>
              <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-muted">
                {SECTION_META[key].blurb}
              </p>
            </Card>
          </Link>
        ))}
      </div>

      {total === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="Nothing awaiting approval"
            body="When the lead contractor submits documents, milestones, variations or invoices for review, they will appear here."
          />
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-6">
          {approvals.variations.length > 0 && (
            <Section<ClientVariation>
              title="Variation requests"
              pending={approvals.variations}
              openId={openReview}
              canReview={can.variations}
              onToggle={setOpenReview}
              onReviewed={handleReviewed}
              renderMeta={(v) => (
                <>
                  {v.proposedAmountCents != null && (
                    <span className="text-xs font-semibold text-ink">
                      {fmtMoneyCents(v.proposedAmountCents)}
                    </span>
                  )}
                  <Badge tone={CLIENT_VARIATION_STATUS_TONES[v.status]}>
                    {CLIENT_VARIATION_STATUS_LABELS[v.status]}
                  </Badge>
                </>
              )}
              renderForm={(v, onDone) => (
                <VariationReviewForm
                  orgId={orgId}
                  variation={v}
                  onSuccess={(d) => onDone(`${v.title} — ${d === "approved" ? "approved" : d === "rejected" ? "rejected" : d === "conditions" ? "approved with conditions" : "clarification requested"}.`)}
                />
              )}
              keyOf={(v) => `variation:${v.id}`}
            />
          )}
          {approvals.invoices.length > 0 && (
            <Section<ClientInvoice>
              title="Invoices under review"
              pending={approvals.invoices}
              openId={openReview}
              canReview={can.invoices}
              onToggle={setOpenReview}
              onReviewed={handleReviewed}
              renderMeta={(i) => (
                <>
                  <span className="text-xs font-semibold text-ink">
                    {fmtMoneyCents(i.amountCents, i.currency)}
                  </span>
                  <Badge tone={CLIENT_INVOICE_STATUS_TONES[i.status]}>
                    {CLIENT_INVOICE_STATUS_LABELS[i.status]}
                  </Badge>
                </>
              )}
              renderForm={(i, onDone) => (
                <InvoiceReviewForm
                  orgId={orgId}
                  invoice={i}
                  onSuccess={(d) =>
                    onDone(
                      `${i.invoiceNumber} — ${d === "approved" ? "approved for payment" : d === "rejected" ? "rejected" : "corrections requested"}.`,
                    )
                  }
                />
              )}
              keyOf={(i) => `invoice:${i.id}`}
            />
          )}
          {approvals.milestones.length > 0 && (
            <Section<ClientMilestone>
              title="Milestones awaiting sign-off"
              pending={approvals.milestones}
              openId={openReview}
              canReview={can.milestones}
              onToggle={setOpenReview}
              onReviewed={handleReviewed}
              renderMeta={(m) => (
                <>
                  {m.dueDate && <span className="text-xs text-muted">Due {fmtDate(m.dueDate)}</span>}
                  <Badge tone={CLIENT_MILESTONE_STATUS_TONES[m.status]}>
                    {CLIENT_MILESTONE_STATUS_LABELS[m.status]}
                  </Badge>
                </>
              )}
              renderForm={(m, onDone) => (
                <MilestoneReviewForm
                  orgId={orgId}
                  milestone={m}
                  onSuccess={(d) =>
                    onDone(`${m.title} — ${d === "approved" ? "signed off" : "changes requested"}.`)
                  }
                />
              )}
              keyOf={(m) => `milestone:${m.id}`}
            />
          )}
          {approvals.documents.length > 0 && (
            <Section<ClientDocument>
              title="Documents awaiting review"
              pending={approvals.documents}
              openId={openReview}
              canReview={can.documents}
              onToggle={setOpenReview}
              onReviewed={handleReviewed}
              renderMeta={(d) => (
                <>
                  {d.category && (
                    <span className="text-xs text-muted">{d.category.replace("_", " ")}</span>
                  )}
                  <Badge tone={CLIENT_DOCUMENT_STATUS_TONES[d.status]}>
                    {CLIENT_DOCUMENT_STATUS_LABELS[d.status]}
                  </Badge>
                </>
              )}
              renderForm={(d, onDone) => (
                <DocumentReviewForm
                  orgId={orgId}
                  document={d}
                  onSuccess={(dec) =>
                    onDone(`${d.title} — ${dec === "approved" ? "approved" : "changes requested"}.`)
                  }
                />
              )}
              keyOf={(d) => `document:${d.id}`}
            />
          )}
          {approvals.issues.length > 0 && (
            <Section<ClientIssue>
              title="Open issues"
              pending={approvals.issues}
              openId={openReview}
              canReview={can.issues}
              onToggle={setOpenReview}
              onReviewed={handleReviewed}
              renderMeta={(i) => (
                <>
                  {i.severity && (
                    <Badge tone="navy">{CLIENT_ISSUE_SEVERITY_LABELS[i.severity]}</Badge>
                  )}
                  <Badge tone={CLIENT_ISSUE_STATUS_TONES[i.status]}>
                    {CLIENT_ISSUE_STATUS_LABELS[i.status]}
                  </Badge>
                </>
              )}
              renderForm={() => (
                <div className="mt-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-muted">
                  Open issues are tracked on the{" "}
                  <Link to="/client/issues" search={{ org: orgId }} className="font-semibold text-brand hover:underline">
                    Issues
                  </Link>{" "}
                  page — follow up with the lead contractor there.
                </div>
              )}
              keyOf={(i) => `issue:${i.id}`}
            />
          )}
          {refetching && <p className="text-xs text-muted">Refreshing…</p>}
        </div>
      )}
    </div>
  );
}

function Section<T extends { id: string; workspaceTitle: string | null; title: string | null; createdAt: string }>({
  title,
  pending,
  openId,
  canReview,
  onToggle,
  onReviewed,
  renderMeta,
  renderForm,
  keyOf,
}: {
  title: string;
  pending: T[];
  openId: string | null;
  canReview: boolean;
  onToggle: (id: string | null) => void;
  onReviewed: (message: string) => void;
  renderMeta: (item: T) => React.ReactNode;
  renderForm: (item: T, onDone: (message: string) => void) => React.ReactNode;
  keyOf: (item: T) => string;
}) {
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{title}</h2>
        <Badge tone="navy">{pending.length}</Badge>
      </div>
      <ul className="mt-3 divide-y divide-slate-100">
        {pending.map((item) => {
          const key = keyOf(item);
          const open = openId === key;
          return (
            <li key={key} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{item.title}</p>
                  <p className="truncate text-xs text-muted">
                    {item.workspaceTitle ?? "Contract"} · {fmtDateTime(item.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {renderMeta(item)}
                  {canReview ? (
                    <button
                      type="button"
                      onClick={() => onToggle(open ? null : key)}
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-navy transition-colors hover:border-brand hover:text-brand"
                    >
                      {open ? "Close" : "Review"}
                    </button>
                  ) : (
                    <Badge tone="slate">Read-only</Badge>
                  )}
                </div>
              </div>
              {open && renderForm(item, onReviewed)}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

