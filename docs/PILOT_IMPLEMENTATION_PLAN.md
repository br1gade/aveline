# Pilot and P2 implementation plan

Prepared 12 October 2026; revised 18 October 2026 (Asia/Yerevan).
**Status: product decisions confirmed; implementation plan ready.
Readiness groundwork, F50 backend seating/attendance, F23 named attendees and
private CSV/PDF/XLSX exports and background automatic seating are implemented;
feature milestones
remain open until all of their acceptance checks pass.**

Goal: deliver the requested pilot features while the frontend is being built,
then verify them together on production infrastructure. The pilot remains free.

This is a work plan, not the live API contract. [API.md](API.md) and generated
`backend/openapi.json` describe implemented behavior. New fields, models and
operations below are proposals until they ship with their documentation.

## 1. Confirmed release scope

The requested list contains **18 items**: 17 P2 features plus F45. The user
requires the full scope before the pilot, with one explicit exception:
**F22's native email-provider integration stays deferred.** Its provider-neutral
quota and feedback groundwork is already implemented. Consequently, **17
remaining feature items are release gates**. The frontend and external launch
requirements are additional gates, not extra backlog features.

The tentative target is **25 October 2026**. On 13 October that is twelve days
away. The user has chosen to keep the full scope and move the pilot date if
necessary. This date is a target, not a delivery commitment.

Required languages: **English, Russian, French and Armenian** (`en/ru/fr/hy`).
Guest flows, messages, exports and the host/organizer interface use all four.
Use the existing 400-guest pilot envelope, including invitation-based and free
ticketed fixtures. Paid plans remain inactive; `PILOT_MODE=true` continues to
prevent live charge initiation.

| Decision | Confirmed behavior |
|---|---|
| Attendance policy | Host chooses event-wide or per-venue attendance for each event |
| Attendance mode changes | Allowed after responses through explicit reconfirmation; preserve earlier answers without guessing new ones |
| Interface languages | Guest and host/organizer interfaces in English, Russian, French and Armenian |
| Directory operators | One venue vendor may operate several directory venues |
| Per-venue invitations | Everyone is invited to every guest-facing venue; internal/preparation venues stay hidden |
| PDFs | All seven existing export kinds, including seating charts and place cards |
| Export freshness | Fixed snapshots; host regenerates when needed |
| Place-card paper | Flat cut cards on A4; six 90 × 70 mm cards per sheet |
| Gallery | Invited guests only; host approval before other guests see a photo |
| Ticket attendee identity | Buyer supplies every attendee's name/details and own venue choices at checkout |
| Guest acknowledgements | Both drawn and typed options; a representative may acknowledge for household members |
| Free invitation expiry | Close guest access; retain host event data and media |
| Email feedback | Keep provider-neutral; native F22 is an explicit release exception |
| Scope versus date | Full scope takes priority; move the pilot date if needed |
| WhatsApp setup | No Meta Business account/test number exists yet |

The previous decision that household RSVPs operate **per person in one
submission** still applies. A representative answering a household is not one
attendance answer for everyone.

## 2. Starting point and verified groundwork

The branch is `codex/pilot-readiness`. Its readiness changes are local; production
has not been deployed and remote CI has not run.

| Already implemented | Evidence and remaining boundary |
|---|---|
| Free-pilot payment guards and guarded test database setup | Paid initiation refused; tests cannot truncate a production/development database |
| CI workflow, API image, production smoke/rehearsal scripts | Local clean migrations, repeatable production seed and HTTP journey passed |
| Caddy API/media routing and credential filtering | Local TLS and redaction passed for success and 502 error logs |
| Paired Postgres/Garage capture and restoration, encrypted Restic tooling | Fresh-store recovery preserved a guest credential and original/variant objects |
| Backup freshness/space checks and systemd templates | Failure cases passed; actual destination, timer installation and alert delivery remain |
| Persistent email quotas and signed normalized feedback | Concurrent allowances, replay/idempotence, early feedback, erasure and suppressions tested |
| Mongo/storage probes and sweep failure reporting | Real Mongo writes/indexes/erasure and Redis/Mongo interruption/recovery tested |

Verification on 13 October: `npm run verify` passed lint, docs, OpenAPI and build,
plus **1,006 unit, 304 integration and 540 HTTP tests**. Eight backup/coordinator
checks passed. The final tiny recovery drill took **20.15 seconds end to end**,
including disposable-container setup; that is not a production recovery estimate.

The 400-guest import and 200 personalized reads at 50-reader concurrency produced
no unexpected responses. Latest p95 was **276ms** (initial run 336ms) on a shared
16-CPU/31GiB development host while verification was running. The shared part of
the invitation is already cached; personalized guest/household data is not.
This is baseline evidence, not final capacity proof.

Current limitations that drive the new plan:

- The original one-seat/event layout has been replaced by separate venue
  arrangements, scoped assignment/release history and enforced venue capacity.
  Attendance supports both modes and reconfirmation. Automatic seating now
  queues a revision-guarded worker job; frontend polling and production acceptance remain.
- Legacy `/exports` CSV remains live; additive `/export-snapshots` jobs generate
  fixed private CSV/PDF/XLSX files for all seven kinds. Frontend adoption,
  standard heading translations and production acceptance remain.
- A separate private storage port now serves export artifacts. Signatures and
  guest-gallery originals still need to adopt protected storage.
- Named ticket checkout, legacy registration and explicit invited-guest linking
  now write the guest graph and share admission/cancellation tracking. Frontend
  attendee/reconciliation screens and language acceptance remain. Venue-profile
  directory operator write flows are still missing.
- The upload controller advertises `kind` but ignores it; uploaded images become
  PHOTO. Signature questions are refused, and one RSVP signature field cannot
  represent several separate acknowledgements.
- Host draft data exists; rendered template previews, question reordering and
  guest self-name editing do not.
- Plan lifetime is modelled (the free seed uses 90 days), but publishing does not
  set expiry. Cached metadata does not currently enforce that future boundary.
- WhatsApp transport accepts messages and saves its provider reference; delivery
  and read callbacks are not consumed.

## 3. Delivery order and dependencies

Work can be prepared independently within each milestone, but migrations,
contract cutovers and acceptance checks remain sequential.

| Milestone | Scope | Dependency | Frontend work |
|---|---|---|---|
| A | Contracts, four-language fixtures, account/setup checklist | Confirmed decisions above | Align settings, response examples and export cutover |
| B | F50 attendance modes, reconfirmation and seating arrangements | A | Mode selection/change preview, reconfirmation, per-venue RSVP and venue-labelled seating |
| C | F23 named ticket holders and unified guest/check-in data | B's guest/attendance model | Attendee forms at checkout and ticket/guest operations |
| D | Private storage, worker, all PDF/CSV/XLSX exports: F20, F49, export part of F27 | B/C data; A's export contract | Queue/status/poll/download/regenerate UI |
| E | Background automatic seating: remaining F27 | B plus the worker proven in D | Start/poll seating jobs; retain direct manual seating |
| F | F46, F29, F47, F48, F24, F28 guest/design features | A; B/C where they affect guest data | Name correction, question ordering, assets, previews |
| G | F25 acknowledgements and F19 moderated gallery | D's private storage; B/C identities | Typed/drawn capture, representative selection, gallery moderation |
| H | F30 expiry and F26 personalized caching | Earlier writes identified and versioned | Expiry display, expired guest state, fresh personalized views |
| I | F21 WhatsApp receipts | Account/app/number and public HTTPS test endpoint | Delivered/read/failed indicators |
| J | F45 complete production rehearsal and release gate | All required items and frontend integrated | Full host/guest walkthrough in four languages |
| Deferred | Native part of F22 | User later selects a provider | No native integration is required for this pilot |

Start Meta account preparation and infrastructure selection during A rather than
waiting for I/J. Account/service setup and production deployment are
operator-owned execution steps.

Milestone A also aligns pilot feature availability with the frontend: the
approved feature set and all four languages must be accessible in guest and
host/organizer interfaces while paid plans stay inactive and plan-limit
enforcement remains deferred. Define stable field/error codes and proposed
response examples for localized validation and recovery messages. Agree frontend
translation catalogs, locale persistence and fallback behavior; cover settings,
checkout, seating, jobs, moderation and errors as well as invitation content.
Translation review and complete host/guest walkthroughs in each language are
acceptance gates, not just the presence of a language selector.

### Planning estimate

These are provisional backend effort ranges for one engineer, including the
feature's focused tests and contract work; they are not promised dates.

| Milestone | Initial estimate |
|---|---|
| A | 1–2 engineering days |
| B | 7–11 |
| C | 3–5 |
| D | 6–10 |
| E | 3–5 |
| F | 5–8 |
| G | 5–8 |
| H | 3–5 |
| I | 2–4, excluding external setup/approvals |
| J | 3–5, excluding remediation from failed rehearsals |

Total: **38–63 engineering days before integration/remediation contingency**.
B now includes explicit attendance reconfirmation in both directions. Four-language
host interface implementation and translation review are additional frontend/team
work, as are provider/infrastructure lead times. Re-estimate
after the attendance migration and PDF/private-storage spikes; those settle the
largest technical uncertainties. No firm replacement pilot date should be set
before these checks and the frontend's estimate.

## 4. Milestone B — attendance and multi-venue seating (F50)

**First slice implemented, 13 October:** arrangement-scoped tables/seats and
release history, explicit selection for ambiguous unassignment/auto-seating,
venue capacity, protected published household assignments and venue-labelled
host/check-in/CSV reads. Migration preserves legacy IDs and unknown venue data.

**Verified 13 October:** full `npm run verify` passed lint, docs, generated
OpenAPI, build, **1,010 unit / 324 integration / 550 HTTP tests**. Focused
regressions cover populated historical migrations, cross-event/arrangement
constraints, capacity/chair races, scoped release/deletion history, simultaneous
bulk numbering, RSVP/seating lock ordering and all four translated guest venue
labels. An existing queued-email fixture now stops its background cron dispatcher
so its status assertion does not depend on the wall clock. New migrations were
applied to guarded disposable test stores; no production deployment occurred.

**Second slice implemented and verified, 13 October:** event-wide/per-venue
policy revisions, preview/confirmation with stale-state protection and idempotent
transitions, preserved attendance history, current household/plus-one venue
answers, scoped declines, reservation flags, venue totals and catering/bar scope.
Venue/timeline visibility edits preserve answered history and new venues start
pending. Guest/host writes and seating share policy locks; transitions and venue
edits serialize ahead of them. Confirmations use per-venue copy in four languages;
hosts may request reconfirmation through the existing separate notify-changes
outbox operation. Unknown imported answer times stay null.

**Second-slice verification:** full `npm run verify` passed zero-warning lint,
docs, generated OpenAPI (130 paths), build, **1,020 unit / 341 integration /
562 HTTP tests** (1,923 total). Regressions cover populated legacy backfills
including unknown response times, immutable historical identities, transitions
in both directions, stale previews/forms, retries, simultaneous venue answers,
policy/RSVP/venue-edit lock ordering, scoped seating and venue totals. HTTP
checks cover permission boundaries, invalid payload rollback and translated venue
labels in all four languages. Partial venue replies now count consistently in
response rate and daily response trend. New migrations were applied only to
guarded test stores; no development/production migration or deployment occurred.

**B remains open for frontend acceptance:** mode selection/preview, household
reconfirmation, reservation/history displays and four-language walkthroughs need
the frontend team. The F27 worker cutover and snapshots are now implemented in
the batches below. Personalized caching remains a later milestone.


**Model and migration**

- Add event attendance mode, defaulting legacy events to EVENT_WIDE. Proposed
  default for new events is also EVENT_WIDE; hosts may choose PER_VENUE.
- Add an attendance-policy revision and preserve previous responses with their
  policy revision. A mode transition creates a new active revision atomically;
  it does not overwrite the historical answers.
- Per-venue mode records each person's attendance separately for every
  guest-facing venue. Reuse the same visibility rule that hides preparation and
  internal-only venues; do not create a new, conflicting guest-facing definition.
- Add a seating arrangement identity per event venue and an explicit legacy
  unspecified arrangement. Backfill existing tables and assignments without
  inventing venue membership.
- Enforce one seat per guest **per arrangement**, unique chair position and
  agreement between seat/table/arrangement/event. Permit “Table 1” at both venues.
- Replace the single guest release marker with arrangement-scoped release
  records. Preserve ambiguous old history instead of assigning a guessed venue.
- Keep event-wide RSVP/seat behavior intact for existing events and clients.
  Do not seed per-venue answers from a person's old event-wide response.

**Behavior and contract**

- Hosts may change mode after responses through an explicit preview/confirmation
  flow. Show affected guests, responses and seating before committing a new
  policy revision. Retry the same transition idempotently and reject competing
  transitions based on a stale revision.
- For both EVENT_WIDE → PER_VENUE and PER_VENUE → EVENT_WIDE, keep prior answers
  available as history and mark current attendance as needing reconfirmation.
  Do not copy an event-wide answer to every venue or infer an event-wide answer
  from mixed venue responses. Retain unrelated dietary/custom answers and
  acknowledgements; changing attendance policy does not re-sign a statement.
- Keep personal links valid. Guest/household forms display the changed policy
  and collect each person's fresh attendance. Submissions carry the policy
  revision; a stale form must reload rather than writing into the new policy.
  Define a safe rejection for legacy clients lacking that revision after a
  transition, and document the frontend cutover.
- Proposed seating default during reconfirmation: preserve existing assignments
  as visible, flagged reservations and count them toward physical capacity;
  exclude unconfirmed people from confirmed attendance/catering totals and
  automatic seating candidates. A fresh decline releases seats under the new
  policy. Hosts can explicitly unseat reservations. Existing check-in history
  remains factual history; a mode change cannot undo an admission.
- Offer the host a reconfirmation notification through the existing outbox,
  consistent with D3. Commit the transition before queuing messages; notification
  failure/retry cannot lose responses or repeat the transition. The guest page
  shows the request even when the host does not send a notification.
- Bind seating jobs and their apply step to the policy revision; reject results
  planned under an old policy. Invalidate personalized caches on transition.
  Existing export snapshots retain their recorded policy revision; hosts
  regenerate to obtain current reconfirmation/attendance state.
- A household submission still contains each member's own answers. In PER_VENUE
  mode it contains attendance for each eligible venue; a decline releases only
  that arrangement's seats. In EVENT_WIDE mode a decline releases every seat.
- Automatic seating and bulk unassignment require a chosen arrangement when
  more than one exists. Moving within one cannot erase another venue's seat.
- Adding a venue creates new pending venue attendance where applicable.
  Removing/hiding a venue after responses/seating must preserve history and use
  a guarded operation; nullable cascades must not merge seating plans.
- Keep publishing event-wide initially. Add venue-labelled seating arrays;
  define the legacy single seating field as null when no unambiguous value
  exists. Publish frontend examples before the server/client cutover.
- Event-wide attendance counts unique people attending any eligible venue.
  Venue counts include only that venue's attendees. Define PENDING/UNDECIDED/
  DECLINED summaries without treating unanswered venues as automatic declines.
- Catering/bar can be scoped to venue attendance; existing personal dietary/
  drink answers remain personal answers, not separate menus for each venue.
- Event-wide check-in remains a unique person count. Display multiple seating
  assignments there; separate check-in at each venue is not part of F50.

**Acceptance**

Populated legacy fixtures migrate without assignment loss. A person can hold a
seat at both venues, once in each. Manual/automatic races preserve table and
venue capacity. Both RSVP modes, partial venue answers, declines, plus-ones,
hidden venues, archive/delete and published household privacy pass real-DB and
HTTP checks. Moving/unseating at one venue leaves the other untouched.
Mode changes in both directions preserve prior answers, seats and unrelated
answers, require fresh attendance and reject stale forms/jobs. Cover concurrent
RSVP/manual seating/transition requests, repeated transition requests and
notification retries. Verify the preview, history and reconfirmation journey in
all four interface languages.

**Areas:** Prisma, seating, RSVP, invitations, guests, operations and vendor
briefs; [VENUES_AND_SEATING.md](VENUES_AND_SEATING.md) and [API.md](API.md).

## 5. Milestone C — named ticket holders in the guest graph (F23)

Backend implementation now covers the roster, atomic issuance, deliberate
legacy reconciliation, shared admission, cancellation and attendee privacy.
Frontend integration and the final four-language/production acceptance remain.
This batch changes checkout: `attendees` is now required (see API contract).

Local verification on 15 October passed the full pipeline and final focused
regressions, including 1,030 unit tests, 364 integration tests and 569 HTTP
tests across those runs. The populated migration preserves legacy ticket
links and admission timestamps without inferring attendee identities.

- Checkout supplies exactly one bounded attendee record per requested ticket.
  Capture names and useful existing guest fields; do not assume buyer = attendee
  or duplicate the buyer's name for every ticket.
- Save pending attendee data with the reserved order, inside its transaction.
  Validate the complete payload before reserving inventory. Idempotent retries
  cannot overwrite a different attendee roster.
- Issue/link guests and tickets exactly once when the order settles, including
  free checkout. Failed/expired orders must not create attending guest rows.
- Do not merge people automatically by shared email, name or order. Group them
  into households only from explicit grouping information; a purchase alone
  does not prove household membership. Hosts retain their existing edit/merge
  tools and can explicitly link an existing invited guest.
- Unify linked ticket/guest admission atomically: either check-in surface must
  respect ticket validity and produce one admitted person. Cancellation/refund
  updates participation/seating without erasing an already-used ticket's history.
- Ensure dashboards, catering, seating and exports include eligible ticket
  holders once; unlinked legacy ticket holders need a deliberate backfill/link
  path, not guessed identities.
- Privacy exports/erasure include the new attendee records and linked guest
  data according to the actual subject; the buyer is not every attendee.

**Acceptance:** multi-person/mixed-type checkout, invalid roster rollback,
duplicate settlement, explicit existing-guest links, refunded/void tickets,
simultaneous ticket/guest scans, both attendance modes and person-count
deduplication. Real bank certification remains outside the free pilot.

**Areas:** ticketing/fulfilment/cancellation, guest management, check-in,
operations, communications and privacy.

## 6. Milestones D/E — private files, exports and seating jobs

### Shared foundation

Use a dedicated worker process and durable Postgres work records. Start with
export jobs; add seating jobs after the worker is proven. Reuse the established
claim/lease pattern when it has two real consumers rather than first creating
an unrestricted general job framework.

- Claims, leases, attempts, bounded retries, recovery after termination, guarded
  completion and durable error/status metadata.
- CPU work outside the API. Rendering/planning follows a short consistent data
  read; it must not hold DB locks while doing CPU work or uploading a file.
- Worker concurrency/memory limits, graceful shutdown and observable failed/
  stopped work. Restore a crashed job without publishing competing results.
- Separate private storage keys/bucket or equivalent filesystem root from the
  public invitation-media path. Store an internal file reference, never a
  permanent public URL for private artifacts.
- Tenant/event scoping and current caller authorization on every download.
  Erasure, event deletion, failed attempts and expired artifacts need bounded
  cleanup that includes originals and variants.

### CSV foundation delivered (15 October 2026)

Dedicated export worker, durable leases/retries, private storage, consistent
CSV capture for all seven kinds, fixed authenticated downloads, expiry and
revocation/cleanup are implemented on additive `/export-snapshots` routes.
Legacy `/exports` remains live during the frontend transition; old rows are
not snapshots. See [API.md](API.md) and
[worker operations](../backend/docs/EXPORT_WORKER.md). The frontend still needs
to adopt queue/status/regeneration behavior. Standard CSV headings remain
English pending F35. Production worker/bucket recovery is still a rehearsal
gate. The PDF/XLSX and background-seating batches below complete F27's backend
worker implementation; frontend adoption and production acceptance remain open.

Verification: `npm run verify` passed lint, docs, OpenAPI, build, **1,049 unit,
384 integration and 577 HTTP tests**. Snapshot coverage includes real worker
termination/replacement and graceful shutdown, stale-owner rejection, erasure
fencing, permission loss during download, expiry and cleanup retry. Production
bucket policy and expanded-stack rehearsal remain unverified launch gates.

### PDF/XLSX backend delivered (16 October 2026)

All **21 kind/format combinations** now produce private fixed snapshots, with
format-aware idempotency, MIME types and filenames. Legacy live CSV routes stay
available during frontend migration. PDF uses bundled licensed DejaVu fonts,
repeated table headers/identity columns and venue/table roster sections. Place
cards use the confirmed flat A4 layout: six 90 × 70 mm cards with cut guides.
XLSX preserves literal text, leading-zero codes, typed counts/UTC dates and
separate catering requirements/notes tabs. New catering/bar snapshots aggregate
attendance by guest-facing venue in both attendance modes.

The bounded library/font spike selected PDFKit and write-excel-file. The
400-person fixture produced 84 files across four locales; all 28 PDFs and 28
workbooks passed structural/content checks, including long names, combining
accents and formula-like text. PDF raster pages and workbook previews were
visually inspected. See [renderer acceptance](../backend/docs/EXPORT_RENDERERS.md)
for versions, limits, measurements and repeatable commands.

**F20/F49 backend work is implemented; their release gates remain open** for
frontend adoption, translated standard headings (F35), native spreadsheet and
physical printing acceptance, and production worker/private-store rehearsal.
The background seating batch below completes F27's worker implementation. No production deployment or
frontend implementation is included in this backend batch.

Verification: `npm run verify` passed lint, docs, OpenAPI, build, **1,062 unit,
400 integration and 578 HTTP tests (2,040 total)**. The 84 synthetic files
passed the renderer rehearsal and PDF/XLSX acceptance recorded above.

### All exports (F20, F49, export part of F27)

Implement the complete **7 kinds × 3 formats** matrix:

| Kind | PDF | CSV | XLSX |
|---|---|---|---|
| Guest list | Paginated readable list | Snapshot rows | Typed worksheet |
| Seating chart | Venue/zone/table sections, capacities and optional layout pages | Arrangement-labelled seats | Venue-labelled sheets/rows |
| Place cards | Print layout with names/table/venue | Person/seat rows | Person/seat worksheet |
| Catering sheet | Venue counts and guest dietary details | Operational rows | Counts and details sheets |
| Bar sheet | Venue/person-based quantities | Operational rows | Quantities worksheet |
| Playlist | Readable song-request list | Song rows | Song worksheet |
| Ticket manifest | Legible door codes/holder details | Manifest rows | Manifest worksheet |

- All three formats queue and produce **fixed snapshots**. Capture consistent
  inputs at generation start; record generation time, event timezone, locale
  and applicable arrangement/data revision.
- This deliberately changes CSV's live-download behavior. Coordinate the
  QUEUED/RUNNING/COMPLETED/FAILED states, regeneration action and download-ready
  behavior with the frontend. Do not silently change the old route.
- Preserve existing export audit records. Old records without artifacts are
  legacy references, not historical snapshots; identify them as needing
  regeneration instead of fabricating their past contents.
- Contact-bearing and redacted artifacts must be distinguishable. A later
  permission reduction can never expose a full artifact to a viewer. Generate
  a safe variant where appropriate; otherwise require regeneration or refuse
  the download. Ticket manifests always require contact permission.
- Embed licensed fonts/fallbacks covering Armenian, Cyrillic, French accents
  and Latin. Verify long names, combining characters, table pagination and
  printable place-card boundaries.
- XLSX must use literal/typed cells for untrusted text, avoiding formulas or
  external links. Preserve existing CSV formula protection and UTF-8 behavior.
- Decide the rendering/workbook libraries through a bounded maintenance,
  license, memory and four-language compatibility spike before adding them.
- Proposed generated-file lifetime: seven days, then regeneration. This is
  separate from retaining the host's source event data; it is a configurable
  engineering default to review with the frontend.

**Acceptance:** all 21 combinations; viewer/contact permissions and later role
changes; expired/cross-event downloads; worker termination during read/render/
upload/finalize; storage outages; erasure while a job runs; no orphan/public
files. Visually inspect exported PDFs and open generated XLSX files with the
four-language 400-person fixture.

### Background seating backend delivered (18 October 2026)

F27's remaining backend work is implemented. The confirmed frontend cutover
changes `POST /seats/auto-assign` to a UUID-idempotent queued response. New
history/status reads expose revisions, attempts and the committed result.
Manual seating remains immediate. A dedicated process owns Postgres claims,
90-second leases, bounded retries and graceful shutdown. Capture and computation
are separated from an atomic revalidation/application transaction.

Arrangement revisions cover all relevant writes through database triggers,
including cancellation SQL, erasure and change/undo cycles. Changed inputs retry;
permission loss/archive fail safely. Seat insertion and job completion share one
transaction, so an old lease owner cannot leave seats behind. The 400-person,
two-venue fixtures cover both attendance modes, including 400/200 eligibility,
with no split households or overfull tables. Real process termination/replacement
and graceful shutdown are exercised. See [API.md](API.md) and the
[worker runbook](../backend/docs/SEATING_WORKER.md).

F27 remains a release gate for queued frontend adoption and actual production
worker/recovery acceptance. Reasons need F35 translation, and the final mixed
write/load rehearsal remains milestone J. This batch does not deploy production.

Verification on 18 October: `npm run verify` passed lint, docs, OpenAPI, build,
**1,070 unit + 424 integration + 583 HTTP tests (2,077 total)**. All eight
backup checks passed with both named workers included in capture/resume. Compose
configuration validates with the separate seating worker.

### Background seating acceptance requirements (F27)

- Add start/status/result operations scoped to one arrangement. Keep manual
  assignments direct and atomic; coordinate retiring the synchronous planner
  with the frontend.
- Prevent duplicate active jobs per arrangement. Snapshot relevant revision/
  candidates, plan off the API, then lock and revalidate eligibility, capacity
  and revision before the atomic commit.
- Preserve existing assignments and household cohesion. A late RSVP, table edit,
  manual seat move, archive or permission change must not be overwritten by a
  stale plan. Retry/replan bounded conflicts; expose a useful failure otherwise.
- Carry arrangement-level revision changes through every seating/eligibility
  write, including ticket cancellation and RSVP declines.

**Acceptance:** concurrent manual edits, both attendance modes, repeated start,
worker termination and lease recovery leave valid seats and bounded API latency.
**F27 is done only when automatic seating and all export formats run in workers.**

## 7. Milestone F — guest corrections and design features

| ID | Implementation | Acceptance |
|---|---|---|
| F46 | Personal-link name correction with bounded first/last names; change that guest's identity fields without rotating links, moving households or changing RSVP | Host/guest views, seating and new exports show the correction; other guests cannot be edited through this surface; current snapshots remain labelled snapshots |
| F29 | One atomic custom-question order update using stable question IDs; validate the complete order and concurrent edits | Answered questions can move without changing answer ownership, option positions or required flags; rejected orders change nothing |
| F47 | Expose/validate the directory venue's operator link under staff directory permissions | Shared profiles cannot expose an organization's private vendor; inactive/wrong-category links are handled; event venue copies retain their established data |
| F48 | Honor an allowlisted upload kind for LOGO/COVER/PHOTO/AUDIO; validate type/kind and attachment compatibility | Corporate logo uploads render through the correct block and appear in host media; DOCUMENT/SIGNATURE cannot enter through ordinary public-media upload |
| F24 | Same-event listing hero selection, variants and privacy-aware preview metadata; bulk hydration in listing reads | Public listing cards and actual frontend HTML link previews use the chosen image; invalid/removed assets and private events do not leak guest information |
| F28 | Synthetic catalog previews and authorized event-specific template previews using the real renderer/theme/locale rules | Previewing never changes the selected template, blocks or theme, never publishes a draft or collects an RSVP; all four languages render |

For F47 the schema currently imposes one vendor per profile and one profile per
vendor. Confirmed directory behavior permits one curated VENUE vendor to operate
several profiles, with one operator per profile. Remove the vendor-link uniqueness
restriction and expose the vendor's profile collection; preserve existing profile
IDs and links in a populated-database migration. Validate each link independently
and test assigning, reassigning and removing one profile without affecting the
vendor's other venues. Organization-private vendors must remain outside shared
directory responses.

F28 uses the frontend invitation renderer rather than a second backend HTML
renderer. Server preview payloads must exclude guest contacts, credentials and
private acknowledgements even when a designer can preview an event.

## 8. Milestone G — acknowledgements and gallery

### Typed/drawn acknowledgements (F25)

- Support both methods per signature question. A typed name is data, not a fake
  generated handwriting image. Drawn images use a bounded raster upload into
  private storage, never the public logo/photo route.
- Bind each record to its question, immutable statement/version and rendered
  locale, subject guest, signer identity/declaration, method and server time.
  More than one signature question must not overwrite one RSVP-wide asset.
- Permit a representative to acknowledge for explicitly selected members of
  their own household. Record the signer separately from each subject; never
  label every subject as the person who drew/typed the acknowledgement.
- Enforce same-event/household membership, ownership of staged assets and
  required-question rules, including attending plus-ones. A ticket order by
  itself does not authorize household representation.
- Show statements and represented people clearly in the UI. Future wording
  changes create a new statement version; prior records keep what was shown.
- Restrict staff reads to suitable guest-data permissions; designers do not
  gain access. Include records/files in subject export, erasure and event
  deletion; clean abandoned staged uploads.

**Acceptance:** drawn/typed/representative flows, multiple questions, forged
asset/member IDs, cross-household submissions, incomplete required answers,
statement edits, privacy fulfillment and old snapshot invalidation where needed.
Captured records distinguish the actual signer, represented guests and the
statement version shown at the time.

### Moderated guest photo gallery (F19)

- Authenticate access through an invited guest's capability. Reuse event
  availability/expiry checks; no public gallery sharing link.
- Store uploads with subject/uploader attribution, bounded size/count, processing
  state and moderation state (pending/approved/rejected/removed).
- Guest uploads enter private staging. Process image variants and strip image
  metadata before publication to the authorized gallery.
- Only hosts with the defined management permission approve/reject. Guests see
  approved photos; uploaders can see their own pending/rejected status.
- Private authorized media reads and bounded pagination must not reveal other
  guests' contacts or unrestricted originals. Retain host data after public
  access expiry.
- Cover deletion/erasure of uploader attribution, removed files, variants and
  pending uploads. Define quotas and operational review tools before enabling
  uploads on the pilot.

**Acceptance:** unauthorized/expired access, malicious MIME/kind attempts,
bounded uploads, processing/moderation races, pagination, removal/erasure and
four-language upload/moderation screens. No photo is visible to other guests
before approval.

## 9. Milestone H — lifetime and personalized cache

### Invitation lifetime (F30)

- Record the applicable lifetime policy at first publication. Preserve the
  existing free-plan 90-day setting and paid indefinite setting without
  activating paid billing or unrelated plan limits.
- Proposed anchor: `endsAt` when present, otherwise `startsAt`. Event date
  corrections recompute expiry from the captured policy; closing/reopening does
  not reset the clock. Plan changes must not silently shorten an already
  published invitation's entitlement.
- Enforce expiry on every guest read/write and dependent gallery/acknowledgement
  access, even when a cached page exists. Keep the host's event, RSVP, seating
  and media data; expiry does not mean deletion or irreversible archive.
- Add host-visible expiry metadata and a bounded, monitored sweep for invalidation
  and expiry state. Preserve legacy published events until their policy can be
  backfilled from reliable data; report ambiguous cases.

**Acceptance:** free/indefinite rules, boundary time, event date edits, reopening,
legacy backfill, gallery/RSVP denial at expiry and continued authorized host
access. No data/media purge is introduced by this feature.

### Personalized caching (F26)

- Keep the existing shared page cache. Cache the remaining guest/household/
  attendance/seating projection with bounded TTL and opaque keys.
- Verify capability, current event availability/expiry and authoritative
  revisions before using cached personal data. Revoked or erased guests must
  never be served from an old cached identity.
- Cache keys must not contain raw capability tokens. Avoid persisting generated
  token-bearing links in the cached projection.
- Centralize/version invalidation for guest/household edits, RSVP, tickets,
  seating, publishing, design/venue changes, gallery access and erasure.
  Prevent a stale in-flight read from repopulating an older version.
- Redis failure falls back to Postgres; recovery after a missed invalidation
  cannot restore a revoked person's cached access.

**Acceptance:** every relevant write followed by a read, races during cache
population, cross-person isolation, erasure/revocation, expiry and Redis outage/
recovery. Repeat the 50-reader measurement after these changes and report warm,
cold and degraded results separately.

## 10. Milestone I — WhatsApp receipts (F21)

- Operator establishes the Meta account/app/test number and later production
  number/access. The account does not exist yet; record its readiness as a
  launch dependency.
- Confirm current supported Graph API version, account permissions, webhook
  verification/signature protocol and template requirements from Meta's current
  documentation during setup. Do not assume the transport's existing default
  API version remains suitable.
- Add authenticated provider webhook ingestion with bounded batches and raw-byte
  signature verification; acknowledge after durable receipt acceptance.
- Match by account/channel/provider reference to the internal message. Handle
  receipt-before-send-acknowledgement, duplicates, retries and delayed statuses.
- Delivered/read timestamps must not be downgraded by older sent events. Define
  failed-event classification without treating account/configuration errors or
  ambiguous delivery failures as recipient unsubscribes.
- Retain normalized outcome metadata, not full provider payloads with contacts
  or message text. Expose useful delivered/read/failed status in existing views.
- Use controlled recipients for the provider round trip. Test webhook subscription
  and a real accepted message/receipt; mocked payloads alone do not close F21.

**Acceptance:** forged/duplicate/out-of-order/early callbacks, unknown references,
erasure, temporary/configuration failures and controlled real delivery.
The setup/review timeline is external and cannot be guaranteed by coding.

F22 remains provider-neutral: maintain its implemented quota, normalized signed
feedback and suppression tests. Native email selection/correlation/webhook
adapter and provider delivery-event proof are deferred explicitly by the user.
Actual pilot email sending/domain configuration still needs verification.

## 11. Milestone J — final production rehearsal (F45)

Build one realistic synthetic fixture using all required surfaces:

- 400 named people, mixed households, multilingual names and late/declined RSVPs.
- Two separately seated venues; exercise EVENT_WIDE and PER_VENUE mode fixtures
  and explicit reconfirmation transitions in both directions.
- Free ticket checkout with multi-attendee buyer data, unified admission and
  counts that never double-count linked guests.
- Four-language invitation, guest corrections, reordered questions, typed/drawn/
  representative acknowledgements, logo/listing media and template previews.
- Moderated gallery uploads, private media access, expiry and subject erasure.
- All 21 export combinations and seating jobs; worker kill/restart and concurrent
  manual edits/RSVPs. Visually inspect PDFs and open XLSX outputs.
- Import/send/reminders/check-in/thank-you journey, controlled real email and
  WhatsApp receipts. Native email feedback remains the documented exception.
- The separate existing 2,000-row import scenario.

Measure 50 readers and 10 writers in a declared, reproducible workload:
p50/p95/p99, unexpected HTTP errors, pool waits, event-loop delay, memory,
outbox/job completion and queue lag. Initial p95 budgets follow PRODUCT_SPEC:
invitation <50ms warm/<200ms cold, RSVP <300ms, dashboard <500ms and block
arrangement <300ms. Report personalized and degraded paths separately; missed
budgets need remediation and an affected-scenario rerun.

Exercise Postgres, Redis, Mongo, media, mail and worker interruptions, restart
and redeploy. Verify correct recovery, accepted outage behavior and no loss of
committed domain data. Sending can be at-least-once; record duplicate-delivery
risk rather than promising exactly-once external effects.

Final external evidence must include:

- Real host/API/media TLS and a repeatable release/migration/seed/smoke run.
- Configured off-host recovery set downloaded/restored into fresh stores;
  measure actual restoration and capture interruption on realistic data.
- Operator-approved data-loss window, backup cadence and maintenance window.
- Alerts reaching an operator for storage/outbox/job failures, stopped sweeps,
  missed backups, disk pressure and external uptime.
- Frontend host/organizer and mobile-door walkthroughs, guest journeys, messages
  and exports in all four required languages, including localized validation,
  reconfirmation, job failure/retry and moderation screens.
- All 17 required items accepted; F22's native exception recorded.

## 12. Execution rules and review checkpoints

For each slice: failing tests first, smallest passing implementation, safe
populated-database migration, corresponding API/docs/OpenAPI update and
`cd backend && npm run verify`. CPU work and unbounded I/O do not enter request
paths. Use guarded test databases and disposable storage; never reset a real
database or use it as a migration shadow.

Keep implementation changes in reviewable feature slices. Publish proposed
contract examples before frontend work depends on them. Snapshot CSV semantics
and synchronous-to-job seating are deliberate contract cutovers and need explicit
release notes.

At the end of B, D and G, review migration evidence, privacy/permission behavior
and frontend usability before proceeding with dependent work. After H, remeasure
latency. After I, record real provider proof. After J, make the go/no-go decision
from evidence, not backlog checkbox counts.

Direction to request when implementation reaches an unresolved boundary:

- Replacing a signature statement or granting representative access beyond the
  household. Attendance-mode changes and multiple venues per vendor are approved.
- Gallery quotas, generated-file lifetime or seating reservation handling during
  reconfirmation if the proposed defaults do not fit the host workflow.
- Renderer layout choices that materially change the print workflow.
- Provider/account selection, translation review, real deployment credentials
  and acceptable recovery/data-loss window. Credentials stay outside chat/Git.

Routine engineering choices and reversible fixes can proceed within the agreed
scope. Product changes, broader access, new retention/deletion rules, paid service
setup and externally visible deployment need the appropriate user direction.

## 13. External inputs and scope boundaries

Still needed for execution, not for the completeness of this plan:

| Input | Owner / when needed |
|---|---|
| Frontend contract readiness and delivery estimate | Frontend team; A and before each cutover |
| Four-language guest/host copy and translation reviewer | User/team; before language acceptance |
| Meta app/business/test number and controlled recipient | User/operator; start during A, gate I |
| Email sender/domain credentials and DNS | User/operator; before real send rehearsal |
| Production host/API/media domains | User/operator; before external rehearsal |
| Off-host destination and alert receiver/on-call owner | User/operator; before holding real guest data |
| Acceptable recovery/data-loss window and maintenance time | User/operator; before J acceptance |
| Revised pilot date | User; after B/D estimates and external/frontend readiness |

Outside this 18-item plan: paid event packages/add-ons, deposits, automatic
renewals/dunning, tax, referral payouts, corporate contracts, availability/
logistics/staff services, full HA and unrelated long-range gaps. Their separate
backlog entries stay open. Plan-limit enforcement remains deferred by its
existing decision. F49 uses the implemented XLSX snapshot support; the enum
remains intact.

## 14. Feature coverage checklist

| ID | Milestone | Required before pilot |
|---|---|---|
| F19 | G — moderated invited-guest gallery | Yes |
| F20 | D — PDFs for all seven kinds | Yes |
| F21 | I — verified WhatsApp receipts | Yes |
| F22 | Existing neutral groundwork; native integration deferred | Explicit native exception |
| F23 | C — attendees at checkout and guest/check-in integration | Yes |
| F24 | F — listing hero/share previews | Yes |
| F25 | G — typed/drawn representative acknowledgements | Yes |
| F26 | H — personalized caching | Yes |
| F27 | D/E — all exports and automatic seating in workers | Yes |
| F28 | F — template previews | Yes |
| F29 | F — custom question ordering | Yes |
| F30 | H — access expiry with host data retained | Yes |
| F46 | F — guest self-name correction | Yes |
| F47 | F — directory venue/vendor links | Yes |
| F48 | F — corporate logo uploads | Yes |
| F49 | D — XLSX support | Yes |
| F50 | B — attendance modes and arrangement-scoped seating | Yes |
| F45 | J — final load/outage/production/frontend rehearsal | Yes |

## References

- [Backlog](BACKLOG.md), [launch requirements](GOING_LIVE.md),
  [API contract](API.md), [product specification](PRODUCT_SPEC.md).
- [Backend engineering rules](../backend/CLAUDE.md) and
  [feature workflow](../.claude/skills/feature/SKILL.md).
- [Storage](../backend/docs/STORAGE.md), [deployment and recovery](../backend/docs/DEPLOYMENT.md),
  [data stores](../backend/docs/DATA_STORES.md).
- [Meta-owned WhatsApp Cloud API collection](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api):
  use with current Meta setup/webhook documentation during the provider spike.
  Direct Meta documentation returned rate-limit errors during planning; exact
  version/authentication details remain a verification task, not an assumption.
