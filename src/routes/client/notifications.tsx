import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge, Button, Card, DbSetupPage, EmptyState, ErrorText } from "~/components/ui";
import {
  getClientSession,
  listClientNotifications,
  markAllClientNotificationsRead,
  markClientNotificationRead,
  resolveClientOrg,
} from "~/lib/client";
import type { ClientNotification } from "~/lib/types";
import {
  CLIENT_NOTIFICATION_TYPE_LABELS,
  CLIENT_NOTIFICATION_TYPE_TONES,
} from "~/lib/types";

export const Route = createFileRoute("/client/notifications")({
  validateSearch: (search: Record<string, unknown>) => ({
    org: typeof search.org === "string" ? search.org : undefined,
  }),
  loaderDeps: ({ search }) => ({ org: search.org }),
  loader: async ({ deps }) => {
    const session = await getClientSession();
    if (!session.client) {
      return { setupRequired: session.setupRequired, orgId: null, notifications: [], unread: 0, loadError: null };
    }
    const org = resolveClientOrg(session.client, deps.org);
    const result = await listClientNotifications({ data: { orgId: org.orgId } });
    return {
      setupRequired: session.setupRequired,
      orgId: org.orgId,
      notifications: result.ok ? result.data.notifications : [],
      unread: result.ok ? result.data.unreadCount : 0,
      loadError: result.ok ? null : result.error,
    };
  },
  component: NotificationsPage,
});

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) +
    " · " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}

function NotificationsPage() {
  const { setupRequired, orgId, notifications, unread, loadError } = Route.useLoaderData();
  const navigate = useNavigate();
  const [items, setItems] = useState<ClientNotification[]>(notifications);
  const [unreadCount, setUnreadCount] = useState(unread);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setItems(notifications);
    setUnreadCount(unread);
  }, [notifications, unread]);

  async function openNotification(n: ClientNotification) {
    if (!orgId) return;
    if (!n.read) {
      await markClientNotificationRead({ data: { orgId, notificationId: n.id } });
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnreadCount((c: number) => Math.max(0, c - 1));
    }
    if (n.link) {
      const orgParam = new URLSearchParams(n.link.split("?")[1] ?? "").get("org");
      if (n.link.startsWith("/client/")) {
        await navigate({ to: n.link, search: orgParam ? { org: orgParam } : { org: orgId } });
        return;
      }
      window.location.assign(n.link);
    }
  }

  async function markAll() {
    if (!orgId || busy) return;
    setBusy(true);
    setError(null);
    const r = await markAllClientNotificationsRead({ data: { orgId } });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setItems((prev) => prev.map((x) => ({ ...x, read: true })));
    setUnreadCount(0);
  }

  if (setupRequired) {
    return (
      <DbSetupPage title="Notifications">
        Connect a Postgres database (DATABASE_URL) to view notifications.
      </DbSetupPage>
    );
  }
  if (!orgId) return null;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-teal">Notifications</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Notifications</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Invitations, approvals needing your attention and new messages from your contracts.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {unreadCount > 0 && <Badge tone="blue">{unreadCount} unread</Badge>}
          <Button variant="outline" size="sm" onClick={() => void markAll()} disabled={busy || unreadCount === 0}>
            {busy ? "Marking…" : "Mark all as read"}
          </Button>
        </div>
      </div>
      {loadError && (
        <div className="mb-6">
          <ErrorText>{loadError}</ErrorText>
        </div>
      )}
      {error && (
        <div className="mb-6">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      {items.length === 0 && !loadError ? (
        <EmptyState title="No notifications" body="You're all caught up." />
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((n) => (
            <div
              key={n.id}
              role="button"
              tabIndex={0}
              className="cursor-pointer"
              onClick={() => void openNotification(n)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") void openNotification(n);
              }}
            >
              <Card
                className={`p-4 transition hover:border-blue/40 ${n.read ? "" : "border-blue/50 bg-blue/[0.03]"}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={CLIENT_NOTIFICATION_TYPE_TONES[n.type]}>
                    {CLIENT_NOTIFICATION_TYPE_LABELS[n.type]}
                  </Badge>
                  {!n.read && <Badge tone="amber">New</Badge>}
                  {n.workspaceTitle && (
                    <span className="text-xs text-muted">{n.workspaceTitle}</span>
                  )}
                  <span className="ml-auto text-[11px] text-muted">{fmtTime(n.createdAt)}</span>
                </div>
                <p className="mt-2 text-sm font-bold text-navy">{n.title}</p>
                {n.body && <p className="mt-1 text-sm text-muted">{n.body}</p>}
              </Card>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
