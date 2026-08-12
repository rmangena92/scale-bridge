# Stage 4 — Client-feature coverage audit (spec §12 item 17)

Anything visible to a client must be visible to the Master Admin through an
authorised administrative view. This checklist maps every client-facing
surface to the admin surface that covers it, and marks verified vs gap.

Verification basis: Stage 4 session (2026-08-12, reports page live-tested in
browser as admin.demo@scalebridge.test) plus prior stage live verifications
recorded in git history (Stage 1 commits for company detail tabs, Stage 2
commits 6926b77/e698105 for View as Client, Stage 3 commits 49b2c22/054b60e
for subscription management panel + entitlement control).

## Legend
- V = Verified: an authorised admin view exists and renders the same live data.
- G = Gap: no admin view exists yet, or the client surface is a placeholder.

## Client portal (buyer / client org) — /client/*

| Client surface | Where the Master Admin sees it | Status |
|---|---|---|
| Dashboard (contract overview, progress, recent activity) | View as Client (/admin/companies/:id/view-as-client) renders the read-only client portal with real data | V (Stage 2) |
| Contracts list + contract detail (/client/contracts, /contracts/:workspaceId) | View as Client + /admin/contracts (list) + /admin/contracts/:workspaceId (admin contract workspace view) | V |
| Documents | /admin/documents (dedicated admin tab) + company detail Documents tab + View as Client | V |
| Invoices | /admin/finance (invoice summary) + company detail Invoices tab + /admin/reports (contract invoice revenue by status/month) + View as Client | V (Stage 4 also) |
| Messages | View as Client (client messaging renders inside the client view; thread labels + badges surfaced) | V (Stage 2) |
| Notifications | View as Client + /app notifications are admin-visible via View as Client of the owning company | V (Stage 3) |
| Organisation / team / settings | Company detail Overview + Contacts tabs; users via /admin/users | V |
| Approvals, issues, milestones, variations, projects (Part B screens) | Client routes are ComingSoon placeholders (Part B queued) — nothing client-visible to mirror yet. Admin sees underlying data via /admin/contracts/:workspaceId | G (placeholder, not a visibility gap) |
| Client portal login | /admin/login + View as Client session entry (reason-required modal, audit) | V (Stage 2) |

## Subscription & membership client flow

| Client surface | Where the Master Admin sees it | Status |
|---|---|---|
| /app plan banner + notifications card | Company detail Membership + Subscription + Feature Entitlements tabs; /admin/subscriptions list; View as Client renders the /app surface | V (Stage 3) |
| Membership pricing window (post-auth gate) | /admin/reports "Membership plan prices" table (live from membership_plans) + company detail Membership tab | V (Stage 4) |
| Plan selection / commitment confirmation / sandbox checkout | Company detail Subscription tab (status: checkout_started/payment_pending) + /admin/subscriptions + /admin/reports pending-changes list | V |
| Payment confirmation + onboarding (business profile) | Company detail Overview + Membership tabs (account status routing), /admin/companies directory (membership/subscription/verification/health columns) | V (Stage 3) |
| Billing recovery / access denied on failed payment | Company detail Subscription tab (payment_failed status) + /admin/reports (payment_failed counts, recent payment events with provider IDs) | V |

## Lead contractor workspace — /workspaces, /workspaces/:workspaceId

| Client surface | Where the Master Admin sees it | Status |
|---|---|---|
| Lead workspace dashboard + all tabs (packages, tasks, milestones, variations, invoices, documents, pricing, messaging, approvals) | /admin/contracts/:workspaceId (dedicated admin contract workspace view) + company detail Contracts + Workspaces tabs | V |
| Workspace fees / contract workspace list | /admin/workspaces + company detail Workspaces tab | V |
| Invitations (directory + email) | Company detail Contacts tab + /admin/contracts participant views | V |

## AI surfaces

| Client surface | Where the Master Admin sees it | Status |
|---|---|---|
| AI insights (per company) | /admin/ai-insights + company detail AI Insights tab | V |
| Upsell opportunities | /admin/upsells + company detail Upsell Opportunities tab | V |
| AI agent controls / run history | Not yet built as client UI (queued item 7); admin AI tables RLS-enforced | V (data layer) / G (no client UI yet) |

## Other client-facing flows

| Client surface | Where the Master Admin sees it | Status |
|---|---|---|
| Signup / login / invitations | /admin/users (user status, system role) + company detail Contacts; View as Client covers the portal after entry | V |
| Client notifications from admin actions (upgrade/downgrade/override/cancel) | Company detail Subscription tab history + /app notifications via View as Client + /admin/audit-log (billing.admin.* immutable audit) | V (Stage 3) |

## Gaps (substantial, one-line fix each — not built in this pass)

1. Client Part B screens (approvals, issues, milestones, variations, projects,
   documents, invoices detail) are ComingSoon placeholders — build Part B, then
   re-verify each through View as Client and /admin/contracts/:workspaceId.
2. No admin view of the client pricing-window *interaction* (which plan the
   client is viewing mid-checkout) beyond subscription status — optional
   enhancement: session-level analytics on /admin/reports.
3. AI agent controls UI (data-source permissions, run history, prompt/model
   version, error logs, cost monitoring) is queued as platform work (item 7 of
   the build order); once built client-side, mirror it in /admin/ai-insights.
4. /workspaces lead UI is not mirrored tab-for-tab in admin; the admin contract
   workspace view covers the same data but with admin chrome. Acceptable per
   spec ("authorised administrative view"), noted for the Stage 4 final test.

## Stage 4 reports page (new, item 16) — live-verified figures

Cross-checked against direct SQL (asUser admin RLS batch):
- Subscription invoiced AED 3,235.00 / paid AED 2,836.00 (SQL sum of
  subscription_invoices) — matches page.
- Active subscriptions 3 (open 1, strategic 1, verified 1) — matches page.
- Status distribution active 3 / cancel_at_period_end 1 / payment_failed 1 /
  payment_pending 2 / pending_plan_selection 1 (8 total) — matches page.
- Contract invoices: 5 total, paid £9,200.00, outstanding £31,300.00 —
  matches page.
- Webhook events 27; commitments in lock 5 / completed 2; overrides 1 —
  match page.
