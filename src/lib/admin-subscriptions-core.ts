/**
 * Master Admin Portal — subscription / membership / entitlement reads
 * (server-only core; client-safe wrappers live in ./admin.ts).
 *
 * Read-only Stage 1 surfaces. All reads run as the authenticated sb_admin
 * (asUser(admin.user.id, "sb_admin", …)) so the RLS policies on the
 * subscription tables let the portal see every tenant while clients still see
 * only their own rows. No mutation workflows here — those arrive with the
 * Stage 3 manual upgrade/downgrade build.
 */
import { asUser, dbConfigured, ensureSchema } from "./db";
import { loadAdminUser } from "./auth-core";
import { STATUS_DISPLAY } from "./subscriptions";
import type { BillingInterval, EntitlementValue, SubscriptionStatus } from "./subscriptions";

// ------------------------------------------------------------- result types
export type AdminSubscriptionRow = {
  id: string;
  companyId: string | null;
  companyName: string | null;
  accountEmail: string | null;
  planId: string | null;
  planCode: string | null;
  planName: string | null;
  priceAel: number | null;
  billingInterval: BillingInterval;
  status: SubscriptionStatus;
  statusLabel: string;
  startedAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextBillingDate: string | null;
  commitmentStart: string | null;
  commitmentEnd: string | null;
  commitmentCompleted: boolean | null;
  downgradeEligibleDate: string | null;
  paymentStatus: string | null;
  outstandingInvoices: number;
  pendingUpgrade: string | null;
  pendingDowngrade: string | null;
  cancellationStatus: string | null;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
};

export type AdminSubscriptionListResult =
  | {
      ok: true;
      subscriptions: AdminSubscriptionRow[];
      total: number;
      plans: { id: string; code: string; name: string; category: string }[];
    }
  | { ok: false; error: string; setupRequired?: boolean };

/** Plan entitlement row for the Feature Entitlements tab. */
export type AdminEntitlementView = {
  key: string;
  label: string;
  value: EntitlementValue | null;
  source: "plan" | "manual";
  granted: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
};

export type AdminCompanySubscriptionDetail = {
  subscription: {
    id: string;
    status: SubscriptionStatus;
    statusLabel: string;
    billingInterval: BillingInterval;
    startedAt: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    nextBillingDate: string | null;
    cancelledAt: string | null;
    providerSubscriptionId: string | null;
    createdAt: string;
  } | null;
  customer: { id: string; providerCustomerId: string | null; userId: string | null } | null;
  plan: {
    id: string | null;
    code: string | null;
    name: string | null;
    category: string | null;
    priceMonthlyAel: number | null;
    priceAnnualAel: number | null;
  } | null;
  commitments: {
    commitmentStart: string;
    commitmentEnd: string;
    cyclesRequired: number;
    completed: boolean;
    completedAt: string | null;
  }[];
  billingCycles: {
    cycleNumber: number;
    periodStart: string;
    periodEnd: string;
    status: string;
    amountAel: number;
    paidAt: string | null;
  }[];
  invoices: {
    id: string;
    invoiceNumber: string;
    totalAel: number;
    status: string;
    billingPeriodStart: string | null;
    billingPeriodEnd: string | null;
    dueDate: string | null;
    paidAt: string | null;
  }[];
  paymentEvents: {
    id: string;
    eventType: string;
    amountAel: number | null;
    occurredAt: string;
  }[];
  webhooks: {
    id: string;
    provider: string;
    eventType: string;
    eventId: string;
    processed: boolean;
    receivedAt: string;
  }[];
  paymentMethods: {
    id: string;
    type: string;
    last4: string | null;
    brand: string | null;
    expiry: string | null;
    isDefault: boolean;
  }[];
  upgradeRequests: {
    id: string;
    status: string;
    requestedAt: string;
    effectiveDate: string | null;
    prorationAmountAel: number | null;
  }[];
  downgradeRequests: {
    id: string;
    status: string;
    requestedAt: string;
    effectiveDate: string | null;
  }[];
  cancellationRequests: {
    id: string;
    status: string;
    requestedAt: string;
    effectiveDate: string | null;
    mode: string;
  }[];
  history: {
    id: string;
    changeType: string;
    effectiveDate: string;
    billingAmountAel: number | null;
    prorationAmountAel: number | null;
    minCommitmentEndDate: string | null;
    paymentStatus: string | null;
    confirmationStatus: string | null;
  }[];
  planEntitlements: AdminEntitlementView[];
  featureAccess: AdminEntitlementView[];
  entitlementAudit: {
    id: string;
    action: string;
    entitlementKey: string;
    reason: string | null;
    createdAt: string;
  }[];
};

export type AdminCompanySubscriptionResult =
  | { ok: true; detail: AdminCompanySubscriptionDetail }
  | { ok: false; error: string; setupRequired?: boolean };

/** Human label for entitlement keys (spec §7 names + seeded granular keys). */
export const ENTITLEMENT_LABELS: Record<string, string> = {
  basic_profile: "Basic Profile",
  verified_profile: "Verified Profile",
  expanded_profile: "Expanded Profile",
  directory_visibility: "Directory Visibility",
  opportunity_access: "Opportunity Access",
  contract_participation: "Contract Participation",
  contract_invitations: "Contract Invitations",
  unlimited_invitations: "Unlimited Invitations",
  unlimited_opportunities: "Unlimited Opportunities",
  team_members: "Team Members",
  document_storage: "Document Storage",
  document_uploads: "Document Uploads",
  document_expiry_reminders: "Document Expiry Reminders",
  work_packages: "Work Packages",
  tasks_and_milestones: "Tasks and Milestones",
  client_portal: "Client Portal",
  bid_workspace: "Bid Workspace",
  pricing_comparison: "Pricing Comparison",
  pricing_submissions: "Pricing Submissions",
  approvals: "Approvals",
  variations: "Variations",
  invoice_tracking: "Invoice Tracking",
  performance_reports: "Performance Reports",
  performance_record: "Performance Record",
  partnership_history: "Partnership History",
  partner_enquiries: "Partner Enquiries",
  services_listing: "Services Listing",
  verification_review: "Verification Review",
  service_discovery_review: "AI Service Discovery Review",
  ai_service_review: "AI Service Review",
  expansion_recommendations: "Expansion Recommendations",
  ai_partnership_intelligence: "AI Partnership Intelligence",
  priority_support: "Priority Support",
  dedicated_support: "Dedicated Support",
  private_partner_network: "Private Partner Network",
  api_access: "API Access",
  multiple_locations: "Multiple Locations",
  multiple_divisions: "Multiple Divisions",
  advanced_capacity_management: "Advanced Capacity Management",
  advanced_reporting: "Advanced Reporting",
  priority_matching: "Priority Matching",
  preferred_partner_status: "Preferred Partner Status",
  quarterly_review: "Quarterly Review",
};

export function entitlementLabel(key: string): string {
  return ENTITLEMENT_LABELS[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ------------------------------------------------------------ master list
export async function doListAdminSubscriptions(input: {
  status: string;
  planId: string;
}): Promise<AdminSubscriptionListResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const status = input.status ?? "";
  const planId = input.planId ?? "";
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };
    const rows = await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select s.id, s.status, s.billing_interval, s.current_period_start, s.current_period_end,
                s.next_billing_date, s.started_at, s.cancelled_at, s.provider_subscription_id,
                c.id as customer_id, c.provider_customer_id, c.company_id,
                co.name as company_name,
                u.email as account_email,
                p.id as plan_id, p.code as plan_code, p.name as plan_name,
                case when s.billing_interval = 'annual' then p.price_annual_ael else p.price_monthly_ael end as price_ael,
                (select mc.commitment_start_date from minimum_commitments mc
                   where mc.subscription_id = s.id order by mc.created_at desc limit 1) as commitment_start,
                (select mc.commitment_end_date from minimum_commitments mc
                   where mc.subscription_id = s.id order by mc.created_at desc limit 1) as commitment_end,
                (select mc.completed from minimum_commitments mc
                   where mc.subscription_id = s.id order by mc.created_at desc limit 1) as commitment_completed,
                (select i.status from subscription_invoices i
                   where i.subscription_id = s.id order by i.created_at desc limit 1) as payment_status,
                (select count(*)::int from subscription_invoices si2
                   where si2.subscription_id = s.id and si2.status = 'Open') as outstanding_invoices,
                (select ur.status from upgrade_requests ur
                   where ur.subscription_id = s.id and ur.status in ('Pending','Confirmed')
                   order by ur.requested_at desc limit 1) as pending_upgrade,
                (select dr.status from downgrade_requests dr
                   where dr.subscription_id = s.id and dr.status in ('Pending','Confirmed')
                   order by dr.requested_at desc limit 1) as pending_downgrade,
                (select cr.status from cancellation_requests cr
                   where cr.subscription_id = s.id and cr.status in ('Pending','Confirmed')
                   order by cr.requested_at desc limit 1) as cancellation_status
         from subscriptions s
         join customers c on c.id = s.customer_id
         left join membership_plans p on p.id = s.plan_id
         left join companies co on co.id = c.company_id
         left join users u on u.id = c.user_id
         where (${status} = '' or s.status = ${status})
           and (${planId} = '' or s.plan_id = ${planId === "" ? null : planId})
         order by s.created_at desc
         limit 300`,
      tx`select id, code, name, category from membership_plans
         where status = 'Active' order by sort_order`,
    ]);
    const list = rows[1] as unknown[];
    const subscriptions: AdminSubscriptionRow[] = (list as {
      id: string;
      status: SubscriptionStatus;
      billing_interval: BillingInterval;
      current_period_start: string | null;
      current_period_end: string | null;
      next_billing_date: string | null;
      started_at: string | null;
      cancelled_at: string | null;
      provider_subscription_id: string | null;
      provider_customer_id: string | null;
      company_id: string | null;
      company_name: string | null;
      account_email: string | null;
      plan_id: string | null;
      plan_code: string | null;
      plan_name: string | null;
      price_ael: string | null;
      commitment_start: string | null;
      commitment_end: string | null;
      commitment_completed: boolean | null;
      payment_status: string | null;
      outstanding_invoices: number | null;
      pending_upgrade: string | null;
      pending_downgrade: string | null;
      cancellation_status: string | null;
    }[]).map((r) => ({
      id: r.id,
      companyId: r.company_id,
      companyName: r.company_name,
      accountEmail: r.account_email,
      planId: r.plan_id,
      planCode: r.plan_code,
      planName: r.plan_name,
      priceAel: r.price_ael !== null && r.price_ael !== undefined ? Number(r.price_ael) : null,
      billingInterval: r.billing_interval,
      status: r.status,
      statusLabel: STATUS_DISPLAY[r.status] ?? r.status,
      startedAt: r.started_at ? String(r.started_at) : null,
      currentPeriodStart: r.current_period_start ? String(r.current_period_start) : null,
      currentPeriodEnd: r.current_period_end ? String(r.current_period_end) : null,
      nextBillingDate: r.next_billing_date ? String(r.next_billing_date) : null,
      commitmentStart: r.commitment_start ? String(r.commitment_start) : null,
      commitmentEnd: r.commitment_end ? String(r.commitment_end) : null,
      commitmentCompleted: r.commitment_completed ?? null,
      downgradeEligibleDate: r.commitment_end ? String(r.commitment_end) : null,
      paymentStatus: r.payment_status,
      outstandingInvoices: Number(r.outstanding_invoices ?? 0),
      pendingUpgrade: r.pending_upgrade,
      pendingDowngrade: r.pending_downgrade,
      cancellationStatus: r.cancellation_status,
      providerCustomerId: r.provider_customer_id,
      providerSubscriptionId: r.provider_subscription_id,
    }));
    const plans = (rows[2] as { id: string; code: string; name: string; category: string }[]).map(
      (p) => ({ id: p.id, code: p.code, name: p.name, category: p.category }),
    );
    return { ok: true, subscriptions, total: subscriptions.length, plans };
  } catch (err) {
    console.error("listAdminSubscriptions failed:", err);
    return { ok: false, error: "Could not load subscriptions." };
  }
}

// ------------------------------------------------------- company detail
export async function doGetAdminCompanySubscription(
  companyId: string,
): Promise<AdminCompanySubscriptionResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };
    const rows = await asUser(admin.user.id, admin.user.role, (tx) => [
      // customer(s) for the company (linked directly or via the owner user)
      tx`select c.id, c.provider_customer_id, c.user_id
         from customers c
         where c.company_id = ${companyId}
            or c.user_id = (select owner_id from companies where id = ${companyId})
         order by c.created_at desc limit 1`,
      // subscriptions for that customer (second query keyed off the customer id)
      tx`select s.* from subscriptions s
         where s.customer_id in (
           select c2.id from customers c2
           where c2.company_id = ${companyId}
              or c2.user_id = (select owner_id from companies where id = ${companyId})
         )
         order by s.created_at desc limit 1`,
      tx`select p.id, p.code, p.name, p.category, p.price_monthly_ael, p.price_annual_ael
         from membership_plans p
         where p.id in (
           select s.plan_id from subscriptions s
           where s.customer_id in (
             select c3.id from customers c3
             where c3.company_id = ${companyId}
                or c3.user_id = (select owner_id from companies where id = ${companyId})
           )
           and s.plan_id is not null
         )
         limit 1`,
    ]);
    const customerRows = rows[1] as { id: string; provider_customer_id: string | null; user_id: string }[];
    const subRows = rows[2] as {
      id: string;
      status: SubscriptionStatus;
      billing_interval: BillingInterval;
      started_at: string | null;
      current_period_start: string | null;
      current_period_end: string | null;
      next_billing_date: string | null;
      cancelled_at: string | null;
      provider_subscription_id: string | null;
      created_at: string;
    }[];
    const planRows = rows[3] as {
      id: string;
      code: string | null;
      name: string | null;
      category: string | null;
      price_monthly_ael: string | null;
      price_annual_ael: string | null;
    }[];
    const customer = customerRows[0] ?? null;
    const subscription = subRows[0] ?? null;
    const plan = planRows[0]
      ? {
          id: planRows[0].id,
          code: planRows[0].code,
          name: planRows[0].name,
          category: planRows[0].category,
          priceMonthlyAel: planRows[0].price_monthly_ael !== null ? Number(planRows[0].price_monthly_ael) : null,
          priceAnnualAel: planRows[0].price_annual_ael !== null ? Number(planRows[0].price_annual_ael) : null,
        }
      : null;
    if (!customer || !subscription) {
      return {
        ok: true,
        detail: {
          subscription: null,
          customer: customer
            ? { id: customer.id, providerCustomerId: customer.provider_customer_id, userId: customer.user_id }
            : null,
          plan: null,
          commitments: [],
          billingCycles: [],
          invoices: [],
          paymentEvents: [],
          webhooks: [],
          paymentMethods: [],
          upgradeRequests: [],
          downgradeRequests: [],
          cancellationRequests: [],
          history: [],
          planEntitlements: [],
          featureAccess: [],
          entitlementAudit: [],
        },
      };
    }
    const subId = subscription.id;
    const custId = customer.id;
    const detailRows = await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select mc.commitment_start_date, mc.commitment_end_date, mc.cycles_required, mc.completed, mc.completed_at
         from minimum_commitments mc where mc.subscription_id = ${subId} order by mc.created_at desc limit 20`,
      tx`select bc.cycle_number, bc.period_start, bc.period_end, bc.status, bc.amount_ael, bc.paid_at
         from billing_cycles bc where bc.subscription_id = ${subId} order by bc.cycle_number desc limit 40`,
      tx`select i.id, i.invoice_number, i.total_ael, i.status, i.billing_period_start, i.billing_period_end,
                i.due_date, i.paid_at
         from subscription_invoices i where i.subscription_id = ${subId} order by i.created_at desc limit 60`,
      tx`select pe.id, pe.event_type, pe.amount_ael, pe.occurred_at
         from payment_events pe
         left join subscription_invoices si on si.id = pe.invoice_id
         where pe.invoice_id is null
            or si.subscription_id = ${subId}
         order by pe.occurred_at desc limit 60`,
      tx`select w.id, w.provider, w.event_type, w.event_id, w.processed, w.received_at
         from billing_provider_webhook_events w
         order by w.received_at desc limit 30`,
      tx`select pm.id, pm.type, pm.last4, pm.brand, pm.expiry, pm.is_default
         from payment_methods pm where pm.customer_id = ${custId} order by pm.created_at desc limit 20`,
      tx`select ur.id, ur.status, ur.requested_at, ur.effective_date, ur.proration_amount_ael
         from upgrade_requests ur where ur.subscription_id = ${subId} order by ur.requested_at desc limit 20`,
      tx`select dr.id, dr.status, dr.requested_at, dr.effective_date
         from downgrade_requests dr where dr.subscription_id = ${subId} order by dr.requested_at desc limit 20`,
      tx`select cr.id, cr.status, cr.requested_at, cr.effective_date, cr.mode
         from cancellation_requests cr where cr.subscription_id = ${subId} order by cr.requested_at desc limit 20`,
      tx`select h.id, h.change_type, h.effective_date, h.billing_amount_ael, h.proration_amount_ael,
                h.min_commitment_end_date, h.payment_status, h.confirmation_status
         from subscription_history h where h.subscription_id = ${subId} order by h.effective_date desc limit 40`,
      tx`select e.entitlement_key, e.value from plan_entitlements e
         where e.plan_id = ${plan?.id ?? null} order by e.entitlement_key`,
      tx`select f.entitlement_key, f.granted, f.effective_from, f.effective_to
         from feature_access_records f
         where f.company_id = ${companyId} order by f.created_at desc limit 100`,
      tx`select e.id, e.action, e.entitlement_key, e.reason, e.created_at
         from entitlement_audit_logs e
         where e.company_id = ${companyId} order by e.created_at desc limit 100`,
    ]);
    const d = detailRows;
    const commitments = (d[1] as {
      commitment_start_date: string;
      commitment_end_date: string;
      cycles_required: number;
      completed: boolean;
      completed_at: string | null;
    }[]).map((r) => ({
      commitmentStart: String(r.commitment_start_date),
      commitmentEnd: String(r.commitment_end_date),
      cyclesRequired: r.cycles_required,
      completed: r.completed,
      completedAt: r.completed_at ? String(r.completed_at) : null,
    }));
    const billingCycles = (d[2] as {
      cycle_number: number;
      period_start: string;
      period_end: string;
      status: string;
      amount_ael: string;
      paid_at: string | null;
    }[]).map((r) => ({
      cycleNumber: r.cycle_number,
      periodStart: String(r.period_start),
      periodEnd: String(r.period_end),
      status: r.status,
      amountAel: Number(r.amount_ael ?? 0),
      paidAt: r.paid_at ? String(r.paid_at) : null,
    }));
    const invoices = (d[3] as {
      id: string;
      invoice_number: string;
      total_ael: string;
      status: string;
      billing_period_start: string | null;
      billing_period_end: string | null;
      due_date: string | null;
      paid_at: string | null;
    }[]).map((r) => ({
      id: r.id,
      invoiceNumber: r.invoice_number,
      totalAel: Number(r.total_ael ?? 0),
      status: r.status,
      billingPeriodStart: r.billing_period_start ? String(r.billing_period_start) : null,
      billingPeriodEnd: r.billing_period_end ? String(r.billing_period_end) : null,
      dueDate: r.due_date ? String(r.due_date) : null,
      paidAt: r.paid_at ? String(r.paid_at) : null,
    }));
    const paymentEvents = (d[4] as {
      id: string;
      event_type: string;
      amount_ael: string | null;
      occurred_at: string;
    }[]).map((r) => ({
      id: r.id,
      eventType: r.event_type,
      amountAel: r.amount_ael !== null ? Number(r.amount_ael) : null,
      occurredAt: String(r.occurred_at),
    }));
    const webhooks = (d[5] as {
      id: string;
      provider: string;
      event_type: string;
      event_id: string;
      processed: boolean;
      received_at: string;
    }[]).map((r) => ({
      id: r.id,
      provider: r.provider,
      eventType: r.event_type,
      eventId: r.event_id,
      processed: r.processed,
      receivedAt: String(r.received_at),
    }));
    const paymentMethods = (d[6] as {
      id: string;
      type: string;
      last4: string | null;
      brand: string | null;
      expiry: string | null;
      is_default: boolean;
    }[]).map((r) => ({
      id: r.id,
      type: r.type,
      last4: r.last4,
      brand: r.brand,
      expiry: r.expiry,
      isDefault: r.is_default,
    }));
    const upgradeRequests = (d[7] as {
      id: string;
      status: string;
      requested_at: string;
      effective_date: string | null;
      proration_amount_ael: string | null;
    }[]).map((r) => ({
      id: r.id,
      status: r.status,
      requestedAt: String(r.requested_at),
      effectiveDate: r.effective_date ? String(r.effective_date) : null,
      prorationAmountAel: r.proration_amount_ael !== null ? Number(r.proration_amount_ael) : null,
    }));
    const downgradeRequests = (d[8] as {
      id: string;
      status: string;
      requested_at: string;
      effective_date: string | null;
    }[]).map((r) => ({
      id: r.id,
      status: r.status,
      requestedAt: String(r.requested_at),
      effectiveDate: r.effective_date ? String(r.effective_date) : null,
    }));
    const cancellationRequests = (d[9] as {
      id: string;
      status: string;
      requested_at: string;
      effective_date: string | null;
      mode: string;
    }[]).map((r) => ({
      id: r.id,
      status: r.status,
      requestedAt: String(r.requested_at),
      effectiveDate: r.effective_date ? String(r.effective_date) : null,
      mode: r.mode,
    }));
    const history = (d[10] as {
      id: string;
      change_type: string;
      effective_date: string;
      billing_amount_ael: string | null;
      proration_amount_ael: string | null;
      min_commitment_end_date: string | null;
      payment_status: string | null;
      confirmation_status: string | null;
    }[]).map((r) => ({
      id: r.id,
      changeType: r.change_type,
      effectiveDate: String(r.effective_date),
      billingAmountAel: r.billing_amount_ael !== null ? Number(r.billing_amount_ael) : null,
      prorationAmountAel: r.proration_amount_ael !== null ? Number(r.proration_amount_ael) : null,
      minCommitmentEndDate: r.min_commitment_end_date ? String(r.min_commitment_end_date) : null,
      paymentStatus: r.payment_status,
      confirmationStatus: r.confirmation_status,
    }));
    const planEntitlements: AdminEntitlementView[] = (d[11] as {
      entitlement_key: string;
      value: EntitlementValue;
    }[]).map((r) => ({
      key: r.entitlement_key,
      label: entitlementLabel(r.entitlement_key),
      value: r.value,
      source: "plan",
      granted: true,
      effectiveFrom: null,
      effectiveTo: null,
    }));
    const featureAccess: AdminEntitlementView[] = (d[12] as {
      entitlement_key: string;
      granted: boolean;
      effective_from: string;
      effective_to: string | null;
    }[]).map((r) => ({
      key: r.entitlement_key,
      label: entitlementLabel(r.entitlement_key),
      value: null,
      source: "manual",
      granted: r.granted,
      effectiveFrom: String(r.effective_from),
      effectiveTo: r.effective_to ? String(r.effective_to) : null,
    }));
    const entitlementAudit = (d[13] as {
      id: string;
      action: string;
      entitlement_key: string;
      reason: string | null;
      created_at: string;
    }[]).map((r) => ({
      id: r.id,
      action: r.action,
      entitlementKey: r.entitlement_key,
      reason: r.reason,
      createdAt: String(r.created_at),
    }));
    return {
      ok: true,
      detail: {
        subscription: subscription
          ? {
              id: subscription.id,
              status: subscription.status,
              statusLabel: STATUS_DISPLAY[subscription.status] ?? subscription.status,
              billingInterval: subscription.billing_interval,
              startedAt: subscription.started_at ? String(subscription.started_at) : null,
              currentPeriodStart: subscription.current_period_start ? String(subscription.current_period_start) : null,
              currentPeriodEnd: subscription.current_period_end ? String(subscription.current_period_end) : null,
              nextBillingDate: subscription.next_billing_date ? String(subscription.next_billing_date) : null,
              cancelledAt: subscription.cancelled_at ? String(subscription.cancelled_at) : null,
              providerSubscriptionId: subscription.provider_subscription_id,
              createdAt: String(subscription.created_at),
            }
          : null,
        customer: {
          id: customer.id,
          providerCustomerId: customer.provider_customer_id,
          userId: customer.user_id,
        },
        plan,
        commitments,
        billingCycles,
        invoices,
        paymentEvents,
        webhooks,
        paymentMethods,
        upgradeRequests,
        downgradeRequests,
        cancellationRequests,
        history,
        planEntitlements,
        featureAccess,
        entitlementAudit,
      },
    };
  } catch (err) {
    console.error("getAdminCompanySubscription failed:", err);
    return { ok: false, error: "Could not load company subscription data." };
  }
}

// --------------------------------------------------- partnership workspaces
export type AdminPartnershipWorkspaceRow = {
  id: string;
  title: string;
  status: string;
  industry: string | null;
  location: string | null;
  contractValue: number | null;
  leadName: string | null;
  leadEmail: string | null;
  clientNames: string[];
  participantCount: number;
  packageCount: number;
  createdAt: string;
};

export type AdminPartnershipWorkspacesResult =
  | {
      ok: true;
      workspaces: AdminPartnershipWorkspaceRow[];
      total: number;
      statuses: string[];
    }
  | { ok: false; error: string; setupRequired?: boolean };

export async function doListPartnershipWorkspaces(input: {
  status: string;
}): Promise<AdminPartnershipWorkspacesResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const status = input.status ?? "";
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };
    const rows = await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select cw.id, cw.title, cw.status, cw.industry, cw.location, cw.contract_value,
                cw.created_at, cw.lead_contractor_id, u.email as lead_email, p.name as lead_name,
                coalesce((select array_agg(co.name order by co.name)
                          from contract_clients cc
                          join client_organizations co on co.id = cc.client_org_id
                          where cc.contract_workspaces_id = cw.id), '{}') as client_names,
                (select count(*) from invitations i
                   where i.workspace_id = cw.id and i.status in ('joined','verified')) as participant_count,
                (select count(*) from work_packages wp where wp.workspace_id = cw.id) as package_count,
                (select count(*) from invitations i2 where i2.workspace_id = cw.id) as invited_count
         from contract_workspaces cw
         join users u on u.id = cw.lead_contractor_id
         left join profiles p on p.user_id = cw.lead_contractor_id
         where ${status} = '' or cw.status = ${status}
         order by cw.created_at desc
         limit 200`,
      tx`select status from contract_workspaces group by status order by status`,
    ]);
    const list = rows[1] as unknown[];
    const workspaces: AdminPartnershipWorkspaceRow[] = (list as {
      id: string;
      title: string;
      status: string;
      industry: string | null;
      location: string | null;
      contract_value: string | null;
      created_at: string;
      lead_email: string;
      lead_name: string | null;
      client_names: string[] | null;
      participant_count: number;
      package_count: number;
      invited_count: number;
    }[]).map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      industry: r.industry,
      location: r.location,
      contractValue: r.contract_value ? Number(r.contract_value) : null,
      leadName: r.lead_name,
      leadEmail: r.lead_email,
      clientNames: r.client_names ?? [],
      participantCount: Number(r.participant_count ?? 0),
      packageCount: Number(r.package_count ?? 0),
      createdAt: String(r.created_at),
    }));
    const statuses = (rows[2] as { status: string }[]).map((r) => r.status);
    return { ok: true, workspaces, total: workspaces.length, statuses };
  } catch (err) {
    console.error("listPartnershipWorkspaces failed:", err);
    return { ok: false, error: "Could not load partnership workspaces." };
  }
}

// ------------------------------------------------------------- client portals
export type AdminClientPortalRow = {
  id: string;
  name: string;
  status: string;
  registrationNumber: string | null;
  registrationCountry: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  memberCount: number;
  contractCount: number;
  contractNames: string[];
  createdAt: string;
};

export type AdminClientPortalsResult =
  | { ok: true; portals: AdminClientPortalRow[]; total: number }
  | { ok: false; error: string; setupRequired?: boolean };

export async function doListClientPortals(): Promise<AdminClientPortalsResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  try {
    await ensureSchema();
    const admin = await loadAdminUser();
    if (!admin) return { ok: false, error: "UNAUTHENTICATED" };
    const rows = await asUser(admin.user.id, admin.user.role, (tx) => [
      tx`select o.id, o.name, o.status, o.registration_number, o.registration_country,
                o.contact_email, o.contact_phone, o.created_at,
                (select count(*) from client_org_members om where om.org_id = o.id) as member_count,
                coalesce((select array_agg(cw.title order by cw.title)
                          from contract_clients cc
                          join contract_workspaces cw on cw.id = cc.contract_workspaces_id
                          where cc.client_org_id = o.id), '{}') as contract_names
         from client_organizations o
         order by o.created_at desc
         limit 200`,
    ]);
    const list = rows[1] as unknown[];
    const portals: AdminClientPortalRow[] = (list as {
      id: string;
      name: string;
      status: string;
      registration_number: string | null;
      registration_country: string | null;
      contact_email: string | null;
      contact_phone: string | null;
      created_at: string;
      member_count: number;
      contract_names: string[] | null;
    }[]).map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      registrationNumber: r.registration_number,
      registrationCountry: r.registration_country,
      contactEmail: r.contact_email,
      contactPhone: r.contact_phone,
      memberCount: Number(r.member_count ?? 0),
      contractCount: (r.contract_names ?? []).length,
      contractNames: r.contract_names ?? [],
      createdAt: String(r.created_at),
    }));
    return { ok: true, portals, total: portals.length };
  } catch (err) {
    console.error("listClientPortals failed:", err);
    return { ok: false, error: "Could not load client portals." };
  }
}
