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
| F38 exact organization context and membership lifecycle, activation-gated | Ambiguous tenant selection and manual ownership/revocation handling |
| F39 staff intake, consultations, atomic draft setup and privacy/recovery | Contact and follow-up records spread across private chats |
| F44 immutable template pins, private authoring/artwork and explicit adoption | Editing shared template data in place |

Backend delivery above does not activate the new features. F38 additional
memberships, F39 production intake and F44 authored publication retain frontend,
operator, recovery and capability gates; see
[current implementation status](../../docs/post-pilot/execution/IMPLEMENTATION_STATUS.md).
Later F31–F44 commerce, corporate/resource and logistics slices remain planned.

## 2. Blocking — nothing ships without these

~~1. Authentication~~, ~~2. Authorization guard~~, ~~3. Rate limiting~~ and
~~4. Job scheduler~~ are **built** — see [ARCHITECTURE.md](ARCHITECTURE.md).

~~5. File upload~~ is built: `POST /events/:eventId/media`.

| # | Gap | Why it blocks |
|---|---|---|
| 5 | **An SMS provider** | The SMS channel is built provider-neutral (decided 9 October 2026): chosen last, numbers normalised, failures classified, copy written. What remains is choosing a provider and writing its adapter — one class implementing `SmsProvider` and a row in `SMS_PROVIDERS` |

The selected pilot also requires performance and four-language acceptance.
The [local rehearsal](PILOT_REHEARSAL.md) passed functional checks and all eight
latency gates in its latest primary run; frontend, human language review and
actual-host acceptance remain. Earlier misses and local variability are retained
in its evidence rather than treated as production capacity proof.

## 3. High value — the actual digitalisation

Each replaces a process the incumbent market performs by hand.

| # | Gap | Replaces |
|---|---|---|
| 6 | **WhatsApp live acceptance** | Signed, scoped sent/delivered/read/failed receipts and host evidence fields are implemented. Account/app/test number, supported/approved templates, real subscription/send/receipt proof and frontend acceptance remain. See [setup checklist](WHATSAPP_SETUP.md); ambiguous failures never globally suppress a guest |
| 7 | **Export pilot acceptance** | All seven kinds now have private CSV/PDF/XLSX worker snapshots, translated standard labels in four languages and synthetic four-script file acceptance. Frontend adoption, human translation review, native spreadsheet/print checks and production worker/private-bucket rehearsal remain |
| 8 | **Shared photo gallery** | PRODUCT_SPEC §7.2 — backend private uploads, moderation, owner removal and durable cleanup are implemented; frontend and production acceptance remain |
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
| 15 | **Vendor referral accounting** | §9.3 — `feeMinor` records what is owed; no payout |
| 16 | **Corporate contracts** | §9.5 — multi-event, branded |
| 17 | **Tax on invoices** | Invoices are issued with gap-free numbers and captured line items; `taxMinor` is always zero, so an invoice is not yet a tax document |

## 5. Operations and trust

| # | Gap | Why |
|---|---|---|
| 18 | ~~Health and readiness endpoints~~ | **Done** |
| 18b | **Metrics and tracing** | Deliberately deferred. Service health is covered by Sentry cron check-ins and edge-triggered dependency alerts, neither of which is tracing |
| 19 | ~~Structured logging~~ | **Done** — pino, JSON in production, every line carrying the request id |
| 20 | **Production backup and retention acceptance** | Lifetime capture and guest-access expiry are built; host data/media are retained by decision. Actual backup destination, installed timers, alerts and production recovery acceptance remain |
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
