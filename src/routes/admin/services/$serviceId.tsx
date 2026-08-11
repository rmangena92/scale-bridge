import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import {
  getAdminSession,
  getServiceDetail,
  getServiceEvidence,
  listServiceCategories,
  listServices,
  mergeServices,
  setServiceStatus,
  updateService,
} from "~/lib/admin";
import type {
  ServiceCategoryRow,
  ServiceDetailResult,
  ServiceEvidenceItem,
  ServiceRow,
  ServiceStatus,
} from "~/lib/services";
import { SERVICE_STATUSES } from "~/lib/service-types";
import {
  ConfidenceBadge,
  DecisionBadge,
  formatDate,
  formatDateTime,
  ServiceStatusBadge,
  VerificationBadge,
} from "~/components/CatalogueBits";
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
  Textarea,
} from "~/components/ui";

export const Route = createFileRoute("/admin/services/$serviceId")({
  loader: async ({ params }) => {
    const session = await getAdminSession();
    const [detail, evidence, categories, all] = await Promise.all([
      getServiceDetail({ data: { serviceId: params.serviceId } }),
      getServiceEvidence({ data: { serviceId: params.serviceId } }),
      listServiceCategories(),
      listServices({ data: {} }),
    ]);
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      initialDetail: detail.ok ? detail : null,
      initialEvidence: evidence.ok ? evidence.evidence : [],
      loadError: detail.ok ? null : detail.error,
      categories: categories.ok ? categories.categories : [],
      allServices: all.ok ? all.services : [],
    };
  },
  component: ServiceDetailPage,
});

function ServiceDetailPage() {
  const loader = Route.useLoaderData();
  const [detail, setDetail] = useState<ServiceDetailResult | null>(loader.initialDetail);
  const [evidence, setEvidence] = useState<ServiceEvidenceItem[]>(
    loader.initialEvidence,
  );
  const [error, setError] = useState<string | null>(loader.loadError);

  if (loader.setupRequired) {
    return (
      <DbSetupPage title="Service profile">
        Connect a Postgres database (DATABASE_URL) to manage services.
      </DbSetupPage>
    );
  }
  if (!loader.admin) return null;
  if (!detail || !detail.ok) {
    return (
      <div className="mb-6">
        <ErrorText>{error ?? "Service not found."}</ErrorText>
        <Link to="/admin/services" className="mt-4 inline-block text-sm font-semibold text-brand hover:underline">
          ← Back to services
        </Link>
      </div>
    );
  }
  const serviceId = detail.service.id;

  async function refresh() {
    const [d, e] = await Promise.all([
      getServiceDetail({ data: { serviceId } }),
      getServiceEvidence({ data: { serviceId } }),
    ]);
    if (d.ok) setDetail(d);
    if (e.ok) setEvidence(e.evidence);
    if (!d.ok) setError(d.error);
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-teal">Services</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold">{detail.service.name}</h1>
            <ServiceStatusBadge status={detail.service.status} />
            <Badge tone="navy">{detail.service.categoryName}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted">
            {detail.service.industry ?? "—"} · updated {formatDate(detail.service.updatedAt)}
          </p>
        </div>
        <Link to="/admin/services" className="text-sm font-semibold text-brand hover:underline">
          ← Back to services
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <InfoCard detail={detail} />
          <ProvidersCard detail={detail} />
          <EvidenceCard evidence={evidence} />
        </div>
        <div className="flex flex-col gap-6">
          <AdminActionsCard
            service={detail.service}
            categories={loader.categories}
            allServices={loader.allServices}
            adminCanMutate={loader.admin.canMutate}
            onChanged={refresh}
            onError={setError}
          />
          <RelatedCard title="Related services" services={detail.related} />
          <RelatedCard title="Upsell services" services={detail.upsells} />
        </div>
      </div>
    </div>
  );
}

function InfoCard({ detail }: { detail: Extract<ServiceDetailResult, { ok: true }> }) {
  const s = detail.service;
  return (
    <Card className="p-6">
      <h2 className="text-lg font-bold">Service information</h2>
      {s.description ? (
        <p className="mt-2 text-sm text-ink">{s.description}</p>
      ) : (
        <p className="mt-2 text-sm text-muted">No description yet.</p>
      )}
      <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Fact label="Industry" value={s.industry ?? "—"} />
        <Fact label="Category" value={s.categoryName} />
        <Fact label="Capacity" value={s.capacity ?? "—"} />
        <Fact label="Geographic coverage" value={s.geographicCoverage ?? "—"} />
        <Fact label="Providers (verified)" value={String(s.providerCount)} />
        <Fact label="Potential providers" value={String(s.potentialProviderCount)} />
        <Fact label="Active demand" value={String(s.activeDemandCount)} />
        <Fact label="Created" value={formatDate(s.createdAt)} />
      </dl>
      <h3 className="mt-5 text-sm font-bold uppercase tracking-wider text-muted">
        Required qualifications
      </h3>
      {s.requiredQualifications.length === 0 ? (
        <p className="mt-1 text-sm text-muted">None recorded.</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {s.requiredQualifications.map((q) => (
            <span
              key={q}
              className="rounded-full bg-mist px-2.5 py-0.5 text-xs font-semibold text-navy"
            >
              {q}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}

function ProvidersCard({ detail }: { detail: Extract<ServiceDetailResult, { ok: true }> }) {
  return (
    <Card className="overflow-x-auto">
      <div className="px-6 pt-6">
        <h2 className="text-lg font-bold">Providers</h2>
        <p className="mt-1 text-sm text-muted">
          Company relationships with source, confidence, verification and admin decision.
        </p>
      </div>
      {detail.providers.length === 0 ? (
        <div className="p-6">
          <EmptyState
            title="No providers linked"
            body="Company relationships for this service appear here once companies are mapped to it."
          />
        </div>
      ) : (
        <table className="mt-3 w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
              <th className="px-6 py-3">Company</th>
              <th className="px-3 py-3">Source</th>
              <th className="px-3 py-3">Confidence</th>
              <th className="px-3 py-3">Verification</th>
              <th className="px-3 py-3">Active</th>
              <th className="px-3 py-3">Upsell</th>
              <th className="px-6 py-3">Admin decision</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {detail.providers.map((p) => (
              <tr key={p.id} className="hover:bg-mist/60">
                <td className="px-6 py-3">
                  <Link
                    to="/admin/companies/$companyId"
                    params={{ companyId: p.companyId }}
                    className="font-semibold text-navy hover:text-brand"
                  >
                    {p.companyName}
                  </Link>
                  <p className="text-xs text-muted">{p.companyType ?? "—"}</p>
                </td>
                <td className="px-3 py-3 text-muted">{p.source}</td>
                <td className="px-3 py-3">
                  <ConfidenceBadge confidence={p.confidence} />
                </td>
                <td className="px-3 py-3">
                  <VerificationBadge status={p.verificationStatus} />
                </td>
                <td className="px-3 py-3">
                  {p.activeWithScalebridge ? (
                    <Badge tone="green">Yes</Badge>
                  ) : (
                    <Badge tone="slate">No</Badge>
                  )}
                </td>
                <td className="px-3 py-3">
                  {p.upsellRecommended ? (
                    <Badge tone="teal">Yes</Badge>
                  ) : (
                    <Badge tone="slate">No</Badge>
                  )}
                </td>
                <td className="px-6 py-3">
                  <DecisionBadge decision={p.adminDecision} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function EvidenceCard({
  evidence,
}: {
  evidence: ServiceEvidenceItem[];
}) {
  return (
    <Card>
      <div className="px-6 pt-6">
        <h2 className="text-lg font-bold">Evidence</h2>
        <p className="mt-1 text-sm text-muted">
          Proof rows behind company relationships — service pages, capability
          statements, case studies.
        </p>
      </div>
      {evidence.length === 0 ? (
        <div className="p-6">
          <EmptyState
            title="No evidence rows"
            body="Evidence captured from websites, documents and the AI agent appears here."
          />
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {evidence.map((e) => (
            <li key={e.id} className="px-6 py-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-ink">{e.title ?? "Untitled evidence"}</p>
                <Badge tone="slate">{e.evidenceType ?? "document"}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted">
                {e.companyName} · captured {formatDateTime(e.capturedAt)}
                {e.agentVersion ? ` · agent v${e.agentVersion}` : ""}
              </p>
              {e.sourceUrl && (
                <a
                  href={e.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block max-w-full truncate text-xs font-semibold text-brand hover:underline"
                >
                  {e.sourceUrl}
                </a>
              )}
              {e.excerpt && (
                <p className="mt-1.5 rounded-lg bg-mist px-3 py-2 text-xs text-ink">{e.excerpt}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AdminActionsCard({
  service,
  categories,
  allServices,
  adminCanMutate,
  onChanged,
  onError,
}: {
  service: ServiceRow;
  categories: ServiceCategoryRow[];
  allServices: ServiceRow[];
  adminCanMutate: boolean;
  onChanged: () => void;
  onError: (e: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [showMerge, setShowMerge] = useState(false);

  async function changeStatus(status: ServiceStatus) {
    if (status === service.status || !adminCanMutate) return;
    setBusy(true);
    setFlash(null);
    onError("");
    const result = await setServiceStatus({ data: { serviceId: service.id, status } });
    setBusy(false);
    if (result.ok) {
      setFlash(`Status → ${status} ✓`);
      onChanged();
    } else {
      onError(result.error);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-lg font-bold">Admin actions</h2>
      <p className="mt-1 text-xs text-muted">Every change is written to the audit log.</p>

      {!adminCanMutate ? (
        <p className="mt-3 text-sm text-muted">Read-only role — changes are disabled.</p>
      ) : (
        <>
          <div className="mt-4">
            <p className="text-xs font-bold uppercase tracking-wider text-muted">Change status</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SERVICE_STATUSES.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={s === service.status ? "secondary" : "outline"}
                  onClick={() => changeStatus(s)}
                  disabled={busy || s === service.status}
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <Button size="sm" variant="outline" onClick={() => { setShowEdit((v) => !v); setShowMerge(false); }}>
              {showEdit ? "Close edit" : "Edit service"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setShowMerge((v) => !v); setShowEdit(false); }}>
              {showMerge ? "Close merge" : "Merge services"}
            </Button>
          </div>

          {showEdit && (
            <EditForm
              service={service}
              categories={categories}
              onSaved={() => {
                setShowEdit(false);
                setFlash("Service updated ✓");
                onChanged();
              }}
              onError={onError}
            />
          )}
          {showMerge && (
            <MergeForm
              service={service}
              allServices={allServices}
              onMerged={(keptName) => {
                setShowMerge(false);
                setFlash(`Merged into ${keptName} ✓`);
                onChanged();
              }}
              onError={onError}
            />
          )}
        </>
      )}

      {flash && (
        <p className="mt-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm font-medium text-success">
          {flash}
        </p>
      )}
    </Card>
  );
}

function EditForm({
  service,
  categories,
  onSaved,
  onError,
}: {
  service: ServiceRow;
  categories: ServiceCategoryRow[];
  onSaved: () => void;
  onError: (e: string) => void;
}) {
  const [name, setName] = useState(service.name);
  const [categoryId, setCategoryId] = useState(service.categoryId);
  const [status, setStatus] = useState<ServiceStatus>(service.status);
  const [description, setDescription] = useState(service.description ?? "");
  const [industry, setIndustry] = useState(service.industry ?? "");
  const [capacity, setCapacity] = useState(service.capacity ?? "");
  const [coverage, setCoverage] = useState(service.geographicCoverage ?? "");
  const [qualifications, setQualifications] = useState(
    service.requiredQualifications.join(", "),
  );
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !categoryId) return;
    setBusy(true);
    onError("");
    const result = await updateService({
      data: {
        serviceId: service.id,
        input: {
          name,
          categoryId,
          status,
          description: description || null,
          industry: industry || null,
          capacity: capacity || null,
          geographicCoverage: coverage || null,
          requiredQualifications: qualifications
            .split(",")
            .map((q) => q.trim())
            .filter(Boolean),
          relatedServiceIds: service.relatedServiceIds,
          upsellServiceIds: service.upsellServiceIds,
        },
      },
    });
    setBusy(false);
    if (result.ok) onSaved();
    else onError(result.error);
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-mist/50 p-4">
      <Field label="Name *" htmlFor="e-name">
        <Input id="e-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category *" htmlFor="e-cat">
          <Select id="e-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" htmlFor="e-status">
          <Select id="e-status" value={status} onChange={(e) => setStatus(e.target.value as ServiceStatus)}>
            {SERVICE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Industry" htmlFor="e-industry">
          <Input id="e-industry" value={industry} onChange={(e) => setIndustry(e.target.value)} />
        </Field>
        <Field label="Capacity" htmlFor="e-capacity">
          <Input id="e-capacity" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </Field>
      </div>
      <Field label="Geographic coverage" htmlFor="e-coverage">
        <Input id="e-coverage" value={coverage} onChange={(e) => setCoverage(e.target.value)} />
      </Field>
      <Field label="Required qualifications (comma-separated)" htmlFor="e-quals">
        <Input id="e-quals" value={qualifications} onChange={(e) => setQualifications(e.target.value)} />
      </Field>
      <Field label="Description" htmlFor="e-desc">
        <Textarea id="e-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div>
        <Button type="submit" size="sm" disabled={busy || !name.trim() || !categoryId}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

function MergeForm({
  service,
  allServices,
  onMerged,
  onError,
}: {
  service: ServiceRow;
  allServices: ServiceRow[];
  onMerged: (keptName: string) => void;
  onError: (e: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const others = allServices.filter((s) => s.id !== service.id && s.status !== "Archived");

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function submit() {
    if (selected.length === 0 || busy) return;
    setBusy(true);
    onError("");
    const result = await mergeServices({
      data: { keepId: service.id, mergeIds: selected },
    });
    setBusy(false);
    if (result.ok) onMerged(service.name);
    else onError(result.error);
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-mist/50 p-4">
      <p className="text-sm font-semibold text-ink">
        Merge other services into <span className="text-brand">{service.name}</span>
      </p>
      <p className="mt-1 text-xs text-muted">
        Their company relationships move to this service and they are archived.
      </p>
      {others.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No other active services to merge.</p>
      ) : (
        <>
          <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto">
            {others.map((s) => (
              <li key={s.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-white">
                  <input
                    type="checkbox"
                    checked={selected.includes(s.id)}
                    onChange={() => toggle(s.id)}
                    className="size-4 accent-brand"
                  />
                  <span className="font-semibold text-navy">{s.name}</span>
                  <span className="text-xs text-muted">({s.categoryName})</span>
                </label>
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            className="mt-3"
            disabled={busy || selected.length === 0}
            onClick={submit}
          >
            {busy ? "Merging…" : `Merge ${selected.length} into ${service.name}`}
          </Button>
        </>
      )}
    </div>
  );
}

function RelatedCard({ title, services }: { title: string; services: ServiceRow[] }) {
  return (
    <Card className="p-6">
      <h2 className="text-lg font-bold">{title}</h2>
      {services.length === 0 ? (
        <p className="mt-2 text-sm text-muted">None linked.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {services.map((s) => (
            <li key={s.id} className="py-2">
              <Link
                to="/admin/services/$serviceId"
                params={{ serviceId: s.id }}
                className="font-semibold text-navy hover:text-brand"
              >
                {s.name}
              </Link>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="text-xs text-muted">{s.categoryName}</span>
                <ServiceStatusBadge status={s.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
