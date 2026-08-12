/**
 * Master Admin Portal - Stage 3 part 2: feature entitlement control (spec §7).
 *
 * Manual, admin-issued feature entitlements recorded in entitlement_grants on
 * top of plan-included entitlements (plan_entitlements). Administrators can:
 *   - view the merged entitlement picture per company (plan + manual grants
 *     with source status marks: Plan Included / Admin Granted / Promotional /
 *     Temporary / Restricted / Expired)
 *   - grant (admin_grant | promotional | temporary) with reason, optional
 *     expiry (temporary requires one), optional future effective date
 *     (scheduling), and optional company-owner notification
 *   - revoke a manual grant with reason + optional notification
 *
 * Every grant/revoke writes an audit_logs row under billing.admin.entitlement.*
 * (consistent with the billing.admin.* pattern in
 * admin-subscriptions-actions.ts) and, when requested, a notifications row for
 * the company owner (type "entitlement").
 *
 * Role gate: staff roles operations / finance / super_admin may mutate;
 * everyone else (support, compliance, read_only) gets a read-only view.
 * RLS: every read/write runs through asUser(adminId, 'sb_admin', ...); the
 * entitlement_grants table additionally lets the company owner SELECT their own
 * rows so manual grants are never invisible to the client.
 */
import { randomUUID } from "node:crypto";
import { asUser, dbConfigured, ensureSchema } from "./db";
import type { Tx, TxQuery } from "./db";
import { auditQuery } from "./audit";
import type { AdminActor } from "./admin-subscriptions-actions";
import { entitlementLabel } from "./admin-subscriptions-core";

/** Staff roles allowed to grant/revoke entitlements (spec §7 + brief). */
export const ENTITLEMENT_MUTATE_ROLES = ["operations", "finance", "super_admin"] as const;
export type EntitlementGrantType = "admin_grant" | "promotional" | "temporary";
export type EntitlementStatusMark =
  | "Plan Included"
  | "Admin Granted"
  | "Promotional"
  | "Temporary"
  | "Restricted"
  | "Expired";

export type CompanyEntitlementRow = {
  key: string;
  label: string;
  source: "plan" | "manual" | "legacy";
  status: EntitlementStatusMark;
  scheduled: boolean;
  grantId?: string;
  grantType?: EntitlementGrantType;
  reason?: string | null;
  grantedByEmail?: string | null;
  effectiveFrom?: string | null;
  expiresAt?: string | null;
  createdAt?: string | null;
};

export type CompanyEntitlementsResult =
  | {
      ok: true;
      company: { id: string; name: string; ownerEmail: string | null; planName: string | null };
      entitlements: CompanyEntitlementRow[];
    }
  | { ok: false; error: string };

const fmtIso = (v: Date | string | null | undefined): string | null =>
  v ? String(v) : null;

/** Insert a client notification inside an asUser batch (same shape as the
 *  subscription panel's notifyQuery). */
function notifyQuery(
  tx: Tx,
  ownerUserId: string | null,
  title: string,
  body: string,
): TxQuery | null {
  if (!ownerUserId) return null;
  return tx`insert into notifications (id, user_id, type, title, body, link)
    values (${randomUUID()}, ${ownerUserId}, 'entitlement', ${title}, ${body}, '/app/notifications')`;
}

/** Spec §7 role gate: operations / finance / super_admin staff roles. */
function requireEntitlementMutate(admin: AdminActor): string | null {
  if (!admin.staffRoles.some((r) => (ENTITLEMENT_MUTATE_ROLES as readonly string[]).includes(r))) {
    return "This action requires an operations, finance or super_admin role.";
  }
  return null;
}

/** The company row + owner profile (same shape as the billing panel loader). */
async function loadCompanyAndOwner(adminId: string, companyId: string) {
  const rows = (await asUser(adminId, "sb_admin", (tx) => [
    tx`select c.id, c.name, c.owner_id, u.email as owner_email
         from companies c
         left join users u on u.id = c.owner_id
        where c.id = ${companyId}`,
  ]))[1] as { id: string; name: string; owner_id: string; owner_email: string | null }[];
  return rows[0] ?? null;
}

/** Latest subscription for a company (directly or via the owner user). */
async function loadCompanySubscription(adminId: string, companyId: string) {
  const rows = (await asUser(adminId, "sb_admin", (tx) => [
    tx`select s.id, s.plan_id, s.status
         from subscriptions s
        where s.customer_id in (
          select c2.id from customers c2
          where c2.company_id = ${companyId}
             or c2.user_id = (select owner_id from companies where id = ${companyId})
        )
        order by s.created_at desc limit 1`,
  ]))[1] as { id: string; plan_id: string | null; status: string }[];
  return rows[0] ?? null;
}

// ---------------------------------------------------------------- list (merged)
export async function doAdminListCompanyEntitlements(
  admin: AdminActor,
  companyId: string,
): Promise<CompanyEntitlementsResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED" };
  try {
    await ensureSchema();
    const company = await loadCompanyAndOwner(admin.id, companyId);
    if (!company) return { ok: false, error: "Company not found." };
    const sub = await loadCompanySubscription(admin.id, companyId);
    const [, planRows, grantRows, legacyRows, planNameRows] = (await asUser(
      admin.id,
      "sb_admin",
      (tx) => [
        // Sweep: expire manual grants whose expiry has passed (keeps the DB
        // status column honest without a background job).
        tx`update entitlement_grants set status = 'expired'
            where status = 'active' and expires_at is not null and expires_at < now()`,
        tx`select e.entitlement_key, e.value from plan_entitlements e
            where e.plan_id = ${sub?.plan_id ?? null} order by e.entitlement_key`,
        tx`select g.id, g.entitlement_key, g.grant_type, g.reason, g.granted_by, g.effective_from,
                  g.expires_at, g.status, g.created_at, u.email as granted_by_email
             from entitlement_grants g
             left join users u on u.id = g.granted_by
            where g.company_id = ${companyId}
            order by g.created_at desc limit 200`,
        tx`select f.entitlement_key, f.granted, f.effective_from, f.effective_to
             from feature_access_records f
            where f.company_id = ${companyId}
            order by f.created_at desc limit 200`,
        tx`select p.name from membership_plans p where p.id = ${sub?.plan_id ?? null} limit 1`,
      ],
    )) as [unknown, Record<string, unknown>[], CompanyEntitlementRow[], unknown[], { name: string | null }[]];
    const planKeys = new Set((planRows as { entitlement_key: string }[]).map((r) => r.entitlement_key));
    const now = Date.now();
    const rows: CompanyEntitlementRow[] = [];
    // 1) Plan-included entitlements.
    for (const p of planRows as { entitlement_key: string }[]) {
      rows.push({
        key: p.entitlement_key,
        label: entitlementLabel(p.entitlement_key),
        source: "plan",
        status: "Plan Included",
        scheduled: false,
      });
    }
    // 2) Manual grants (admin_grant / promotional / temporary).
    const coveredByGrant = new Set<string>();
    for (const g of grantRows as CompanyEntitlementRow[]) {
      const raw = g as unknown as {
        id: string;
        entitlement_key: string;
        grant_type: EntitlementGrantType;
        reason: string | null;
        granted_by: string | null;
        granted_by_email: string | null;
        effective_from: string;
        expires_at: string | null;
        status: string;
        created_at: string;
      };
      coveredByGrant.add(raw.entitlement_key);
      const effectiveFrom = new Date(raw.effective_from).getTime();
      const expiresAt = raw.expires_at ? new Date(raw.expires_at).getTime() : null;
      const revoked = raw.status === "revoked";
      const expired = raw.status === "expired" || (expiresAt !== null && expiresAt <= now);
      const scheduled = effectiveFrom > now;
      let status: EntitlementStatusMark;
      if (revoked) status = "Restricted";
      else if (expired) status = "Expired";
      else if (raw.grant_type === "promotional") status = "Promotional";
      else if (raw.grant_type === "temporary") status = "Temporary";
      else status = "Admin Granted";
      rows.push({
        key: raw.entitlement_key,
        label: entitlementLabel(raw.entitlement_key),
        source: "manual",
        status,
        scheduled,
        grantId: raw.id,
        grantType: raw.grant_type,
        reason: raw.reason,
        grantedByEmail: raw.granted_by_email,
        effectiveFrom: fmtIso(raw.effective_from),
        expiresAt: fmtIso(raw.expires_at),
        createdAt: fmtIso(raw.created_at),
      });
    }
    // 3) Legacy feature_access_records (plan-driven grants) not already
    //    covered by the plan list or a manual grant: granted=true rows surface
    //    as Admin Granted, granted=false as Restricted.
    const seen = new Set(planKeys);
    for (const f of legacyRows as { entitlement_key: string; granted: boolean }[]) {
      if (seen.has(f.entitlement_key) || coveredByGrant.has(f.entitlement_key)) continue;
      seen.add(f.entitlement_key);
      rows.push({
        key: f.entitlement_key,
        label: entitlementLabel(f.entitlement_key),
        source: "legacy",
        status: f.granted ? "Admin Granted" : "Restricted",
        scheduled: false,
      });
    }
    const planName = (planNameRows[0] as { name: string | null } | undefined)?.name ?? null;
    return {
      ok: true,
      company: { id: company.id, name: company.name, ownerEmail: company.owner_email, planName },
      entitlements: rows,
    };
  } catch (err) {
    console.error("doAdminListCompanyEntitlements failed:", err);
    return { ok: false, error: "Could not load entitlements." };
  }
}

// ---------------------------------------------------------------- grant
export async function doAdminGrantEntitlement(
  admin: AdminActor,
  companyId: string,
  input: {
    entitlementKey: string;
    grantType: EntitlementGrantType;
    reason: string;
    expiresAt?: string | null;
    effectiveFrom?: string | null;
    notify: boolean;
  },
): Promise<{ ok: true; message: string; grantId: string } | { ok: false; error: string }> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED" };
  const gate = requireEntitlementMutate(admin);
  if (gate) return { ok: false, error: gate };
  const key = (input.entitlementKey ?? "").trim();
  const reason = (input.reason ?? "").trim();
  if (!key) return { ok: false, error: "Entitlement key is required." };
  if (!reason) return { ok: false, error: "A reason is required for every grant." };
  if (!["admin_grant", "promotional", "temporary"].includes(input.grantType)) {
    return { ok: false, error: "Invalid grant type." };
  }
  let expiresAt: Date | null = null;
  if (input.expiresAt) {
    expiresAt = new Date(input.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) return { ok: false, error: "Invalid expiry date." };
  }
  if (input.grantType === "temporary" && !expiresAt) {
    return { ok: false, error: "Temporary grants require an expiry date." };
  }
  let effectiveFrom: Date = new Date();
  if (input.effectiveFrom) {
    effectiveFrom = new Date(input.effectiveFrom);
    if (Number.isNaN(effectiveFrom.getTime())) return { ok: false, error: "Invalid effective date." };
  }
  try {
    await ensureSchema();
    const company = await loadCompanyAndOwner(admin.id, companyId);
    if (!company) return { ok: false, error: "Company not found." };
    const sub = await loadCompanySubscription(admin.id, companyId);
    const grantId = randomUUID();
    const label = entitlementLabel(key);
    const expiresText = expiresAt ? fmtIso(expiresAt) : null;
    const effectiveText = fmtIso(effectiveFrom);
    const body =
      `ScaleBridge has granted ${label} access for ${company.name}. ` +
      `Reason: ${reason}.` +
      (effectiveText && effectiveFrom.getTime() > Date.now()
        ? ` Access starts on ${effectiveText}.`
        : "") +
      (expiresText ? ` This access expires on ${expiresText}.` : "");
    await asUser(admin.id, "sb_admin", (tx) => [
      tx`insert into entitlement_grants (id, company_id, subscription_id, entitlement_key, grant_type, reason, granted_by, effective_from, expires_at, status)
         values (${grantId}, ${companyId}, ${sub?.id ?? null}, ${key}, ${input.grantType}, ${reason}, ${admin.id}, ${effectiveFrom}, ${expiresAt}, 'active')`,
      auditQuery(tx, admin.id, "billing.admin.entitlement.granted", {
        companyId,
        subscriptionId: sub?.id ?? null,
        grantId,
        entitlementKey: key,
        entitlementLabel: label,
        grantType: input.grantType,
        reason,
        effectiveFrom: effectiveText,
        expiresAt: expiresText,
        notify: input.notify,
        notificationStatus: input.notify ? "sent" : "skipped",
      }),
      notifyQuery(tx, company.owner_id, `Feature access granted: ${label}`, body),
    ].filter((q): q is TxQuery => q !== null));
    const scheduled = effectiveFrom.getTime() > Date.now();
    return {
      ok: true,
      message: scheduled
        ? `${label} scheduled from ${effectiveText}.`
        : `${label} granted to ${company.name}.`,
      grantId,
    };
  } catch (err) {
    console.error("doAdminGrantEntitlement failed:", err);
    return { ok: false, error: "Could not grant the entitlement." };
  }
}

// ---------------------------------------------------------------- revoke
export async function doAdminRevokeEntitlement(
  admin: AdminActor,
  companyId: string,
  grantId: string,
  reason: string,
  notify: boolean,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED" };
  const gate = requireEntitlementMutate(admin);
  if (gate) return { ok: false, error: gate };
  const trimmed = (reason ?? "").trim();
  if (!trimmed) return { ok: false, error: "A reason is required for every revoke." };
  try {
    await ensureSchema();
    const company = await loadCompanyAndOwner(admin.id, companyId);
    if (!company) return { ok: false, error: "Company not found." };
    const [, rowRows] = (await asUser(admin.id, "sb_admin", (tx) => [
      tx`select id, entitlement_key, grant_type, status from entitlement_grants
          where id = ${grantId} and company_id = ${companyId}`,
    ])) as [unknown, { id: string; entitlement_key: string; grant_type: string; status: string }[]];
    const row = rowRows[0];
    if (!row) return { ok: false, error: "Grant not found for this company." };
    if (row.status === "revoked") return { ok: false, error: "This grant is already revoked." };
    const label = entitlementLabel(row.entitlement_key);
    const body =
      `ScaleBridge has removed ${label} access for ${company.name}. ` +
      `Reason: ${trimmed}.`;
    await asUser(admin.id, "sb_admin", (tx) => [
      tx`update entitlement_grants set status = 'revoked' where id = ${grantId}`,
      auditQuery(tx, admin.id, "billing.admin.entitlement.revoked", {
        companyId,
        grantId,
        entitlementKey: row.entitlement_key,
        entitlementLabel: label,
        grantType: row.grant_type,
        reason: trimmed,
        notify,
        notificationStatus: notify ? "sent" : "skipped",
      }),
      notifyQuery(tx, company.owner_id, `Feature access removed: ${label}`, body),
    ].filter((q): q is TxQuery => q !== null));
    return { ok: true, message: `${label} access revoked.` };
  } catch (err) {
    console.error("doAdminRevokeEntitlement failed:", err);
    return { ok: false, error: "Could not revoke the entitlement." };
  }
}
