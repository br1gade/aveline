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
| Bugfixes | 0 open | 0 open | 0 open | — |
| Features | 1 open (F1, frontend integration) | 0 open | 16 backend features implemented, acceptance open; native F22 deferred | 14 revenue and services (F31–F44); F45 is now a pilot gate |
| Decisions | 38 decided (D1–D38) | | | |

All ten P0 bugs were fixed on 8 October 2026, and the two backend P0
features — editing an event, and loading the invitation into the editor —
were built the same day. F1, the client, remains the original P0 feature.
The expanded release scope below adds further pilot gates. Fixed items are removed, so a gap in the
numbering is something that has been done.

**Release scope revised 13 October 2026:** the user requires all the listed P2
features plus F45 before the pilot, with **native F22 deferred explicitly**.
The historical priority labels remain for reference; they no longer imply these
features may ship after this pilot. The release needs 17 requested feature items,
the frontend and the external launch checks. Attendance, export, gallery,
signature, language and directory choices are recorded in D23–D38 and the
[implementation plan](PILOT_IMPLEMENTATION_PLAN.md). The tentative 25 October
date can move; full scope takes priority.

Current execution tasks, prerequisites and proposed post-pilot batches are in
[TODO.md](TODO.md). Backend translations and local performance/recovery rehearsals
are implemented and verified; human review, frontend and actual-host/provider
acceptance remain. Post-pilot batch groupings are proposals, not committed dates.

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

**P1** — none open. B66–B84 were fixed on 10 October 2026.

**P2** — none open. B85–B92 and B94 were fixed on 10–11 October 2026.

One suspected race was looked at and left: a host cancelling a paid ticket
order while the door admits one of its tickets, in the seconds the refund is
at the bank, ends with the order refunded and that ticket already used.
Closing it would reverse the refund-then-void order PAYMENTS.md relies on;
it needs a cancellation during the event itself, at the door.

---

## 2. Features — implementation and acceptance

### P0

| # | Feature | Why | Size |
|---|---|---|---|
| F1 | **The client** | Frontend work exists on a separate branch; integration and full host/guest acceptance remain. Build against [API.md](API.md) and `backend/openapi.json` | L |

### P1

| # | Feature | Why | Size |
|---|---|---|---|

### P2

| # | Feature | Size |
|---|---|---|
| F19 | Backend implemented: private invited-guest uploads, bounded worker variants, host moderation, owner removal and durable privacy cleanup. Frontend and production acceptance remain (§7.2) | M–L |
| F20 | Backend implemented: PDFs for all seven kinds, translated standard headings, embedded four-script fonts and A4 flat place cards. Frontend, human language review and pilot print acceptance remain | M |
| F21 | WhatsApp delivery receipts: signed/scoped backend and host evidence fields built; real account/template/subscription/send proof and frontend acceptance remain | S–M |
| F22 | Native email feedback adapter or mailbox bounce parser. Provider-neutral signed delivery/bounce/complaint ingestion and suppression updates are built; provider connection remains deferred by the user | M |
| F23 | Backend implemented: named checkout, guest linking, legacy reconciliation, unified admission/cancellation and attendee privacy. Frontend and pilot acceptance remain (§13.4) | M |
| F24 | Backend implemented: validated same-event hero/share selection, batched responsive images and privacy-aware metadata. Frontend HTML Open Graph tags and browser acceptance remain (§13.2) | S |
| F25 | Backend implemented: versioned typed/drawn acknowledgements, explicit household representation, RSVP/admission gates and attendee personal links. Frontend and production acceptance remain | S–M |
| F26 | Backend implemented: bounded personal projections, durable revisions, live capability/expiry checks and Redis fallback. Production load acceptance remains | M |
| F27 | Backend implemented: all exports and automatic seating use durable workers with bounded recovery and stale-plan guards. Queued frontend integration and production acceptance remain | M |
| F28 | Backend implemented: synthetic en/ru/fr/hy and authorized event preview payloads share the live serializer. Frontend renderer integration and visual acceptance remain | S |
| F29 | Backend implemented: atomic complete question ordering with stale-order conflicts; answered data preserved. Frontend editor acceptance remains | S |
| F30 | Backend implemented: captured lifetime, free 90 days after event end/start, preserved legacy deadlines and bounded sweep. Frontend expiry state and production acceptance remain | S |
| F46 | Backend implemented: personal-link self-name correction preserving identity links, answers and seats. Frontend form acceptance remains (§5.3) | S |
| F47 | Backend implemented: curated VENUE operators may manage several directory halls; staff validation and private-link filtering. Frontend directory acceptance remains | S |
| F48 | Backend implemented: allowlisted LOGO/COVER/PHOTO/AUDIO uploads honor kind and validate MIME/attachment compatibility. Frontend corporate logo acceptance remains | S |
| F49 | Backend implemented: typed XLSX snapshots for all seven kinds, translated labels, literal untrusted text and separate catering tabs. Frontend, human language review and native-viewer acceptance remain | S |
| F50 | **Backend implemented; acceptance pending:** separate venue seating, attendance modes, per-venue RSVP, preview/reconfirmation and history; frontend integration and four-language acceptance remain | L |

### Pilot rehearsal — promoted from the post-pilot list

| # | Feature | Size |
|---|---|---|
| F45 | **Required before pilot:** local mixed-load, venue seating, PDF and outage/worker recovery rehearsals pass. Frontend, real-provider, production-host and off-host recovery acceptance remain | S–M |

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
| — | **Deferred:** enforcing plan limits — decided 8 October 2026, until after the pilot | §8 | — |

---

## 3. Decisions needed

D1–D4 were decided on 8 October 2026, D5–D7 on 9 October, D8–D22 on 10 October.
D23–D38 were decided on 13 October while planning the expanded pilot scope.
All recorded pilot product questions have answers. The subsequent interactive
post-pilot review recorded **58 decisions (PP-D01–58)** in the
[decision register](post-pilot/DECISIONS.md). These govern planned F31–F44 initial
workflows and deferrals; they do not mark any feature complete. Bank choice,
tax/protected-evidence rules and actual provider acceptance remain external
inputs, while prices/terms/retry values are ADMIN configuration before use. See
the [delivery plan](POST_PILOT_IMPLEMENTATION_PLAN.md) for dependencies.

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
| D15 | What does erasure do with do-not-contact records? | B88 | **Keeps them as a one-way hash**: the address is still recognised and blocked, never readable |
| D16 | Registering with an email that already has an account? | B90 | **The same answer either way**; the owner is emailed a sign-in link instead. Register no longer signs in — the client logs in next |
| D17 | Do guests see PREPARATION venues, and ones only internal entries use? | B92 | **No.** Ceremony, reception, after-party and venues the visible timeline uses |
| D18 | SVG uploads? | B92 | **Refused.** JPEG, PNG, WebP, AVIF for images |
| D19 | What does a full refund of a subscription payment do? | B85 | **Voids the invoice and ends the plan at once.** A partial refund changes nothing |
| D20 | What is an erased guest's household called, when it was named after them? | B88 | **"Household" and a number** |
| D21 | After an erasure, who may add the person again? | B88 | **Only the hosts who had them are stopped**: each such organization keeps a hashed `ERASED` record that blocks import and messages; other hosts are unaffected |
| D22 | How long is Mongo observability data kept? | B91 | **Invitation views 13 months, audit trail 2 years**, then deleted automatically |
| D23 | Attendance across multiple venues? | F50 | **Host chooses per event:** event-wide or per-venue attendance; household submissions still contain each person's answers |
| D24 | Which of the 18 requested items must precede the pilot? | Release scope | **Full scope before pilot**, subject to D30's explicit native-email exception |
| D25 | Which PDF exports are required? | F20 | **All seven existing export kinds**, not only seating charts |
| D26 | Who uses the guest photo gallery? | F19 | **Invited guests only, with host approval before other guests see uploads** |
| D27 | Who provides ticket attendee identities? | F23 | **Buyer supplies every attendee's names/details at checkout** |
| D28 | How are guest acknowledgements captured? | F25 | **Both drawn and typed options** |
| D29 | Are background exports live data or snapshots? | F27 | **Fixed snapshots; host regenerates when needed**, deliberately changing current CSV freshness behavior |
| D30 | Must native email feedback integration precede the pilot? | F22 | **No. Keep provider-neutral and defer native F22 explicitly**; sender/domain setup and real sending still need verification |
| D31 | Does free invitation expiry delete event data? | F30 | **Close guest access; retain host data and media** |
| D32 | Who is invited to venues in per-venue mode? | F50 | **Everyone is invited to every guest-facing venue**; preparation/internal-only venues stay hidden |
| D33 | May someone acknowledge for household members? | F25 | **Yes, a representative may acknowledge for their household**; record signer and subjects separately |
| D34 | Is the pilot date or complete scope fixed? | Release | **Full scope wins. 25 October 2026 is tentative and may move** |
| D35 | Which languages must the pilot support? | Language coverage | **English, Russian, French and Armenian**; host-interface coverage is D36 |
| D36 | Must the host interface also support all four languages? | Frontend scope | **Yes. Guest flows and the host/organizer interface in English, Russian, French and Armenian**, including localized validation and operational screens |
| D37 | May attendance mode change after guests answer? | F50 | **Yes, through an explicit reconfirmation flow.** Preserve historical answers; do not guess attendance under the new policy |
| D38 | May one vendor operate several directory venues? | F47 | **Yes. One venue vendor may operate several directory venues**; preserve existing links when removing the current uniqueness restriction |

---

## 4. Documents that contradict the code

Re-checked on 9 October 2026. Each would be believed.

- **API.md** — promo run-out at checkout is `400`, not `409`; promo-check answers `201`, not `200`; `notInvited` lists invited households with no usable address, not the never-invited; lists return bare arrays except `/public/events` (and `ticket-orders` and concierge truncate silently); a resource you cannot see is `403`, not `404`; a sequential checkout retry returns no `payment`; "an invitation always goes by email"; notify-changes re-chooses the channel; venue edits always suggest notifying; a late bounce is not read; the timeline is not in the operations view; `devLink` also on team invites; example error strings differ; `PRIVATE` public events are `404`, not `noindex`; suppression reasons are not ranked; privacy requests are not sorted soonest-due; `VERIFYING` can be skipped.
- **API.md, more** — the §4 example theme uses `font`, but the keys are `headingFont`/`bodyFont`; the `devLink` list omits team invites and concierge; `/settings` is "not a general event PATCH" though `PATCH /events/:id` exists; `GET /events?archived=true` needs no `event:delete`; M4A is listed but only `audio/mp4` is accepted, so browsers' `audio/x-m4a` is a 415.
- **ACCESS_CONTROL.md** — 20 policy tests, not 17; `billing:write` also gates ticket-order cancellation; the throttle is per IP and in memory; refresh "reuse makes theft visible" is not implemented.
- **INVITATION_DESIGN.md** — `DOCUMENT` kind missing; `LOGO` and `SIGNATURE` cannot be uploaded (the upload's OpenAPI `kind` field is ignored); custom `colors` bypass palettes.
- **PAYMENTS.md** — paths lack `/v1`; "nothing schedules reconciliation" and "no auth" are false; "nothing charges" (the first period is charged).
- **GAPS.md** §7 cites item numbers that now mean other things.
- **DATA_MODEL.md / DATA_STORES.md / ARCHITECTURE.md** — the audit trail is built (Mongo `audit_trail`); `GuestChannel` and `InvoiceCounter` missing; the throttle is not in Redis; no job queue; the prefix is `/api/v1`; four sweeps plus reminders and privacy, not three.
- **GOING_LIVE.md** — privacy requests do alert (Sentry and logs, once `SENTRY_DSN` is set); `POST /privacy/requests` is throttled like everything else.
- `backend/prisma/schema.prisma` refers to `docs/PUBLIC_EVENTS.md`, which does not exist.
