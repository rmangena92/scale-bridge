import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import {
  createServiceCategory,
  getAdminSession,
  listServiceCategories,
  updateServiceCategory,
} from "~/lib/admin";
import type { ServiceCategoryRow } from "~/lib/services";
import {
  Button,
  Card,
  DbSetupPage,
  EmptyState,
  ErrorText,
  Field,
  Input,
  Textarea,
} from "~/components/ui";

export const Route = createFileRoute("/admin/services/categories")({
  loader: async () => {
    const session = await getAdminSession();
    const categories = await listServiceCategories();
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      initial: categories.ok ? categories.categories : [],
      loadError: categories.ok ? null : categories.error,
    };
  },
  component: CategoriesPage,
});

function CategoriesPage() {
  const loader = Route.useLoaderData();
  const [categories, setCategories] = useState<ServiceCategoryRow[]>(loader.initial);
  const [error, setError] = useState<string | null>(loader.loadError);

  if (loader.setupRequired) {
    return (
      <DbSetupPage title="Service categories">
        Connect a Postgres database (DATABASE_URL) to manage service categories.
      </DbSetupPage>
    );
  }
  if (!loader.admin) return null;
  const admin = loader.admin;

  async function reload() {
    const result = await listServiceCategories();
    if (result.ok) setCategories(result.categories);
    else setError(result.error);
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-teal">Services</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Service categories</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Group the catalogue the way the partner directory presents it —
            every service belongs to exactly one category.
          </p>
        </div>
        <Link to="/admin/services" className="text-sm font-semibold text-brand hover:underline">
          ← Back to services
        </Link>
      </div>

      {error && (
        <div className="mb-5">
          <ErrorText>{error}</ErrorText>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card className="overflow-x-auto">
            {categories.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="No categories yet"
                  body="Create the first category to start organising the catalogue."
                />
              </div>
            ) : (
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                    <th className="px-5 py-3">Category</th>
                    <th className="px-3 py-3">Order</th>
                    <th className="px-3 py-3">Slug</th>
                    <th className="px-5 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {categories.map((c) => (
                    <CategoryRow
                      key={c.id}
                      category={c}
                      adminCanMutate={admin.canMutate}
                      onSaved={reload}
                      onError={setError}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <CreateCategoryCard
          adminCanMutate={admin.canMutate}
          onCreated={reload}
          onError={setError}
        />
      </div>
    </div>
  );
}

function CategoryRow({
  category,
  adminCanMutate,
  onSaved,
  onError,
}: {
  category: ServiceCategoryRow;
  adminCanMutate: boolean;
  onSaved: () => void;
  onError: (e: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [description, setDescription] = useState(category.description ?? "");
  const [sortOrder, setSortOrder] = useState(String(category.sortOrder));
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    onError("");
    const result = await updateServiceCategory({
      data: {
        categoryId: category.id,
        name,
        description: description || null,
        sortOrder: Number(sortOrder) || 0,
      },
    });
    setBusy(false);
    if (result.ok) {
      setEditing(false);
      onSaved();
    } else {
      onError(result.error);
    }
  }

  return (
    <tr className="hover:bg-mist/60">
      <td className="px-5 py-3">
        {editing ? (
          <div className="flex flex-col gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
            />
          </div>
        ) : (
          <>
            <p className="font-semibold text-ink">{category.name}</p>
            {category.description && (
              <p className="mt-0.5 text-xs text-muted">{category.description}</p>
            )}
          </>
        )}
      </td>
      <td className="px-3 py-3">
        {editing ? (
          <Input
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className="w-24"
            type="number"
          />
        ) : (
          <span className="text-muted">{category.sortOrder}</span>
        )}
      </td>
      <td className="px-3 py-3 font-mono text-xs text-muted">{category.slug}</td>
      <td className="px-5 py-3">
        {editing ? (
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={busy || !name.trim()}>
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        ) : adminCanMutate ? (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Rename / edit
          </Button>
        ) : (
          <span className="text-xs text-muted">Read-only</span>
        )}
      </td>
    </tr>
  );
}

function CreateCategoryCard({
  adminCanMutate,
  onCreated,
  onError,
}: {
  adminCanMutate: boolean;
  onCreated: () => void;
  onError: (e: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sortOrder, setSortOrder] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setFlash(null);
    onError("");
    const result = await createServiceCategory({
      data: {
        name,
        description: description || null,
        sortOrder: Number(sortOrder) || 0,
      },
    });
    setBusy(false);
    if (result.ok) {
      setFlash("Category created ✓");
      setName("");
      setDescription("");
      setSortOrder("");
      onCreated();
    } else {
      onError(result.error);
    }
  }

  return (
    <Card className="h-fit p-6">
      <h2 className="text-lg font-bold">Create category</h2>
      {!adminCanMutate ? (
        <p className="mt-2 text-sm text-muted">Read-only role — categories are disabled.</p>
      ) : (
        <form onSubmit={submit} className="mt-3 flex flex-col gap-3">
          <Field label="Name *" htmlFor="cat-name">
            <Input
              id="cat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Facilities Management"
            />
          </Field>
          <Field label="Sort order" htmlFor="cat-order" hint="Lower numbers appear first.">
            <Input
              id="cat-order"
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              placeholder="e.g. 10"
            />
          </Field>
          <Field label="Description" htmlFor="cat-desc">
            <Textarea
              id="cat-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What belongs in this category (optional)"
            />
          </Field>
          <Button type="submit" size="sm" disabled={busy || !name.trim()}>
            {busy ? "Creating…" : "Create category"}
          </Button>
          {flash && (
            <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm font-medium text-success">
              {flash}
            </p>
          )}
        </form>
      )}
    </Card>
  );
}
