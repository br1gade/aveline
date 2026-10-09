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
| Bugfixes | 0 open | 19 open (B66–B84) | 9 open (B85–B92, B94) | — |
| Features | 1 open (F1, the client) | 0 open | 17 (F19–F30, F46–F50) | 15 revenue and services (F31–F45) |
| Decisions | 14 (D1–D14), all decided | | | |

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

None open. All were fixed on 9 October 2026.

### P2 — after the pilot, and all of "Money" before real money moves

None open. All 22 were fixed on 9 October 2026, the eight money bugs
(B36–B43) among them.

---

### Found by the audit of 9 October 2026

Eight read-only audits — spec coverage, the docs line by line, access,
guests and seating, invitations and messaging, money, concurrency, load —
each claim then checked against the code. One P0 (any made-up guest token
opened a PRIVATE invitation) was fixed the same day. Duplicates across audits
are merged; "suspected" marks what needs timing or a bank's spec to confirm.

**P0** — none open. B63–B65 and B93 were fixed on 10 October 2026.

**P1 — a pilot host will hit it**

| # | Bug | Where | Size |
|---|---|---|---|
| B66 | Auto-assign splits a household that is partly seated: a late acceptor goes to an empty table, not beside their family | `seating/seating.service.ts`, `seating-plan.ts` | S–M |
| B67 | Editing a choice question after guests answered silently changes their answers (stored by position); changing its type misreads them | `design/design.service.ts` | S |
| B68 | Plus-ones skip required questions and per-member answers (D1); a plus-one declined by `members` flips back to the respondent's answer on any later submission | `rsvp/rsvp.service.ts` | S |
| B69 | A host can add a *required* SIGNATURE question, after which every attending RSVP is a 400; choice options may differ in length per language, and the shorter list wins | `design/design.service.ts`, `rsvp/answers.ts` | S |
| B70 | Ended events stay listed (oldest first) and keep selling when `salesEndAt` is empty; nothing sets `COMPLETED`; an archived event's listing can be republished | `public-events/`, `ticketing/` | S |
| B71 | Any SMTP 5xx — including our own quota (`550 5.4.5`), size or policy rejections — suppresses the guest's address platform-wide for good | `communications/delivery-outcome.ts` | S |
| B72 | Telegram and WhatsApp are never chosen: no copy exists for them and nothing can write it, so opted-in guests still get email | `sending/audience.ts`, `seed/message-copy.ts` | M |
| B73 | A household invited inside a reminder window is reminded within the hour — possibly before the invitation itself arrives | `sending/reminder.service.ts` | S |
| B74 | Concierge hand-over dead-ends when the customer already has an organization: accepting is a 409, every time, and the staff-built one is orphaned. **Decision** D8 | `organizations/concierge.service.ts` | S–M |
| B75 | A refresh racing a password reset or "sign out everywhere" creates a session nothing revoked; a reused refresh token is not detected | `infra/auth/auth.service.ts` | S |
| B76 | A double-clicked Subscribe issues two open invoices, both payable — a double charge | `billing/subscriptions.service.ts` | S |
| B77 | A double-uploaded or retried CSV duplicates households and guests; each duplicate is invited | `guests/import/guest-import.service.ts` | S |
| B78 | A refund the bank processed but we failed to record is marked failed and asked again; a crash between claim and Refund row voids tickets with nothing paid back | `payments/payments.service.ts` | M |
| B79 | No timeout on bank or S3 calls: a hanging bank holds checkout open and stalls every money sweep | `payments/providers/*`, `storage/adapters/s3.adapter.ts` | S |
| B80 | The outbox sends 50 a minute, one at a time, in one queue: a large send delays password resets and tickets by minutes; the job lock is deleted without an owner check | `communications/communications.service.ts`, `infra/jobs/job-lock.service.ts` | M |
| B81 | The throttle is per IP and covers guest pages and check-in: guests and tablets on venue Wi-Fi get 429s | `app.module.ts` | S |
| B82 | Hot paths are heavier than §12 assumes: the cached page still runs ~8 queries, a personal link ~14 uncached; every RSVP scans `messages`; sending and import run several queries per row | `invitations/`, `sending/rsvp-confirmer.service.ts`, `import/` | M |
| B83 | PATCHing a booking to CANCELLED keeps its brief link, and PATCHing it back revives the old, possibly forwarded, link | `vendors/vendors.service.ts` | S |
| B84 | The dev seed stores palettes by `key`, which the code does not read, so every theme edit is a 400 locally | `prisma/seed.ts` | S |

**P2 — later; money items before real money moves**

| # | Bug | Where |
|---|---|---|
| B85 | Money edge cases: a transient bank error marks a payment FAILED for good; stuck AUTHORIZED payments starve reconciliation; a late-issued order releases its promo redemption twice; duplicate basket lines bypass `maxPerOrder`; one failing settlement stops all hold releases; a late-refund notice can precede the refund; concurrent cancels give one a 409; refunding a subscription payment leaves it active; a first paid subscription shows the paid plan before payment. *Suspected, check with the banks:* Ameriabank may need an integer OrderID; ArCa may expect AMD in luma | `payments/`, `ticketing/`, `billing/` |
| B86 | `returnUrl` is unvalidated on checkout and subscribe (an open redirect through the bank page); the fallback is `aveline.test` | `ticketing/dto`, `billing/dto` |
| B87 | Concurrency leftovers: reminder read-then-enqueue can reach a household that just answered; deleting a question or a table can cascade a concurrent answer or seat; a decline can race auto-seat; media sweep vs delete orphans files; read-modify-write edits lose a co-host's change; a stale payload can be written back to cache after invalidation; concurrent enqueue or checkout surfaces as a 409; guest/household lock order can deadlock (500); accept vs revoke invite; publish vs archive; `markInvoicePaid` resets a newer cancel | various |
| B88 | Erasure leaves the person's name on a household named after them, their email in the Mongo audit trail and invitation views, pending invites, session IP/UA, signature files; it deletes global complaint suppressions; re-importing the original file brings them back; the RSVP form can still write to an erased member | `privacy/erasure.ts` |
| B89 | Validation: non-strict ISO dates 500 or shift (`2026-02-30`); import takes phones, lengths and CR/LF unchecked and emails un-normalised; blank names; unbounded guest dietary strings; translation keys unchecked; `{"hy":""}` labels; TTL env values unvalidated (NaN breaks every login) | DTOs, `env.validation.ts` |
| B90 | Leaks: error bodies echo the URL with its capability token; invite emails and payment order numbers are not redacted from logs; the referer is not scrubbed; register reveals existing accounts (and answers 401); the privacy form reveals another person's request status | `all-exceptions.filter.ts`, `redact-url.ts`, `auth.service.ts`, `privacy.service.ts` |
| B91 | Load at growth: missing indexes (`messages.guestId`, `tickets.orderId`, `rsvp_answers.questionId`, Mongo `audit_trail`); sweeps scanning all history; Prisma pool size unset; no TTL on Mongo collections; concurrent Mongo connects leak clients; sharp has no pixel limit; erasure's 5 s transaction; bcryptjs on the main thread; staff `GET /events` unbounded | schema, `infra/` |
| B94 | `PATCH` a timeline entry with `occursAt: null` stores 1 January 1970 instead of a 400 | `design/timeline.service.ts` |
| B92 | Smaller behaviours: block `variant: null` is ignored on the block edit; personal-page `?locale=en-GB` is not negotiated; timeline ties ignore `sortOrder`; label and question edits replace every language; message copy ignores translated titles; every venue, including `PREPARATION`, shows on the guest page; health says `ok` with Redis down and the container stays healthy with Postgres down; refund route reachable only by platform ADMIN; `?archived=true` unchecked; revoking an org invite is case-sensitive; confirmation dedupe by calendar minute; uploads served nowhere with filesystem storage in dev; SVG served from the app's origin would be XSS | various |

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
| F28 | Template preview (layouts are now declared and validated — B46) | S |
| F29 | Reordering custom RSVP questions | S |
| F30 | Invitation expiry from the plan's lifetime (decided: indefinite paid, 3 months free) | S |
| F46 | A guest correcting their own name on the RSVP form (§5.3 "Full name") | S |
| F47 | Linking a directory venue to the vendor who runs it (VENUES §1) | S |
| F48 | Logo uploads for corporate events (INVITATION_DESIGN §3) | S |
| F49 | XLSX exports — the format is in the API enum and refused; or drop it from the enum | S |
| F50 | Choosing seats per venue: one seat per guest per event today, and auto-assign mixes venues' tables | M |

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
| F43 | Vendor listing fees — §9.3 names "margin or listing fee"; F36 covers only the margin | §7.3, §9.3 | M |
| F44 | Template authoring for the Production tier's custom design — templates exist only as seed data, with no way to make one | §8 | M–L |
| F45 | Measure the §12 latency targets under load — nothing has measured them | §12 | S–M |
| — | **Deferred:** enforcing plan limits — decided 8 October 2026, until after the pilot | §8 | — |

---

## 3. Decisions needed

D1–D4 were decided on 8 October 2026, D5–D7 on 9 October, D8–D14 on 10 October.

| # | Question | Blocks | Decided |
|---|---|---|---|
| D1 | How does a household answer? | B7 (fixed) | **Per member, in one submission.** Whoever opens the link marks each named member of the household attending or not. Families split, and catering and seating count people |
| D2 | Who carries out data-protection requests? | B1 (fixed) | **Aveline staff only.** A request matches an email across every customer, so hosts neither see the queue nor act on it |
| D3 | When a host changes the date or venue after sending, are guests told? | F2 (built) | **The host is offered it.** After the edit, they choose whether to send an "updated details" message to everyone already invited |
| D4 | Is find-your-seat public? | B16 | **Only through a guest's own link, and only once the host publishes the seating** |
| D5 | A ticket buyer pays after their hold lapsed: then what? | B36 (fixed) | **Issue the tickets if the seats are still there; otherwise refund in full and tell the buyer** |
| D6 | May a PRIVATE invitation be read from its generic link? | B49 | **No — personal links only, as the spec says.** A host who wants one shareable link sets the event UNLISTED |
| D7 | What becomes of the public `POST /payments`? | B42 (fixed) | **Removed.** Payments start only from Aveline's own flows; a deposit flow will start its own |
| D8 | A customer staff set an event up for already has an organization: what happens? | B74 | **Build in their existing organization.** The event appears in it; there is no second organization and nothing to accept |
| D9 | Does a MANAGER who creates an event become its OWNER? | — | **No — its COORDINATOR.** They run it fully; deleting it and managing its team stay with the organization's owner, as ACCESS_CONTROL says |
| D10 | What may change in a choice question once guests have answered? | B67 | **Reword and add only.** Labels can be reworded or translated and options added at the end; removing, reordering or changing the type is refused |
| D11 | Do plus-ones answer the host's required questions? | B68 | **Yes, each one.** The form collects each plus-one's own answers; an attending plus-one missing a required one is refused |
| D12 | When does a public event stop selling, and leave browse? | B70 | **Sales stop at the start; the listing leaves browse at the end.** The detail page still loads by link |
| D13 | Where does Telegram copy come from? | B72 | **Written with the email copy and seeded, reviewed by the team.** WhatsApp stays off until Meta approves templates |
| D14 | When may a late-invited household be reminded? | B73 | **Not until 3 days after its invitation — 1 day if the event is under a week away** |

---

## 4. Documents that contradict the code

Re-checked on 9 October 2026. Each would be believed.

- **API.md** — promo run-out at checkout is `400`, not `409`; promo-check answers `201`, not `200`; `notInvited` lists invited households with no usable address, not the never-invited; lists return bare arrays except `/public/events` (and `ticket-orders` and concierge truncate silently); a resource you cannot see is `403`, not `404`; a sequential checkout retry returns no `payment`; "an invitation always goes by email"; notify-changes re-chooses the channel; venue edits always suggest notifying; a late bounce is not read; the timeline is not in the operations view; `devLink` also on team invites; example error strings differ; `PRIVATE` public events are `404`, not `noindex`; suppression reasons are not ranked; privacy requests are not sorted soonest-due; `VERIFYING` can be skipped.
- **API.md, more** — the §4 example theme uses `font`, but the keys are `headingFont`/`bodyFont`; the `devLink` list omits team invites and concierge; `/settings` is "not a general event PATCH" though `PATCH /events/:id` exists; `GET /events?archived=true` needs no `event:delete`; M4A is listed but only `audio/mp4` is accepted, so browsers' `audio/x-m4a` is a 415.
- **ACCESS_CONTROL.md** — 20 policy tests, not 17; `billing:write` also gates ticket-order cancellation; the throttle is per IP and in memory; refresh "reuse makes theft visible" is not implemented.
- **INVITATION_DESIGN.md** — `DOCUMENT` kind missing; `LOGO` and `SIGNATURE` cannot be uploaded (the upload's OpenAPI `kind` field is ignored); custom `colors` bypass palettes.
- **VENUES_AND_SEATING.md** — §4 says venue capacity is respected (it is not; the schema comment agrees with §4); §5 describes the planner as unbuilt; one seat per guest per event, and auto-assign mixes venues.
- **PAYMENTS.md** — paths lack `/v1`; "nothing schedules reconciliation" and "no auth" are false; "nothing charges" (the first period is charged).
- **GAPS.md** §7 cites item numbers that now mean other things.
- **DATA_MODEL.md / DATA_STORES.md / ARCHITECTURE.md** — the audit trail is built (Mongo `audit_trail`); `GuestChannel` and `InvoiceCounter` missing; the throttle is not in Redis; no job queue; the prefix is `/api/v1`; four sweeps plus reminders and privacy, not three.
- **GOING_LIVE.md** — privacy requests do alert (Sentry and logs, once `SENTRY_DSN` is set); `POST /privacy/requests` is throttled like everything else.
- `backend/prisma/schema.prisma` refers to `docs/PUBLIC_EVENTS.md`, which does not exist.
