# Backend Gap Analysis

What the backend must still do to deliver [PRODUCT_SPEC.md](../../docs/PRODUCT_SPEC.md),
and which manual, paper-based or chat-based process each piece replaces.

This is the long-range view. The verified, prioritised list of what to fix
and build next — bugs included — is [BACKLOG.md](../../docs/BACKLOG.md).

The category we are entering runs on messaging apps, spreadsheets and phone
calls. Every gap below is a process that exists today and is performed by a
human retyping something another human already typed.

---

## 1. Built

| Capability | Replaces |
|---|---|
| Invitation rendering, data-bound, multi-language | A page hand-assembled per customer |
| Per-guest capability links | One link forwarded to everyone |
| RSVP intake into a guest graph | Answers landing in an inbox |
| Headcount, catering, bar, playlist sheets | Counting a spreadsheet by hand |
| Guest graph with households and attribution | A flat list of names |
| Host edits to the guest list: add, correct, move, remove | Re-uploading the whole spreadsheet to fix one name |
| One-call dashboard, atomic block arrangement | Multi-step editing workflows |
| Access policy (roles, scoped vendor briefs) | "Who do I forward this to?" |
| Payments core + three bank gateways | Bank transfer screenshots over chat |
| Public announcements and ticketing | Phone bookings and paper tickets |
| Concurrency-safe ticket inventory | Overselling discovered at the door |
| Messaging outbox with templates | Copy-pasting a message 400 times |
| Authentication, sessions, the guard | — |
| Scheduled sweeps behind a distributed lock | — |
| Health, request correlation, one error shape | — |

## 2. Blocking — nothing ships without these

~~1. Authentication~~, ~~2. Authorization guard~~, ~~3. Rate limiting~~ and
~~4. Job scheduler~~ are **built** — see [ARCHITECTURE.md](ARCHITECTURE.md).

~~5. File upload~~ is built: `POST /events/:eventId/media`.

| # | Gap | Why it blocks |
|---|---|---|
| 5 | **An SMS provider** | The SMS channel is built provider-neutral (decided 9 October 2026): chosen last, numbers normalised, failures classified, copy written. What remains is choosing a provider and writing its adapter — one class implementing `SmsProvider` and a row in `SMS_PROVIDERS` |

## 3. High value — the actual digitalisation

Each replaces a process the incumbent market performs by hand.

| # | Gap | Replaces |
|---|---|---|
| 6 | **WhatsApp delivery receipts** | Meta reports delivery and read status by webhook; nothing consumes it, so a WhatsApp message stays SENT and a failure after acceptance is never recorded. The same webhook is how a WhatsApp block would reach us |
| 7 | **PDF exports** | CSV works for every kind — guest list, seating chart, place cards, catering, bar, playlist, ticket manifest. A venue still wants the seating chart on paper, which needs a renderer and a queue |
| 8 | **Shared photo gallery** | PRODUCT_SPEC §7.2 — the guest book and the thank-you flow are built; a gallery guests can add to needs capability-token uploads and a moderation answer |
| 9 | **Disputed refunds** | A ticket order with any admitted ticket cannot be cancelled — refunding after attendance is a dispute with the buyer, not a cancellation, and voiding a used ticket would erase the record that they came. There is no flow for that dispute; it is handled outside the system |
| 10 | **Partial ticket cancellation** | **Decided (8 October 2026): whole orders only.** A buyer who can bring three of four is refunded and buys again. Revisit if hosts ask |
| 11 | **Image cropping** | Photos reach the guest page with smaller WebP copies made by a background job, and alt text is written per language. What remains is cropping to a shape and focal points |
| 12 | **Deposit → confirmed booking** | Reconciling a transfer against a calendar by hand |

## 4. Revenue — unbuilt business model lines

Per [PRODUCT_SPEC.md](../../docs/PRODUCT_SPEC.md) §9.

| # | Gap | Stream |
|---|---|---|
| 13 | **Subscription renewal and dunning** | §9.4 — subscribing, invoicing and settling work; nothing charges again when a period lapses, and no card binding is stored, so renewal is manual |
| 14 | **Plan and entitlement enforcement** | §8 — entitlements are published on `/plans` and on the subscription; nothing refuses an action that exceeds them. **Decided (8 October 2026): deferred until after the pilot** — paid plans stay inactive and limits stay unenforced until real events show which limits matter and what to charge |
| 15 | **Vendor referral accounting** | §9.3 — `feeAmount` records what is owed; no payout |
| 16 | **Corporate contracts** | §9.5 — multi-event, branded |
| 17 | **Tax on invoices** | Invoices are issued with gap-free numbers and captured line items; `taxMinor` is always zero, so an invoice is not yet a tax document |

## 5. Operations and trust

| # | Gap | Why |
|---|---|---|
| 18 | ~~Health and readiness endpoints~~ | **Done** |
| 18b | **Metrics and tracing** | Deliberately deferred. Service health is covered by Sentry cron check-ins and edge-triggered dependency alerts, neither of which is tracing |
| 19 | ~~Structured logging~~ | **Done** — pino, JSON in production, every line carrying the request id |
| 20 | **Backups and retention policy** | Page lifetime is decided (indefinite on paid tiers, 3 months on free) and modelled as `Plan.invitationLifetimeDays`; nothing sets `Invitation.expiresAt` from it and no sweep reclaims storage |
| 21 | **GDPR identity verification** | Requests are accepted, tracked, carried out, and the one-month clock is now swept daily and raised in Sentry when it is missed. What stays manual is establishing who is asking — a human step by design, since acting on an unverified request is itself a breach |
| 22 | **Webhook signature verification** | If any bank pushes callbacks rather than being polled |

## 6. Physical-service bridge

The spec commits to coordinating physical services (§7). These make that real
rather than a phone call.

| # | Gap |
|---|---|
| 23 | **Vendor availability calendar** — booking a caterer currently means asking them |
| 24 | **Delivery and logistics tracking** for decor and printed stationery |
| 25 | **Printed companion orders** — print-on-demand from the same design |
| 26 | **On-site staff assignment** for the day-of coordinator in Production tier |
| 27 | **Physical ticket fallback** — QR on paper for guests without smartphones |

---

## 7. Suggested order

The sequencing argument, not just a list.

**First — unblock everything else.** Authentication, the guard, and the job
scheduler (#1, #2, #4). Nothing is deployable without the first two, and three
correctness-critical sweeps are inert without the third.

**Second — the sending loop.** Upload pipeline, guest import, invitation
sending, reminders (#5, #6, #8, #9). Together these close the loop the product
actually sells: import a guest list, send invitations, collect responses, chase
non-responders. Today each step requires a human.

**Third — the operational payoff.** Seating, exports, check-in (#7, #11, #12).
This is the Managed tier's visible value and the hardest thing for a
page-builder competitor to copy.

**Fourth — revenue.** Subscription billing and entitlements (#15, #16), which
convert the product from a transaction into infrastructure.

**Throughout — trust.** Rate limiting, audit, health, logging (#3, #20–22)
alongside the above rather than after.
