import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import {
  createService,
  getAdminSession,
  listServiceCategories,
  listServices,
} from "~/lib/admin";
import type { ServiceCategoryRow, ServiceRow } from "~/lib/services";
import { SERVICE_STATUSES } from "~/lib/service-types";
import { ServiceStatusBadge } from "~/components/CatalogueBits";
import {
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

export const Route = createFileRoute("/admin/services")({
  loader: async () => {
    const session = await getAdminSession();
    const [services, categories] = await Promise.all([
      listServices({ data: {} }),
      listServiceCategories(),
    ]);
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      initial: services.ok ? services.services : [],
      loadError: services.ok ? null : services.error,
      categories: categories.ok ? categories.categories : [],
      categoriesError: categories.ok ? null : categories.error,
    };
  },
  component: ServicesPage,
});

function ServicesPage() {
  const loader = Route.useLoaderData();
  const [services, setServices] = useState<ServiceRow[]>(loader.initial);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [industry, setIndustry] = useState("");
  const [error, setError] = useState<string | null>(loader.loadError);
  const [pending, setPending] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  if (loader.setupRequired) {
    return (
      <DbSetupPage title="Services">
        Connect a Postgres database (DATABASE_URL) to manage the services catalogue.
      </DbSetupPage>
    );
  }
  if (!loader.admin) return null;

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await listServices({
      data: { search: query, status, categoryId, industry },
    });
    setPending(false);
    if (result.ok) {
      setServices(result.services);
    } else {
      setError(result.error);
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-teal">Services</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Central services catalogue</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Every service — name, category, industry, qualifications, providers,
            demand and upsell relationships — managed from the live catalogue.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setShowCreate((v) => !v)}
            disabled={!loader.admin.canMutate}
          >
            {showCreate ? "Close form" : "New service"}
          </Button>
          <Link
            to="/admin/services/categories"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-navy transition-colors hover:border-brand hover:text-brand"
          >
            Categories
          </Link>
        </div>
      </div>

      {showCreate && (
        <CreateServiceCard
          categories={loader.categories}
          onCreated={() => onSearch({ preventDefault: () => {} } as FormEvent)}
          onClose={() => setShowCreate(false)}
        />
      )}

      <Card className="p-5">
        <form onSubmit={onSearch} className="flex flex-wrap items-end gap-3">
          <div className="min-w-52 flex-1">
            <Field label="Search" htmlFor="service-search">
              <Input
                id="service-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Service name or description…"
              />
            </Field>
          </div>
          <div className="w-44">
            <Field label="Status" htmlFor="service-status">
              <Select id="service-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All statuses</option>
                {SERVICE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="w-52">
            <Field label="Category" htmlFor="service-category">
              <Select
                id="service-category"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">All categories</option>
                {loader.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="w-44">
            <Field label="Industry" htmlFor="service-industry">
              <Input
                id="service-industry"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="e.g. Facilities"
              />
            </Field>
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Searching…" : "Search"}
          </Button>
        </form>
      </Card>

      {loader.categoriesError && (
        <div className="mt-5">
          <ErrorText>{loader.categoriesError}</ErrorText>
        </div>
      )}
      {error && (
        <div className="mt-5">
          <ErrorText>{error}</ErrorText>
        </div>
      )}

      <Card className="mt-5 overflow-x-auto">
        {services.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No services found"
              body="Try a different search term or clear the filters."
            />
          </div>
        ) : (
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">Service</th>
                <th className="px-3 py-3">Category</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Providers</th>
                <th className="px-3 py-3">Active demand</th>
                <th className="px-5 py-3">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {services.map((s) => (
                <tr key={s.id} className="hover:bg-mist/60">
                  <td className="px-5 py-3">
                    <Link
                      to="/admin/services/$serviceId"
                      params={{ serviceId: s.id }}
                      className="font-semibold text-navy hover:text-brand"
                    >
                      {s.name}
                    </Link>
                    <p className="max-w-xs truncate text-xs text-muted">
                      {s.industry ?? "—"}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-muted">{s.categoryName}</td>
                  <td className="px-3 py-3">
                    <ServiceStatusBadge status={s.status} />
                  </td>
                  <td className="px-3 py-3">
                    <span className="font-semibold text-navy">{s.providerCount}</span>
                    <span className="text-muted"> verified · </span>
                    <span className="font-semibold text-navy">{s.potentialProviderCount}</span>
                    <span className="text-muted"> potential</span>
                  </td>
                  <td className="px-3 py-3 text-muted">{s.activeDemandCount}</td>
                  <td className="px-5 py-3 text-xs text-muted">
                    {new Date(s.updatedAt).toLocaleDateString()}
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

function CreateServiceCard({
  categories,
  onCreated,
  onClose,
}: {
  categories: ServiceCategoryRow[];
  onCreated: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [status, setStatus] = useState("Listed");
  const [description, setDescription] = useState("");
  const [industry, setIndustry] = useState("");
  const [capacity, setCapacity] = useState("");
  const [coverage, setCoverage] = useState("");
  const [qualifications, setQualifications] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !categoryId) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    const result = await createService({
      data: {
        name,
        categoryId,
        status: status as ServiceRow["status"],
        description: description || null,
        industry: industry || null,
        capacity: capacity || null,
        geographicCoverage: coverage || null,
        requiredQualifications: qualifications
          .split(",")
          .map((q) => q.trim())
          .filter(Boolean),
      },
    });
    setBusy(false);
    if (result.ok) {
      setFlash("Service created ✓");
      setName("");
      setDescription("");
      setIndustry("");
      setCapacity("");
      setCoverage("");
      setQualifications("");
      onCreated();
    } else {
      setError(result.error);
    }
  }

  return (
    <Card className="mb-6 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">Create a service</h2>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Name *" htmlFor="svc-name">
          <Input id="svc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HVAC Maintenance" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category *" htmlFor="svc-cat">
            <Select id="svc-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" htmlFor="svc-status">
            <Select id="svc-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              {SERVICE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Industry" htmlFor="svc-industry">
          <Input id="svc-industry" value={industry} onChange={(e) => setIndustry(e.target.value)} />
        </Field>
        <Field label="Capacity" htmlFor="svc-capacity">
          <Input id="svc-capacity" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </Field>
        <Field label="Geographic coverage" htmlFor="svc-coverage">
          <Input id="svc-coverage" value={coverage} onChange={(e) => setCoverage(e.target.value)} />
        </Field>
        <Field
          label="Required qualifications"
          htmlFor="svc-quals"
          hint="Comma-separated, e.g. Electrical licence, White card"
        >
          <Input id="svc-quals" value={qualifications} onChange={(e) => setQualifications(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description" htmlFor="svc-desc">
            <Textarea id="svc-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" size="sm" disabled={busy || !name.trim() || !categoryId}>
            {busy ? "Creating…" : "Create service"}
          </Button>
          {error && <ErrorText>{error}</ErrorText>}
          {flash && (
            <span className="rounded-lg border border-success/30 bg-success/10 px-3 py-1.5 text-sm font-medium text-success">
              {flash}
            </span>
          )}
        </div>
      </form>
    </Card>
  );
}
