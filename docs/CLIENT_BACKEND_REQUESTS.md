# Client backend requests — implementation plan and delivery record

Source: frontend request register at [`d8fe229`](https://github.com/br1gade/aveline/blob/d8fe229c2458f34855fd990055093179df9dd44c/frontend/docs/BACKEND_REQUESTS.md), captured 5 November 2026. Backend base: `34ac1e6`. This record covers FR-1–126, including previously answered requests; a request is complete only when implementation, contract and verification agree. The frontend source register remains its team's record.

## Delivery order and dependencies

1. **S1 safety/correctness:** reproduce payment-retry race, protect import/privacy evidence, validate required answers and nullable inputs, apply guest-read rate allowances. Shared test fixtures use newly created isolated stores only.
2. **S2 contract/identity:** response/security/header/query schemas, current-user and effective-capability reads, stable machine-readable refusal metadata. This removes frontend source/text matching and hand-written response types.
3. **S3 host/guest operations:** bounded reports, atomic household answers/seating/admission, idempotent walk-ins, bulk moderation/positions, accurate door/acknowledgement views, follow-up audience/delivery, organization and privacy-request consistency.
4. **S4 ticketing/vendors/billing:** complete order/public-event projections, payment availability and retry semantics, vendor edits/choices/scopes and privacy, pagination and nullable updates. Preserve pilot charge guards and accepted commercial terms.
5. **S5 templates/renderer:** draft previews through the existing serializer, safe artwork references, explicit catalogue capabilities and bounded content. Renderer/font/palette choices need reviewed manifests rather than invented visual support.
6. **S6 optional/deployment:** deployment topology and optional auth/seed changes receive explicit documented disposition. Existing bank, fiscal and provider acceptance gates continue to apply.

S2 schemas must describe the final S3–S5 contract. Per-request backward-compatible additions are preferred; any required shape change is versioned or explicitly identified in API.md. All multi-write operations use transactions and authorization is rechecked against current standing. Shared locks follow existing order. Private tokens/contact data stay out of new projections and diagnostics.

## Product decisions recorded during implementation

- 5 November: the owner selected **hide unpublished seating in vendor briefs** and **allow suspending brief access while retaining the booking**. The owner also selected **paid-to-free changes take effect after the paid period ends**. The restricted door role is still awaiting an answer.
- 7 November: a token invalidated by **single-device logout is only rejected**;
  other sessions remain active. Only recorded successful rotation can establish
  replay requiring account-wide revocation after the retry grace.

## Verification

Write the reproducing test first at its cheapest meaningful layer, confirm the red result, then implement. Run focused tests while iterating. At completion run lint, docs/OpenAPI drift, type checks, unit/integration/HTTP suites and the complete container/deployment/restore local gate before any push. Record actual results below; do not infer production acceptance from test fixtures.

## Request disposition

"Previously delivered" is an audit starting point, not a claim that every newer extension is resolved. Product questions are limited to unpublished vendor seating/access suspension, paid-to-free timing and a restricted door role; their independent defects can proceed while answers are pending.

| Request | Client request / starting point | Slice | Status |
|---|---|---|---|
| FR-1 | Response schemas for every operation in openapi.json | S2 contract/identity | Implemented; backend verification recorded; pre-push CI pending |
| FR-2 | Declare security per operation: bearer, or public with security: [] | S2 contract/identity | Implemented; backend verification recorded; pre-push CI pending |
| FR-3 | Answered at 34ac1e6 | S3 host/guest operations | Audit confirmed code/schema and regression coverage; pre-push CI pending |
| FR-4 | Answered at 34ac1e6 | S3 host/guest operations | Audit confirmed code/schema and regression coverage; pre-push CI pending |
| FR-5 | Partly answered at 34ac1e6, without naming this: GET /me/organizations returns {items:[{organizationId,na | S2 contract/identity | Implemented; backend verification recorded; pre-push CI pending |
| FR-6 | Effective permissions per event, and whether the account may create events in its organization At 34ac1e6 | S2 contract/identity | Implemented; backend verification recorded; pre-push CI pending |
| FR-7 | Rate limits that fit the client | S1 safety/correctness | Implemented; backend verification recorded; pre-push CI pending |
| FR-8 | Write the route contract (/invitations/:slug/g/:guestToken and the others the backend emails) into docs/A | S2 contract/identity | Implemented; backend verification recorded; pre-push CI pending |
| FR-9 | Mechanism only at 34ac1e6: authored templates must bundle their fonts and a remote one is refused (templa | S5 templates/renderer | Design/external or optional decision; document prerequisite |
| FR-10 | Partly answered at 34ac1e6: x-request-id is exposed and preflights are cached for ten minutes (common/cor | S2 contract/identity | Implemented; backend verification recorded; pre-push CI pending |
| FR-11 | Agree the deployment topology: one origin through Caddy, a web service, CORS_ORIGINS, PUBLIC_APP_URL, pro | S6 optional/deployment | Design/external or optional decision; document prerequisite |
| FR-12 | Optional: the refresh token as an httpOnly cookie | S6 optional/deployment | Design/external or optional decision; document prerequisite |
| FR-13 | Answered at 34ac1e6 | S3 host/guest operations | Audit confirmed code/schema and regression coverage; pre-push CI pending |
| FR-14 | A seeded login for manual testing | S6 optional/deployment | Design/external or optional decision; document prerequisite |
| FR-15 | Optional: a metadata object on the public invitation | S5 templates/renderer | Audit and implement |
| FR-16 | Optional: the template's API rules as an importable file | S2 contract/identity | Audit and implement |
| FR-17 | Answered at 34ac1e6 | S3 host/guest operations | Audit confirmed code/schema and regression coverage; pre-push CI pending |
| FR-18 | Answered at 34ac1e6 | S3 host/guest operations | Audit confirmed code/schema and regression coverage; pre-push CI pending |
| FR-19 | Answered at 34ac1e6 | S3 host/guest operations | Audit confirmed code/schema and regression coverage; pre-push CI pending |
| FR-20 | Prefix class-validator messages with their field, as the service's own messages do (party.0.firstName: …) | S2 contract/identity | Audit and implement |
| FR-21 | Answered at 34ac1e6 | S3 host/guest operations | Audit confirmed code/schema and regression coverage; pre-push CI pending |
| FR-22 | Answered at 34ac1e6 | S3 host/guest operations | Implemented; transaction, migration and HTTP verification recorded; pre-push CI pending |
| FR-23 | Let an accepted invitation lead somewhere | S2 contract/identity | Audit and implement |
| FR-24 | Answered in the schema at 34ac1e6 | S3 host/guest operations | Audit confirmed code/schema and regression coverage; pre-push CI pending |
| FR-25 | Answered at 34ac1e6 | S3 host/guest operations | Audit confirmed code/schema and regression coverage; pre-push CI pending |
| FR-26 | Partly answered at 34ac1e6: row: 0 is documented and the examples now match the code | S2 contract/identity | Implemented; backend verification recorded; pre-push CI pending |
| FR-27 | Answered at 34ac1e6 | S3 host/guest operations | Audit confirmed code/schema and regression coverage; pre-push CI pending |
| FR-28 | Machine-readable codes for refusals that name no field | S2 contract/identity | Audit and implement |
| FR-29 | Answered another way at 34ac1e6: the answers are not gated, but a policy test fails if any role may write | S3 host/guest operations | Audit confirmed code/schema and regression coverage; pre-push CI pending |
| FR-30 | Move a guest into a household of their own | S3 host/guest operations | Audit and implement |
| FR-31 | Answered at 34ac1e6 | S3 host/guest operations | Audit confirmed code/schema and regression coverage; pre-push CI pending |
| FR-32 | Stable codes for the publish blockers, in publishBlockers (GET /invitations/:slug/design) and in the publ | S2 contract/identity | Audit and implement |
| FR-33 | Codes for a send's outcomes: each unreachable household's reason (no guests, erased, malformed address, n | S2 contract/identity | Audit and implement |
| FR-34 | Answered another way at 34ac1e6: the answers are not gated, but a policy test fails if any role may send  | S3 host/guest operations | Audit confirmed code/schema and regression coverage; pre-push CI pending |
| FR-35 | Answered at 34ac1e6 | S3 host/guest operations | Audit confirmed code/schema and regression coverage; pre-push CI pending |
| FR-36 | Answered at 34ac1e6 | S3 host/guest operations | Audit confirmed code/schema and regression coverage; pre-push CI pending |
| FR-37 | Return each person's agreements in GET …/g/:guestToken/rsvp: which statements each household member has a | S3 host/guest operations | Audit and implement |
| FR-38 | Answered at 34ac1e6 | S3 host/guest operations | Audit confirmed code/schema and regression coverage; pre-push CI pending |
| FR-39 | Say how many households hold the invitation in the attendance change's notice, as the event's and the ven | S3 host/guest operations | Audit and implement |
| FR-40 | Answered at 34ac1e6, through ?locale= | S3 host/guest operations | Audit confirmed code/schema and regression coverage; pre-push CI pending |
| FR-41 | A status read for one signature upload, and a rate allowance for polling it | S1 safety/correctness | Audit and implement |
| FR-42 | Templates the renderer can draw | S5 templates/renderer | Design/external or optional decision; document prerequisite |
| FR-43 | Declare each block's content and settings fields | S5 templates/renderer | Audit and implement |
| FR-44 | Partly answered at 34ac1e6: the eventId path parameter and a nullable variant are in the schema | S2 contract/identity | Implemented; backend verification recorded; pre-push CI pending |
| FR-45 | Answered at 34ac1e6 | S3 host/guest operations | Audit confirmed code/schema and regression coverage; pre-push CI pending |
| FR-46 | A per-event switch for the guest gallery | S3 host/guest operations | Audit and implement |
| FR-47 | Filters, counts and usage on GET /events/:eventId/gallery | S3 host/guest operations | Audit and implement |
| FR-48 | Say who shared a photo, to the hosts, or say why not | S3 host/guest operations | Audit and implement |
| FR-49 | Name the guests in GET /events/:eventId/acknowledgements | S3 host/guest operations | Audit and implement |
| FR-50 | The guest's own photos and the gallery's closing date, on the personal link | S3 host/guest operations | Audit and implement |
| FR-51 | Answered at 34ac1e6 by the schema work, though the backend did not know of this request | S3 host/guest operations | Audit confirmed code/schema and regression coverage; pre-push CI pending |
| FR-52 | Say which seating arrangements guests see, in the venues' order | S3 host/guest operations | Audit and implement |
| FR-53 | Seat a household in one request | S3 host/guest operations | Audit and implement |
| FR-54 | Order tables by their number | S3 host/guest operations | Audit and implement |
| FR-55 | Name the households a seating run could not seat | S3 host/guest operations | Audit and implement |
| FR-56 | Partly answered at 34ac1e6: zone, venueId, posX and posY are typed | S2 contract/identity | Implemented; backend verification recorded; pre-push CI pending |
| FR-57 | Name the venue in each seatReleases record, as seating does (guests.service.ts, guestView) | S3 host/guest operations | Audit and implement |
| FR-58 | Codes for the export refusals that share a status | S3 host/guest operations | Audit and implement |
| FR-59 | Export failure codes that say what to do | S3 host/guest operations | Audit and implement |
| FR-60 | Say which export kinds carry contacts, or ignore includesContacts where none do | S3 host/guest operations | Audit and implement |
| FR-61 | Say who made each export | S3 host/guest operations | Audit and implement |
| FR-62 | Name the event, the ticket types and the buyer in GET /ticket-orders/:accessToken and its confirm | S4 ticketing/vendors/billing | Audit and implement |
| FR-63 | Codes for checkout's refusals | S4 ticketing/vendors/billing | Audit and implement |
| FR-64 | Say on the public event's checkout whether paid tickets can be bought, and with which banks | S4 ticketing/vendors/billing | Audit and implement |
| FR-65 | Translate venue names in GET /public/events/:slug and in its checkout.venues, as FR-40 asks of the reply  | S4 ticketing/vendors/billing | Audit and implement |
| FR-66 | Return salesStartAt on the public ticket types | S4 ticketing/vendors/billing | Audit and implement |
| FR-67 | Let PATCH …/ticket-types/:typeId clear a sales window | S4 ticketing/vendors/billing | Audit and implement |
| FR-68 | Orders that a host can read whole | S3 host/guest operations | Audit and implement |
| FR-69 | Codes for the announcement's publish blockers, as FR-32 asks of the invitation's: POST …/listing/publish  | S4 ticketing/vendors/billing | Audit and implement |
| FR-70 | Partly answered at 34ac1e6: names, descriptions and picture ids are typed | S2 contract/identity | Implemented; backend verification recorded; pre-push CI pending |
| FR-71 | Give hosts checkout's rules for one person (attendanceMode, attendanceRevision, guest-facing venues, rsvp | S3 host/guest operations | Audit and implement |
| FR-72 | Declare Idempotency-Key optional on POST /organizations | S2 contract/identity | Implemented; backend verification recorded; pre-push CI pending |
| FR-73 | Give GET /public/events/:slug the guest-page allowance, or trust a forwarded client address from our rend | S3 host/guest operations | Implemented; backend verification recorded; pre-push CI pending |
| FR-74 | Keep contact details out of a CSV's "No first-name column found" error | S1 safety/correctness | Implemented; backend verification recorded; pre-push CI pending |
| FR-75 | Refuse a blank answer to a required question | S1 safety/correctness | Implemented; backend verification recorded; pre-push CI pending |
| FR-76 | Codes and facts on the door's refusals | S3 host/guest operations | Audit and implement |
| FR-77 | Check arrival and ticket state before the agreement gate | S1 safety/correctness | Audit and implement |
| FR-78 | Who still must agree, per person, on a host's read | S3 host/guest operations | Audit and implement |
| FR-79 | A light list for the door, and a search | S3 host/guest operations | Audit and implement |
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
| FR-92 | timezone, locale and endsAt on each listing card | S3 host/guest operations | Audit and implement |
| FR-93 | The listing's categories and availability | S3 host/guest operations | Audit and implement |
| FR-94 | The running order's writes: a notice, the venue, and three loose ends | S1 safety/correctness | Audit and implement |
| FR-95 | Recording an answer: return what was saved, and let status be left out | S3 host/guest operations | Audit and implement |
| FR-96 | Side labels in each language | S3 host/guest operations | Audit and implement |
| FR-97 | An archived event: which writes stay open, and whether it can be deleted | S3 host/guest operations | Audit and implement |
| FR-98 | "Who must not be contacted" for someone outside the organization | S3 host/guest operations | Audit and implement |
| FR-99 | Suppression writes and reads | S1 safety/correctness | Audit and implement |
| FR-100 | Promo codes: a currency, a zone, clearing, the pilot | S4 ticketing/vendors/billing | Audit and implement |
| FR-101 | translations on creating an event | S3 host/guest operations | Audit and implement |
| FR-102 | Correct and remove an organization's own vendor, and read back its notes | S4 ticketing/vendors/billing | Implemented; organization-owned edits, private notes and soft removal; pre-push CI pending |
| FR-103 | Vendor choices for someone on an event only | S4 ticketing/vendors/billing | Implemented; event-scoped vendor choices verified; pre-push CI pending |
| FR-104 | Say a brief's language, and give it in the vendor's | S4 ticketing/vendors/billing | Audit and implement |
| FR-105 | Expose the usual sections for each kind of vendor | S4 ticketing/vendors/billing | Implemented; picker returns brief section purposes and defaults; pre-push CI pending |
| FR-106 | A booking's fee: clearing it, its currency, and a null | S4 ticketing/vendors/billing | Implemented; 84 vendor/access HTTP cases passed; pre-push CI pending |
| FR-107 | What a brief's sections carry beyond their purpose | S4 ticketing/vendors/billing | Implemented; vendor HTTP and snapshot verification recorded; pre-push CI pending |
| FR-108 | Withdraw a brief link without making another | S4 ticketing/vendors/billing | Implemented; vendor HTTP and snapshot verification recorded; pre-push CI pending |
| FR-109 | Say whether paid plans can be bought, and with which banks, as FR-64 asks of tickets, and give the pilot' | S4 ticketing/vendors/billing | Audit and implement |
| FR-110 | Billing's data | S4 ticketing/vendors/billing | Decision recorded; implementation pending |
| FR-111 | Tell "analytics is off" from "no views", and count songs per venue | S3 host/guest operations | Audit and implement |
| FR-112 | Approve several photos in one request | S3 host/guest operations | Audit and implement |
| FR-113 | The drawn plan's writes | S3 host/guest operations | Audit and implement |
| FR-114 | Declare ChooseTemplateDto whole, and say which templates need a preview | S2 contract/identity | Implemented; backend verification recorded; pre-push CI pending |
| FR-115 | Give private artwork as an asset's id, not a path holding the guest's token | S5 templates/renderer | Audit and implement |
| FR-116 | Declare X-Aveline-Organization-Id per route | S2 contract/identity | Implemented; backend verification recorded; pre-push CI pending |
| FR-117 | Describe and page the guest book and the answers sheet | S3 host/guest operations | Implemented; backend verification recorded; pre-push CI pending |
| FR-118 | Read and record a household's answers in one request each | S3 host/guest operations | Audit and implement |
| FR-119 | Take an idempotency key when adding a guest | S3 host/guest operations | Audit and implement |
| FR-120 | Preview a section's unsaved content | S5 templates/renderer | Implemented; backend verification recorded; pre-push CI pending |
| FR-121 | Say who the caller is on GET /organizations/current/members, or give GET /me (FR-5) | S2 contract/identity | Implemented; backend verification recorded; pre-push CI pending |
| FR-122 | Say whether a closure review is open, on GET /organizations/current | S3 host/guest operations | Implemented; backend verification recorded; pre-push CI pending |
| FR-123 | Tell an unreadable audit trail from an empty one, and describe each entry | S3 host/guest operations | Audit and implement |
| FR-124 | Give asking to close a route permission and a plain refusal | S3 host/guest operations | Implemented; backend verification recorded; pre-push CI pending |
| FR-125 | Say which members are active, and read a page's revision with its rows | S1 safety/correctness | Implemented; backend verification recorded; pre-push CI pending |
| FR-126 | Keep each data request's notes apart, marked unverified, and drop none silently | S1 safety/correctness | Implemented; backend verification recorded; pre-push CI pending |

## Evidence and remaining work

First batch evidence: payment/billing integration 28 cases passed; organization lifecycle integration 6 passed, including an interleaved snapshot mutation; identity/capability HTTP 5 passed; schema/transport/wire regression 13 passed; required-answer/import focused unit coverage 81 passed across the combined focused run; decline-to-acceptance PostgreSQL regression passed. Lint and docs checks passed during iteration. These counts overlap and are not a full-suite total.

Review findings corrected: passthrough JSON vs raw responses, streamed file MIME types, array interfaces, nullable unions/enums, interceptor recovery fields, and required answers evaluated only for attending guests (including prior stored blanks).

Not yet completed: the remaining request rows and the final pre-push/container gate. No merge, deployment, real sending, charging or production activation is implied by this plan.

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
canonical pre-push container proof remains pending.

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
guest-read case. The canonical full pre-push CI proof is still pending. No test
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

Billing (FR-110) needs its own additive scheduled-change record/fields and
transaction tests: preserve the paid plan and period through its end, expose
the pending free-plan change, and apply it exactly once at the period boundary.
All plan-change, payment-settlement, refund, cancellation and resume paths must
share organization serialization so a stale settlement cannot overwrite a
newer intent. The accepted target/version and effective date must survive
catalogue edits. Selecting a free plan still voids an unpaid plan-change invoice;
a late capture must follow the existing full-refund path. Preserve captured
invitation lifetime. Charge providers, fiscal configuration and unattended
renewals remain subject to existing launch gates.
