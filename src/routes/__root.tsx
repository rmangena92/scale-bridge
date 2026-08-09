import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import appCss from "~/styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "ScaleBridge — Collaborative Contracting Platform" },
      {
        name: "description",
        content:
          "ScaleBridge is the collaborative contracting platform for small and mid-size businesses: create contracts, define work packages, invite companies, verify participants, and manage delivery end to end.",
      },
      { name: "theme-color", content: "#0B1F3A" },
      {
        name: "og:title",
        content: "ScaleBridge — Collaborative Contracting Platform",
      },
      {
        name: "og:description",
        content:
          "Create a contract, invite the right companies, verify every participant, and manage delivery end to end — with a full audit trail.",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      {
        rel: "icon",
        href: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230B1F3A'/%3E%3Cpath d='M5 21c4-6 7.3-8.7 11-8.7S23 15 27 21' fill='none' stroke='%2316A6A0' stroke-width='2.6' stroke-linecap='round'/%3E%3Cpath d='M5 25.5c4-6 7.3-8.7 11-8.7S23 19.5 27 25.5' fill='none' stroke='%23fff' stroke-width='2.6' stroke-linecap='round' opacity='.55'/%3E%3C/svg%3E",
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap",
      },
    ],
  }),
  notFoundComponent: () => (
    <main className="container-site flex min-h-dvh flex-col items-center justify-center gap-3 text-center">
      <p className="font-display text-2xl font-bold text-navy">Page not found</p>
      <a href="/" className="text-sm font-semibold text-brand hover:underline">
        Back to ScaleBridge
      </a>
    </main>
  ),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
