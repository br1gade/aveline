# Backlog

What is not built, and what is built wrong, measured against
[PRODUCT_SPEC.md](PRODUCT_SPEC.md) and the domain docs. Compiled 8 October
2026 by tracing every requirement to the HTTP endpoint that delivers it — a
test that seeds the database directly does not count, because a real host
cannot. Every item was traced to the code it names, which is where to start;
bugs marked ✔ were also reproduced by running them.

**How to read it**

| Priority | Meaning |
|---|---|
| **P0** | Blocks the free pilot, or exposes data. Fix before the first real event |
| **P1** | A pilot host will hit it. Fix during the pilot |
| **P2** | After the pilot, or before real money moves |
| **Deferred** | Decided not to build yet — the decision is recorded |

Sizes: **S** under half a day · **M** one to two days · **L** more.
**Client** marks items the frontend needs before it can build a screen.
**Decision** marks items whose product answer is recorded in
[§3](#3-decisions-needed).

**At a glance**

| | P0 | P1 | P2 | After the pilot |
|---|---|---|---|---|
| Bugfixes | 0 open | 14 open | 22 open, of which 8 money | — |
| Features | 1 open (F1, the client) | 0 open | 12 (F19–F30) | 12 revenue and services (F31–F42) |
| Decisions | 4 (D1–D4), all decided | | | |

All ten P0 bugs were fixed on 8 October 2026, and the two backend P0
features — editing an event, and loading the invitation into the editor —
were built the same day. What still blocks the pilot is F1, the client. Fixed items are removed, so a gap in the
numbering is something that has been done.

Infrastructure and accounts (bank, domain, mail DNS, server) are not here;
they are in [GOING_LIVE.md](GOING_LIVE.md). The long-range view of the
backend is [GAPS.md](../backend/docs/GAPS.md).

---

## 1. Bugfixes — built, but wrong

### P0 — before the first real event

None open. B1–B10 were fixed on 8 October 2026.

### P1 — a pilot host will hit it

**Access and privacy**

| # | Bug | What goes wrong | Where | Size |
|---|---|---|---|---|
| B16 | Find-your-seat is unreachable for guests, and lists names to anyone ✔ | Keyed by `eventId`, which no guest-facing response contains. With no query it returns ten names and tables — for any event, drafts included. **Decision** D4 | `guests/guests.controller.ts`, `guests.service.ts` | S |

**Messaging**

| # | Bug | What goes wrong | Where | Size |
|---|---|---|---|---|
| B18 | A household is invited twice when its recipient changes ✔ | Resend is decided per guest, but the recipient is re-chosen per household. The invitation went to the bride because the primary had no email; the host adds the primary's email and presses send — a second invitation. Thank-yous repeat the same way | `invitations/sending/invitation-sender.service.ts`, `send-plan.ts` | S |
| B19 | A database error after a successful send sends it again ✔ | The provider call and the "sent" update share one error path; a failed update is treated as temporary and the message goes out up to five times | `communications/communications.service.ts` | S |
| B20 | Our own errors suppress a guest's address for good ✔ | WhatsApp template errors and every Telegram 400 (including "message too long") are treated as the recipient's hard bounce: a platform-wide suppression no host can lift | `channels/whatsapp.transport.ts`, `telegram.transport.ts` | S |
| B21 | A guest who blocks and re-starts the Telegram bot stays unsubscribed ✔ | The suppression is never cleared, and reminders resolve to a suppressed Telegram with no email fallback | `communications/telegram-webhook.controller.ts` | S |

**Guests, design and seating**

| # | Bug | What goes wrong | Where | Size |
|---|---|---|---|---|
| B24 | Rearranging some blocks leaves the page order ambiguous | Blocks not sent keep their old positions, producing ties; the documented `[RSVP, HERO]` example does it | `invitations/arrangement.service.ts` | S |
| B25 | Partial updates wipe what was omitted | PATCH on a question resets `required` to false when it is left out. The contract is "omitted means leave as is". (Venues and timeline entries fixed.) | `design/` | S |
| B27 | CSV import has no size limit ✔ | API.md says 2 MB; nothing enforces it, and the file is parsed synchronously before the row cap. Media upload has no limit either. A re-import without a side column resets sides the guests chose; household seats are not enforced on import | `guests/guests.controller.ts`, `guests/import/` | S |
| B28 | Auto-seating can overfill a table under concurrency | It plans outside a transaction and writes without re-checking capacity. (Seating one guest by hand now locks the table — fixed 9 October 2026.) | `seating/seating.service.ts` | S |
| B29 | A guest who declines keeps their seat | Their seat still counts against the table | `seating/seating.service.ts` | S |
| B31 | "Still to come" undercounts on the day | Walk-ins and declined guests who turn up are subtracted from those expected | `guests/check-in.service.ts` | S |
| B32 | The playlist includes guests who are not coming | No status filter; capitalisation makes duplicates | `operations/operations.service.ts` | S |

**Public events and tickets**

| # | Bug | What goes wrong | Where | Size |
|---|---|---|---|---|
| B34 | Door staff cannot admit tickets ✔ | `POST /tickets/:code/admit` has no event in its path, so an event coordinator or owner gets 403; only platform staff can scan — any event's tickets | `ticketing/ticketing.controller.ts` | S |
| B35 | Browsing public events rejects its own documented filters ✔ | `?category=…&locale=…` returns 400 | `public-events/public-events.controller.ts` | S |

### P2 — after the pilot, and all of "Money" before real money moves

**Money**

| # | Bug | What goes wrong | Where | Size |
|---|---|---|---|---|
| B36 | A buyer who pays but does not come back gets no ticket ✔ | The reservation expires after 15 minutes without checking the payment, its seats are resold, and reconciliation updates only the payment: captured, no tickets, no refund. Subscription invoices have the same gap | `ticketing/ticket-fulfilment.service.ts`, `jobs` | M |
| B37 | A failed checkout releases its seats twice ✔ | When choosing a provider or starting the payment fails after the order is written, the seats are released and the order left RESERVED; the sweep releases them again. A later buyer pays and gets "cannot commit" | `ticketing/ticketing.service.ts` | S–M |
| B38 | Reconciliation expires a payment the bank captured ✔ | It marks a payment EXPIRED before asking the bank, and EXPIRED is final. Fifty per run, oldest first, so a busy hour reaches real payments only after they expire | `payments/payments.service.ts` | S |
| B39 | Paying an old cheap invoice activates the newer expensive plan ✔ | Changing plan overwrites the one subscription row; confirming the older invoice activates whatever plan it now holds. Abandoning a plan change drops an active customer to trial | `billing/subscriptions.service.ts` | M |
| B40 | Refunds in a foreign currency are 100× too large | Ameriabank refunds convert as AMD whatever the currency. Both gateways treat any HTTP 200 as a successful refund without reading the bank's error code | `payments/providers/ameriabank.gateway.ts`, `arca.gateway.ts` | S |
| B41 | Two refunds at once leave a fully refunded payment "partially refunded" ✔ | The status is computed from a stale read | `payments/payments.service.ts` | S |
| B42 | Anyone can register a payment against any organization | `POST /payments` is public and takes organization, purpose and amount from the caller | `payments/payments.controller.ts` | S |
| B43 | Ticket and cancellation emails can be lost | Queued after the transaction with errors swallowed; a retry returns early because the order is already paid | `ticketing/ticket-fulfilment.service.ts` | S |

**Everything else**

| # | Bug | Where | Size |
|---|---|---|---|
| B44 | Bulk table creation silently creates fewer tables after a deletion ✔ | `seating/seating.service.ts` | S |
| B46 | A block the template cannot render can be re-enabled through the block edit; `variant` is free text | `design/design.service.ts` | S |
| B47 | RSVP accepts `PENDING` as an answer, an unpublished language, and overwrites the host's side for a guest | `rsvp/` | S |
| B48 | Booking a cancelled vendor again returns a cancelled booking and a dead brief link ✔ | `vendors/vendors.service.ts` | S |
| B49 | A PRIVATE invitation is readable by anyone with its generic URL (§13.1 says capability link only) | `invitations/invitations.controller.ts` | S |
| B50 | Platform staff lose their own memberships' permissions (they now see vendor fees) | `infra/auth/auth.guard.ts`, `vendors/` | S |
| B51 | Vendor fees are a decimal string, not integer minor units — breaking for the client to change | `vendors/` | S |
| B53 | Two refreshes with one token make two live sessions ✔ | `infra/auth/auth.service.ts` | S |
| B55 | Any user can revoke or take over another's push device token (nothing sends push yet) ✔ | `devices/devices.service.ts` | S |
| B56 | The Telegram webhook is unauthenticated when no bot token is set, production included | `communications/telegram-webhook.controller.ts` | S |
| B57 | Publish, send and design writes are recorded without their event, so they never appear in the audit trail | `infra/audit/audit.interceptor.ts` | S |
| B58 | Reminder edge cases: "once a day" is not kept across manual and automatic; a reminder still retrying is delivered after the guest answers; the delivery view leaves reminders out | `invitations/sending/` | S |
| B59 | Sending with one unknown `guestIds` entry returns 201, though API.md promises 400 | `invitations/sending/` | S |
| B60 | An answer changed twice within a minute can leave a contradictory last confirmation | `invitations/sending/rsvp-confirmation.ts` | S |

---

## 2. Features — not built

### P0

| # | Feature | Why | Size |
|---|---|---|---|
| F1 | **The client** | `frontend/` is a scaffold. No host or guest can use anything until it exists. Built against [API.md](API.md) and `backend/openapi.json` | L |

### P1

| # | Feature | Why | Size |
|---|---|---|---|

### P2

| # | Feature | Size |
|---|---|---|
| F19 | Shared post-event photo gallery guests can add to (§7.2) | M–L |
| F20 | PDF exports — the seating chart on paper (CSV works) | M |
| F21 | WhatsApp delivery receipts | S–M |
| F22 | Reading bounce reports that arrive after sending | M |
| F23 | Ticket holders join the guest list, so arrivals and catering count them (§13.4) | M |
| F24 | Hero and share-preview images on event listings (§13.2) | S |
| F25 | Guest signature capture (`SIGNATURE` question) | S–M |
| F26 | Caching the personalised page — every link actually sent is personalised and uncached | M |
| F27 | Seating and exports as background jobs, as §12 says | M |
| F28 | Template variants declared and validated; template preview | S–M |
| F29 | Reordering custom RSVP questions | S |
| F30 | Invitation expiry from the plan's lifetime (decided: indefinite paid, 3 months free) | S |

### Revenue and services — after the pilot

| # | Feature | Spec | Size |
|---|---|---|---|
| F31 | Buy a package per event (a subscription is per organization today) | §9.1–9.2 | M |
| F32 | Add-ons: photoshoot, print companion, extra languages | §9.6 | M |
| F33 | Deposit confirms a booking | §7.4 | M |
| F34 | Subscription renewal and dunning | §9.4 | M |
| F35 | Tax on invoices | — | S–M |
| F36 | Vendor referral payouts | §9.3 | M |
| F37 | Corporate contracts, branded | §9.5 | L |
| F38 | More than one organization per account | — | M |
| F39 | Enquiry and consultation intake | §7.4 | M |
| F40 | Design components and quotes (event type × component) | §7.1 | L |
| F41 | Vendor availability calendar | GAPS #23 | M |
| F42 | Logistics, print orders, on-site staff, paper ticket fallback | GAPS #24–27 | L |
| — | **Deferred:** enforcing plan limits — decided 8 October 2026, until after the pilot | §8 | — |

---

## 3. Decisions needed

All four were decided on 8 October 2026.

| # | Question | Blocks | Decided |
|---|---|---|---|
| D1 | How does a household answer? | B7 (fixed) | **Per member, in one submission.** Whoever opens the link marks each named member of the household attending or not. Families split, and catering and seating count people |
| D2 | Who carries out data-protection requests? | B1 (fixed) | **Aveline staff only.** A request matches an email across every customer, so hosts neither see the queue nor act on it |
| D3 | When a host changes the date or venue after sending, are guests told? | F2 (built) | **The host is offered it.** After the edit, they choose whether to send an "updated details" message to everyone already invited |
| D4 | Is find-your-seat public? | B16 | **Only through a guest's own link, and only once the host publishes the seating** |

---

## 4. Documents that contradict the code

All small; each is a doc that would be believed.

- [API.md](API.md) — refunds need `billing:write`, not `billing:read`; the 2 MB import limit is not enforced (B27); reminders "skip guests never invited" (B22).
- [PAYMENTS.md](PAYMENTS.md) — says nothing schedules reconciliation (it is scheduled), that there is no auth (there is), that nothing charges (the first period is charged); paths lack `/v1`.
- [GAPS.md](../backend/docs/GAPS.md) §7 cites item numbers that no longer match its tables.
- `backend/prisma/schema.prisma` refers to `docs/PUBLIC_EVENTS.md`, which does not exist.
- [GOING_LIVE.md](GOING_LIVE.md) — lists GDPR endpoints as still to build; the test count is out of date.
