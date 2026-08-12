import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AdminShell } from "~/components/AdminShell";
import { Badge, Button, Card, ErrorText, Field, Input, Select, Textarea } from "~/components/ui";
import {
  getAdminSession,
  getAdminSettings,
  updateLandingContent,
  updateMembershipPlan,
  updatePlatformPreference,
  updateSuccessFeeCap,
  updateWorkspaceFeeTier,
} from "~/lib/admin";
import type {
  AdminSettingsData,
  JsonValue,
  SettingsFeeTier,
  SettingsPlan,
  SettingsSuccessCap,
} from "~/lib/admin";

export const Route = createFileRoute("/admin/settings/")({
  loader: async () => {
    const session = await getAdminSession();
    if (session.setupRequired || !session.admin) {
      return { setupRequired: session.setupRequired, admin: null, data: null };
    }
    const result = await getAdminSettings();
    const data = result.ok ? result.data : null;
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      data,
      loadError: result.ok ? null : result.error,
    };
  },
  component: SettingsPage,
});

const TABS = [
  "Fees & Plans",
  "Workspace Fees",
  "Success Fee Caps",
  "Landing Content",
  "System Preferences",
] as const;
type Tab = (typeof TABS)[number];

function SettingsPage() {
  const loader = Route.useLoaderData();
  if (loader.setupRequired) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-mist px-5">
        <Card className="w-full max-w-lg p-6">
          <h1 className="text-xl font-bold text-navy">Platform Settings</h1>
          <p className="mt-2 text-sm text-muted">
            Connect a database (DATABASE_URL) to manage pricing, fees and content.
          </p>
        </Card>
      </div>
    );
  }
  if (!loader.admin) return null;
  const staffRoles: string[] = (loader.admin as { staffRoles?: string[] }).staffRoles ?? [];
  const canEdit = staffRoles.some((r) =>
    (["super_admin", "operations", "finance"] as string[]).includes(r),
  );

  return (
    <AdminShell admin={loader.admin}>
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="text-xl font-bold text-navy">Platform Settings</h1>
          <p className="mt-1 text-sm text-muted">
            Pricing, fees, caps, landing-page content and system preferences. Changes are
            audited and reflect live on the public pricing page and client pricing window.
          </p>
        </div>
        {!canEdit && (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-muted">
            Your staff role is read-only for settings. Changes require operations, finance
            or super_admin.
          </p>
        )}
        {!loader.data && (
          <ErrorText>{loader.loadError ?? "Could not load platform settings."}</ErrorText>
        )}
        {loader.data && (
          <SettingsTabs data={loader.data} canEdit={canEdit} />
        )}
      </div>
    </AdminShell>
  );
}

function SettingsTabs({ data, canEdit }: { data: AdminSettingsData; canEdit: boolean }) {
  const [tab, setTab] = useState<Tab>("Fees & Plans");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
              tab === t
                ? "bg-navy text-white"
                : "bg-white text-muted border border-slate-200 hover:border-brand hover:text-brand"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Fees & Plans" && <PlansTab plans={data.plans} canEdit={canEdit} />}
      {tab === "Workspace Fees" && <TiersTab tiers={data.workspaceFeeTiers} canEdit={canEdit} />}
      {tab === "Success Fee Caps" && <CapsTab caps={data.successFeeCaps} canEdit={canEdit} />}
      {tab === "Landing Content" && <LandingTab content={data.landingContent} canEdit={canEdit} />}
      {tab === "System Preferences" && <PrefsTab prefs={data.preferences} canEdit={canEdit} />}
    </div>
  );
}

type SaveState = { busy: boolean; msg: string; err: string };
const idle: SaveState = { busy: false, msg: "", err: "" };

function SaveBar({ state }: { state: SaveState }) {
  return (
    <div className="flex items-center gap-3">
      {state.msg && <p className="text-sm font-medium text-teal">{state.msg}</p>}
      {state.err && <p className="text-sm font-medium text-danger">{state.err}</p>}
    </div>
  );
}

function PlanRow({ plan, canEdit }: { plan: SettingsPlan; canEdit: boolean }) {
  const [name, setName] = useState(plan.name);
  const [description, setDescription] = useState(plan.description ?? "");
  const [monthly, setMonthly] = useState(plan.priceMonthlyAel === null ? "" : String(plan.priceMonthlyAel));
  const [annual, setAnnual] = useState(plan.priceAnnualAel === null ? "" : String(plan.priceAnnualAel));
  const [intervals, setIntervals] = useState<string[]>(plan.billingIntervals);
  const [sortOrder, setSortOrder] = useState(String(plan.sortOrder));
  const [status, setStatus] = useState<string>(plan.status);
  const [state, setState] = useState<SaveState>(idle);

  const setMonthlyAuto = (v: string) => {
    setMonthly(v);
    const n = Number(v);
    if (!Number.isNaN(n) && n > 0) setAnnual(String(Math.round(n * 10)));
  };

  const save = async () => {
    setState({ busy: true, msg: "", err: "" });
    const res = await updateMembershipPlan({
      data: {
        planId: plan.id,
        input: {
          name,
          description: description.trim() || null,
          priceMonthlyAel: monthly.trim() === "" ? null : Number(monthly),
          priceAnnualAel: annual.trim() === "" ? null : Number(annual),
          billingIntervals: intervals,
          sortOrder: Number(sortOrder) || 100,
          status: status as "Active" | "Archived",
        },
      },
    });
    if (res.ok) {
      setState({ busy: false, msg: res.message, err: "" });
    } else {
      setState({ busy: false, msg: "", err: res.error });
    }
  };

  const toggleInterval = (iv: string) => {
    setIntervals((prev) => (prev.includes(iv) ? prev.filter((x) => x !== iv) : [...prev, iv]));
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-mist px-2 py-0.5 text-xs font-bold text-muted uppercase">
          {plan.category}
        </span>
        <Badge tone={plan.status === "Active" ? "teal" : "slate"}>{status}</Badge>
        <span className="text-xs text-muted">code: {plan.code}</span>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Plan name">
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} />
        </Field>
        <Field label="Sort order">
          <Input value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} disabled={!canEdit} />
        </Field>
        <Field label="Monthly price (AED)" hint="Annual display is monthly x 10 (two months free)">
          <Input
            value={monthly}
            onChange={(e) => setMonthlyAuto(e.target.value)}
            disabled={!canEdit}
            placeholder="e.g. 149"
          />
        </Field>
        <Field label="Annual price (AED)">
          <Input value={annual} onChange={(e) => setAnnual(e.target.value)} disabled={!canEdit} />
        </Field>
        <div className="md:col-span-2">
          <Field label="Description">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={!canEdit} />
          </Field>
        </div>
        <div className="md:col-span-2 flex flex-wrap items-center gap-4">
          <span className="text-sm font-semibold text-ink">Billing intervals:</span>
          {["monthly", "annual"].map((iv) => (
            <label key={iv} className="flex items-center gap-1.5 text-sm text-ink">
              <input
                type="checkbox"
                checked={intervals.includes(iv)}
                onChange={() => toggleInterval(iv)}
                disabled={!canEdit}
              />
              {iv === "monthly" ? "Monthly" : "Annual"}
            </label>
          ))}
          <div className="ml-auto">
            <Select value={status} onChange={(e) => setStatus(e.target.value)} disabled={!canEdit}>
              <option value="Active">Active</option>
              <option value="Archived">Archived</option>
            </Select>
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button onClick={save} disabled={!canEdit || state.busy}>
          {state.busy ? "Saving..." : "Save plan"}
        </Button>
        <SaveBar state={state} />
      </div>
      {status === "Archived" && (
        <p className="mt-2 text-xs text-muted">
          Archived plans stay valid for existing subscriptions; they are hidden from new
          selection on the pricing window.
        </p>
      )}
    </Card>
  );
}

function PlansTab({ plans, canEdit }: { plans: SettingsPlan[]; canEdit: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        AED plans shown on the public pricing page and the client pricing window. Annual =
        monthly x 10 (two months free).
      </p>
      {plans.map((p) => (
        <PlanRow key={p.id} plan={p} canEdit={canEdit} />
      ))}
    </div>
  );
}

function TierRow({ tier, canEdit }: { tier: SettingsFeeTier; canEdit: boolean }) {
  const [label, setLabel] = useState(tier.label);
  const [minV, setMinV] = useState(String(tier.minContractValue));
  const [maxV, setMaxV] = useState(tier.maxContractValue === null ? "" : String(tier.maxContractValue));
  const [fee, setFee] = useState(tier.fee === null ? "" : String(tier.fee));
  const [sortOrder, setSortOrder] = useState(String(tier.sortOrder));
  const [state, setState] = useState<SaveState>(idle);
  const save = async () => {
    setState({ busy: true, msg: "", err: "" });
    const res = await updateWorkspaceFeeTier({
      data: {
        tierId: tier.id,
        input: {
          label,
          minContractValue: Number(minV),
          maxContractValue: maxV.trim() === "" ? null : Number(maxV),
          fee: fee.trim() === "" ? null : Number(fee),
          sortOrder: Number(sortOrder) || 100,
          status: "Active",
        },
      },
    });
    setState(res.ok ? { busy: false, msg: res.message, err: "" } : { busy: false, msg: "", err: res.error });
  };
  return (
    <Card className="p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
        <Field label="Label">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} disabled={!canEdit} />
        </Field>
        <Field label="Min (AED)">
          <Input value={minV} onChange={(e) => setMinV(e.target.value)} disabled={!canEdit} />
        </Field>
        <Field label="Max (AED)" hint="Blank = open ended">
          <Input value={maxV} onChange={(e) => setMaxV(e.target.value)} disabled={!canEdit} />
        </Field>
        <Field label="Fee (AED)" hint="Blank = custom quote">
          <Input value={fee} onChange={(e) => setFee(e.target.value)} disabled={!canEdit} />
        </Field>
        <Field label="Sort">
          <Input value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} disabled={!canEdit} />
        </Field>
        <div className="flex items-end">
          <Button onClick={save} disabled={!canEdit || state.busy}>
            {state.busy ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
      <div className="mt-2">
        <SaveBar state={state} />
      </div>
    </Card>
  );
}

function TiersTab({ tiers, canEdit }: { tiers: SettingsFeeTier[]; canEdit: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Contract workspace fee tiers: under 250k = AED 250, 250k-1M = AED 750, 1M-5M = AED
        1,500, 5M-25M = AED 3,500, over 25M = custom.
      </p>
      {tiers.map((t) => (
        <TierRow key={t.id} tier={t} canEdit={canEdit} />
      ))}
    </div>
  );
}

function CapRow({ cap, canEdit }: { cap: SettingsSuccessCap; canEdit: boolean }) {
  const [label, setLabel] = useState(cap.label);
  const [minV, setMinV] = useState(String(cap.contractValueMin));
  const [maxV, setMaxV] = useState(cap.contractValueMax === null ? "" : String(cap.contractValueMax));
  const [capV, setCapV] = useState(cap.cap === null ? "" : String(cap.cap));
  const [note, setNote] = useState(cap.note ?? "");
  const [state, setState] = useState<SaveState>(idle);
  const save = async () => {
    setState({ busy: true, msg: "", err: "" });
    const res = await updateSuccessFeeCap({
      data: {
        capId: cap.id,
        input: {
          label,
          contractValueMin: Number(minV),
          contractValueMax: maxV.trim() === "" ? null : Number(maxV),
          cap: capV.trim() === "" ? null : Number(capV),
          note: note.trim() || null,
          sortOrder: cap.sortOrder,
          status: "Active",
        },
      },
    });
    setState(res.ok ? { busy: false, msg: res.message, err: "" } : { busy: false, msg: "", err: res.error });
  };
  return (
    <Card className="p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        <Field label="Label">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} disabled={!canEdit} />
        </Field>
        <Field label="Min (AED)">
          <Input value={minV} onChange={(e) => setMinV(e.target.value)} disabled={!canEdit} />
        </Field>
        <Field label="Max (AED)">
          <Input value={maxV} onChange={(e) => setMaxV(e.target.value)} disabled={!canEdit} />
        </Field>
        <Field label="Cap (AED)" hint="Blank = negotiated">
          <Input value={capV} onChange={(e) => setCapV(e.target.value)} disabled={!canEdit} />
        </Field>
        <div className="flex items-end">
          <Button onClick={save} disabled={!canEdit || state.busy}>
            {state.busy ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
      <div className="mt-2">
        <Field label="Note">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} disabled={!canEdit} />
        </Field>
      </div>
      <div className="mt-2">
        <SaveBar state={state} />
      </div>
    </Card>
  );
}

function CapsTab({ caps, canEdit }: { caps: SettingsSuccessCap[]; canEdit: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Success-fee caps: AED 10k under 1M, AED 25k 1M-5M, negotiated above 5M. Applied only
        when ScaleBridge actively facilitates.
      </p>
      {caps.map((c) => (
        <CapRow key={c.id} cap={c} canEdit={canEdit} />
      ))}
    </div>
  );
}

const LANDING_BLOCKS: { key: string; title: string; hint: string; kind: "text" | "json" }[] = [
  { key: "hero.headline_lead", title: "Hero headline (lead)", hint: "e.g. Big contracts.", kind: "text" },
  { key: "hero.headline_accent", title: "Hero headline (accent)", hint: "e.g. Open to every capable business.", kind: "text" },
  { key: "hero.supporting", title: "Hero supporting copy", hint: "Short paragraph under the headline.", kind: "text" },
  { key: "pricing.intro", title: "Pricing section intro", hint: "JSON: {\"heading\": \"...\", \"body\": \"...\"}", kind: "json" },
  { key: "footer.tagline", title: "Footer tagline", hint: "Short tagline for the footer.", kind: "text" },
];

function LandingTab({ content, canEdit }: { content: Record<string, JsonValue>; canEdit: boolean }) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      LANDING_BLOCKS.map((b) => [b.key, content[b.key] === undefined ? "" : JSON.stringify(content[b.key])]),
    ),
  );
  const [state, setState] = useState<SaveState>(idle);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  const save = async (key: string, kind: "text" | "json") => {
    setState({ busy: true, msg: "", err: "" });
    let parsed: JsonValue = draft[key];
    if (kind === "json") {
      try {
        parsed = JSON.parse(draft[key]);
      } catch {
        setState({ busy: false, msg: "", err: "Invalid JSON for this block." });
        return;
      }
    }
    const res = await updateLandingContent({ data: { key, content: parsed } });
    if (res.ok) {
      setState({ busy: false, msg: res.message, err: "" });
      setSavedKey(key);
    } else {
      setState({ busy: false, msg: "", err: res.error });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Editable blocks for the public site. The landing page reads these values live and
        falls back to the built-in copy when a block is missing.
      </p>
      {LANDING_BLOCKS.map((b) => (
        <Card key={b.key} className="p-4">
          <h3 className="text-sm font-bold text-navy">{b.title}</h3>
          <p className="mt-0.5 text-xs text-muted">{b.hint}</p>
          <Textarea
            className="mt-2"
            rows={b.kind === "json" ? 4 : 3}
            value={draft[b.key]}
            onChange={(e) => setDraft((d) => ({ ...d, [b.key]: e.target.value }))}
            disabled={!canEdit}
          />
          <div className="mt-2 flex items-center gap-3">
            <Button onClick={() => save(b.key, b.kind)} disabled={!canEdit || state.busy}>
              {state.busy && savedKey === b.key ? "Saving..." : "Save block"}
            </Button>
            {savedKey === b.key && state.msg && (
              <p className="text-sm font-medium text-teal">{state.msg}</p>
            )}
          </div>
        </Card>
      ))}
      <SaveBar state={state} />
    </div>
  );
}

const PREF_KEYS: { key: string; label: string; hint: string }[] = [
  { key: "platform_name", label: "Platform name", hint: "Display name of the platform." },
  { key: "support_email", label: "Support email", hint: "Contact email shown in admin and client surfaces." },
  { key: "currency_display", label: "Currency display", hint: "Currency code used for pricing display (AED)." },
];

function PrefsTab({ prefs, canEdit }: { prefs: Record<string, JsonValue>; canEdit: boolean }) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(PREF_KEYS.map((p) => [p.key, typeof prefs[p.key] === "string" ? String(prefs[p.key]) : ""])),
  );
  const [state, setState] = useState<SaveState>(idle);
  const save = async (key: string) => {
    setState({ busy: true, msg: "", err: "" });
    const res = await updatePlatformPreference({ data: { key, value: draft[key], description: null } });
    setState(res.ok ? { busy: false, msg: res.message, err: "" } : { busy: false, msg: "", err: res.error });
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Small set of key/value preferences consumed across the platform.
      </p>
      {PREF_KEYS.map((p) => (
        <Card key={p.key} className="p-4">
          <Field label={p.label} hint={p.hint}>
            <div className="flex gap-2">
              <Input value={draft[p.key]} onChange={(e) => setDraft((d) => ({ ...d, [p.key]: e.target.value }))} disabled={!canEdit} />
              <Button onClick={() => save(p.key)} disabled={!canEdit || state.busy}>
                {state.busy ? "Saving..." : "Save"}
              </Button>
            </div>
          </Field>
        </Card>
      ))}
      <SaveBar state={state} />
    </div>
  );
}
