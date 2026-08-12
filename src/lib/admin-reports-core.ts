/**
 * Master Admin Portal - Stage 4 (spec section 12 items 16): Financial and
 * subscription reports.
 *
 * Every figure on /admin/reports comes from live database queries executed
 * inside an asUser(admin.id, 'sb_admin', ...) transaction so Row Level
 * Security sees the admin role (all subscription tables allow sb_admin
 * selects). Nothing is hardcoded.
 *
 * Role gate: super_admin, operations and finance see the full report; any
 * other admin role (read_only, support, compliance) receives allowed:false
 * and the page renders a notice. The page is strictly read-only - there are
 * no mutations in this module.
 */
import { dbConfigured, asUser, ensureSchema } from "./db";
import { loadAdminUser } from "./auth-core";

const REPORT_ROLES = ["super_admin", "operations", "finance"] as const;

export type AdminReportsData = {
  // ---- subscription revenue (AED, from subscription_invoices) ----
  subInvoicesByStatus: { status: string; count: number; totalAel: number }[];
  subRevenueByPlan: {
    planCode: string | null;
    category: string | null;
    invoicedAel: number;
    paidAel: number;
    count: number;
  }[];
  subRevenueByMonth: { ym: string; count: number; totalAel: number }[];
  recentPaymentEvents: {
    eventType: string;
    amountAel: number | null;
    providerEventId: string | null;
    occurredAt: string;
    invoiceNumber: string | null;
  }[];
  // ---- contract invoice revenue (GBP, from invoices) ----
  contractInvoicesByStatus: { status: string; count: number; totalCents: number }[];
  contractInvoicesByMonth: { ym: string; count: number; totalCents: number }[];
  contractInvoicesTotal: { count: number; paidCents: number; outstandingCents: number };
  // ---- subscriptions ----
  subsByStatus: { status: string; count: number }[];
  activeSubsByPlan: { planCode: string | null; category: string | null; count: number }[];
  lifecycle: { changeType: string; count: number }[];
  requests: { kind: "upgrade" | "downgrade" | "cancellation"; status: string; count: number }[];
  commitments: { completed: boolean; count: number }[];
  commitmentOverrides: { status: string; count: number }[];
  pendingChanges: {
    id: string;
    status: string;
    billingInterval: string;
    planCode: string | null;
    companyName: string | null;
    accountEmail: string | null;
  }[];
  plans: {
    code: string;
    name: string;
    category: string;
    priceMonthlyAel: number | null;
    priceAnnualAel: number | null;
    status: string;
  }[];
  webhookByType: { provider: string; eventType: string; count: number }[];
  webhookTotals: { count: number; lastReceived: string | null };
};

export type AdminReportsResult =
  | { ok: true; allowed: true; data: AdminReportsData }
  | { ok: true; allowed: false; data: null }
  | { ok: false; error: string; setupRequired?: boolean };

function toNum(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "number" ? v : Number(v);
}

export async function doGetAdminReports(): Promise<AdminReportsResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };
    const allowed = admin.staffRoles.some((r) => (REPORT_ROLES as readonly string[]).includes(r));
    if (!allowed) return { ok: true, allowed: false, data: null };

    const rows = await asUser(admin.user.id, admin.user.role, (tx) => [
      // 1. subscription invoices by status
      tx`select status, count(*)::int as n, coalesce(sum(total_ael), 0)::numeric as total
         from subscription_invoices group by status order by status`,
      // 2. subscription revenue by plan (paid vs invoiced)
      tx`select p.code as plan_code, p.category as plan_category,
                count(*)::int as n,
                coalesce(sum(case when i.status = 'Paid' then i.total_ael else 0 end), 0)::numeric as paid,
                coalesce(sum(i.total_ael), 0)::numeric as invoiced
         from subscription_invoices i
         join subscriptions s on s.id = i.subscription_id
         left join membership_plans p on p.id = s.plan_id
         group by p.code, p.category order by p.category, p.code`,
      // 3. subscription revenue by month (Paid invoices, paid_at)
      tx`select to_char(i.paid_at, 'YYYY-MM') as ym, count(*)::int as n,
                coalesce(sum(i.total_ael), 0)::numeric as total
         from subscription_invoices i
         where i.status = 'Paid' and i.paid_at is not null
         group by 1 order by 1`,
      // 4. recent payment events (provider IDs)
      tx`select pe.event_type, pe.amount_ael, pe.provider_event_id, pe.occurred_at,
                si.invoice_number
         from payment_events pe
         left join subscription_invoices si on si.id = pe.invoice_id
         order by pe.occurred_at desc limit 25`,
      // 5. contract invoices by status (GBP)
      tx`select status, count(*)::int as n, coalesce(sum(amount_cents), 0)::bigint as cents
         from invoices group by status order by status`,
      // 6. contract invoices by month (created_at)
      tx`select to_char(created_at, 'YYYY-MM') as ym, count(*)::int as n,
                coalesce(sum(amount_cents), 0)::bigint as cents
         from invoices group by 1 order by 1`,
      // 7. subscriptions by status
      tx`select status, count(*)::int as n from subscriptions group by status order by status`,
      // 8. active subscriptions by plan
      tx`select p.code as plan_code, p.category as plan_category, count(*)::int as n
         from subscriptions s
         left join membership_plans p on p.id = s.plan_id
         where s.status = 'active'
         group by p.code, p.category order by p.category, p.code`,
      // 9. lifecycle change types (subscription_history)
      tx`select change_type, count(*)::int as n from subscription_history
         group by change_type order by change_type`,
      // 10. upgrade / downgrade / cancellation requests
      tx`select 'upgrade' as kind, status, count(*)::int as n from upgrade_requests group by status
         union all select 'downgrade', status, count(*) from downgrade_requests group by status
         union all select 'cancellation', status, count(*) from cancellation_requests group by status`,
      // 11. minimum commitments (in lock vs completed)
      tx`select completed, count(*)::int as n from minimum_commitments group by completed`,
      // 12. commitment overrides
      tx`select status, count(*)::int as n from commitment_overrides group by status order by status`,
      // 13. subscriptions with pending changes
      tx`select s.id, s.status, s.billing_interval,
                p.code as plan_code, co.name as company_name, u.email as account_email
         from subscriptions s
         left join membership_plans p on p.id = s.plan_id
         left join customers c on c.id = s.customer_id
         left join companies co on co.id = c.company_id
         left join users u on u.id = c.user_id
         where s.status in ('upgrade_pending','downgrade_scheduled',
                            'cancel_at_period_end','cancellation_requested',
                            'payment_pending','checkout_started')
         order by s.updated_at desc`,
      // 14. plan price table
      tx`select code, name, category, price_monthly_ael, price_annual_ael, status
         from membership_plans order by sort_order`,
      // 15. webhook events by provider + type
      tx`select provider, event_type, count(*)::int as n
         from billing_provider_webhook_events group by provider, event_type order by n desc`,
      // 16. webhook totals
      tx`select count(*)::int as n, max(received_at) as last_received
         from billing_provider_webhook_events`,
    ]);

    const r = (i: number) => rows[i] as readonly unknown[];

    const subInvoicesByStatus = (r(1) as { status: string; n: number; total: string }[]).map(
      (x) => ({ status: x.status, count: x.n, totalAel: toNum(x.total) }),
    );
    const subRevenueByPlan = (
      r(2) as {
        plan_code: string | null;
        plan_category: string | null;
        n: number;
        paid: string;
        invoiced: string;
      }[]
    ).map((x) => ({
      planCode: x.plan_code,
      category: x.plan_category,
      count: x.n,
      paidAel: toNum(x.paid),
      invoicedAel: toNum(x.invoiced),
    }));
    const subRevenueByMonth = (r(3) as { ym: string; n: number; total: string }[]).map((x) => ({
      ym: x.ym,
      count: x.n,
      totalAel: toNum(x.total),
    }));
    const recentPaymentEvents = (
      r(4) as {
        event_type: string;
        amount_ael: string | null;
        provider_event_id: string | null;
        occurred_at: string;
        invoice_number: string | null;
      }[]
    ).map((x) => ({
      eventType: x.event_type,
      amountAel: x.amount_ael === null ? null : toNum(x.amount_ael),
      providerEventId: x.provider_event_id,
      occurredAt: String(x.occurred_at),
      invoiceNumber: x.invoice_number,
    }));
    const contractInvoicesByStatus = (
      r(5) as { status: string; n: number; cents: number }[]
    ).map((x) => ({ status: x.status, count: x.n, totalCents: Number(x.cents) }));
    const contractInvoicesByMonth = (
      r(6) as { ym: string; n: number; cents: number }[]
    ).map((x) => ({ ym: x.ym, count: x.n, totalCents: Number(x.cents) }));
    const paidCents = contractInvoicesByStatus
      .filter((x) => x.status === "paid")
      .reduce((a, x) => a + x.totalCents, 0);
    const outstandingCents = contractInvoicesByStatus
      .filter((x) => !["paid", "cancelled", "rejected"].includes(x.status))
      .reduce((a, x) => a + x.totalCents, 0);
    const contractInvoicesTotal = {
      count: contractInvoicesByStatus.reduce((a, x) => a + x.count, 0),
      paidCents,
      outstandingCents,
    };
    const subsByStatus = (r(7) as { status: string; n: number }[]).map((x) => ({
      status: x.status,
      count: x.n,
    }));
    const activeSubsByPlan = (
      r(8) as { plan_code: string | null; plan_category: string | null; n: number }[]
    ).map((x) => ({ planCode: x.plan_code, category: x.plan_category, count: x.n }));
    const lifecycle = (r(9) as { change_type: string; n: number }[]).map((x) => ({
      changeType: x.change_type,
      count: x.n,
    }));
    const requests = (r(10) as { kind: "upgrade" | "downgrade" | "cancellation"; status: string; n: number }[]).map(
      (x) => ({ kind: x.kind, status: x.status, count: x.n }),
    );
    const commitments = (r(11) as { completed: boolean; n: number }[]).map((x) => ({
      completed: x.completed,
      count: x.n,
    }));
    const commitmentOverrides = (r(12) as { status: string; n: number }[]).map((x) => ({
      status: x.status,
      count: x.n,
    }));
    const pendingChanges = (
      r(13) as {
        id: string;
        status: string;
        billing_interval: string;
        plan_code: string | null;
        company_name: string | null;
        account_email: string | null;
      }[]
    ).map((x) => ({
      id: x.id,
      status: x.status,
      billingInterval: x.billing_interval,
      planCode: x.plan_code,
      companyName: x.company_name,
      accountEmail: x.account_email,
    }));
    const plans = (
      r(14) as {
        code: string;
        name: string;
        category: string;
        price_monthly_ael: string | null;
        price_annual_ael: string | null;
        status: string;
      }[]
    ).map((x) => ({
      code: x.code,
      name: x.name,
      category: x.category,
      priceMonthlyAel: x.price_monthly_ael === null ? null : toNum(x.price_monthly_ael),
      priceAnnualAel: x.price_annual_ael === null ? null : toNum(x.price_annual_ael),
      status: x.status,
    }));
    const webhookByType = (
      r(15) as { provider: string; event_type: string; n: number }[]
    ).map((x) => ({ provider: x.provider, eventType: x.event_type, count: x.n }));
    const whTotal = (r(16) as { n: number; last_received: string | null }[])[0];

    return {
      ok: true,
      allowed: true,
      data: {
        subInvoicesByStatus,
        subRevenueByPlan,
        subRevenueByMonth,
        recentPaymentEvents,
        contractInvoicesByStatus,
        contractInvoicesByMonth,
        contractInvoicesTotal,
        subsByStatus,
        activeSubsByPlan,
        lifecycle,
        requests,
        commitments,
        commitmentOverrides,
        pendingChanges,
        plans,
        webhookByType,
        webhookTotals: {
          count: whTotal?.n ?? 0,
          lastReceived: whTotal?.last_received ? String(whTotal.last_received) : null,
        },
      },
    };
  } catch (err) {
    console.error("getAdminReports failed:", err);
    return { ok: false, error: "Could not load the reports." };
  }
}
