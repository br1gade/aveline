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
| 5 | **Real message transports** | The outbox renders, queues, claims and dispatches correctly — but every channel resolves to the console transport, so nothing actually reaches a guest. This is now the single thing standing between the product and its core loop |

## 3. High value — the actual digitalisation

Each replaces a process the incumbent market performs by hand.

| # | Gap | Replaces |
|---|---|---|
| 6 | **Guest list import** (CSV, contacts) | Typing 400 guests one at a time. `GuestImport` is modelled; the parser is not built |
| 7 | **Seating assignment** | A paper chart redrawn whenever one RSVP changes. `Table`/`Seat` modelled, read path works, the constrained algorithm is not written |
| 8 | **Invitation sending** | Pasting a link into 400 chats individually. The outbox exists; nothing calls it from the invitation flow |
| 9 | **Reminders and follow-ups** | Chasing non-responders by phone. Scheduled messages are modelled, the triggers are not |
| 10 | **Vendor brief endpoints** | Forwarding a spreadsheet to the caterer. `briefScopes`/`briefToken` modelled, endpoints not built |
| 11 | **Exports** (PDF/CSV: seating chart, place cards, catering sheet) | The one artefact a venue still genuinely needs on paper |
| 12 | **Day-of check-in** | A clipboard at the door. `CheckIn` modelled; ticket admission is built, guest check-in is not |
| 13 | **Design endpoints + theme validation** | Design changes requested over chat and applied by staff |
| 14 | **Deposit → confirmed booking** | Reconciling a transfer against a calendar by hand |

## 4. Revenue — unbuilt business model lines

Per [PRODUCT_SPEC.md](../../docs/PRODUCT_SPEC.md) §9.

| # | Gap | Stream |
|---|---|---|
| 15 | **Subscription billing** (card binding) | §9.4 — `Plan`, `Subscription` and `Invoice` are **modelled**; nothing charges or renews yet |
| 16 | **Plan and entitlement enforcement** | §8 — entitlements are columns on `Plan`; nothing reads them |
| 17 | **Vendor referral accounting** | §9.3 — `feeAmount` records what is owed; no payout |
| 18 | **Corporate contracts** | §9.5 — multi-event, branded |
| 19 | **Invoicing and tax** | `Invoice` is modelled; nothing issues one, and nothing computes tax |

## 5. Operations and trust

| # | Gap | Why |
|---|---|---|
| 20 | **Audit trail** | Mongo-shaped and documented; blocked on authentication, since there is no actor to record |
| 21 | ~~Health and readiness endpoints~~ | **Done** |
| 21b | **Metrics and tracing** | Deliberately deferred. Service health is covered by Sentry cron check-ins and edge-triggered dependency alerts, neither of which is tracing |
| 22 | ~~Structured logging~~ | **Done** — pino, JSON in production, every line carrying the request id |
| 23 | **Backups and retention policy** | Page lifetime after an event is still an open decision (§13.8) |
| 24 | **GDPR behaviour** | The schema is in place — `DataSubjectRequest`, `anonymizedAt`, consent fields — but no endpoint accepts a request, nothing anonymises, and nothing assembles an export |
| 25 | **Webhook signature verification** | If any bank pushes callbacks rather than being polled |

## 6. Physical-service bridge

The spec commits to coordinating physical services (§7). These make that real
rather than a phone call.

| # | Gap |
|---|---|
| 26 | **Vendor availability calendar** — booking a caterer currently means asking them |
| 27 | **Delivery and logistics tracking** for decor and printed stationery |
| 28 | **Printed companion orders** — print-on-demand from the same design |
| 29 | **On-site staff assignment** for the day-of coordinator in Production tier |
| 30 | **Physical ticket fallback** — QR on paper for guests without smartphones |

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
