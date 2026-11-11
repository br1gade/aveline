# Client backend requests — implementation plan and delivery record

Source: frontend request register at [`d8fe229`](https://github.com/br1gade/aveline/blob/d8fe229c2458f34855fd990055093179df9dd44c/frontend/docs/BACKEND_REQUESTS.md), captured 5 November 2026. Backend base: `34ac1e6`. The disposition table covers FR-1–126, with later requests tracked in the follow-up below; a request is complete only when implementation, contract and verification agree. The frontend source register remains its team's record.

## Delivery order and dependencies

1. **S1 safety/correctness:** reproduce payment-retry race, protect import/privacy evidence, validate required answers and nullable inputs, apply guest-read rate allowances. Shared test fixtures use newly created isolated stores only.
2. **S2 contract/identity:** response/security/header/query schemas, current-user and effective-capability reads, stable machine-readable refusal metadata. This removes frontend source/text matching and hand-written response types.
3. **S3 host/guest operations:** bounded reports, atomic household answers/seating/admission, idempotent walk-ins, bulk moderation/positions, accurate door/acknowledgement views, follow-up audience/delivery, organization and privacy-request consistency.
4. **S4 ticketing/vendors/billing:** complete order/public-event projections, payment availability and retry semantics, vendor edits/choices/scopes and privacy, pagination and nullable updates. Preserve pilot charge guards and accepted commercial terms.
5. **S5 templates/renderer:** draft previews through the existing serializer, safe artwork references, explicit catalogue capabilities and bounded content. Renderer/font/palette choices need reviewed manifests rather than invented visual support.
6. **S6 optional/deployment:** deployment topology and optional auth/seed changes receive explicit documented disposition. Existing bank, fiscal and provider acceptance gates continue to apply.

S2 schemas must describe the final S3–S5 contract. Per-request backward-compatible additions are preferred; any required shape change is versioned or explicitly identified in API.md. All multi-write operations use transactions and authorization is rechecked against current standing. Shared locks follow existing order. Private tokens/contact data stay out of new projections and diagnostics.

## Product decisions recorded during implementation

- 5 November: the owner selected **hide unpublished seating in vendor briefs** and **allow suspending brief access while retaining the booking**. The owner also selected **paid-to-free changes take effect after the paid period ends**. The pilot uses existing event roles for the door.
- 7 November: a token invalidated by **single-device logout is only rejected**;
  other sessions remain active. Only recorded successful rotation can establish
  replay requiring account-wide revocation after the retry grace.

## Verification

Write the reproducing test first at its cheapest meaningful layer, confirm the red result, then implement. Run focused tests while iterating. At completion run lint, docs/OpenAPI drift, type checks, unit/integration/HTTP suites and the complete container/deployment/restore local gate before any push. Record actual results below; do not infer production acceptance from test fixtures.

## Request disposition

"Previously delivered" is an audit starting point, not a claim that every newer extension is resolved. The initial audit asked about unpublished vendor seating, brief access suspension, paid-to-free timing and a restricted door role. The bounded follow-up below records the separate door-response and concierge decisions.

| Request | Client request / starting point | Slice | Status |
|---|---|---|---|
| FR-1 | Response schemas for every operation in openapi.json | S2 contract/identity | Implemented; backend verification recorded; merged in `75e22e8` |
| FR-2 | Declare security per operation: bearer, or public with security: [] | S2 contract/identity | Implemented; backend verification recorded; merged in `75e22e8` |
| FR-3 | Answered at 34ac1e6 | S3 host/guest operations | Audit confirmed code/schema and regression coverage; merged in `75e22e8` |
| FR-4 | Answered at 34ac1e6 | S3 host/guest operations | Audit confirmed code/schema and regression coverage; merged in `75e22e8` |
| FR-5 | Partly answered at 34ac1e6, without naming this: GET /me/organizations returns {items:[{organizationId,na | S2 contract/identity | Implemented; backend verification recorded; merged in `75e22e8` |
| FR-6 | Effective permissions per event, and whether the account may create events in its organization At 34ac1e6 | S2 contract/identity | Implemented; backend verification recorded; merged in `75e22e8` |
| FR-7 | Rate limits that fit the client | S1 safety/correctness | Implemented; backend verification recorded; merged in `75e22e8` |
| FR-8 | Write the route contract (/invitations/:slug/g/:guestToken and the others the backend emails) into docs/A | S2 contract/identity | Implemented; backend verification recorded; merged in `75e22e8` |
| FR-9 | Mechanism only at 34ac1e6: authored templates must bundle their fonts and a remote one is refused (templa | S5 templates/renderer | Design/external or optional decision; document prerequisite |
| FR-10 | Partly answered at 34ac1e6: x-request-id is exposed and preflights are cached for ten minutes (common/cor | S2 contract/identity | Implemented; backend verification recorded; merged in `75e22e8` |
| FR-11 | Agree the deployment topology: one origin through Caddy, a web service, CORS_ORIGINS, PUBLIC_APP_URL, pro | S6 optional/deployment | Same-origin Compose and release wiring implemented. Staging acceptance open. |
| FR-12 | Optional: the refresh token as an httpOnly cookie | S6 optional/deployment | Design/external or optional decision; document prerequisite |
| FR-13 | Answered at 34ac1e6 | S3 host/guest operations | Audit confirmed code/schema and regression coverage; merged in `75e22e8` |
| FR-14 | A seeded login for manual testing | S6 optional/deployment | Design/external or optional decision; document prerequisite |
| FR-15 | Optional: a metadata object on the public invitation | S5 templates/renderer | Audit and implement |
| FR-16 | Optional: the template's API rules as an importable file | S2 contract/identity | Audit and implement |
| FR-17 | Answered at 34ac1e6 | S3 host/guest operations | Audit confirmed code/schema and regression coverage; merged in `75e22e8` |
| FR-18 | Answered at 34ac1e6 | S3 host/guest operations | Audit confirmed code/schema and regression coverage; merged in `75e22e8` |
| FR-19 | Answered at 34ac1e6 | S3 host/guest operations | Audit confirmed code/schema and regression coverage; merged in `75e22e8` |
| FR-20 | Prefix class-validator messages with their field, as the service's own messages do (party.0.firstName: …) | S2 contract/identity | Audit and implement |
| FR-21 | Answered at 34ac1e6 | S3 host/guest operations | Audit confirmed code/schema and regression coverage; merged in `75e22e8` |
| FR-22 | Answered at 34ac1e6 | S3 host/guest operations | Implemented; transaction, migration and HTTP verification recorded; merged in `75e22e8` |
| FR-23 | Let an accepted invitation lead somewhere | S2 contract/identity | Audit and implement |
| FR-24 | Answered in the schema at 34ac1e6 | S3 host/guest operations | Audit confirmed code/schema and regression coverage; merged in `75e22e8` |
| FR-25 | Answered at 34ac1e6 | S3 host/guest operations | Audit confirmed code/schema and regression coverage; merged in `75e22e8` |
| FR-26 | Partly answered at 34ac1e6: row: 0 is documented and the examples now match the code | S2 contract/identity | Implemented; backend verification recorded; merged in `75e22e8` |
| FR-27 | Answered at 34ac1e6 | S3 host/guest operations | Audit confirmed code/schema and regression coverage; merged in `75e22e8` |
| FR-28 | Machine-readable codes for refusals that name no field | S2 contract/identity | Audit and implement |
| FR-29 | Answered another way at 34ac1e6: the answers are not gated, but a policy test fails if any role may write | S3 host/guest operations | Audit confirmed code/schema and regression coverage; merged in `75e22e8` |
| FR-30 | Move a guest into a household of their own | S3 host/guest operations | Audit and implement |
| FR-31 | Answered at 34ac1e6 | S3 host/guest operations | Audit confirmed code/schema and regression coverage; merged in `75e22e8` |
| FR-32 | Stable codes for the publish blockers, in publishBlockers (GET /invitations/:slug/design) and in the publ | S2 contract/identity | Audit and implement |
| FR-33 | Codes for a send's outcomes: each unreachable household's reason (no guests, erased, malformed address, n | S2 contract/identity | Audit and implement |
| FR-34 | Answered another way at 34ac1e6: the answers are not gated, but a policy test fails if any role may send  | S3 host/guest operations | Audit confirmed code/schema and regression coverage; merged in `75e22e8` |
| FR-35 | Answered at 34ac1e6 | S3 host/guest operations | Audit confirmed code/schema and regression coverage; merged in `75e22e8` |
| FR-36 | Answered at 34ac1e6 | S3 host/guest operations | Audit confirmed code/schema and regression coverage; merged in `75e22e8` |
| FR-37 | Return each person's agreements in GET …/g/:guestToken/rsvp: which statements each household member has a | S3 host/guest operations | Audit and implement |
| FR-38 | Answered at 34ac1e6 | S3 host/guest operations | Audit confirmed code/schema and regression coverage; merged in `75e22e8` |
| FR-39 | Say how many households hold the invitation in the attendance change's notice, as the event's and the ven | S3 host/guest operations | Audit and implement |
| FR-40 | Answered at 34ac1e6, through ?locale= | S3 host/guest operations | Audit confirmed code/schema and regression coverage; merged in `75e22e8` |
| FR-41 | A status read for one signature upload, and a rate allowance for polling it | S1 safety/correctness | Audit and implement |
| FR-42 | Templates the renderer can draw | S5 templates/renderer | Design/external or optional decision; document prerequisite |
| FR-43 | Declare each block's content and settings fields | S5 templates/renderer | Audit and implement |
| FR-44 | Partly answered at 34ac1e6: the eventId path parameter and a nullable variant are in the schema | S2 contract/identity | Implemented; backend verification recorded; merged in `75e22e8` |
| FR-45 | Answered at 34ac1e6 | S3 host/guest operations | Audit confirmed code/schema and regression coverage; merged in `75e22e8` |
| FR-46 | A per-event switch for the guest gallery | S3 host/guest operations | Backend implemented. Client control and staging acceptance open |
| FR-47 | Filters, counts and usage on GET /events/:eventId/gallery | S3 host/guest operations | Audit and implement |
| FR-48 | Say who shared a photo, to the hosts, or say why not | S3 host/guest operations | Audit and implement |
| FR-49 | Name the guests in GET /events/:eventId/acknowledgements | S3 host/guest operations | Audit and implement |
| FR-50 | The guest's own photos and the gallery's closing date, on the personal link | S3 host/guest operations | Audit and implement |
| FR-51 | Answered at 34ac1e6 by the schema work, though the backend did not know of this request | S3 host/guest operations | Audit confirmed code/schema and regression coverage; merged in `75e22e8` |
| FR-52 | Say which seating arrangements guests see, in the venues' order | S3 host/guest operations | Audit and implement |
| FR-53 | Seat a household in one request | S3 host/guest operations | Audit and implement |
| FR-54 | Order tables by their number | S3 host/guest operations | Audit and implement |
| FR-55 | Name the households a seating run could not seat | S3 host/guest operations | Audit and implement |
| FR-56 | Partly answered at 34ac1e6: zone, venueId, posX and posY are typed | S2 contract/identity | Implemented; backend verification recorded; merged in `75e22e8` |
| FR-57 | Name the venue in each seatReleases record, as seating does (guests.service.ts, guestView) | S3 host/guest operations | Audit and implement |
| FR-58 | Codes for the export refusals that share a status | S3 host/guest operations | Audit and implement |
| FR-59 | Export failure codes that say what to do | S3 host/guest operations | Backend implemented. Client recovery adoption and staging acceptance open |
| FR-60 | Say which export kinds carry contacts, or ignore includesContacts where none do | S3 host/guest operations | Audit and implement |
| FR-61 | Say who made each export | S3 host/guest operations | Audit and implement |
| FR-62 | Name the event, the ticket types and the buyer in GET /ticket-orders/:accessToken and its confirm | S4 ticketing/vendors/billing | Backend merged in `c86782e`; frontend adoption pending |
| FR-63 | Codes for checkout's refusals | S4 ticketing/vendors/billing | Audit and implement |
| FR-64 | Say on the public event's checkout whether paid tickets can be bought, and with which banks | S4 ticketing/vendors/billing | Audit and implement |
| FR-65 | Translate venue names in GET /public/events/:slug and in its checkout.venues, as FR-40 asks of the reply  | S4 ticketing/vendors/billing | Audit and implement |
| FR-66 | Return salesStartAt on the public ticket types | S4 ticketing/vendors/billing | Audit and implement |
| FR-67 | Let PATCH …/ticket-types/:typeId clear a sales window | S4 ticketing/vendors/billing | Audit and implement |
| FR-68 | Orders that a host can read whole | S3 host/guest operations | Audit and implement |
| FR-69 | Codes for the announcement's publish blockers, as FR-32 asks of the invitation's: POST …/listing/publish  | S4 ticketing/vendors/billing | Audit and implement |
| FR-70 | Partly answered at 34ac1e6: names, descriptions and picture ids are typed | S2 contract/identity | Implemented; backend verification recorded; merged in `75e22e8` |
| FR-71 | Give hosts checkout's rules for one person (attendanceMode, attendanceRevision, guest-facing venues, rsvp | S3 host/guest operations | Audit and implement |
| FR-72 | Declare Idempotency-Key optional on POST /organizations | S2 contract/identity | Implemented; backend verification recorded; merged in `75e22e8` |
| FR-73 | Give GET /public/events/:slug the guest-page allowance, or trust a forwarded client address from our rend | S3 host/guest operations | Implemented; backend verification recorded; merged in `75e22e8` |
| FR-74 | Keep contact details out of a CSV's "No first-name column found" error | S1 safety/correctness | Implemented; backend verification recorded; merged in `75e22e8` |
| FR-75 | Refuse a blank answer to a required question | S1 safety/correctness | Implemented; backend verification recorded; merged in `75e22e8` |
| FR-76 | Codes and facts on the door's refusals | S3 host/guest operations | Backend implemented in this follow-up; client adoption pending |
| FR-77 | Check arrival and ticket state before the agreement gate | S1 safety/correctness | Audit and implement |
| FR-78 | Who still must agree, per person, on a host's read | S3 host/guest operations | Audit and implement |
| FR-79 | A light list for the door, and a search | S3 host/guest operations | Roster API implemented. Client adoption and door rehearsal open. |
| FR-80 | Let admit return the door screen, as check-in does, and name who arrived | S3 host/guest operations | Audit and implement |
| FR-81 | Count an unlinked ticket's admission, and let it be undone | S3 host/guest operations | Audit and implement |
| FR-82 | Codes a person can type | S3 host/guest operations | Audit and implement |
| FR-83 | Check in a household in one request | S3 host/guest operations | Audit and implement |
| FR-84 | A dry run for remind and thank-you | S3 host/guest operations | Audit and implement |
| FR-85 | Say which households were suppressed from remind and thank-you, and count only what went as "already" | S3 host/guest operations | Audit and implement |
| FR-86 | Refuse a thank-you for a draft or expired invitation | S1 safety/correctness | Audit and implement |
| FR-87 | Report more than invitations | S3 host/guest operations | Audit and implement |
| FR-88 | Make the team readable and name the caller | S3 host/guest operations | Audit and implement |
| FR-89 | Word the team invitation's email | S3 host/guest operations | Audit and implement |
| FR-90 | A door-only role, if product wants one (PQ-15) | S3 host/guest operations | Implement defects; product-dependent portion pending answer |
| FR-91 | A directory staff can keep | S3 host/guest operations | Audit and implement |
| FR-92 | timezone, locale and endsAt on each listing card | S3 host/guest operations | Implemented 11 November 2026. Client adoption open. |
| FR-93 | The listing's categories and availability | S3 host/guest operations | Audit and implement |
| FR-94 | The running order's writes: a notice, the venue, and three loose ends | S1 safety/correctness | Audit and implement |
| FR-95 | Recording an answer: return what was saved, and let status be left out | S3 host/guest operations | Audit and implement |
| FR-96 | Side labels in each language | S3 host/guest operations | Implemented 12 November 2026. Client adoption open. |
| FR-97 | An archived event: which writes stay open, and whether it can be deleted | S3 host/guest operations | Audit and implement |
| FR-98 | "Who must not be contacted" for someone outside the organization | S3 host/guest operations | Audit and implement |
| FR-99 | Suppression writes and reads | S1 safety/correctness | (a) precedence, (b) host reasons, (c) blank addresses, (d) phone form and (f) schema implemented. (e), the list's silent 500 cap, remains open: signalling it changes the response shape. |
| FR-100 | Promo codes: a currency, a zone, clearing, the pilot | S4 ticketing/vendors/billing | Audit and implement |
| FR-101 | translations on creating an event | S3 host/guest operations | Audit and implement |
| FR-102 | Correct and remove an organization's own vendor, and read back its notes | S4 ticketing/vendors/billing | Implemented; organization-owned edits, private notes and soft removal; merged in `75e22e8` |
| FR-103 | Vendor choices for someone on an event only | S4 ticketing/vendors/billing | Implemented; event-scoped vendor choices verified; merged in `75e22e8` |
| FR-104 | Say a brief's language, and give it in the vendor's | S4 ticketing/vendors/billing | Implemented 12 November 2026 in the event's language (C-45). Client adoption open. |
| FR-105 | Expose the usual sections for each kind of vendor | S4 ticketing/vendors/billing | Implemented; picker returns brief section purposes and defaults; merged in `75e22e8` |
| FR-106 | A booking's fee: clearing it, its currency, and a null | S4 ticketing/vendors/billing | Implemented; 84 vendor/access HTTP cases passed; merged in `75e22e8` |
| FR-107 | What a brief's sections carry beyond their purpose | S4 ticketing/vendors/billing | Implemented; vendor HTTP and snapshot verification recorded; merged in `75e22e8` |
| FR-108 | Withdraw a brief link without making another | S4 ticketing/vendors/billing | Implemented; vendor HTTP and snapshot verification recorded; merged in `75e22e8` |
| FR-109 | Say whether paid plans can be bought, and with which banks, as FR-64 asks of tickets, and give the pilot' | S4 ticketing/vendors/billing | Audit and implement |
| FR-110 | Billing's data | S4 ticketing/vendors/billing | Scheduled Free transition implemented under FR-135. Client adoption open. |
| FR-111 | Tell "analytics is off" from "no views", and count songs per venue | S3 host/guest operations | Audit and implement |
| FR-112 | Approve several photos in one request | S3 host/guest operations | Audit and implement |
| FR-113 | The drawn plan's writes | S3 host/guest operations | Audit and implement |
| FR-114 | Declare ChooseTemplateDto whole, and say which templates need a preview | S2 contract/identity | Implemented; backend verification recorded; merged in `75e22e8` |
| FR-115 | Give private artwork as an asset's id, not a path holding the guest's token | S5 templates/renderer | Asset references available on opt-in. Client rollout and default cutover open. |
| FR-116 | Declare X-Aveline-Organization-Id per route | S2 contract/identity | Implemented; backend verification recorded; merged in `75e22e8` |
| FR-117 | Describe and page the guest book and the answers sheet | S3 host/guest operations | Implemented; backend verification recorded; merged in `75e22e8` |
| FR-118 | Read and record a household's answers in one request each | S3 host/guest operations | Audit and implement |
| FR-119 | Take an idempotency key when adding a guest | S3 host/guest operations | Audit and implement |
| FR-120 | Preview a section's unsaved content | S5 templates/renderer | Implemented; backend verification recorded; merged in `75e22e8` |
| FR-121 | Say who the caller is on GET /organizations/current/members, or give GET /me (FR-5) | S2 contract/identity | Implemented; backend verification recorded; merged in `75e22e8` |
| FR-122 | Say whether a closure review is open, on GET /organizations/current | S3 host/guest operations | Implemented; backend verification recorded; merged in `75e22e8` |
| FR-123 | Tell an unreadable audit trail from an empty one, and describe each entry | S3 host/guest operations | Audit and implement |
| FR-124 | Give asking to close a route permission and a plain refusal | S3 host/guest operations | Implemented; backend verification recorded; merged in `75e22e8` |
| FR-125 | Say which members are active, and read a page's revision with its rows | S1 safety/correctness | Implemented; backend verification recorded; merged in `75e22e8` |
| FR-126 | Keep each data request's notes apart, marked unverified, and drop none silently | S1 safety/correctness | Implemented; backend verification recorded; merged in `75e22e8` |

## Evidence and remaining work

First batch evidence: payment/billing integration 28 cases passed; organization lifecycle integration 6 passed, including an interleaved snapshot mutation; identity/capability HTTP 5 passed; schema/transport/wire regression 13 passed; required-answer/import focused unit coverage 81 passed across the combined focused run; decline-to-acceptance PostgreSQL regression passed. Lint and docs checks passed during iteration. These counts overlap and are not a full-suite total.

Review findings corrected: passthrough JSON vs raw responses, streamed file MIME types, array interfaces, nullable unions/enums, interceptor recovery fields, and required answers evaluated only for attending guests (including prior stored blanks).

The first backend batch passed full local and hosted CI and merged to `dev` and `main` at `75e22e8`. Remaining request rows and production launch prerequisites are still open.

Follow-up batch: FR-117 adds bounded question/answer and guest-book pages, full
SQL option tallies, translated boolean values (including regional locales),
undated entries last, and explicit legacy report limits without truncation.
FR-120 adds an authorized inert POST preview built by the existing serializer.
FR-126 stores every public submission separately as unverified input, preserves
staff notes/deadlines, and serializes concurrent case creation. Its additive
migration preserves historical unattributed notes rather than inventing their
provenance. New public-note storage and legacy report caps are compatibility
changes that must be identified in the eventual commit.

Historic completion audit confirmed 19 of the 20 previously delivered rows
against current DTOs/schema and their existing regressions. FR-22 also exposed
a policy mismatch: the client heading required rotation evidence, while the
access contract explicitly treated single-device logout as reuse. The owner
chose rejection without ending other sessions on 7 November. The follow-up
adds nullable rotation evidence and atomic replacement/signing, including
rollback tests for both failure points and conservative handling of legacy
revocations. Four real-transaction regressions and all 37 authentication HTTP
cases passed; the strengthened concurrency assertion also passed separately.
Eleven schema critique cases passed, including migration drift, and OpenAPI
remains unchanged at 207 paths. Build, lint and docs checks passed. The
canonical pre-push container proof for the merged batch passed at `75e22e8`.

Import diagnostic review resulted in stripping every raw diagnostic `value`,
regardless of its column, rebuilding durable messages from known codes and
keeping raw database exceptions out of logs. History reads sanitize older
records too, without silently rewriting stored history. A misplaced address in
a seats/name column is still contact data. Immediate importer responses may
retain rejected values under the existing contact-authorized write permission.
Ten focused diagnostic/privacy unit cases and four HTTP cases passed after
reproducing the leaks. The first broad gate passed 1,633 unit tests but its
database phase was interrupted to replace slow disposable disk storage with
memory-backed PostgreSQL (`fsync` and synchronous commits remain on). The rerun
passed 1,643 unit tests and 928 integration tests. Its HTTP sweep passed 1,365
of 1,367 cases, with only two outdated policy assertions failing: the member
field whitelist and the old public-read rate limit. Both were corrected; all
39 cases in the two affected HTTP files passed on rerun, including one added
guest-read case. The canonical full pre-push CI later passed at `75e22e8`. No test
was disabled and no runtime behavior changed to satisfy those assertions.

FR-107/108 now keep booking authority and every brief section on one PostgreSQL
snapshot. Pausing preserves the engagement and token; renewal retires the
cancelled credential. Published seating keeps accurate occupancy after erasure
and withholds identities and history that the vendor does not need. The full
vendor/access HTTP files passed all 82 cases after these changes; two controlled
PostgreSQL interleavings reproduced and then verified the snapshot fixes. The
11 schema critique cases, lint, build, docs and regenerated OpenAPI also passed.
The current frontend reads the legacy `released` array's length. Published
seating now returns one null entry per release alongside `releasedCount`,
without returning any release records.

FR-106 accepts ISO currency codes and an explicit null to clear a fee on either
booking write. Changing a recorded fee's currency requires an explicit amount
or clear. Both vendor HTTP files passed all 84 cases with this change.

FR-103/105 add a typed, paginated picker scoped to the event's organization.
Event-only coordinators can select and book eligible vendors without
organization directory access. The picker returns the section purposes and
defaults from the booking policy and omits commercial and contact fields.
All 89 vendor HTTP cases and 33 focused policy and route checks passed,
including offset validation and duplicate-booking fee changes.

FR-102 lets organization vendor editors correct an owned entry, read its
private notes and remove it from future booking choices. Removal preserves
current engagements and their brief links. Both booking write paths reject
re-engagement after cancellation; directory removal and booking writes share
an organization lock. All 94 vendor HTTP cases passed, including a controlled
PostgreSQL race between directory removal and a first booking. The full unit
suite passed all 1,643 tests.

## Next implementation slice: vendor brief locale and billing transitions

FR-104 can proceed independently of billing and household RSVP writes. Use
the event's supported locales to resolve the brief's event title, venue and
timeline text, section purposes, side labels and applicable answer choices.
Preserve the existing snapshot and section permissions.

FR-110 and FR-135 share the scheduled Free implementation. The subscription
returns the current plan and its pending change. The agreed target terms
survive catalogue edits. Settlement and other billing changes serialize on
the organization. See [API.md](API.md) for withdrawal, payment and refund
behavior. Charge providers, fiscal configuration and unattended renewals
remain subject to the launch gates.

## Follow-up from frontend commit `77ed2c9`

The frontend was built against `34ac1e6`. The merged backend already covers
FR-1, FR-2, FR-5, FR-6, FR-73 and FR-74. This follow-up implements FR-62
for the buyer link and its confirmation. Both include localized ticket type
names and the buyer's display name. The next open pilot API requests in
Arthur's message are FR-76 (door refusal codes and facts) and FR-79 (door roster
and search). FR-11 is the deployment layout decision.

The frontend register adds FR-127 through FR-136. FR-131 is addressed in this
follow-up. An applied erasure stays in recovery and cannot be rejected.
FR-135 is the period-end free-plan change already decided under FR-110.
The other new rows remain open.

A6 was superseded. Frontend and backend ticketing merged through `dev` to
`main` at `2fe4df0`. The real-backend ticketing rehearsal covered seat and
zone purchase and admission. Wider real-backend acceptance, dedicated
frontend CI and the production origin layout remain separate work.

## Implementation plan for the small and bounded requests

The plan covers FR-62 frontend adoption, FR-76, FR-130, FR-134, FR-136,
frontend CI and the launch checklist. Start the two backend quick changes
and the checklist independently. Freeze the two bounded API contracts early
so the client team can plan fixtures. Frontend implementation belongs to
the client team. The larger workstreams remain on the request register.

### Decisions confirmed on 8 November 2026

- **FR-76.** Door staff may see the holder's name, first admission time and
  guest ID when available. For an acknowledgement refusal, return only the
  missing acknowledgements for the ticket or guest being admitted. Omit
  contact details. Keep the existing event access requirements.
- **FR-130.** An active OWNER membership or a live OWNER invitation
  qualifies as an existing customer organization. Return those as distinct
  states. Memberships in other roles are insufficient.

### Backend and shared documentation

| Work | Estimate | Entry point and delivery |
|---|---:|---|
| FR-134 · New invitation defaults | ½–1 day | Persist explicit disabled settings for drink preference and song request in `createEventInvitation`. Both event creation with an invitation and adding an invitation to an existing event use this helper. Keep the read fallback for older invitations and preserve existing host edits. Verify both creation paths, a legacy invitation with unset fields and re-enabling either question. Update the invitation and API docs with the new defaults. |
| FR-136 · Invitation email footer | ½–1 day | Add a localized footer at the common render/enqueue boundary for new `invitation.send` EMAIL messages. Build the public, token-free link with `appPage('/privacy-request')` so it follows `PUBLIC_APP_URL`. Apply the footer to built-in and organization copy through both single and batch enqueue paths. Cover Armenian, English, Russian and French footer text while preserving existing template fallback. Include an Aveline website link if a separate website is configured for email. Scope delivery to invitation emails and leave stored messages and other channels alone. Verify that the link opens for a signed-out guest. Add it to the browser route contract. |
| FR-76 · Door refusal contract | 1–3 days | Extend the existing check-in and ticket-admission responses with typed domain codes and scoped facts. Keep endpoint permissions and the admission transaction. Publish examples and OpenAPI before client adoption. |
| FR-130 · Concierge relationship lookup | 2–3 days | Apply one relationship eligibility rule to concierge lookup and opening a customer organization. Add an explicit relationship projection and revalidate it on the write path. Keep the separate sales-conversion policy explicit and cover that caller in regression tests. |
| Launch checklist | ½ day | Correct the merged status in `docs/GOING_LIVE.md` and record the ticketing rehearsal's coverage. Mark FR-73 and FR-74 delivered. Leave FR-11, FR-76, FR-79, the wider rehearsal and unresolved launch requirements open. Record frontend CI and public build settings as pending until evidence exists. |

#### FR-76 acceptance

- Cover guest check-in and ticket admission for an unknown or other-event
  target, duplicate arrival or scan, changed ticket link, unavailable order,
  pending cancellation, unregistered attendee when an acknowledgement is
  required, and missing current acknowledgements. Keep existing HTTP
  statuses and compatible message text during client migration. The client
  keys off the new codes.
- Return the original `arrivedAt` or `usedAt` in UTC when recorded, and the
  approved holder and guest fields when known. Represent the order status and
  pending cancellation in typed data. Scope the acknowledgement query to the
  person being admitted and return the missing question IDs and safe display
  labels. Keep the existing RSVP and ticket-link acknowledgement contracts.
- Use the existing attendance, order, guest and ticket locks. Exercise two
  scanners racing, a concurrent relink or cancellation, and the case where
  more than one rule blocks admission. Prefer an already used or unavailable
  ticket response to a request for a new acknowledgement when both apply.
  Assert that denied attempts create no admissions and return no contacts,
  capability tokens or unrelated guest data.
- Coordinate field naming with FR-79's future roster. FR-76 can ship and be
  adopted using the current door screen while the roster is designed.

#### FR-130 acceptance

- Match normalized email to an active OWNER membership or a live,
  unaccepted, unrevoked OWNER invitation for an open organization. Deduplicate
  by organization, with active ownership taking precedence if both exist.
  Add an explicit relationship such as `OWNER` or `PENDING_OWNER_INVITE` to
  the lookup and existing-organization result. Return no invite token.
- Keep cursor pagination and explicit selection when several organizations
  qualify. Revalidate the selected relationship inside the opening transaction
  under the existing owner-address lock. A pending invitation remains pending
  on reuse. Avoid duplicate organizations and invitations when the request
  repeats. A stale or unrelated selected organization is refused.
- Cover case-insensitive email, non-owner membership, pending-only results,
  expired and revoked invites, multiple matches across pages and a relationship
  changed between lookup and write. The shared resolver also serves sales
  conversion. Keep its current workflow unless a separate decision changes it.

### Frontend handoff

| Work | Estimate | When to start and what to verify |
|---|---:|---|
| FR-62 · Buyer order page | ½–1 day | Ready on `main`. Read `buyerName`, order `locale`, `event` and `items[].name` from both the buyer-order read and confirmation. An emailed link must show context in a fresh tab without a prior checkout slug or a public listing fetch. Cover null listing slug and type name, event timezone, held/paid/refunded states, seat and zone labels, and existing capability-token protections. |
| Dedicated GitHub frontend CI | ½–1 day | Ready. Draft the shared workflow for review. Check out the combined tree and run `npm ci` and `npm run verify` in `frontend/` using its pinned Node line. Generate API types from the same commit. Trigger on frontend, workflow and backend contract changes, including the controllers that frontend contract tests read. Keep the existing local push gate. |
| FR-134 · Remove the client workaround | After backend deployment | Remove the extra write that disables the two fields after creation, once the target backend persists those defaults. Confirm older invitations still display their stored settings and either question can be enabled. |
| FR-76 · Door refusal UI | After verified API contract | Replace message matching for the new cases with codes and facts. Localize in all four languages. Show the original arrival time, only the approved identity fields, and the missing acknowledgements for that guest. Keep fallbacks until the supported backend versions expose the new contract. |
| FR-130 · Concierge lookup UI | After verified API contract | Label owner and pending invite distinctly. Keep explicit organization selection when required, handle pagination, and refresh when an invite or membership is no longer valid. |

FR-62 and frontend CI can proceed in parallel with the backend quick changes.
FR-76 and FR-130 are independent once their response shapes are reviewed.
For each API change, update the governing contract and regenerate OpenAPI with
the implementation. Run focused regressions before the complete local gate.
Test client adoption against the resulting backend in a disposable stack.

### Backend delivery and client adoption

FR-134 persists the new defaults only on invitation creation. FR-136 adds
the localized footer at email render/enqueue time. FR-76 exposes the
structured door refusal contract, and FR-130 projects the two qualifying
relationships in concierge lookup and reuse. The shared launch checklist
now reflects the merged frontend and the remaining launch evidence.

FR-62, frontend CI, and adoption of FR-76, FR-130 and FR-134 remain client
handoff items. The same-origin release wiring and the backend for FR-79,
FR-115, FR-128 and FR-135 are implemented. The
[larger requests implementation plan](CLIENT_LARGER_REQUESTS_PLAN.md)
records the API handoff and remaining rollout and rehearsal work. The
[remaining priority plan](CLIENT_REMAINING_PRIORITY_PLAN.md) covers the
additional verified requests outside Arthur’s highlighted handoff.

Local verification covered lint, TypeScript, build, generated OpenAPI and
the docs check. All 1,654 unit tests and 10 pilot tooling tests passed. All
92 HTTP suites passed across three isolated stacks. The affected admission
integration suites passed on rerun with the new error codes and race
assertions. The current frontend's 324 focused contract tests and generated
API type check passed. The signed-out privacy form returned HTTP 200 locally.

### Door, listing and price-list follow-up (11 November 2026)

From the frontend register at `efcdf22`. FR-92 adds `endsAt`, `timezone` and
the negotiated `locale` to each browse card. They come from the event row the
card already reads, so no query is added. FR-141 adds `isErased` to each door
roster row and keeps erased guests in their household's results. FR-142 and
FR-147 give the door roster and `GET /plans` the guest-page read allowance. Each
route keeps its own count, so check-ins and other writes keep the default limit.
All four are additive. Client adoption and the real-backend rehearsal are open.

### Side labels, brief language and suppression input (12 November 2026)

FR-96 makes `sideALabel` and `sideBLabel` translatable like the title and
resolves them in the guest page's language. FR-104 names the brief's `locale`,
the event's default language, and gives the title, side labels and venues in
it. FR-99 refuses a host-sent reason other than `MANUAL` and a blank address,
stores SMS and WhatsApp numbers without formatting, and declares the request
schema. Refusing the other reasons is breaking for a client that sent them; the
current client sends none. FR-99(e) stays open. The release workflow now takes
the support contacts and website address as optional inputs.
