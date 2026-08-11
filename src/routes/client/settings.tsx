import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import { getClientSettings, getClientSession, updateClientProfile } from "~/lib/client";
import { CLIENT_ROLE_LABELS } from "~/lib/types";
import { Badge, Button, Card, DbSetupPage, ErrorText, Field, Input, Select } from "~/components/ui";

export const Route = createFileRoute("/client/settings")({
  loader: async () => {
    const session = await getClientSession();
    const settings = await getClientSettings();
    return {
      setupRequired: session.setupRequired,
      client: session.client,
      settings: settings.ok ? settings.data : null,
      settingsError: settings.ok ? null : settings.error,
    };
  },
  component: SettingsPage,
});

function SettingsPage() {
  const { setupRequired, client, settings, settingsError } = Route.useLoaderData();
  const navigate = useNavigate();
  const [name, setName] = useState(settings?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState({ emailNotifications: true, inAppNotifications: true });

  if (setupRequired) {
    return (
      <DbSetupPage title="Settings">
        Connect a Postgres database (DATABASE_URL) to manage your settings.
      </DbSetupPage>
    );
  }
  if (!client || !settings) return null;

  async function onSaveProfile(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(null);
    setSaving(true);
    const result = await updateClientProfile({ data: { name } });
    setSaving(false);
    if (result.ok) {
      setSaved("Profile saved.");
    } else {
      setError(result.error);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">Settings</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Profile &amp; preferences</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Your personal details and notification preferences across the client portal.
        </p>
      </div>

      {settingsError && (
        <div className="mb-6">
          <ErrorText>{settingsError}</ErrorText>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <h2 className="text-lg font-bold">Profile</h2>
          {saved && <p className="mt-3 text-sm font-medium text-success">{saved}</p>}
          {error && (
            <div className="mt-3">
              <ErrorText>{error}</ErrorText>
            </div>
          )}
          <form onSubmit={onSaveProfile} className="mt-4 flex flex-col gap-4">
            <Field label="Full name" htmlFor="profile-name">
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                required
              />
            </Field>
            <Field label="Email" htmlFor="profile-email">
              <Input id="profile-email" value={settings.email} disabled />
            </Field>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save profile"}
              </Button>
            </div>
          </form>
        </Card>

        <div className="flex flex-col gap-6">
          <Card className="p-6">
            <h2 className="text-lg font-bold">Organisations</h2>
            {settings.orgs.length <= 1 ? (
              <p className="mt-2 text-sm text-muted">
                You act for one organisation. When you're added to more, you can
                switch between them from the portal header.
              </p>
            ) : (
              <div className="mt-3 flex flex-col gap-2">
                {settings.orgs.map((o) => (
                  <div
                    key={o.orgId}
                    className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2"
                  >
                    <span className="truncate text-sm font-semibold text-ink">{o.orgName}</span>
                    <Badge tone={o.orgId === client.primaryOrg.orgId ? "teal" : "slate"}>
                      {CLIENT_ROLE_LABELS[o.role]}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-6">
            <h2 className="text-lg font-bold">Notifications</h2>
            <p className="mt-1 text-xs text-muted">Preferences ship with messaging in Part C.</p>
            <div className="mt-4 flex flex-col gap-3">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-ink">Email notifications</span>
                <Select
                  aria-label="Email notifications"
                  className="h-9 w-28"
                  value={prefs.emailNotifications ? "on" : "off"}
                  onChange={(e) => setPrefs((p) => ({ ...p, emailNotifications: e.target.value === "on" }))}
                >
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </Select>
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-ink">In-app notifications</span>
                <Select
                  aria-label="In-app notifications"
                  className="h-9 w-28"
                  value={prefs.inAppNotifications ? "on" : "off"}
                  onChange={(e) => setPrefs((p) => ({ ...p, inAppNotifications: e.target.value === "on" }))}
                >
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </Select>
              </label>
            </div>
            <p className="mt-3 text-xs text-muted">
              Stub only — no notifications are sent yet.
            </p>
          </Card>

          <Card className="p-6">
            <h2 className="text-lg font-bold">Signed in as</h2>
            <p className="mt-2 text-sm font-semibold text-ink">{settings.email}</p>
            <p className="mt-0.5 text-xs text-muted">System role: {settings.systemRole}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => navigate({ to: "/" })}>
              Back to ScaleBridge home
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
