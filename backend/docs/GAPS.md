# Backend Gap Analysis

What the backend must still do to deliver [PRODUCT_SPEC.md](../../docs/PRODUCT_SPEC.md),
and which manual, paper-based or chat-based process each piece replaces.

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
| 5 | **Real message transports** | The outbox renders, queues, claims and dispatches correctly — but every channel resolves to the console transport, so nothing actually reaches a guest. This is now the single thing standing between the product and its core loop. **Decided:** start with Google Workspace SMTP. Note its ~500/day send limit — fine for development and early events, but a 400-guest wedding plus reminders approaches it, so plan to move to a transactional provider before volume arrives. Writing the adapter against plain SMTP keeps that a configuration change |

## 3. High value — the actual digitalisation

Each replaces a process the incumbent market performs by hand.

| # | Gap | Replaces |
|---|---|---|
| 6 | **Invitation sending** | Pasting a link into 400 chats individually. The outbox exists; nothing calls it from the invitation flow |
| 7 | **Reminders and follow-ups** | Chasing non-responders by phone. Scheduled messages are modelled, the triggers are not |
| 8 | **PDF exports** | CSV works for every kind — guest list, seating chart, place cards, catering, bar, playlist, ticket manifest. A venue still wants the seating chart on paper, which needs a renderer and a queue |
| 9 | **Image processing and cover images** | Design endpoints and theme validation are built; what remains is resizing, thumbnails, and attaching an asset as the invitation cover |
| 10 | **Deposit → confirmed booking** | Reconciling a transfer against a calendar by hand |

## 4. Revenue — unbuilt business model lines

Per [PRODUCT_SPEC.md](../../docs/PRODUCT_SPEC.md) §9.

| # | Gap | Stream |
|---|---|---|
| 11 | **Subscription renewal and dunning** | §9.4 — subscribing, invoicing and settling work; nothing charges again when a period lapses, and no card binding is stored, so renewal is manual |
| 12 | **Plan and entitlement enforcement** | §8 — entitlements are published on `/plans` and on the subscription; nothing refuses an action that exceeds them |
| 13 | **Vendor referral accounting** | §9.3 — `feeAmount` records what is owed; no payout |
| 14 | **Corporate contracts** | §9.5 — multi-event, branded |
| 15 | **Tax on invoices** | Invoices are issued with gap-free numbers and captured line items; `taxMinor` is always zero, so an invoice is not yet a tax document |

## 5. Operations and trust

| # | Gap | Why |
|---|---|---|
| 17 | **Audit trail** | Mongo-shaped and documented; blocked on authentication, since there is no actor to record |
| 18 | ~~Health and readiness endpoints~~ | **Done** |
| 18b | **Metrics and tracing** | Deliberately deferred. Service health is covered by Sentry cron check-ins and edge-triggered dependency alerts, neither of which is tracing |
| 19 | ~~Structured logging~~ | **Done** — pino, JSON in production, every line carrying the request id |
| 20 | **Backups and retention policy** | Page lifetime is decided (indefinite on paid tiers, 3 months on free) and modelled as `Plan.invitationLifetimeDays`; nothing sets `Invitation.expiresAt` from it and no sweep reclaims storage |
| 21 | **GDPR automation** | Requests are accepted, tracked against the one-month clock, and carried out — export assembles, erasure anonymises. What is missing is automation: identity verification is a human step, the clock is not alerted on, and nothing records a hard bounce because no real transport is wired |
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
