import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useClientPortal } from "~/components/ClientShell";
import {
  Badge,
  Button,
  Card,
  DbSetupPage,
  EmptyState,
  ErrorText,
  Textarea,
} from "~/components/ui";
import {
  getClientSession,
  listClientConversations,
  listClientMessages,
  markClientMessagesRead,
  resolveClientOrg,
  sendClientMessage,
} from "~/lib/client";
import type {
  ClientConversation,
  ClientMessage,
  ClientThread,
} from "~/lib/types";
import { CLIENT_MESSAGE_THREAD_LABELS } from "~/lib/types";

export const Route = createFileRoute("/client/messages")({
  validateSearch: (search: Record<string, unknown>) => ({
    org: typeof search.org === "string" ? search.org : undefined,
    ws: typeof search.ws === "string" ? search.ws : undefined,
    thread: typeof search.thread === "string" ? search.thread : undefined,
  }),
  loaderDeps: ({ search }) => ({ org: search.org, ws: search.ws, thread: search.thread }),
  loader: async ({ deps }) => {
    const session = await getClientSession();
    if (!session.client) {
      return {
        setupRequired: session.setupRequired,
        orgId: null,
        conversations: [],
        thread: null,
        loadError: null,
      };
    }
    const org = resolveClientOrg(session.client, deps.org);
    const convResult = await listClientConversations({ data: { orgId: org.orgId } });
    let thread: ClientThread | null = null;
    if (deps.ws && deps.thread) {
      const t = await listClientMessages({
        data: { orgId: org.orgId, workspaceId: deps.ws, threadKey: deps.thread },
      });
      thread = t.ok ? t.data : null;
    }
    return {
      setupRequired: session.setupRequired,
      orgId: org.orgId,
      conversations: convResult.ok ? convResult.data : [],
      thread,
      loadError: convResult.ok ? null : convResult.error,
    };
  },
  component: MessagesPage,
});

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) +
    " · " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function MessagesPage() {
  const { setupRequired, orgId, conversations, thread, loadError } = Route.useLoaderData();
  const navigate = useNavigate();
  const { org } = useClientPortal();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [threadData, setThreadData] = useState<ClientThread | null>(thread);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [convos, setConvos] = useState<ClientConversation[]>(conversations);

  const selectedKey = threadData ? `${threadData.workspaceId}::${threadData.threadKey}` : null;

  useEffect(() => {
    setConvos(conversations);
  }, [conversations]);
  useEffect(() => {
    setThreadData(thread);
  }, [thread]);

  async function openThread(wsId: string, threadKey: string) {
    setThreadError(null);
    setThreadData(null);
    await navigate({
      to: "/client/messages",
      search: { org: org.orgId, ws: wsId, thread: threadKey },
      replace: true,
    });
    const r = await listClientMessages({
      data: { orgId: org.orgId, workspaceId: wsId, threadKey },
    });
    if (r.ok) {
      setThreadData(r.data);
      if (r.data.unread > 0) {
        void markClientMessagesRead({ data: { orgId: org.orgId, workspaceId: wsId, threadKey } });
        const updated = convos.map((c) =>
          c.workspaceId === wsId && c.threadKey === threadKey ? { ...c, unread: 0 } : c,
        );
        setConvos(updated);
      }
    } else {
      setThreadError(r.error);
    }
  }

  async function handleSend() {
    if (!threadData || !body.trim() || sending) return;
    setSending(true);
    setThreadError(null);
    const r = await sendClientMessage({
      data: {
        orgId: org.orgId,
        workspaceId: threadData.workspaceId,
        threadType: threadData.threadType,
        threadEntityId: threadData.entityId ?? null,
        body,
      },
    });
    setSending(false);
    if (!r.ok) {
      setThreadError(r.error);
      return;
    }
    setBody("");
    const [t, c] = await Promise.all([
      listClientMessages({
        data: { orgId: org.orgId, workspaceId: threadData.workspaceId, threadKey: threadData.threadKey },
      }),
      listClientConversations({ data: { orgId: org.orgId } }),
    ]);
    if (t.ok) setThreadData(t.data);
    if (c.ok) setConvos(c.data);
  }

  if (setupRequired) {
    return (
      <DbSetupPage title="Messages">
        Connect a Postgres database (DATABASE_URL) to view messages.
      </DbSetupPage>
    );
  }
  if (!orgId) return null;

  const threadLabel = threadData
    ? CLIENT_MESSAGE_THREAD_LABELS[threadData.threadType]
    : "";

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">Messages</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Conversations</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Contract-level communication with your lead contractor — plus threaded
          discussions on milestones, documents, issues and variations.
        </p>
      </div>
      {loadError && (
        <div className="mb-6">
          <ErrorText>{loadError}</ErrorText>
        </div>
      )}
      {convos.length === 0 && !loadError ? (
        <EmptyState
          title="No conversations yet"
          body="Once a contract is shared with your organisation, its client–lead channel will appear here."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          {/* conversation list */}
          <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto pr-1">
            {convos.map((c) => {
              const key = `${c.workspaceId}::${c.threadKey}`;
              const active = key === selectedKey;
              const label =
                c.threadType === "general"
                  ? c.workspaceTitle
                  : `${CLIENT_MESSAGE_THREAD_LABELS[c.threadType]}${c.entityTitle ? ` — ${c.entityTitle}` : ""}`;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => openThread(c.workspaceId, c.threadKey)}
                  className={`rounded-xl border p-3 text-left transition ${
                    active
                      ? "border-blue bg-blue/5"
                      : "border-slate-200 bg-white hover:border-blue/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-bold text-navy">{label}</p>
                    {c.unread > 0 && (
                      <Badge tone="blue" className="shrink-0">
                        {c.unread}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {c.lastMessageAt
                      ? `${c.lastAuthorSide === "lead" ? c.lastAuthorName ?? "Lead contractor" : "You"} · ${c.lastBody}`
                      : "No messages yet"}
                  </p>
                  <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {c.workspaceTitle}
                  </p>
                </button>
              );
            })}
          </div>
          {/* thread pane */}
          <Card className="flex min-h-[420px] flex-col p-0">
            {!threadData ? (
              <div className="flex flex-1 items-center justify-center p-10 text-sm text-muted">
                {threadError ? (
                  <ErrorText>{threadError}</ErrorText>
                ) : (
                  "Select a conversation to view it."
                )}
              </div>
            ) : (
              <>
                <div className="border-b border-slate-100 px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold text-navy">
                        {threadData.threadType === "general"
                          ? threadData.workspaceTitle
                          : `${threadLabel}${threadData.entityTitle ? ` — ${threadData.entityTitle}` : ""}`}
                      </p>
                      <p className="text-xs text-muted">
                        {threadData.workspaceTitle} · Lead:{" "}
                        {threadData.leadName ?? threadData.leadEmail ?? "Lead contractor"}
                        {threadData.leadCompany ? ` (${threadData.leadCompany})` : ""}
                      </p>
                    </div>
                    <Badge tone="navy">{threadLabel}</Badge>
                  </div>
                </div>
                <div className="flex flex-1 flex-col gap-3 overflow-y-auto bg-mist/50 px-5 py-4">
                  {threadData.messages.length === 0 && (
                    <p className="py-8 text-center text-sm text-muted">
                      No messages in this thread yet — say hello to your lead contractor.
                    </p>
                  )}
                  {threadData.messages.map((m) => (
                    <MessageBubble key={m.id} message={m} />
                  ))}
                </div>
                <div className="border-t border-slate-100 p-4">
                  {threadError && (
                    <div className="mb-2">
                      <ErrorText>{threadError}</ErrorText>
                    </div>
                  )}
                  <div className="flex items-end gap-2">
                    <Textarea
                      className="min-h-[44px] flex-1"
                      placeholder={`Message the lead contractor…`}
                      value={body}
                      maxLength={4000}
                      onChange={(e) => setBody(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void handleSend();
                        }
                      }}
                    />
                    <Button onClick={() => void handleSend()} disabled={!body.trim() || sending}>
                      {sending ? "Sending…" : "Send"}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: ClientMessage }) {
  const fromClient = message.authorSide === "client";
  return (
    <div className={`flex ${fromClient ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm shadow-sm ${
          fromClient
            ? "rounded-br-sm bg-blue text-white"
            : "rounded-bl-sm border border-slate-200 bg-white text-navy"
        }`}
      >
        {!fromClient && (
          <p className="text-[11px] font-bold uppercase tracking-wide text-teal">
            {message.authorName ?? "Lead contractor"}
          </p>
        )}
        <p className="whitespace-pre-wrap">{message.body}</p>
        <p className={`mt-1 text-[10px] ${fromClient ? "text-white/70" : "text-muted"}`}>
          {fmtTime(message.createdAt)}
        </p>
      </div>
    </div>
  );
}
