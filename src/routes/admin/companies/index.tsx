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
    const result = await listAdminCompanies({
      data: {
        query: "",
        status: "",
        industry: "",
        activeStatus: "",
        participation: "",
        membershipPlan: "",
        subscriptionStatus: "",
      },
    });
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      initial: result.ok ? result.companies : [],
      industries: result.ok ? result.industries : [],
      plans: result.ok ? result.plans : [],
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

/** Subscription statuses mirrored from the backend 13-status state machine. */
const SUB_STATUSES = [
  "pending_plan_selection",
  "checkout_started",
  "payment_pending",
  "active",
  "past_due",
  "payment_failed",
  "upgrade_pending",
  "downgrade_scheduled",
  "cancellation_requested",
  "cancel_at_period_end",
  "cancelled",
  "expired",
  "suspended",
];
const SUB_STATUS_LABELS: Record<string, string> = {
  pending_plan_selection: "Pending Plan Selection",
  checkout_started: "Checkout Started",
  payment_pending: "Payment Pending",
  active: "Active",
  past_due: "Past Due",
  payment_failed: "Payment Failed",
  upgrade_pending: "Upgrade Pending",
  downgrade_scheduled: "Downgrade Scheduled",
  cancellation_requested: "Cancellation Requested",
  cancel_at_period_end: "Cancel at Period End",
  cancelled: "Cancelled",
  expired: "Expired",
  suspended: "Suspended",
};

const subTones: Record<string, "green" | "red" | "amber" | "slate" | "blue" | "teal"> = {
  active: "green",
  pending_plan_selection: "amber",
  checkout_started: "blue",
  payment_pending: "amber",
  past_due: "amber",
  payment_failed: "red",
  upgrade_pending: "blue",
  downgrade_scheduled: "amber",
  cancellation_requested: "amber",
  cancel_at_period_end: "amber",
  cancelled: "red",
  expired: "slate",
  suspended: "red",
};

const healthTones: Record<string, "green" | "red" | "amber" | "slate" | "blue" | "teal"> = {
  Good: "green",
  Attention: "amber",
  "At risk": "red",
  Onboarding: "slate",
};

function accountHealth(c: AdminCompanySummary): string {
  if (["suspended", "rejected", "archived"].includes(c.verificationStatus)) return "At risk";
  const st = c.subscriptionStatus;
  if (st === "payment_failed" || st === "past_due" || st === "cancelled" || st === "expired" || st === "suspended")
    return "Attention";
  if (st === "active") return "Good";
  return "Onboarding";
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

/** Disabled filter — no source data for this column yet. */
function DisabledFilter({ label, value }: { label: string; value: string }) {
  return (
    <div className="w-44" title="No source data for this filter yet">
      <Field label={label}>
        <div className="relative">
          <Input value={value} readOnly disabled aria-disabled="true" />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted">
            ⓘ
          </span>
        </div>
      </Field>
    </div>
  );
}

function CompaniesPage() {
  const loader = Route.useLoaderData();
  const [companies, setCompanies] = useState<AdminCompanySummary[]>(loader.initial);
  const [industries, setIndustries] = useState<string[]>(loader.industries);
  const [plans] = useState(loader.plans);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [industry, setIndustry] = useState("");
  const [activeStatus, setActiveStatus] = useState("");
  const [participation, setParticipation] = useState("");
  const [membershipPlan, setMembershipPlan] = useState("");
  const [subscriptionStatus, setSubscriptionStatus] = useState("");
  const [error, setError] = useState<string | null>(loader.loadError);
  const [pending, setPending] = useState(false);

  if (loader.setupRequired) {
    return (
      <DbSetupPage title="Company directory">
        Connect a Postgres database (DATABASE_URL) to manage companies.
      </DbSetupPage>
    );
  }
  if (!loader.admin) return null;

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await listAdminCompanies({
      data: { query, status, industry, activeStatus, participation, membershipPlan, subscriptionStatus },
    });
    setPending(false);
    if (result.ok) {
      setCompanies(result.companies);
      setIndustries(result.industries);
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
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Master company directory</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Search and filter every registered company — membership, subscription,
          verification and account health included. Location data has no source
          column yet, so it shows as — until the schema lands.
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
          <div className="w-48">
            <Field label="Verification status" htmlFor="company-status">
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
          <div className="w-48">
            <Field label="Industry" htmlFor="company-industry">
              <Select
                id="company-industry"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
              >
                <option value="">All industries</option>
                {industries.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="w-48">
            <Field label="Membership plan" htmlFor="company-plan">
              <Select
                id="company-plan"
                value={membershipPlan}
                onChange={(e) => setMembershipPlan(e.target.value)}
              >
                <option value="">All plans</option>
                {plans.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="w-48">
            <Field label="Subscription status" htmlFor="company-sub-status">
              <Select
                id="company-sub-status"
                value={subscriptionStatus}
                onChange={(e) => setSubscriptionStatus(e.target.value)}
              >
                <option value="">All</option>
                {SUB_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {SUB_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="w-44">
            <Field label="Active status" htmlFor="company-active">
              <Select
                id="company-active"
                value={activeStatus}
                onChange={(e) => setActiveStatus(e.target.value)}
              >
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="inactive">Suspended / rejected / archived</option>
              </Select>
            </Field>
          </div>
          <div className="w-44">
            <Field label="Contract participation" htmlFor="company-participation">
              <Select
                id="company-participation"
                value={participation}
                onChange={(e) => setParticipation(e.target.value)}
              >
                <option value="">Any</option>
                <option value="active">Active contracts</option>
                <option value="any">Any contract</option>
                <option value="none">No contracts</option>
              </Select>
            </Field>
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Searching…" : "Search"}
          </Button>
        </form>
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
          <DisabledFilter label="Location" value="—" />
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
              title="No companies found"
              body="Try a different search term or clear the filters."
            />
          </div>
        ) : (
          <table className="w-full min-w-[1150px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">Company</th>
                <th className="px-3 py-3">Industry</th>
                <th className="px-3 py-3">Verification</th>
                <th className="px-3 py-3">Membership plan</th>
                <th className="px-3 py-3">Subscription</th>
                <th className="px-3 py-3">Location</th>
                <th className="px-3 py-3">Active contracts</th>
                <th className="px-3 py-3">Active workspaces</th>
                <th className="px-3 py-3">Account health</th>
                <th className="px-3 py-3">Last activity</th>
                <th className="px-5 py-3">Owner</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {companies.map((c) => (
                <tr key={c.id} className="hover:bg-mist/60 align-top">
                  <td className="px-5 py-3">
                    <Link
                      to="/admin/companies/$companyId"
                      params={{ companyId: c.id }}
                      search={{ notice: undefined }}
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
                  <td className="px-3 py-3 font-medium text-navy">{c.membershipPlan ?? "—"}</td>
                  <td className="px-3 py-3">
                    {c.subscriptionStatus ? (
                      <Badge tone={subTones[c.subscriptionStatus] ?? "slate"}>
                        {SUB_STATUS_LABELS[c.subscriptionStatus] ?? c.subscriptionStatus}
                      </Badge>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-muted">{c.location ?? "—"}</td>
                  <td className="px-3 py-3">
                    {c.contractsCount === 0 ? (
                      <span className="text-xs text-muted">No contracts</span>
                    ) : (
                      <span className="text-xs">
                        <span className="font-semibold text-navy">{c.contractsCount}</span>
                        <span className="text-muted">
                          {" "}
                          contract{c.contractsCount === 1 ? "" : "s"}
                        </span>
                        {c.activeContractsCount > 0 && (
                          <>
                            {" "}
                            · <span className="font-semibold text-success">{c.activeContractsCount} active</span>
                          </>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-muted">{c.activeWorkspacesCount}</td>
                  <td className="px-3 py-3">
                    <Badge tone={healthTones[accountHealth(c)] ?? "slate"}>{accountHealth(c)}</Badge>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted">{fmtDate(c.lastActivity)}</td>
                  <td className="px-5 py-3 text-muted">{c.ownerEmail ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
