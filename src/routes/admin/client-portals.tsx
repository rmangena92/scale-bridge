import { createFileRoute } from "@tanstack/react-router";
import { getAdminSession, listClientPortals } from "~/lib/admin";
import type { AdminClientPortalRow } from "~/lib/admin";
import { Badge, Card, DbSetupPage, EmptyState, ErrorText } from "~/components/ui";

export const Route = createFileRoute("/admin/client-portals")({
  loader: async () => {
    const session = await getAdminSession();
    const result = await listClientPortals();
    return {
      setupRequired: session.setupRequired,
      admin: session.admin,
      initial: result.ok ? result.portals : [],
      loadError: result.ok ? null : result.error,
    };
  },
  component: ClientPortalsPage,
});

const statusTones: Record<string, "green" | "red" | "amber" | "slate" | "blue" | "teal"> = {
  draft: "slate",
  registered: "blue",
  under_review: "amber",
  verified: "green",
  suspended: "red",
  archived: "slate",
};

function fmtDate(v: string): string {
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function ClientPortalsPage() {
  const loader = Route.useLoaderData();
  if (loader.setupRequired) {
    return (
      <DbSetupPage title="Client portals">
        Connect a Postgres database (DATABASE_URL) to manage client portals.
      </DbSetupPage>
    );
  }
  if (!loader.admin) return null;
  const portals: AdminClientPortalRow[] = loader.initial;
  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-teal">Client Portals</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Client organisations</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Buying organisations with a ScaleBridge client portal — their contracts,
          members and registration details. Portal-level client views arrive with a
          later stage.
        </p>
      </div>
      {loader.loadError && (
        <div className="mb-5">
          <ErrorText>{loader.loadError}</ErrorText>
        </div>
      )}
      <Card className="overflow-x-auto">
        {portals.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No client organisations yet"
              body="Client organisations appear here once a buying organisation is registered and linked to a contract."
            />
          </div>
        ) : (
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">Organisation</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Registration</th>
                <th className="px-3 py-3">Country</th>
                <th className="px-3 py-3">Contact</th>
                <th className="px-3 py-3">Members</th>
                <th className="px-3 py-3">Linked contracts</th>
                <th className="px-5 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {portals.map((p) => (
                <tr key={p.id} className="hover:bg-mist/60 align-top">
                  <td className="px-5 py-3 font-semibold text-navy">{p.name}</td>
                  <td className="px-3 py-3">
                    <Badge tone={statusTones[p.status] ?? "slate"}>{p.status}</Badge>
                  </td>
                  <td className="px-3 py-3 text-muted">{p.registrationNumber ?? "—"}</td>
                  <td className="px-3 py-3 text-muted">{p.registrationCountry ?? "—"}</td>
                  <td className="px-3 py-3">
                    <p className="text-ink">{p.contactEmail ?? "—"}</p>
                    <p className="text-xs text-muted">{p.contactPhone ?? ""}</p>
                  </td>
                  <td className="px-3 py-3 text-muted">{p.memberCount}</td>
                  <td className="px-3 py-3 text-muted">
                    {p.contractCount > 0 ? (
                      <span>
                        <span className="font-semibold text-navy">{p.contractCount}</span>{" "}
                        <span className="text-xs">{p.contractNames.join(", ")}</span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-5 py-3 text-xs text-muted">{fmtDate(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
