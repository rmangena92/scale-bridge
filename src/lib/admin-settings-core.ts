/**
 * Platform Settings (owner-approved scope 2026-08-12) — server-only core.
 *
 * One page at /admin/settings with five sections:
 *   1. Fees & plan pricing    — membership_plans edits (AED plans)
 *   2. Workspace fees         — workspace_fee_tiers
 *   3. Success-fee caps       — success_fee_caps
 *   4. Landing-page content   — landing_content blocks (public site reads live)
 *   5. System preferences     — platform_settings key/value
 *
 * Every mutation writes its immutable audit_logs row (action prefix
 * `settings.*`) in the SAME asUser() transaction as the change. RLS: all
 * reads/writes run as sb_admin (IS_ADMIN policies); the public landing page
 * reads through `to scalebridge_app` select policies via asService().
 *
 * Role gate: super_admin / operations / finance staff roles may edit; every
 * other staff role is read-only.
 */
import { asUser, dbConfigured, ensureSchema } from "./db";
import type { Tx } from "./db";
import { auditQuery } from "./audit";
import type { AdminActor } from "./admin-subscriptions-actions";

export const SETTINGS_MUTATE_ROLES = ["super_admin", "operations", "finance"] as const;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type SettingsPlan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: "partner" | "anchor";
  priceMonthlyAel: number | null;
  priceAnnualAel: number | null;
  billingIntervals: string[];
  sortOrder: number;
  status: "Active" | "Archived";
};

export type SettingsFeeTier = {
  id: string;
  label: string;
  minContractValue: number;
  maxContractValue: number | null;
  fee: number | null;
  sortOrder: number;
  status: "Active" | "Archived";
};

export type SettingsSuccessCap = {
  id: string;
  label: string;
  contractValueMin: number;
  contractValueMax: number | null;
  cap: number | null;
  note: string | null;
  sortOrder: number;
  status: "Active" | "Archived";
};

export type AdminSettingsData = {
  plans: SettingsPlan[];
  workspaceFeeTiers: SettingsFeeTier[];
  successFeeCaps: SettingsSuccessCap[];
  landingContent: Record<string, JsonValue>;
  preferences: Record<string, JsonValue>;
};

export type SettingsActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string; code?: string };

const num = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

function requireSettingsMutate(admin: AdminActor): string | null {
  if (
    !admin.staffRoles.some((r) =>
      (SETTINGS_MUTATE_ROLES as readonly string[]).includes(r as never),
    )
  ) {
    return "This action requires an operations, finance or super_admin role.";
  }
  return null;
}

// ---------------------------------------------------------------- full read
export async function doGetAdminSettings(
  admin: AdminActor,
): Promise<{ ok: true; data: AdminSettingsData } | { ok: false; error: string }> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED" };
  try {
    await ensureSchema();
    const [, plans, tiers, caps, landing, prefs] = (await asUser(admin.id, "sb_admin", (tx) => [
      tx`select id, code, name, description, category, price_monthly_ael,
                price_annual_ael, billing_intervals, sort_order, status
           from membership_plans order by category, sort_order, name`,
      tx`select id, label, min_contract_value, max_contract_value, fee, sort_order, status
           from workspace_fee_tiers order by sort_order, min_contract_value`,
      tx`select id, label, contract_value_min, contract_value_max, cap, note, sort_order, status
           from success_fee_caps order by sort_order, contract_value_min`,
      tx`select key, content from landing_content order by key`,
      tx`select key, value, description from platform_settings order by key`,
    ])) as unknown as [
      unknown,
      {
        id: string;
        code: string;
        name: string;
        description: string | null;
        category: "partner" | "anchor";
        price_monthly_ael: string | number | null;
        price_annual_ael: string | number | null;
        billing_intervals: string[];
        sort_order: number;
        status: "Active" | "Archived";
      }[],
      {
        id: string;
        label: string;
        min_contract_value: string | number;
        max_contract_value: string | number | null;
        fee: string | number | null;
        sort_order: number;
        status: "Active" | "Archived";
      }[],
      {
        id: string;
        label: string;
        contract_value_min: string | number;
        contract_value_max: string | number | null;
        cap: string | number | null;
        note: string | null;
        sort_order: number;
        status: "Active" | "Archived";
      }[],
      { key: string; content: unknown }[],
      { key: string; value: unknown; description: string | null }[],
    ];
    return {
      ok: true,
      data: {
        plans: plans.map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          description: p.description,
          category: p.category,
          priceMonthlyAel: num(p.price_monthly_ael),
          priceAnnualAel: num(p.price_annual_ael),
          billingIntervals: p.billing_intervals ?? ["monthly"],
          sortOrder: p.sort_order,
          status: p.status,
        })),
        workspaceFeeTiers: tiers.map((t) => ({
          id: t.id,
          label: t.label,
          minContractValue: Number(t.min_contract_value),
          maxContractValue: num(t.max_contract_value),
          fee: num(t.fee),
          sortOrder: t.sort_order,
          status: t.status,
        })),
        successFeeCaps: caps.map((c) => ({
          id: c.id,
          label: c.label,
          contractValueMin: Number(c.contract_value_min),
          contractValueMax: num(c.contract_value_max),
          cap: num(c.cap),
          note: c.note,
          sortOrder: c.sort_order,
          status: c.status,
        })),
        landingContent: Object.fromEntries(
          landing.map((l) => [l.key, l.content as JsonValue]),
        ),
        preferences: Object.fromEntries(prefs.map((p) => [p.key, p.value as JsonValue])),
      },
    };
  } catch (err) {
    console.error("doGetAdminSettings failed:", err);
    return { ok: false, error: "Could not load platform settings." };
  }
}

// ------------------------------------------------------------ membership plans
export type MembershipPlanInput = {
  name: string;
  description: string | null;
  priceMonthlyAel: number | null;
  priceAnnualAel: number | null;
  billingIntervals: string[];
  sortOrder: number;
  status: "Active" | "Archived";
};

export async function doUpdateMembershipPlan(
  admin: AdminActor,
  planId: string,
  input: MembershipPlanInput,
): Promise<SettingsActionResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED" };
  const denied = requireSettingsMutate(admin);
  if (denied) return { ok: false, error: denied, code: "ROLE_DENIED" };
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, error: "Plan name is required." };
  const intervals = (input.billingIntervals ?? []).filter(
    (iv) => iv === "monthly" || iv === "annual",
  );
  if (intervals.length === 0) {
    return { ok: false, error: "Select at least one billing interval." };
  }
  const monthly = input.priceMonthlyAel === null ? null : Number(input.priceMonthlyAel);
  const annual = input.priceAnnualAel === null ? null : Number(input.priceAnnualAel);
  if (monthly !== null && (Number.isNaN(monthly) || monthly < 0)) {
    return { ok: false, error: "Monthly price must be a non-negative number." };
  }
  if (annual !== null && (Number.isNaN(annual) || annual < 0)) {
    return { ok: false, error: "Annual price must be a non-negative number." };
  }
  const sortOrder = Number.isNaN(Number(input.sortOrder)) ? 100 : Number(input.sortOrder);
  try {
    await ensureSchema();
    const rows = (await asUser(admin.id, "sb_admin", (tx) => [
      tx`select id, code, name, description, category, price_monthly_ael,
                price_annual_ael, billing_intervals, sort_order, status
           from membership_plans where id = ${planId} limit 1`,
    ]))[1] as unknown as {
      id: string;
      code: string;
      name: string;
      description: string | null;
      category: string;
      price_monthly_ael: string | number | null;
      price_annual_ael: string | number | null;
      billing_intervals: string[];
      sort_order: number;
      status: string;
    }[];
    const plan = rows[0];
    if (!plan) return { ok: false, error: "Plan not found." };
    const before = {
      name: plan.name,
      description: plan.description,
      priceMonthlyAel: num(plan.price_monthly_ael),
      priceAnnualAel: num(plan.price_annual_ael),
      billingIntervals: plan.billing_intervals,
      sortOrder: plan.sort_order,
      status: plan.status,
    };
    const after = {
      name,
      description: input.description,
      priceMonthlyAel: monthly,
      priceAnnualAel: annual,
      billingIntervals: intervals,
      sortOrder,
      status: input.status,
    };
    if (JSON.stringify(before) === JSON.stringify(after)) {
      return { ok: true, message: "No changes to save." };
    }
    await asUser(admin.id, "sb_admin", (tx) => [
      tx`update membership_plans set
            name = ${name},
            description = ${input.description},
            price_monthly_ael = ${monthly},
            price_annual_ael = ${annual},
            billing_intervals = ${intervals as unknown as string[]},
            sort_order = ${sortOrder},
            status = ${input.status},
            updated_at = now()
         where id = ${planId}`,
      auditQuery(tx, admin.id, "settings.plan.update", {
        planId,
        code: plan.code,
        before,
        after,
      }),
    ]);
    return { ok: true, message: `Plan "${name}" updated.` };
  } catch (err) {
    console.error("doUpdateMembershipPlan failed:", err);
    return { ok: false, error: "Could not update the plan." };
  }
}

// ------------------------------------------------------------- workspace fees
export type WorkspaceFeeInput = {
  label: string;
  minContractValue: number;
  maxContractValue: number | null;
  fee: number | null;
  sortOrder: number;
  status: "Active" | "Archived";
};

export async function doUpdateWorkspaceFeeTier(
  admin: AdminActor,
  tierId: string,
  input: WorkspaceFeeInput,
): Promise<SettingsActionResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED" };
  const denied = requireSettingsMutate(admin);
  if (denied) return { ok: false, error: denied, code: "ROLE_DENIED" };
  const label = (input.label ?? "").trim();
  if (!label) return { ok: false, error: "Tier label is required." };
  const min = Number(input.minContractValue);
  if (Number.isNaN(min) || min < 0) {
    return { ok: false, error: "Minimum contract value must be a non-negative number." };
  }
  const max = input.maxContractValue === null ? null : Number(input.maxContractValue);
  if (max !== null && (Number.isNaN(max) || max <= min)) {
    return { ok: false, error: "Maximum must be greater than the minimum." };
  }
  const fee = input.fee === null ? null : Number(input.fee);
  if (fee !== null && (Number.isNaN(fee) || fee < 0)) {
    return { ok: false, error: "Fee must be a non-negative number (or blank for custom)." };
  }
  const sortOrder = Number.isNaN(Number(input.sortOrder)) ? 100 : Number(input.sortOrder);
  try {
    await ensureSchema();
    const rows = (await asUser(admin.id, "sb_admin", (tx) => [
      tx`select id, label, min_contract_value, max_contract_value, fee, sort_order, status
           from workspace_fee_tiers where id = ${tierId} limit 1`,
    ]))[1] as unknown as {
      id: string;
      label: string;
      min_contract_value: string | number;
      max_contract_value: string | number | null;
      fee: string | number | null;
      sort_order: number;
      status: string;
    }[];
    const tier = rows[0];
    if (!tier) return { ok: false, error: "Workspace fee tier not found." };
    const before = {
      label: tier.label,
      minContractValue: Number(tier.min_contract_value),
      maxContractValue: num(tier.max_contract_value),
      fee: num(tier.fee),
      sortOrder: tier.sort_order,
      status: tier.status,
    };
    const after = { label, minContractValue: min, maxContractValue: max, fee, sortOrder, status: input.status };
    if (JSON.stringify(before) === JSON.stringify(after)) {
      return { ok: true, message: "No changes to save." };
    }
    await asUser(admin.id, "sb_admin", (tx) => [
      tx`update workspace_fee_tiers set
            label = ${label},
            min_contract_value = ${min},
            max_contract_value = ${max},
            fee = ${fee},
            sort_order = ${sortOrder},
            status = ${input.status}
         where id = ${tierId}`,
      auditQuery(tx, admin.id, "settings.workspace_fee.update", {
        tierId,
        before,
        after,
      }),
    ]);
    return { ok: true, message: `Workspace fee tier "${label}" updated.` };
  } catch (err) {
    console.error("doUpdateWorkspaceFeeTier failed:", err);
    return { ok: false, error: "Could not update the workspace fee tier." };
  }
}

// ------------------------------------------------------------ success fee caps
export type SuccessFeeCapInput = {
  label: string;
  contractValueMin: number;
  contractValueMax: number | null;
  cap: number | null;
  note: string | null;
  sortOrder: number;
  status: "Active" | "Archived";
};

export async function doUpdateSuccessFeeCap(
  admin: AdminActor,
  capId: string,
  input: SuccessFeeCapInput,
): Promise<SettingsActionResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED" };
  const denied = requireSettingsMutate(admin);
  if (denied) return { ok: false, error: denied, code: "ROLE_DENIED" };
  const label = (input.label ?? "").trim();
  if (!label) return { ok: false, error: "Cap label is required." };
  const min = Number(input.contractValueMin);
  if (Number.isNaN(min) || min < 0) {
    return { ok: false, error: "Minimum contract value must be a non-negative number." };
  }
  const max = input.contractValueMax === null ? null : Number(input.contractValueMax);
  if (max !== null && (Number.isNaN(max) || max <= min)) {
    return { ok: false, error: "Maximum must be greater than the minimum." };
  }
  const cap = input.cap === null ? null : Number(input.cap);
  if (cap !== null && (Number.isNaN(cap) || cap < 0)) {
    return { ok: false, error: "Cap must be a non-negative number (or blank for negotiated)." };
  }
  const sortOrder = Number.isNaN(Number(input.sortOrder)) ? 100 : Number(input.sortOrder);
  try {
    await ensureSchema();
    const rows = (await asUser(admin.id, "sb_admin", (tx) => [
      tx`select id, label, contract_value_min, contract_value_max, cap, note, sort_order, status
           from success_fee_caps where id = ${capId} limit 1`,
    ]))[1] as unknown as {
      id: string;
      label: string;
      contract_value_min: string | number;
      contract_value_max: string | number | null;
      cap: string | number | null;
      note: string | null;
      sort_order: number;
      status: string;
    }[];
    const row = rows[0];
    if (!row) return { ok: false, error: "Success fee cap not found." };
    const before = {
      label: row.label,
      contractValueMin: Number(row.contract_value_min),
      contractValueMax: num(row.contract_value_max),
      cap: num(row.cap),
      note: row.note,
      sortOrder: row.sort_order,
      status: row.status,
    };
    const after = {
      label,
      contractValueMin: min,
      contractValueMax: max,
      cap,
      note: input.note,
      sortOrder,
      status: input.status,
    };
    if (JSON.stringify(before) === JSON.stringify(after)) {
      return { ok: true, message: "No changes to save." };
    }
    await asUser(admin.id, "sb_admin", (tx) => [
      tx`update success_fee_caps set
            label = ${label},
            contract_value_min = ${min},
            contract_value_max = ${max},
            cap = ${cap},
            note = ${input.note},
            sort_order = ${sortOrder},
            status = ${input.status}
         where id = ${capId}`,
      auditQuery(tx, admin.id, "settings.success_fee_cap.update", {
        capId,
        before,
        after,
      }),
    ]);
    return { ok: true, message: `Success fee cap "${label}" updated.` };
  } catch (err) {
    console.error("doUpdateSuccessFeeCap failed:", err);
    return { ok: false, error: "Could not update the success fee cap." };
  }
}

// ------------------------------------------------------------ landing content
export async function doUpdateLandingContent(
  admin: AdminActor,
  key: string,
  content: JsonValue,
): Promise<SettingsActionResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED" };
  const denied = requireSettingsMutate(admin);
  if (denied) return { ok: false, error: denied, code: "ROLE_DENIED" };
  const blockKey = (key ?? "").trim();
  if (!blockKey) return { ok: false, error: "Content key is required." };
  if (content === null || content === undefined || content === "") {
    return { ok: false, error: "Content cannot be empty." };
  }
  try {
    await ensureSchema();
    const rows = (await asUser(admin.id, "sb_admin", (tx) => [
      tx`select key, content from landing_content where key = ${blockKey} limit 1`,
    ]))[1] as unknown as { key: string; content: unknown }[];
    const existing = rows[0] ?? null;
    const before = existing ? (existing.content as JsonValue) : null;
    if (existing && JSON.stringify(before) === JSON.stringify(content)) {
      return { ok: true, message: "No changes to save." };
    }
    await asUser(admin.id, "sb_admin", (tx) => [
      existing
        ? tx`update landing_content set content = ${content as never}, updated_by = ${admin.id}, updated_at = now()
             where key = ${blockKey}`
        : tx`insert into landing_content (key, content, updated_by) values (${blockKey}, ${content as never}, ${admin.id})`,
      auditQuery(tx, admin.id, "settings.landing_content.update", {
        key: blockKey,
        before,
        after: content,
      }),
    ]);
    return { ok: true, message: `Landing content "${blockKey}" updated.` };
  } catch (err) {
    console.error("doUpdateLandingContent failed:", err);
    return { ok: false, error: "Could not update landing content." };
  }
}

// ----------------------------------------------------------- system preferences
export async function doUpdatePlatformPreference(
  admin: AdminActor,
  key: string,
  value: string,
  description: string | null,
): Promise<SettingsActionResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED" };
  const denied = requireSettingsMutate(admin);
  if (denied) return { ok: false, error: denied, code: "ROLE_DENIED" };
  const prefKey = (key ?? "").trim();
  if (!prefKey) return { ok: false, error: "Preference key is required." };
  if (!value || !value.trim()) {
    return { ok: false, error: "Preference value must be a non-empty string." };
  }
  try {
    await ensureSchema();
    const rows = (await asUser(admin.id, "sb_admin", (tx) => [
      tx`select key, value, description from platform_settings where key = ${prefKey} limit 1`,
    ]))[1] as unknown as { key: string; value: unknown; description: string | null }[];
    const existing = rows[0] ?? null;
    const before = existing ? (existing.value as JsonValue) : null;
    const newValue: JsonValue = value;
    if (existing && JSON.stringify(before) === JSON.stringify(newValue)) {
      return { ok: true, message: "No changes to save." };
    }
    await asUser(admin.id, "sb_admin", (tx) => [
      existing
        ? tx`update platform_settings set
              value = ${newValue as never},
              description = ${description ?? existing.description},
              updated_by = ${admin.id},
              updated_at = now()
           where key = ${prefKey}`
        : tx`insert into platform_settings (key, value, description, updated_by)
             values (${prefKey}, ${newValue as never}, ${description}, ${admin.id})`,
      auditQuery(tx, admin.id, "settings.preference.update", {
        key: prefKey,
        before,
        after: newValue,
      }),
    ]);
    return { ok: true, message: `Preference "${prefKey}" updated.` };
  } catch (err) {
    console.error("doUpdatePlatformPreference failed:", err);
    return { ok: false, error: "Could not update the preference." };
  }
}

// --------------------------------------------------- audit for settings changes
export function settingsAuditQuery(
  tx: Tx,
  actorId: string,
  action: string,
  details: Record<string, unknown>,
): ReturnType<Tx> {
  return auditQuery(tx, actorId, action, details);
}
