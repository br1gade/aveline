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
| Bugfixes | 0 open | 0 open | 4 open, of which 8 money | — |
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

**Messaging**

| # | Bug | What goes wrong | Where | Size |
|---|---|---|---|---|

**Guests, design and seating**

| # | Bug | What goes wrong | Where | Size |
|---|---|---|---|---|

**Public events and tickets**

| # | Bug | What goes wrong | Where | Size |
|---|---|---|---|---|

### P2 — after the pilot, and all of "Money" before real money moves

**Money**

| # | Bug | What goes wrong | Where | Size |
|---|---|---|---|---|

**Everything else**

| # | Bug | Where | Size |
|---|---|---|---|
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

D1–D4 were decided on 8 October 2026, D5–D7 on 9 October.

| # | Question | Blocks | Decided |
|---|---|---|---|
| D1 | How does a household answer? | B7 (fixed) | **Per member, in one submission.** Whoever opens the link marks each named member of the household attending or not. Families split, and catering and seating count people |
| D2 | Who carries out data-protection requests? | B1 (fixed) | **Aveline staff only.** A request matches an email across every customer, so hosts neither see the queue nor act on it |
| D3 | When a host changes the date or venue after sending, are guests told? | F2 (built) | **The host is offered it.** After the edit, they choose whether to send an "updated details" message to everyone already invited |
| D4 | Is find-your-seat public? | B16 | **Only through a guest's own link, and only once the host publishes the seating** |
| D5 | A ticket buyer pays after their hold lapsed: then what? | B36 (fixed) | **Issue the tickets if the seats are still there; otherwise refund in full and tell the buyer** |
| D6 | May a PRIVATE invitation be read from its generic link? | B49 | **No — personal links only, as the spec says.** A host who wants one shareable link sets the event UNLISTED |
| D7 | What becomes of the public `POST /payments`? | B42 (fixed) | **Removed.** Payments start only from Aveline's own flows; a deposit flow will start its own |

---

## 4. Documents that contradict the code

All small; each is a doc that would be believed.

- [API.md](API.md) — refunds need `billing:write`, not `billing:read`; the 2 MB import limit is not enforced (B27); reminders "skip guests never invited" (B22).
- [PAYMENTS.md](PAYMENTS.md) — says nothing schedules reconciliation (it is scheduled), that there is no auth (there is), that nothing charges (the first period is charged); paths lack `/v1`.
- [GAPS.md](../backend/docs/GAPS.md) §7 cites item numbers that no longer match its tables.
- `backend/prisma/schema.prisma` refers to `docs/PUBLIC_EVENTS.md`, which does not exist.
- [GOING_LIVE.md](GOING_LIVE.md) — lists GDPR endpoints as still to build; the test count is out of date.
