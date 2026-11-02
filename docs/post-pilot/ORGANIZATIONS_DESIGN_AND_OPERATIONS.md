# Organizations, corporate contracts, template authoring and operations

> **Delivery update — 30 October 2026:** this is the historical broad design.
> F38/F39/F44 backend slices are now implemented; other commercial/resource/
> logistics slices remain planned. See [current implementation status](execution/IMPLEMENTATION_STATUS.md).
> Proposed or “unimplemented” route/runtime examples below are superseded where
> delivered by [API.md](../API.md), generated [OpenAPI](../../backend/openapi.json)
> and governing domain docs. This design does not establish deployment acceptance.


**Decision precedence:** confirmed choices and explicitly delegated defaults in [DECISIONS.md](DECISIONS.md) supersede unresolved alternatives in this proposal. All other options remain proposals until answered.

Production implementation proposal for F38, F37, F44, F41 and F42. Prepared 25 October 2026 against `eb1b6e2` and the dependency refinement in the parent delivery plan. **Planning only; none of the models, operations or routes proposed below is implemented by this document.** Names and state machines are engineering proposals, not approved product policy. No code, database, branch, deployment or provider action was performed for this plan.

Read alongside [delivery plan](../POST_PILOT_IMPLEMENTATION_PLAN.md), [product](../PRODUCT_SPEC.md), [access](../ACCESS_CONTROL.md), [design](../INVITATION_DESIGN.md), [venues](../VENUES_AND_SEATING.md), [API](../API.md), [TODO](../TODO.md) and [backlog](../BACKLOG.md). The local feature workflow and backend engineering rules govern implementation. All money remains integer minor-unit strings; timestamps UTC with explicit IANA timezone where local scheduling matters. `en/ru/fr/hy`, free-pilot payment guards, existing attendance/reconfirmation, snapshot exports, privacy and captured invitation lifetime remain unchanged. Native F22 and entitlement enforcement stay deferred.

## 1. Existing code to extend, and hazards to address

| Area | Existing foundation and specific gap |
|---|---|
| Tenancy | `backend/prisma/schema.prisma`: `OrganizationMembership.userId` is unique in addition to `(userId, organizationId)`. `AuthGuard.organizationRoleOf` in `backend/src/infra/auth/auth.guard.ts` chooses `findFirst({userId})`. `rolesOn` already looks up membership for the event's owning organization and is the safer reference. |
| Onboarding/invites | `OrganizationsService.create` refuses a second membership. `AccountService.acceptInvite` calls `assertNoOtherOrganization`; acceptance claims the invite and writes membership transactionally. `ConciergeService.openForCustomer` chooses the first organization found by customer email. F38 cannot simply remove one index. |
| Event access/creation | `EventsService.findAll` uses selected organization standing plus direct event memberships; `creatorRole` currently reads any membership by user ID, which would wrongly grant OWNER in one tenant based on ownership of another. Every call must supply the event's actual organization. |
| Corporate/branding | `Organization.kind = CORPORATE`, event-owned LOGO uploads, organization subscriptions and invoices exist. No contract lifecycle or contract-to-event allocation exists. `MediaAsset` is event-owned and public; it is not a corporate brand asset store or private contract attachment store. |
| Templates | `DesignTemplate` has one mutable row per unique key; `Invitation.templateId` directly references it. `DesignService.chooseTemplate`, `validateTheme`, `assertBlockEdit`, `canRender` and `variantProblem` enforce current data constraints. `TemplatePreviewsService` and `buildInvitationContent` provide live-compatible synthetic/event previews. Existing published invitations would observe an in-place template mutation. |
| Seeds/rendering | `backend/src/seed-production.ts` leaves existing template fields intact; development `backend/prisma/seed.ts` refreshes classic template data. F44 must stop seed writes from mutating published versions. A new variant name in data is not evidence that the frontend implements a renderer for it. |
| Vendor/calendar | `Vendor`, `VenueProfile` and event `VendorBooking` exist. One curated VENUE vendor may operate several halls. `VendorsService` enforces curated/private visibility and `vendor:fee:read`. `VendorBooking` has no interval/resource allocation: `CONFIRMED` cannot be backfilled into a calendar by guessing event start/end. |
| Physical operations | Existing event venues, internal timeline and scoped `VendorBriefsService` are reusable. No deliveries, production orders or staff schedules exist. Staff assignment must not silently grant event/guest-data permissions. |
| Tickets/print | `TicketingService.admit` uses shared `lockAdmission`/`recordAdmission` in `backend/src/modules/guests/admission.ts`. Admission locks policy, order, guest and ticket and checks current acknowledgements/cancellation. `ExportSnapshotsService` already generates private worker artifacts; `ExportSheets.ticketManifest` includes door codes, holder names and buyer data. This manifest is sensitive and is not a minimal per-attendee ticket PDF. |
| Jobs/authorization | `ExportQueue` supplies claim/lease/fencing/recovery patterns; `ExportSnapshotsService.download` checks access before and after storage I/O. `requireSeatingAccess` in `backend/src/modules/seating/jobs/seating-access.ts` locks current user/membership standing before applying a job. Reuse these patterns without building an unrelated general workflow platform. |
| Notifications | `CommunicationsService.enqueue` uses its own Prisma service; it does not accept the caller's transaction. Its class comment describes atomic action/outbox behavior more strongly than the method API guarantees. New workflows must use a transactional business-notice intent plus deduplicated recovery, or explicitly add a transaction-aware enqueue contract first. |

Do not treat proposed new permission names or a selected organization ID as authorization. Membership and the resource's tenant are checked on each request and again for irreversible worker application/download.

## 2. Shared contracts to agree before parallel implementation

1. **Organization selection.** All streams use one resolver; no new controller independently chooses `findFirst`. Event-scoped routes derive the tenant from the event. A caller-supplied organization is a selector requiring membership validation, never an authority claim. Existing platform-only powers stay platform-only, and SUPPORT does not acquire billing access.
2. **Commerce/contract references.** Corporate and print workflows reference immutable accepted quote/order/contract revision IDs and a payer organization. They do not recalculate mutable catalogue prices or set payments CAPTURED themselves. Commerce owns fiscal documents/refunds; operations owns fulfilment transitions. A vendor-booking operational status is not paid booking confirmation.
3. **Template/render snapshot.** A stable template key plus immutable version identity, renderer capability version and public asset manifest identifies a reproducible design. Print approval names the exact rendered proof hash and commercial order revision. Guest PII is never incorporated into a reusable template asset.
4. **Calendar allocation.** Booking/operations identify resource IDs, UTC interval, original timezone/local input and reservation revision. They acquire resources in deterministic sorted order and use the same transactional conflict writer. Calendar access returns only permitted availability, not other tenants' event names or fees.
5. **Durable business notices.** Domain writes include a deduplicated `NoticeIntent` in their own transaction; a bounded reconciler invokes the current communications outbox and records delivery linkage. Alternatively implement a transaction-aware communications API first. Do not hold domain locks across SMTP/provider/storage calls or promise exactly-once external effects.

## 3. F38 — multiple organizations per account

### Confirmed scope and proposed selection contract

Confirmed: multiple memberships, explicit switching/invitations and tenant isolation are required. Existing single-org clients and event-only invitees must remain usable. **PP-D45 confirms the explicit per-tab selection UX and ambiguity handling. The concrete header/route contract below remains an engineering/frontend integration proposal:**

- New authenticated membership-list operation returns only the caller's organizations, roles and explicitly permitted summary fields. Proposed route: `GET /api/v1/me/organizations`.
- Use optional `X-Aveline-Organization-Id` on organization-scoped operations; validate bounded opaque ID and membership per request. No header with exactly one membership preserves today's behavior. No header with more than one returns `409 ORGANIZATION_SELECTION_REQUIRED` and no financial/domain write. No memberships retains existing denial on organization-scoped operations. This does not reveal other tenants to an arbitrary supplied ID.
- Event/invitation routes continue to derive organization from their resource, using membership for that tenant plus direct event membership. They do not borrow privileges from the selected header. Proposed frontend behavior omits this header on event-scoped calls; reject a supplied mismatching selector rather than silently treating it as a second authority. Confirm this mismatch behavior before shipping, particularly for event-only invitees.
- Keep the selected ID in client state per tab/request; no mutable server-wide user default is necessary for correctness. A remembered preference may be added later, revalidated each time; it must not affect other open tabs. Existing JWTs need not be reissued and should not embed tenant roles.
- Keep `GET /events` compatibility semantics explicit: selected organization events plus direct event memberships, or add an explicit new cross-org listing rather than silently changing the meaning. Frontend decides which view it wants. Staff selection is a separate privileged scoped path, not membership fabricated by SUPPORT.

### Models and invariants

Retain membership primary IDs and `(userId, organizationId)` uniqueness; remove `userId` uniqueness only after application cutover. Add a user lookup index before removal if the old unique index provided it. Organization identity remains stable for every existing event/invoice/message/vendor. Existing one-subscription-per-organization remains unchanged.

`OrganizationInvite` stays keyed by target organization/email and stores a hash, expiry, revocation and one-time acceptance. Existing-account acceptance still proves ownership with the account's password/current authenticated acceptance contract; receiving an invite does not join unrelated tenants. [PP-D44](DECISIONS.md) permits any signed-in customer to create an additional organization as its OWNER. Use an idempotency key scoped to actor plus request fingerprint; do not inherit privileges from another tenant. Remaining selection/leave policies are still pending. Proposed optional `OrganizationSelectionPreference(userId, organizationId)` is only a UI hint and must never be trusted by authorization.

Audit every single-membership assumption with a tracked inventory: guard, organization create/current/rename, account invite accept, concierge resolution, event list and `creatorRole`, billing, promos, vendor/private directory, suppressions, memberships, privacy account closure, staff tools, workers and exports. Change `creatorRole(tx, userId, organizationId)` to exact membership lookup before enabling a second membership. An organization-less event invitee still gets only that event's standing.

### Atomicity, rollout and recovery

- Membership changes, invite claim and new-account creation are transactional. Re-evaluate invite validity and intended role under the lock; stale acceptance must not overwrite a role changed since invitation without an agreed rule.
- PP-D46 permits member self-leaving and requires last-OWNER handover or ADMIN-reviewed closure. PP-D49 also revokes event roles within that organization on leave/removal, with required handover first. Preserve the existing last-event-owner invariant and do not leave an event-role access gap during revocation. Do not allow a new destructive owner-removal operation before that policy exists.
- Define one membership-write lock order across invite acceptance, create, remove and closure (e.g. user then affected organizations sorted, then membership/invite); audit against event jobs before adopting it. Role removal must conflict with worker authorization locks so an accepted mutation cannot commit after permission is revoked. Do not add a late user lock inside the established policy/order/guest/ticket admission lock chain.
- Deploy compatible readers/selector support while uniqueness remains, add indexes, then remove unique user constraint, then separately enable multiple-membership creation/acceptance. No backfill creates extra memberships or guesses a default. Concierge must explicitly select an existing customer organization when there is more than one; preserve D8 for the unambiguous existing-organization case.
- Rollback while only single memberships exist may restore the old constraint after proof. After multiple memberships exist, old code is unsafe: disable additional joins/creates and roll forward; never delete memberships merely to fit the old schema. Ensure all running API/worker versions understand scope before activation.

### Proposed API/acceptance slices

Add membership listing/selection first; retain existing organization-scoped paths with approved selector behavior. Later add explicit target-org member management and customer-org selection in concierge. Use existing response shapes plus additive organization IDs/context; do not silently turn a single-org response into an array. Add `ORGANIZATION_SELECTION_REQUIRED` localized recovery to the four-language error catalogue, and CORS header allowlisting where needed.

TDD: unit-test selection truth table, role union scoped to the correct tenant and error recovery; integration-test concurrent invite accepts/role removal and populated migration preserving IDs; HTTP-test selection omitted/single/multiple/foreign/revoked/closed, direct-event invitees, header/resource mismatch, invoices/promos/private-vendor/suppression isolation and creator-role cross-org escalation. Reuse `backend/test/e2e/billing.e2e-spec.ts`, `concierge.e2e-spec.ts` and existing authorization suites. Worker test removes membership after queueing and during storage I/O. Keep membership/event listing bounded and indexed; no organization-by-organization N+1.

First slice: approved selector contract + exhaustive resolver/HTTP regressions under the existing unique constraint. Second: inventory conversion and membership lifecycle. Third: safe constraint migration + controlled activation. Full F38 is not complete until old clients get the documented ambiguity response and every tenant boundary is tested.

## 4. F37 — branded corporate contracts

[PP-D47](DECISIONS.md) confirms one payer organization and only its own events in the initial contract. Cross-organization parties/allocations below are deferred expansion proposals; initial F37 does not require F38 completion. PP-D48 confirms ADMIN-issued versioned terms, named-approver authenticated acceptance and accepted amendments, with explicit billing/activation conditions.

### Aggregate and lifecycle proposal

Introduce a separate `CorporateContract` rather than overloading `Subscription`: owning organization, customer/seller reference, lifecycle revision, responsible operator and stable key. `CorporateContractVersion` captures exact approved wording/attachments, currency, agreed billing schedule/terms, branding configuration references and relevant offer/fiscal snapshot references. `ContractAcceptance` records who accepted which version, authority evidence and server clock; this is not automatically a legal electronic-signature service. Legal/signatory requirements and evidence/retention policy need user direction.

Proposed lifecycle is draft → offered → accepted → active → completed/terminated, with expiry/withdrawal where agreed. A later amendment is a new version with new acceptance; never patch accepted commercial terms. Separate factual acceptance, financial settlement and service eligibility so an accepted annual contract cannot be mistaken for paid service. PP-D48 requires billing schedules and activation conditions explicitly in each ADMIN-issued accepted contract. Renewal/termination follow those captured terms and an accepted amendment/new version where changed; no automatic renewal debit is inferred.

`ContractEventAllocation` associates an eligible event/organization with an accepted version, reference and allocation revision. Composite tenant relationships prevent linking another tenant's event. If one contract spans several organizations, model explicit contract parties/access grants; do not make organization memberships transitively inherit one another. Contract allowance counts may be recorded, but do not silently enforce plan entitlements while that policy remains deferred.

Create private `ContractDocument` attachment metadata, immutable content hash and storage ledger with malware/content validation chosen for the allowed input type. Do not use public `MediaAsset` for contracts. For reusable logos/brand tokens, use an organization-owned brand asset/version with explicit visibility/publication and authorized materialization into an event-owned public asset, or a deliberately scoped immutable public brand reference. Current event assets may not be attached cross-event as a shortcut. A brand update creates a new version; whether an event adopts it is explicit and preserves printed/published snapshots.

Indexes: `(organizationId, status, updatedAt, id)` for queue; unique `(contractId, version)`; unique acceptance intent/version identity as agreed; unique active allocation identity to prevent the same event consuming the same contract twice. Monetary totals are integer strings and handed to the commerce/tax contract; no independent financial calculator here.

### Authorization, transactions and APIs

Separate `contract:read`, `contract:write`, `contract:accept` and commercial-document read permissions as proposed names; approve role mappings before grant. Existing SUPPORT's operational access must not expose prices or billing. Organization OWNER authority to accept a particular legal contract is not inferred merely from existing billing permission. An event DESIGNER receives permitted brand tokens/assets for its event, not contract wording, contacts, other events or invoices.

Under contract/version lock, compare `expectedRevision`, validate signer/party standing, claim acceptance idempotency key/fingerprint and write acceptance/version state plus notice intent. Payment collection is started by commerce after the domain transaction, using durable order linkage; reconcile ambiguous results rather than charging on retry. Allocation locks contract first and eligible target IDs in deterministic order; cross-event operations must be checked against existing event locking before integration. Concurrent amendment, acceptance and allocation cannot use mixed terms. Artifact rendering runs in a worker and rechecks current permission/revocation on download.

Proposed unimplemented operations: draft/read/revise contract; offer/withdraw version; accept exact version; list/allocate events; request/download private contract artifact. Use explicit contract and organization IDs, expected revision, stable idempotency key for intent, bounded paginated lists and field-specific errors. No changes to existing subscription response shape are required.

Migration starts with new tables and nullable optional event/organization references only where needed. Historical subscriptions/events are not retroactively deemed corporate contracts or accepted. Rollback disables new contract actions while retaining accepted versions/documents and financial links; never cascade-delete financial or acceptance history.

### Slices, tests and gates

Build draft/version/permission engine in parallel with F38. Integrate multi-organization parties/allocations only after explicit scope selection is ready; integrate payable schedules after F35 and commerce contracts. Brand versions can progress independently of collection. Acceptance and service activation wait for the user's examples, signers, annual term/amendment/cancellation/renewal and billing decisions.

Unit: transition matrix, scope/party permissions, immutable version references, locale fallback. Integration: concurrent accept/amend/allocate, cross-tenant composite constraints, exact version/hash preservation, failed order-start recovery and idempotent notification intent. HTTP: role matrix, validation bounds, stale versions/intent conflicts and attachment access before/after permission loss. QA: all four scripts in private contract/proof outputs; no pricing reaches event designers. Operational acceptance includes recoverable document jobs, stuck offer/order linkage alerts and restore preserving version and content hashes. Human legal/accounting acceptance is a gate, not something backend tests prove.

## 5. F44 — controlled template authoring

[PP-D50](DECISIONS.md) confirms ADMIN-owned shared catalogue, organization-private custom templates, explicitly assigned SUPPORT draft authors, ADMIN-only publication and immutable published versions. Template/brand upgrades for existing events require explicit preview/confirmation; event DESIGNER grants do not imply authoring.

### Versioned catalogue design

Recommended proposal: keep `DesignTemplate` as stable catalogue identity/key and add immutable `DesignTemplateVersion` containing the current renderable fields (`allowedFonts`, palettes, supportedBlocks, blockVariants, defaultTheme), schema/renderer capability version, asset manifest/content hash and publication metadata. A template can have mutable drafts and a pointer to the active published version; each invitation pins a published version. Draft revisions use optimistic expected revision. Publishing creates/freezes a version; retiring prevents new selection but existing pinned invitations continue to render under the agreed retirement policy. Existing catalogue key remains stable in payloads and gains additive version identity.

No arbitrary JavaScript/HTML/CSS, executable SVG or unreviewed remote URLs are introduced. This authoring feature configures the existing renderer; novel block renderers require a separately reviewed frontend/backend deployment. Have the frontend declare a tested renderer capability manifest for allowed block variants/theme keys/fonts/assets, validate every publication against it and render four-language synthetic previews. Backend `block-rules.ts` checks only whether a variant is listed by the template; it currently cannot establish that the frontend actually supports that variant.

Reuse `validateTheme`, `assertBlockEdit`, `languageKeysProblem`, `TemplatePreviewsService` and `buildInvitationContent` through a version-shaped DTO/adapter. Do not duplicate their rules in a new authoring-only path. Bound arrays/JSON depth/text/assets; validate defaults are a subset of supported values; verify approved fonts support required scripts and are licensed/distributable through the chosen asset process. Font/language compatibility acceptance needs human/browser rendering; naming a family alone is not proof.

`TemplateAsset` belongs to the template/version owner, not an arbitrary event. Public decorative assets may be copied/materialized into version-owned public storage only after review; proof/upload staging remains private. Never take a customer's uploaded photo, signature or gallery image as a shared template asset. Use durable reference/cleanup ledgers and content hashes; deletion refuses referenced published assets or follows explicit retirement policy. Template permission grants are distinct from event `invitation:design`: a freelance event DESIGNER must not gain global catalogue publication. PP-D50 assigns shared catalogue/publication to ADMIN and permits explicitly assigned SUPPORT draft work; do not invent broader author/reviewer grants or mandatory two-person approval.

### Legacy-safe migration and switching

Add version table and nullable `Invitation.templateVersionId`; snapshot each existing template exactly into one legacy baseline version without claiming historical authorship/review. Backfill every invitation to the matching baseline. Do not assign new font/theme defaults to legacy events. Dual-read during deployment, then constrain version references only after backfill verification. Enforce matching template identity/version in the database, and keep relevant public/read indexes (`templateId, publicationState`, unique template/version). Existing `templateId` can remain for compatibility until every worker/read uses the pinned version.

Update event creation (`EventsService.pickTemplate`, `create`, `createInvitation`), draft reads, public `invitationInclude`, template switching, synthetic/event preview, cache invalidation, seed paths and print/proof generation together. Production seeds preserve publication history; development reseeding must create/update a draft or explicit new version rather than mutate a published version. Existing template switch semantics disable unsupported blocks and reset theme/default variants; a new version upgrade is an explicit preview + expected-version confirmation. Do not silently upgrade published events. Applying a version invalidates the durable guest-page revision through existing paths but never changes attendance, acknowledgement statement versions or captured invitation lifetime merely because design changed.

Proposed unimplemented operations: list authorable templates; create/clone draft; read/update draft with expected revision; validate; preview private draft with synthetic or authorized event content; submit/review/publish/retire; preview/apply an invitation version upgrade. Draft previews remain authenticated `private, no-store`, disable RSVP/analytics and exclude contacts/guest tokens/private media. Publish requests carry a dedupe key and exact draft revision/hash; two publishers cannot freeze different content under the same version number. Publication notice intent is transactional; asset processing/render checks use bounded worker claims outside DB locks.

Rollback keeps pinned published versions and all referenced assets. Turning authoring off is safe; reverting to code that ignores pinned versions is not safe after divergent versions exist. During compatible rollout keep the legacy read adapter until migration verification is complete; do not overwrite baseline templates to mimic a rollback.

### Test matrix and slices

1. Version-shaped read adapter and exact legacy baseline migration (no author UI yet).
2. Restricted draft create/edit/validate/preview with real frontend renderer capability agreement.
3. Review/publication/assets with immutable constraints and seeded catalogue compatibility.
4. Explicit invitation upgrade preview/confirmation plus cross-client acceptance.

Unit: schema/theme/block/default validation, publish transition matrix and renderer capability mismatches. Integration: pinned legacy events retain identical serialized design, publish/edit races, publication numbering/idempotency, cross-owner asset refusal, concurrent asset removal and safe cleanup, rollback of rejected whole publication. HTTP: author vs event DESIGNER boundary, foreign draft/event preview isolation, stale revisions, invalid asset and bounds errors. Browser fixtures: en/ru/fr/hy, long text, font fallbacks, unsupported variants and responsive layouts. Measure existing invitation warm/cold budgets independently after the read-model change; do not accept success based only on request status. Existing snapshot exports remain fixed.

F44 is independent of F38/F37/payment work. PP-D50 chooses organization-private custom templates alongside ADMIN-managed shared templates; implement that explicit scope without speculative marketplace rights.

## 6. F41 — vendor availability and reservation conflicts

[PP-D51](DECISIONS.md) confirms ADMIN-managed explicit exclusive resources, ADMIN-configured buffers, assigned-SUPPORT event reservations, expiring manual holds, safe customer availability and deferral of vendor self-service/recurrence. PP-D24 still prohibits automatic holds from quote acceptance. Capacity-based inventory is not part of the initial model.

### Calendar model and access

Do not infer inventory from a vendor or one hall per vendor. Introduce explicit `VendorResource` for the thing reservable (a directory hall, crew or service slot), with calendar owner and visibility scope. `ResourceCalendarEntry` records unavailable interval or reservation/hold with source booking/event ID where authorized, start/end UTC, source timezone/local input, status/revision and optional hold expiry. PP-D51 chooses exclusive resources, ADMIN-configured buffers and no initial recurrence/vendor self-service. Use explicitly configured intervals/timezone; no conflict-bypass or capacity-sharing override is implied.

A curated vendor resource may be shared across tenants while each reservation remains private. Tenant clients see authorized availability/busy intervals only; never return another customer's event ID/title/contact/fee in a conflict or list. Private organization resources remain invisible outside their tenant. Existing brief tokens authorize one event's declared sections, not a vendor-wide calendar. Vendor self-service editing, if desired, requires a new authenticated/scoped access design with revocation; do not silently broaden brief capabilities.

Use real foreign keys to resources and source bookings; enforce start before end and same-tenant references where relevant. Index `(resourceId, startsAt, endsAt)` plus `(status, expiresAt, id)` for bounded hold sweeps and `(eventId, id)` for event views. Source-intent identity and resource/revision uniqueness provide idempotency. Event/calendar linking is nullable during migration: existing bookings without explicit schedules are marked unscheduled, never given guessed blockers.

### Atomic reservation design

For an approved exclusive resource policy, proposed boundary is half-open intervals `[startsAt, endsAt)` so adjacent bookings do not overlap; this is a proposal needing operational agreement on buffers. Every create/edit/confirm/cancel/expiry writer locks the resource row before checking active overlaps and writes the reservation in one transaction. Acquire multiple resource IDs in sorted order. A database exclusion constraint can provide an additional backstop for the approved exclusive model if its deployment requirements are accepted; do not choose that constraint for unknown capacity semantics. A plain earlier availability read is only a preview, never permission to reserve.

Expired holds are excluded at decision time under the lock even if their cleanup sweep has not run. Hold duration, grace and whether a deposit promotes a hold are policy inputs. Confirmation joins the sales booking transition only if agreed; a `VendorBooking.CONFIRMED` update must use the same reservation writer whenever it owns a calendar interval. Conditional revisions prevent stale edits, and a repeated intent returns the original result. Conflict responses expose safe resource/time information only. No provider call takes place under a calendar lock.

Changes in event date do not automatically move supplier reservations; propose an explicit affected-bookings preview/confirmation with conflicts and notice intents. The current event change notification remains host-directed, as D3 requires. Changing calendar data must not silently change guest venues, RSVP eligibility, attendance policy or seating. Staff overrides, if allowed, record actor/reason and cannot disguise a double booking as conflict-free.

Proposed unimplemented operations: bounded date-range availability; resource/calendar management; atomic hold/reserve/revise/cancel; event calendar summary; affected-resource preview for rescheduling. Tenant and calendar ownership are explicit in requests/guards. Durable expiry/recovery sweeps are bounded and lease-protected; expired-hold backlog alerts do not determine correctness. Keep time-window bounds so a request cannot expand years of recurrence or scan an entire vendor history.

### Booking integration without a module cycle

Keep availability as a lower-level domain module exporting transaction-aware reservation operations (proposed `reserve(tx, request)`, `confirm(tx, reservationId, expectedRevision)` and `release(tx, ...)`). It depends on Prisma/resource policy, not sales, quotes or payments. Sales owns accepted quotes/deposit bookings and calls these operations with its transaction and stable source identity; calendar records expose no financial truth. Calendar-backed booking creation writes the booking reference, holds and notice intent atomically. Payment reconciliation calls sales settlement, which confirms/releases the applicable reservation under the approved deposit/late-payment policy; availability never calls payment capture/refund or independently confirms a sales booking. Logistics calls the same reservation contract for approved shared resources. Existing payment core remains unaware of vendor calendars.

Proposed local orchestration order: claim request intent, lock quote/booking revision, lock sorted resource IDs, then reservation rows. Every source-backed cancellation/reschedule/promotion follows that order. A standalone calendar operation may lock resource then its reservation, but cannot reach back to lock/change the source quote/booking; source-backed semantic edits route through the booking owner. This prevents the obvious booking→resource / resource→booking cycle. Integrating with any event policy/order/guest/ticket lock is a separate reviewed step: do not hold the existing admission locks while acquiring a calendar resource, and do not let a bank request run under any of these locks. Expired hold conversion found after capture must follow the user-approved reacquire/refund/review rule, not assume capacity is still available.

### Tests and release slices

Unit: interval boundary/DST/local-time validation and transition/visibility rules. For nonexistent or ambiguous local clocks, require explicit offset/confirmed interpretation under an approved UX; do not silently choose one. Integration: simultaneous overlapping reservations, adjacent boundaries, capacity boundary if chosen, opposite-order multi-resource requests, expired hold races, cancellation/rebook/reschedule and cross-tenant shared-resource privacy. HTTP: safe 409, time/window bounds, private calendars and scoped vendor capabilities. Rehearse sweep restart/outage and restore before accepting real commitments.

First deliver explicit resource/calendar ownership and read-only availability with synthetic or manually entered data. Next add one approved reservation type with its complete concurrency tests. Add multi-resource/reschedule and deposit promotion only after interfaces are fixed. F41 can run independently of F39/F40/F35/F38/F44 against existing tenants; it depends on F33 only for agreed deposit-driven holds, not basic calendar correctness.

## 7. F42 — four separately deliverable workflows

### A. Paper/QR ticket distribution

[PP-D52](DECISIONS.md) confirms private printed PDFs for contact-authorized event staff, reuse of existing codes on reprint, mandatory online admission checks and ADMIN review of lost/reissue cases. Offline admission is explicitly deferred; its design below is a future dependency analysis, not initial scope.

Reuse paid/free-issued tickets and unified online admission; printing does not issue another ticket or reset its status. Design a minimal private per-attendee/authorized batch ticket artifact, not a public ticket URL or a copy of the contact-heavy manifest. `TicketPrintRequest` records event, requester, idempotency/fingerprint, selected ticket IDs/order revision, locale, proof/artifact job and optional issuance/distribution audit. `TicketPrintItem` links the existing ticket to its captured printable holder label and opaque code, with bounded batches. Reprints retain the same admission credential unless a separate revocation/reissue policy is explicitly approved. Protect object keys and QR/codes from logs, analytics, error bodies and shared previews.

Choose the exact QR payload with the frontend scanner: proposed minimal existing opaque ticket code, not a guest capability or buyer access token. Include a human-readable fallback and event discriminator without embedding contact details. Confirm QR symbology, print dimensions and scanner compatibility by actual printer/phone tests in four scripts. Per-attendee PDFs should omit buyer contact data and dietary/acknowledgement data. Existing manifest download still requires contact permission and is not weakened. Design batch/private-file permissions explicitly rather than granting arbitrary door staff access to every code.

Generate artifacts through the existing bounded private-worker pattern, rechecking current requester/event/ticket standing at capture and download. If a ticket is cancelled after printing, the paper cannot be recalled: online scan must still consult current `assertTicketAdmits` and acknowledgement gate. DSAR invalidates stored artifacts using subject provenance/cleanup ledgers; record that already-distributed paper needs operator handling under an agreed policy. No retention duration is invented. Printing does not refresh free invitation expiry or sign acknowledgements for the attendee.

**Offline admission is explicitly deferred by PP-D52. The following is future design analysis, not initial scope.** A downloaded manifest cannot guarantee exactly-once admission across disconnected doors or learn a new cancellation. If required, first agree device registration, encrypted/minimized manifest, offline expiry/revocation expectations, event partitions, duplicate conflict policy and explicit scan reconciliation. Model append-only `OfflineScanBatch/OfflineScan` with device sequence/idempotent identity and captured server-manifest revision; ingestion must report accepted/duplicate/conflicting/stale outcomes and preserve facts rather than overwrite admissions. Never implement offline admission by setting all scanned tickets USED without running the established admission/acknowledgement/cancellation policy. A scoped single-door/event partition may be proposed, but is not an approved operating assumption.

Proposed unimplemented API: request private ticket print job, poll, download, record handoff; offline batch issue/sync only after policy. TDD unit-tests QR payload/format policy and exact reprint behavior; integration tests duplicate generation, ticket/guest scanner race unchanged (`backend/test/integration/ticket-admission.int-spec.ts`), cancellation during capture/download, permission loss, revocation and DSAR; HTTP tests no public file/code exposure, valid selection scope and bounded output. Physical print/scanner acceptance is required. This slice does not depend on F41, F44 or new commerce: existing issued tickets suffice.

### B. Logistics and delivery tracking

[PP-D53](DECISIONS.md) confirms ADMIN/assigned SUPPORT event tasks, Planned/In progress/Completed/Cancelled states, factual actor/time/handoff evidence, minimal assigned-worker access, calendar-backed conflicts and manual partner coordination. No initial carrier API integration.

`LogisticsTask` is event-owned with vendor/venue/order links where applicable, pickup/dropoff or service window, responsible party, bounded instructions and revision. `LogisticsTransition` records factual handoff/status actor/time and immutable evidence attachment references. Proposed states such as planned → ready → dispatched → delivered, with failed/cancelled branches, must be adapted to the operator's real workflow. Do not auto-claim delivery merely because a scheduled time passed. Vendor access uses explicit event/task scope, exposes necessary addresses/contact only and never another vendor's fees or the guest list by default.

An explicit request transitions one task atomically with expected revision and idempotency key plus notice intent. External carrier integration is optional later; ambiguous carrier outcomes remain pending reconciliation rather than automatic repeat dispatch. Proof files are private, validated and tied to subject/privacy cleanup. Scheduler reminders are durable and use approved time/channel/consent policy. Resource time conflicts join F41 only when those tasks reserve a shared vehicle/crew. Changing a task does not mutate guest-facing timeline entries without explicit operator intent.

Tests cover duplicate handoffs, stale transitions, recipient/vendor scope, contact field redaction, provider timeout/retry if integrated, late evidence, deletion/archive handling and four-language operator copy. First slice is manual tracking with existing event/vendor/venue IDs; no dependency on completed quotes unless the task's commercial source requires one.

### C. On-site staff assignment

PP-D53 also confirms the staff-shift access/calendar/manual-coordination model; assignment never grants broader guest/billing rights. Payroll is outside the initial scope.

`EventStaffAssignment` holds event, real user or approved external person record, role/task, shift interval/timezone, assignment lifecycle and acceptance evidence if required. Scheduling a person does not grant `COORDINATOR`, guest-contact or billing access. Event access is separately invited/accepted through the existing `AccountService.inviteToEvent` contract, or a new narrow role/permission approved for the job. External workers must not be forced into full account/guest records as a shortcut.

Assignments check event and staff eligibility within the target scope. Shift acceptance/decline is factual; rescheduling creates a revision/renewed acknowledgement under the chosen policy. If cross-event double-booking matters, use a staff resource or dedicated person calendar with the same deterministic interval lock discipline as F41; do not expose another customer's schedule details. Cancel/remove access by an explicit coordinated workflow and preserve attendance/check-in facts. Employment/payroll/wage/contractor settlement are outside this feature unless separately agreed; no pay rules are invented.

Tests cover person/role scope, simultaneous shift claims, conflicting edits, invitation acceptance not granting organization membership, schedule removal versus permission revocation and timezone boundaries. First slice is event-owned assignment roster with explicit access mapping, independently of vendor resource calendars when conflict enforcement is not in scope.

### D. Print companion production orders

[PP-D54](DECISIONS.md) confirms immutable source specifications/design, named-approver signed-in proof approval, new approval for changes, ADMIN production release after verified accepted payment conditions and manual printer handoff/delivery tracking. No automatic printer order follows from approval/payment.

`PrintOrder` references an immutable accepted quote line or package/add-on order line from the chosen commerce model. It captures quantity, materials/dimensions/options, source design version, requested delivery window/address and approved price/currency snapshot reference. `PrintProofVersion` stores private proof artifact hash and exact design/source revision. `PrintApproval` records approver/authority, proof hash and timestamp. `PrintFulfilmentTransition` records partner handoff, production/shipping/delivery and failure/rework evidence. Separate commercial payment state, customer proof approval and production state.

Proposed flow: draft specification → proof queued/ready → exact proof approved → eligible for production → in production → handed off/delivered, with agreed cancellation/rework branches. Customer edits after approval create a new proof and invalidate pending production eligibility; they do not quietly change the file at the print partner. PP-D54 requires ADMIN release after the accepted source payment conditions are verified; actual conditions are configured in the accepted order/quote terms, not guessed by the renderer. Approval of a live invitation URL is insufficient because event edits would change the printed content.

Generate one fixed proof with captured inputs using bounded worker jobs outside DB locks, reuse private storage/download checks, and send only the scoped partner artifact needed. Production release atomically claims the approved version and writes durable partner-handoff intent. A printer timeout/unknown acknowledgement is not retried as a second purchase/production order; reconcile stable partner order IDs where supported or put it in operator review. No printer integration or physical spend is authorized by this plan. Quoted costs, tax, refunds and cancellation charges are owned by commerce and require policy/examples.

Template authoring F44 is conditional: a proof can use an existing supported design plus captured data. New custom template versions join through the shared template snapshot contract, not direct mutable `DesignTemplate` reads. Calendar F41 is conditional for reserved print/fulfilment slots. Logistics B can deliver the order but basic print proof/approval need not wait for logistics implementation.

Tests cover approval/edit/production-release races, idempotent partner intent and unknown outcome, fixed proof hash after event changes, forbidden cross-tenant proof/order links, private files/contact minimization, rejected/partial production outcomes under agreed rules, and human approval/physical A4 or partner specification acceptance. First slice is immutable proof generation/approval and manual production tracking after commercial order linkage is agreed; no live partner order is placed.

### Proposed local lock protocols requiring integration review

These are per-aggregate proposals, not a proven global hierarchy. Before implementation, document the actual overlap with `lockAdmission` (policy → order → guest → ticket), attendance/seating policy locks, payment/refund claims and user/membership authorization locks. Write two-direction race/deadlock tests for every shared pair.

- Membership lifecycle: user → sorted organizations → affected membership/invite. Do not introduce this protocol late inside an existing event transaction; resolve/lock standing at its established boundary.
- Corporate accept/amend/allocate: contract → exact version → sorted allocation targets. Never add an inverse event → contract writer; if an existing event operation must join, refactor to one reviewed orchestrator or use a separate conditional allocation intent.
- Template publish: template identity → draft/version → relevant asset references. Invitation upgrade: established event/invitation fence → invitation expected version; read an immutable published template version without acquiring mutable authoring locks. Authoring must not lock every consuming event.
- Calendar-backed booking: request claim → quote/booking → sorted resources → reservations as above; availability never calls back into its booking owner.
- Print proof/release: print order → proof/approval → release intent/job at finalization. Worker claims release their job transaction before acquiring business locks, render/upload without locks, then reacquire business/proof/current-permission fences and conditionally complete the owned job. A job claim is not authority to bypass a new proof revision or permission loss.

## 8. Integration, operations and migration acceptance

- Domain correctness lives in Postgres. Use new additive tables, nullable foreign-key introduction → verified backfill → constraints. Never edit applied migrations, reset real databases or use them as shadow stores. Give each schema change a population/legacy fixture and deterministic validation query. Catalogue/tenant template pointers and existing event IDs must survive.
- Use unique intent keys scoped to the aggregate/actor with canonical fingerprint; same key with changed input is a safe conflict. Expected revision prevents stale state transitions. A successful multi-write intent includes its audit/business-notice record in the same transaction; external calls happen after commit and recover through bounded claims.
- Reuse existing queue/lease patterns for proofs/files, not synchronous CPU rendering in requests. Save requester identity, not a frozen permission grant. Recheck current standing/revocation before application/download and after storage I/O. Store safe failure codes, attempt/next-attempt/lease clocks and provenance, never tokens or raw documents in observability.
- Define per-slice technical bounds before implementation (page sizes/time-window/batch/asset bytes), from existing worker limits and approved workloads. Preserve one screen/one request with aggregate summaries/selects, no N+1. Use indexed bounded queues and alert on oldest pending age, repeated conflicts, exhausted jobs and unreconciled external intents. Do not repurpose Mongo as a domain ledger.
- Add new aggregate/asset/job/intent tables to backup/restore inventory and DSAR subject matching. Account closure and membership removal must not delete accepted corporate terms or financial history; exact retained/redacted fields and durations need policy. Private artifacts get immediate access revocation and durable object cleanup, following the existing guest-media/export pattern.
- Every slice includes updated shared API/permissions/design/venue/product docs and generated OpenAPI in the implementation commit. Proposal routes here must not be added to the live API guide until implemented. New translated errors/recovery, notifications and artifact labels cover en/ru/fr/hy; host-authored legal/commercial copy has explicit locale/fallback and review, never automatic legal translation approval.
- Each slice starts with failing tests at the cheapest appropriate layer, then integration for relational/transaction races and HTTP for validation/status/access shape. Run full `npm run verify` after integration. Integration/HTTP share guarded `aveline_test` and must not run concurrently across workstreams; measured load remains separate. This planning task ran no test suites or migrations.
- Recovery rehearsal: terminate proof worker after capture and after upload, expire lease, revoke requester, recover with a different worker and prove only one fenced artifact is published; simulate storage/outbox/partner outage and restore pending business intents plus media cleanup state. Multi-organization activation also requires proof that every deployed reader/worker understands new membership scope.

## 9. Delivery order and required decisions

| Lane / slice | Can proceed in parallel | Must wait for |
|---|---|---|
| F38 scope resolver and compatibility design | F37 draft engine, F44, F41, sales/commerce domain engines | Selector/default/invite/owner policy approval before activating new membership behavior |
| F37 immutable contract drafts/brand versions | F38 and commerce fiscal work | Approved parties/signers/retention; full multi-org access after F38; charging after commerce/provider acceptance |
| F44 legacy version pinning and draft preview | Every other lane | Author/reviewer/publication/asset/renderer policy before authoring rollout |
| F41 resource/calendar and one reservation type | Sales, commerce, F38/F44, referral accounting | Calendar owner, interval/hold/capacity/override rules; deposit promotion after agreed F33 transition |
| F42 paper ticket job with online admission | All new features | Distribution/reprint/privacy and print/scanner acceptance; offline waits for separate admission policy |
| F42 logistics / staff tracking | Each other and F41 | Real operator states/access; F41 only for shared scheduling conflicts |
| F42 print proof/approval | F44/F41/logistics when interface agreed | Immutable design/order link and partner/proof approval rules; payment/refund production-release policy |

Recommended first design contracts: choose explicit organization selection before new org-scoped APIs; agree immutable template/version and renderer capability; agree sales/commerce order/quote reference envelope; separate paper distribution from offline admission. These decisions unblock production-oriented vertical slices without waiting for a bank to finish certification.

### Confirmed policy and remaining inputs

The interview is complete. [PP-D44–49](DECISIONS.md) governs organization and
single-organization corporate workflows, PP-D50 templates/brand versioning,
PP-D51 exclusive calendars, PP-D52 online paper tickets, PP-D53 tasks/shifts,
PP-D54 print proofs/release and PP-D58 operational retention.

- Initial F37 contracts have one payer organization and only its own events;
  F38 is independent rather than a prerequisite for this initial contract scope.
- Exact header/route transport, actor resolution and migration order require
  engineering/frontend agreement, not a new product choice between per-tab and
  account-wide selection; PP-D45 already chooses explicit per-tab behavior.
- ADMIN/operator configures real resources/buffers, authors, approvers, brand/
  renderer-approved assets, shifts, partner instructions, proofs and accepted
  contract/production conditions. No default workload, wage or physical spend
  is invented. Supported renderer code/font assets still need team evidence.
- Expert-reviewed accepted contract/proof/financial retention, and any real
  provider/fiscal use, remain production gates. New operational notes/contacts
  follow PP-D58; existing pilot media/data retention remains unchanged.
- Offline admission, capacity-sharing/recurring calendars, vendor calendar
  self-service, payroll/carrier/printer APIs and cross-organization contracts are
  outside the initial scope unless the user later reopens them.

Unimplemented: every new feature in this document. Existing foundations and known open pilot acceptance remain as recorded in TODO. The register supplies approved initial policies; no extra deadline, legal term, tax rate, consent grant, retention duration or paid-operation approval is implied beyond those decisions.
