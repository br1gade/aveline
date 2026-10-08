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
| Bugfixes | 10 (B1–B10) | 25 (B11–B35) | 26 (B36–B61), of which 8 money | — |
| Features | 3 (F1–F3) | 15 (F4–F18) | 12 (F19–F30) | 12 revenue and services (F31–F42) |
| Decisions | 4 (D1–D4), all decided | | | |

The P0 bugs are small — most are under half a day — but four expose people's
data (B1–B4) and three break the core RSVP loop (B6–B8). The feature that
gates everything is F1, the client.

Infrastructure and accounts (bank, domain, mail DNS, server) are not here;
they are in [GOING_LIVE.md](GOING_LIVE.md). The long-range view of the
backend is [GAPS.md](../backend/docs/GAPS.md).

---

## 1. Bugfixes — built, but wrong

### P0 — before the first real event

| # | Bug | What goes wrong | Where | Size |
|---|---|---|---|---|
| B1 | **Any host can export or erase any guest's data, across every customer** ✔ | Every organization owner holds `privacy:manage`, and the data-subject request list, update and fulfil are not scoped. A self-registered host lists every request on the platform, or files one for a stranger's email, marks it in progress and fulfils it — receiving that person's guest records, phones and answers from every other customer's events, or erasing them. **Decision** D2 | `access/access-policy.ts`, `privacy/privacy.service.ts` | S |
| B2 | **Erasure leaves personal data behind** ✔ | After an erasure the person's account still logs in, and their custom answers, drink preference, Telegram/phone channel links, message addresses and SMS bodies remain. Matching is case-sensitive, so `Ani@x.am` survives an erasure of `ani@x.am`. A request can also be moved back from COMPLETED, or marked COMPLETED without erasing | `privacy/privacy.service.ts`, `privacy/anonymisation.ts` | M |
| B3 | **Capability links are written to the logs** ✔ | Every request logs its full URL, so guest links, ticket links, vendor brief links and device tokens sit in the logs and in Sentry on errors — the root CLAUDE.md §3 rule. Anyone with log access can answer as any guest | `infra/logging/logging.config.ts`, `common/all-exceptions.filter.ts` | S |
| B4 | **Registering someone's email first steals their invitation to a team** ✔ | No email verification is enforced. An attacker registers `alice@…`; the owner invites Alice as MANAGER; Alice accepts with her own password, which is discarded, and the attacker's login now holds the membership | `organizations/account.service.ts` | S–M |
| B5 | **Development shortcuts fail open in production** | The password-reset link returned in the response, and the default JWT secret, are disabled only when `NODE_ENV` is exactly `production` — and it defaults to development. One missing variable on the server returns reset links to anyone. The project rule is "impossible to reach in production, not merely discouraged" | `organizations/account.service.ts`, `common/env.validation.ts` | S |
| B6 | **Any RSVP that answers a custom question is rejected** ✔ | `CustomAnswerDto.value` has no validator, so the global pipe refuses it: "Meat or fish?" makes the whole RSVP fail. Once fixed, also: `questionId` is not checked against this invitation, `required` is not enforced, values are not checked against the question's type or options, and `answers` is unbounded | `rsvp/dto/submit-rsvp.dto.ts`, `rsvp/rsvp.service.ts` | S |
| B7 | **Only the person who opened the link is recorded; the rest of the household stays PENDING** | Invitations go one per household. Armen answers ATTENDING; Lusine, imported in the same household, stays PENDING forever. Headcount, catering, auto-seating and the door list undercount every family, and naming her in `party` fails the capacity check. **Decision** D1 | `rsvp/rsvp.service.ts` `submit` | M |
| B8 | **Answering again duplicates the party and leaves plus-ones behind** ✔ | API.md says resubmitting is safe; every submit inserts `party` again, so a retry creates a second Lusine and a third submit fails on capacity. Plus-ones never follow a later status change — switch to DECLINED and they stay ATTENDING. Omitted fields are wiped, and `respondedAt` is overwritten | `rsvp/rsvp.service.ts` | S–M |
| B9 | **A message that fails mid-send is stuck forever, and its guest is never invited** ✔ | Nothing returns a SENDING message to the queue. A crash or error after the claim strands it, aborts the rest of the batch, and because SENDING counts as "on its way", pressing send never tries that guest again | `communications/communications.service.ts`, `invitations/sending/previous-attempts.ts` | S |
| B10 | **Editing one language of a block erases the others** | `PATCH /invitations/:slug/blocks/:type` replaces the whole `content` map; sending Russian deletes the Armenian | `design/design.service.ts` `updateBlock` | S |

### P1 — a pilot host will hit it

**Access and privacy**

| # | Bug | What goes wrong | Where | Size |
|---|---|---|---|---|
| B11 | Read-only roles get guest contact details ✔ | The guest-list export needs only `operations:read`, bypassing `guest:contact:read`, and export files sit at public, non-expiring URLs (the ticket manifest exposes door codes the same way). `GET /invitations/:slug/delivery` gives a DESIGNER or VIEWER every address. `GET /vendors` hands brief tokens, which can carry the `contacts` scope, to any VIEWER. `GET /guests` gives VIEWERs every guest's capability token, letting them answer as the guest | `exports/`, `invitations/invitation-lifecycle.controller.ts`, `vendors/`, `guests/guests.service.ts` | M |
| B12 | The vendor directory is shared by every customer, and any customer can write to it | `Vendor` has no organization: host B sees the phone number host A entered for their cousin the photographer | `vendors/` | S |
| B13 | Read-only members can create events and become their owner ✔ | `POST /events` requires no permission | `events/events.controller.ts` | S |
| B14 | "One organization per account" is not held ✔ | Concurrent creates make three; accepting an invite adds a second. The guard then picks a membership arbitrarily, so events, billing and invites act on a random organization | `organizations/organizations.service.ts`, `account.service.ts`, `infra/auth/auth.guard.ts` | S |
| B15 | Email addresses are case-sensitive at login ✔ | `Ani@x.am` and `ani@x.am` are two accounts, and logging in with different capitals fails | `infra/auth/auth.service.ts`, `account.service.ts` | S |
| B16 | Find-your-seat is unreachable for guests, and lists names to anyone ✔ | Keyed by `eventId`, which no guest-facing response contains. With no query it returns ten names and tables — for any event, drafts included. **Decision** D4 | `guests/guests.controller.ts`, `guests.service.ts` | S |
| B17 | `GET /suppressions` shows other customers' addresses | Global suppressions — every bounced or complaining address on the platform — are listed to every host | `communications/suppression.service.ts` | S |

**Messaging**

| # | Bug | What goes wrong | Where | Size |
|---|---|---|---|---|
| B18 | A household is invited twice when its recipient changes ✔ | Resend is decided per guest, but the recipient is re-chosen per household. The invitation went to the bride because the primary had no email; the host adds the primary's email and presses send — a second invitation. Thank-yous repeat the same way | `invitations/sending/invitation-sender.service.ts`, `send-plan.ts` | S |
| B19 | A database error after a successful send sends it again ✔ | The provider call and the "sent" update share one error path; a failed update is treated as temporary and the message goes out up to five times | `communications/communications.service.ts` | S |
| B20 | Our own errors suppress a guest's address for good ✔ | WhatsApp template errors and every Telegram 400 (including "message too long") are treated as the recipient's hard bounce: a platform-wide suppression no host can lift | `channels/whatsapp.transport.ts`, `telegram.transport.ts` | S |
| B21 | A guest who blocks and re-starts the Telegram bot stays unsubscribed ✔ | The suppression is never cleared, and reminders resolve to a suppressed Telegram with no email fallback | `communications/telegram-webhook.controller.ts` | S |
| B22 | Reminders go to guests who never received the invitation ✔ | Failed, bounced, suppressed and still-queued invitations count as "invited". API.md says the opposite | `invitations/sending/reminder.service.ts` | S |

**Guests, design and seating**

| # | Bug | What goes wrong | Where | Size |
|---|---|---|---|---|
| B23 | Venue edits do not reach the cached invitation | A corrected address stays wrong on the generic link for up to five minutes | `design/venues.service.ts` | S |
| B24 | Rearranging some blocks leaves the page order ambiguous | Blocks not sent keep their old positions, producing ties; the documented `[RSVP, HERO]` example does it | `invitations/arrangement.service.ts` | S |
| B25 | Partial updates wipe what was omitted | PATCH on a venue or timeline entry uses the create DTO; PATCH on a question resets `required` to false when it is left out. The contract is "omitted means leave as is" | `design/` | S |
| B26 | Bad input returns 500 instead of 400 ✔ | An unknown block type in the path; a venue `arriveAt` that is not a date; a venue role of `"constructor"` | `design/design.controller.ts`, `venues.service.ts` | S |
| B27 | CSV import has no size limit ✔ | API.md says 2 MB; nothing enforces it, and the file is parsed synchronously before the row cap. Media upload has no limit either. A re-import without a side column resets sides the guests chose; household seats are not enforced on import | `guests/guests.controller.ts`, `guests/import/` | S |
| B28 | Two planners seating at once can overfill a table ✔ | Six simultaneous assignments to a one-seat table seat six. Auto-seating plans outside a transaction too | `seating/seating.service.ts` | S |
| B29 | A guest who declines keeps their seat | Their seat still counts against the table | `seating/seating.service.ts` | S |
| B30 | The catering export drops dietary notes | "Severe nut allergy" is on screen and missing from the file handed to the venue, and from the guest-list export | `exports/exports.service.ts` | S |
| B31 | "Still to come" undercounts on the day | Walk-ins and declined guests who turn up are subtracted from those expected | `guests/check-in.service.ts` | S |
| B32 | The playlist includes guests who are not coming | No status filter; capitalisation makes duplicates | `operations/operations.service.ts` | S |
| B33 | The page cannot match a timeline entry to its venue | Timeline entries carry `venueId`; venues on the page carry no `id` | `invitations/invitations.service.ts` | S |

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
| B45 | A table can be attached to another event's venue, which then cannot delete its own venue ✔ | `seating/seating.service.ts` | S |
| B46 | A block the template cannot render can be re-enabled through the block edit; `variant` is free text | `design/design.service.ts` | S |
| B47 | RSVP accepts `PENDING` as an answer, an unpublished language, and overwrites the host's side for a guest | `rsvp/` | S |
| B48 | Booking a cancelled vendor again returns a cancelled booking and a dead brief link ✔ | `vendors/vendors.service.ts` | S |
| B49 | A PRIVATE invitation is readable by anyone with its generic URL (§13.1 says capability link only) | `invitations/invitations.controller.ts` | S |
| B50 | Platform staff lose their own memberships' permissions, and never see vendor fees | `infra/auth/auth.guard.ts`, `vendors/` | S |
| B51 | Vendor fees are a decimal string, not integer minor units — breaking for the client to change | `vendors/` | S |
| B52 | An event can be created whose default language is not one of its languages | `events/events.service.ts` | S |
| B53 | Two refreshes with one token make two live sessions ✔ | `infra/auth/auth.service.ts` | S |
| B54 | Login timing and registration reveal which emails have accounts ✔ | `infra/auth/auth.service.ts` | S |
| B55 | Any user can revoke or take over another's push device token (nothing sends push yet) ✔ | `devices/devices.service.ts` | S |
| B56 | The Telegram webhook is unauthenticated when no bot token is set, production included | `communications/telegram-webhook.controller.ts` | S |
| B57 | Publish, send and design writes are recorded without their event, so they never appear in the audit trail | `infra/audit/audit.interceptor.ts` | S |
| B58 | Reminder edge cases: "once a day" is not kept across manual and automatic; a reminder still retrying is delivered after the guest answers; the delivery view leaves reminders out | `invitations/sending/` | S |
| B59 | Sending with one unknown `guestIds` entry returns 201, though API.md promises 400 | `invitations/sending/` | S |
| B60 | An answer changed twice within a minute can leave a contradictory last confirmation | `invitations/sending/rsvp-confirmation.ts` | S |
| B61 | In production, channels without a provider fall back to a console transport that marks messages delivered and logs their links | `communications/channels/transport-registry.ts` | S |

---

## 2. Features — not built

### P0

| # | Feature | Why | Size |
|---|---|---|---|
| F1 | **The client** | `frontend/` is a scaffold. No host or guest can use anything until it exists. Built against [API.md](API.md) and `backend/openapi.json` | L |
| F2 | **Edit an event after creating it** | Title, hosts, dates, timezone, languages and side labels are fixed at creation. A typo in the date is permanent, and a diaspora family cannot add Russian later. Needs cache invalidation and an answer to D3 | M |
| F3 | **Read back the invitation being designed** · Client | The only reads of block content are the public pages, which 404 on a draft and return one language and enabled blocks only. An editor cannot load what the host wrote | S–M |

### P1

| # | Feature | Why | Size |
|---|---|---|---|
| F4 | **See the answers to custom questions** | Answers are stored and returned only to the guest who gave them. No host view, sheet or export includes them — the question has no consumer, which the spec forbids | M |
| F5 | **Team management** | Nothing assigns COORDINATOR, DESIGNER or event VIEWER, lists members, removes one or changes a role. Door staff today need organization MANAGER, which also shows vendor fees | M |
| F6 | **Record an answer on a guest's behalf** · Client | A grandmother phones in her answer; the host has nowhere to enter it | S |
| F7 | **A guest list an edit form can use** · Client | `GET /guests` returns a combined name, status and table — no separate first and last name, email, phone, language, household or answers, and there is no single-guest read | S |
| F8 | **Edit a table** · Client | Name, capacity, zone and venue cannot change; position and shape for a drag-and-drop plan are never stored | S–M |
| F9 | **Venue coordinates and capacity** | Latitude, longitude and capacity are returned but only ever copied from the venue directory, which nothing can fill. The Map block has only a pasted link | S |
| F10 | **Configure the built-in RSVP questions** | A host cannot switch off drink or song questions or define the choices. Drinks are free text, so "Wine", "Вино" and "Գինի" are three rows on the bar sheet | M |
| F11 | **Manage uploads** · Client | No list or delete of an event's media, and no way to set alt text | S–M |
| F12 | **Delete or archive an event** | `event:delete` exists in the policy and nothing uses it | M |
| F13 | **Concierge setup** | Staff cannot create an organization or event for a customer and hand it over, which §11 relies on. Workaround: the host registers and creates the event first | M |
| F14 | **Internal running-order entries** | The day-of timeline and the guest-facing one are the same rows, so "caterer load-in 10:00" would appear on the invitation | S |
| F15 | **Headcount by household, with a trend** | Promised in §6; only totals and a point-in-time rate exist | S–M |
| F16 | **Switch language on a personalised page** | The personalised link ignores `?locale`; event title, hosts and venue names are not translatable | S |
| F17 | **SMS** | The channel for guests who use neither email nor chat apps — the older half of an Armenian guest list. A host can share a guest's link by hand meanwhile | M |
| F18 | **Image resizing** | Originals are served as uploaded; a 6 MB photo costs every guest 6 MB | M |

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
| D1 | How does a household answer? | B7 | **Per member, in one submission.** Whoever opens the link marks each named member of the household attending or not. Families split, and catering and seating count people |
| D2 | Who carries out data-protection requests? | B1 | **Aveline staff only.** A request matches an email across every customer, so hosts neither see the queue nor act on it |
| D3 | When a host changes the date or venue after sending, are guests told? | F2 | **The host is offered it.** After the edit, they choose whether to send an "updated details" message to everyone already invited |
| D4 | Is find-your-seat public? | B16 | **Only through a guest's own link, and only once the host publishes the seating** |

---

## 4. Documents that contradict the code

All small; each is a doc that would be believed.

- [API.md](API.md) — "submitting again … safe to retry" (false while B8 stands); refunds need `billing:write`, not `billing:read`; the 2 MB import limit is not enforced (B27); reminders "skip guests never invited" (B22).
- [ACCESS_CONTROL.md](ACCESS_CONTROL.md) §6 lists as unbuilt the audit trail, brief rotation, invite acceptance and password reset — all built.
- [VENUES_AND_SEATING.md](VENUES_AND_SEATING.md) — implies table positions are stored (F8); lists place cards and seating CSV as unbuilt (built); says auto-seating runs as a job (it runs in the request).
- [PAYMENTS.md](PAYMENTS.md) — says nothing schedules reconciliation (it is scheduled), that there is no auth (there is), that nothing charges (the first period is charged); paths lack `/v1`.
- [PRODUCT_SPEC.md](PRODUCT_SPEC.md) §4 and `backend/docs/DATA_MODEL.md` count 42 models; there are 46. DATA_MODEL says the privacy endpoints are unbuilt.
- [GAPS.md](../backend/docs/GAPS.md) §7 cites item numbers that no longer match its tables.
- `backend/prisma/schema.prisma` refers to `docs/PUBLIC_EVENTS.md`, which does not exist.
- [GOING_LIVE.md](GOING_LIVE.md) — lists GDPR endpoints as still to build; the test count is out of date.
