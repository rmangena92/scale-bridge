import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import { getClientOrg, getClientSession, updateClientOrg, resolveClientOrg } from "~/lib/client";
import { CLIENT_ORG_STATUS_LABELS } from "~/lib/types";
import { Badge, Button, Card, DbSetupPage, ErrorText, Field, Input, Textarea } from "~/components/ui";
import { useClientPortal } from "~/components/ClientShell";

export const Route = createFileRoute("/client/organisation")({
  validateSearch: (search: Record<string, unknown>) => ({
    org: typeof search.org === "string" ? search.org : undefined,
  }),
  loaderDeps: ({ search }) => ({ org: search.org }),
  loader: async ({ deps }) => {
    const session = await getClientSession();
    if (!session.client) {
      return { setupRequired: session.setupRequired, client: null, orgId: null, org: null, loadError: null };
    }
    const org = resolveClientOrg(session.client, deps.org);
    const result = await getClientOrg({ data: { orgId: org.orgId } });
    return {
      setupRequired: session.setupRequired,
      client: session.client,
      orgId: org.orgId,
      org: result.ok ? result.data : null,
      loadError: result.ok ? null : result.error,
    };
  },
  component: OrganisationPage,
});

function OrganisationPage() {
  const { setupRequired, client, orgId, org, loadError } = Route.useLoaderData();
  const { org: membership } = useClientPortal();
  const isAdmin = membership.role === "client_admin";

  const [form, setForm] = useState(() => ({
    registrationNumber: org?.registrationNumber ?? "",
    registrationCountry: org?.registrationCountry ?? "",
    taxId: org?.taxId ?? "",
    address: org?.address ?? "",
    contactEmail: org?.contactEmail ?? "",
    contactPhone: org?.contactPhone ?? "",
  }));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (setupRequired) {
    return (
      <DbSetupPage title="My Organisation">
        Connect a Postgres database (DATABASE_URL) to view your organisation.
      </DbSetupPage>
    );
  }
  if (!client || !orgId) return null;

  function setField(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setSaving(true);
    const result = await updateClientOrg({
      data: { orgId, ...form },
    });
    setSaving(false);
    if (result.ok) {
      setEditing(false);
      setMessage("Organisation profile saved (audit-logged).");
    } else {
      setError(result.error);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">My Organisation</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{org?.name ?? "Organisation"}</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Your organisation's registration and contact details, as held by
          ScaleBridge{isAdmin ? " — you can update the basic fields below." : " — read-only for your role."}
        </p>
      </div>

      {loadError && (
        <div className="mb-6">
          <ErrorText>{loadError}</ErrorText>
        </div>
      )}

      {org && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="p-6 lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Organisation profile</h2>
              {isAdmin && !editing && (
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
            </div>

            {message && <p className="mt-3 text-sm font-medium text-success">{message}</p>}
            {error && (
              <div className="mt-3">
                <ErrorText>{error}</ErrorText>
              </div>
            )}

            {editing ? (
              <form onSubmit={onSave} className="mt-5 flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Registration number" htmlFor="reg-no">
                    <Input
                      id="reg-no"
                      value={form.registrationNumber}
                      onChange={(e) => setField("registrationNumber", e.target.value)}
                    />
                  </Field>
                  <Field label="Registration country" htmlFor="reg-country">
                    <Input
                      id="reg-country"
                      value={form.registrationCountry}
                      onChange={(e) => setField("registrationCountry", e.target.value)}
                    />
                  </Field>
                  <Field label="Tax ID / VAT" htmlFor="tax-id">
                    <Input
                      id="tax-id"
                      value={form.taxId}
                      onChange={(e) => setField("taxId", e.target.value)}
                    />
                  </Field>
                  <Field label="Contact email" htmlFor="contact-email">
                    <Input
                      id="contact-email"
                      type="email"
                      value={form.contactEmail}
                      onChange={(e) => setField("contactEmail", e.target.value)}
                    />
                  </Field>
                  <Field label="Contact phone" htmlFor="contact-phone">
                    <Input
                      id="contact-phone"
                      value={form.contactPhone}
                      onChange={(e) => setField("contactPhone", e.target.value)}
                    />
                  </Field>
                </div>
                <Field label="Registered address" htmlFor="address">
                  <Textarea
                    id="address"
                    value={form.address}
                    onChange={(e) => setField("address", e.target.value)}
                  />
                </Field>
                <div className="flex items-center gap-3">
                  <Button type="submit" disabled={saving}>
                    {saving ? "Saving…" : "Save changes"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setEditing(false);
                      setError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <dl className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2">
                <OrgField label="Name" value={org.name} />
                <OrgField label="Status" value={CLIENT_ORG_STATUS_LABELS[org.status]} />
                <OrgField label="Registration number" value={org.registrationNumber ?? "—"} />
                <OrgField label="Registration country" value={org.registrationCountry ?? "—"} />
                <OrgField label="Tax ID / VAT" value={org.taxId ?? "—"} />
                <OrgField label="Contact email" value={org.contactEmail ?? "—"} />
                <OrgField label="Contact phone" value={org.contactPhone ?? "—"} />
                <OrgField label="Registered address" value={org.address ?? "—"} />
              </dl>
            )}
          </Card>

          <div className="flex flex-col gap-6">
            <Card className="p-6">
              <h2 className="text-lg font-bold">Account status</h2>
              <div className="mt-3 flex items-center gap-2">
                <Badge tone={org.status === "verified" ? "green" : org.status === "suspended" ? "red" : "amber"}>
                  {CLIENT_ORG_STATUS_LABELS[org.status]}
                </Badge>
              </div>
              <p className="mt-3 text-xs text-muted">
                Registered {shortDate(org.createdAt)} · last updated {shortDate(org.updatedAt)}.
              </p>
            </Card>
            <Card className="p-6">
              <h2 className="text-lg font-bold">Your role</h2>
              <p className="mt-2 text-sm text-ink">{membership.role}</p>
              <p className="mt-1 text-xs text-muted">
                {isAdmin
                  ? "You can update this organisation's profile and manage the team."
                  : "Read-only for this organisation — contact your client administrator to make changes."}
              </p>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function OrgField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
