# Sales and bookings — production implementation design

> **Delivery update — 30 October 2026:** this is the historical broad design.
> F38/F39/F44 backend slices are now implemented; other commercial/resource/
> logistics slices remain planned. See [current implementation status](execution/IMPLEMENTATION_STATUS.md).
> Proposed or “unimplemented” route/runtime examples below are superseded where
> delivered by [API.md](../API.md), generated [OpenAPI](../../backend/openapi.json)
> and governing domain docs. This design does not establish deployment acceptance.


**Decision precedence:** confirmed choices and explicitly delegated defaults in [DECISIONS.md](DECISIONS.md) supersede unresolved alternatives in this proposal. All other options remain proposals until answered.

Prepared 25 October 2026 (Asia/Yerevan), against `eb1b6e2` and the working dependency refinement. Covers **F39 enquiry/consultation intake, F40 component quotes, F33 deposit-confirmed bookings**. This is a design proposal, not an implemented API, a product-policy decision, or paid-launch approval. No database or provider operation was performed for this design.

## 1. Requirements and evidence boundary

**Confirmed:** PRODUCT_SPEC §7.1 separates event type from design component; §7.4 requires enquiry → consultation → setup and a deposit confirming a booking; §11 is concierge-first. The pilot stays free with `PILOT_MODE=true`. Money is integer minor units serialized as strings; timestamps are UTC plus an IANA timezone for local appointment/event display; user-facing validation and messages support en/ru/fr/hy. Existing RSVP/reconfirmation, snapshots, privacy, retained host data and captured invitation lifetime remain unchanged. Native F22 and unrelated entitlement enforcement remain deferred.

**Confirmed initial workflow:** PP-D01–38 resolves the sales workflow: staff-only
intake, assigned SUPPORT access, required contact fields, consultation conflicts,
explicit conversion, internal notes, reviewed AMD offers, named signed-in
acceptance, ADMIN external written acceptance, automatic quote emails, fixed
immediately charged deposits, no automatic pre-payment holds, late/unfulfillable
refunds, one balance payment, ADMIN refund control, accepted credit-carrying
amendments and card-only sales payments. PP-D57 resolves uncertain refunds;
PP-D58 classifies new operational retention. Enquiry six-month cleanup is PP-D03.

**Still input-dependent:** actual ADMIN-configured offers/terms/deadlines,
accountant-approved fiscal/protected-evidence rules and provider capabilities.
No workflow alternative below overrides the completed decision register. The
aggregate/model/API organization remains a reviewable engineering proposal.

## 2. Audit of reusable code and specific gaps

| Existing anchor | Reuse | Required boundary/change |
|---|---|---|
| `backend/src/modules/organizations/concierge.service.ts`: `openForCustomer`, `createEvent`; `concierge.controller.ts` | Staff creates a customer organization/event without holding their password; reuse normal event creation and invitation behavior | No enquiry, consultation or sales-booking model exists. `openForCustomer` creates organization then calls account invitation outside one transaction; enquiry conversion must not blindly promise atomic conversion by wrapping this existing method |
| `backend/src/modules/access/access-policy.ts`; `infra/auth/auth.guard.ts` | Default authentication, live membership/permission checks, platform-only permissions | `SUPPORT` has concierge access but explicitly no billing access. Intake access must not silently grant quote-price/deposit/billing access. Pre-tenant enquiries need a platform scope, not arbitrary nullable organization scope |
| `backend/prisma/schema.prisma`: `VendorBooking`, `BookingStatus` | Link operational vendor engagements later if the approved sales offer calls for them | `ENQUIRED/QUOTED/CONFIRMED` vendor states are not a sales contract, customer booking or deposit ledger; do not overload them or change their current meanings |
| `backend/src/modules/payments/payments.service.ts`: `start`, `confirm`, `reconcile`, `refund`, `onRefunded` | Hosted form registration, persisted idempotency claim, conditional payment transitions, refund reservation and uncertainty handling | `DEPOSIT` is a purpose enum, not a completed booking flow. Start-key replay does not verify an intent fingerprint. `confirm` currently drops normalized authorized/captured `amountMinor` in `extraFieldsFor`; deposit settlement needs validated provider amount evidence. Never treat a claimed refund as completed money returned |
| `backend/src/modules/payments/providers/payment-provider.ts`: `PaymentGateway` | `registerOrder`, `getStatus`, `refund`, `cancel`, bounded bank timeout | No explicit capture command exists. Authorize-then-capture requires a separately designed, supported and certified capability; an AUTHORIZED status is not a captured deposit |
| `backend/src/infra/jobs/money-sweep.service.ts`: `reconcilePayments` | Monitored periodic reconciliation followed by business settlement | Currently settles only ticket orders and subscription invoices. Add bounded deposit settlement/repair; extending a fifth constructor parameter would breach repository limits, so use a small deposit sweep or a justified purpose-settlement composition rather than enlarging this constructor blindly |
| `backend/src/modules/billing/subscriptions.service.ts`: invoice issue/settlement; `billing/invoice-number.ts` | Transactional numbering, captured invoice lines, conditional settlement as examples | Invoice creation is subscription-specific/private today. Sales consumes a commerce-owned fiscal issuance contract; it must not impersonate a subscription or allocate independent duplicate fiscal numbering |
| `backend/src/modules/communications/communications.service.ts`: `enqueue`, `enqueueMany`, `checkBeforeSending` | Persistent outbound messages, unique dedupe keys, suppression, quota and recovery | These APIs use their injected Prisma service, not a caller transaction. A business commit plus later enqueue has a crash gap. Write a durable sales notification intent in the business transaction; an idempotent dispatcher repairs delivery into the existing outbox |
| `backend/src/infra/jobs/job-lock.service.ts` | Cron check-ins and Redis coordination | Redis locks reduce duplicate work but do not make money/booking correctness. Database claims and constraints must remain safe if a lock expires or callbacks and sweeps race; Redis outage currently stops monitored sweeps, so surface backlog and recover when restored |
| `backend/src/modules/privacy/privacy.service.ts`: `assembleExport`; `privacy/erasure.ts`: `eraseSubject` | Verified staff-only DSAR workflow, domain/media cleanup and suppression hashing | They enumerate existing guest/order/account sources explicitly. New prospect contacts, consultation notes, quote party snapshots, booking contacts and notice intents must be integrated before intake is enabled |
| `backend/src/infra/audit/audit.interceptor.ts` | Existing successful-action observability without request bodies | Mongo audit is best effort. Acceptance, price revisions, cancellation and payment allocation evidence needed for correctness belongs in Postgres and its transaction |
| `backend/test/integration/payments.int-spec.ts`, `transaction-safety.int-spec.ts`, `ticket-settlement.int-spec.ts`, `billing.int-spec.ts`; `test/e2e/concierge.e2e-spec.ts` | Existing concurrent idempotency/settlement/refund, paid-pilot refusal, concierge access and real relational fixture patterns | Add sales-specific tests at the layer owning each rule; existing ticket late-refund policy is not automatically the deposit policy |

Source contracts reviewed: `docs/PRODUCT_SPEC.md` §§7–12, `docs/API.md` authentication, concierge, billing, privacy, money and error conventions; `docs/PAYMENTS.md`; `docs/ACCESS_CONTROL.md`; `docs/TODO.md`, `docs/BACKLOG.md` and `docs/POST_PILOT_IMPLEMENTATION_PLAN.md`.

## 3. Module boundary and contracts with parallel workstreams

Add one understandable `sales` module, organized around enquiry, quote and booking services rather than a generic workflow platform. Keep payment transport owned by payments, fiscal computation/issuance owned by commerce, tenant selection owned by authorization, and vendor availability owned by operations. Do not extract a universal order/event bus until multiple real consumers justify it.

| Shared interface to agree first | Sales needs / sales supplies |
|---|---|
| Organization selection (F38) | Request actor contains a server-authorized organization selection. Staff pre-tenant cases remain platform-scoped. Every linked event/quote/payment must match the chosen tenant; no `findFirst` membership fallback once multiple memberships exist |
| Fiscal quote/invoice snapshot (F35) | Commerce supplies versioned, integer amount calculation and document snapshots once accountant rules exist. Sales supplies exact immutable line/revision IDs, party reference, event, currency, amount and accepted terms. Quotes are not tax invoices; commerce is the sole source of final fiscal totals/snapshots, and sales must not compute a competing tax total. While tax policy is unknown, draft arithmetic is explicitly provisional and cannot be represented as an accepted final payable offer |
| Payment obligation / attempt | Agree a narrow commercial payment obligation or allocation owned once across commerce and sales. It carries tenant, purpose, source revision, amount/currency, attempt intent, payment ID/reference, evidence status and allocations. Prefer reusing the agreed commerce obligation over creating a competing generic purchase model; if no shared obligation is adopted, a minimal `BookingDepositAttempt` serves only F33 |
| Booking transition | Sales emits a transactionally persisted, versioned booking outcome with `bookingId`, `organizationId`, `eventId`, accepted quote revision and transition ID. Consumers idempotently apply fulfilment, availability or referral accrual. A Mongo audit entry is not that contract |
| Availability/holds (F41) | Only if a deposit reserves a real resource: operations supplies transactional reservation verification/commit/release and consistent resource lock order. Otherwise no vendor calendar dependency is introduced |
| Print/fulfilment (F42) | Accepted quote lines can identify a fulfilment kind and immutable approved design reference later. Acceptance never silently creates paid orders or publishes an invitation |
| Referral accrual (F36) | If commercial terms use booking confirmation/capture as the trigger, consume the persisted transition/allocation ID; do not infer revenue from VendorBooking.status or repeat accrual after replay |

## 4. F39 — enquiry and consultation intake

### First release scope

Confirmed in [PP-D01–06](DECISIONS.md): staff-entered intake only for messaging/phone/in-person enquiries. Name plus email or phone is required; other proposed fields are optional. SUPPORT-created enquiries assign to the creator, ADMIN handles reassignment, and stages may be skipped/reopened. Proposed implementation includes one staff queue/detail response, assignment, bounded notes and consultation appointment records. Customer account creation, public web intake, automatic marketing, lead scoring, file attachments and payments are separate slices. Intake does not publish an event, reserve a vendor or confirm a booking.

### Proposed domain and constraints

- `SalesEnquiry`: opaque ID; `organizationId` nullable only for an unconverted platform prospect; optional linked `eventId`; source; preferred locale; structured event requirements (event type, possible local date/range/timezone, estimated guest count and summary); current owner user ID; workflow state; optimistic `revision`; created/updated/closed clocks; privacy/redaction marker. A date-only event request stays date-only until its time is known; never invent midnight UTC as a booked instant.
- `EnquiryContact`: separately bounded subject/contact fields, normalized email/phone when supplied, consent/contact-source evidence as approved, revocation/redaction clocks. Do not create a global customer identity by automatically merging equal names/emails. Subject linkage is explicit so erasure can identify each copy without erasing unrelated people on one enquiry.
- `Consultation`: enquiry ID, optional assignee, scheduled start/end and timezone, revision, state and bounded outcome. Require end after start. [PP-D07](DECISIONS.md) requires atomic prevention of overlapping scheduled consultations for the same operator.
- `EnquiryActivity`: committed actor/action/revision/time and narrowly scoped payload for assignment/status/note changes; free text stays in an erasable field/table, not immutable evidence payload. Avoid saving contact values in state-change history.
- Unique `(enquiryId, revision)` transition/version identity, tenant-consistent composite references for linked event/organization, and actor references that preserve history after account closure. Index the real queue query `(ownerUserId, state, nextFollowUpAt, id)` and the tenant queue `(organizationId, state, updatedAt, id)` only when those queries are shipped. Index normalized contact lookup used for DSAR; do not expose a global contact-search surface to customers.
- Creation idempotency is unique by authenticated actor/operation/key with a canonical intent fingerprint. No uniqueness constraint on contact email: two legitimate enquiries may share it. Field/array/page bounds are defined in DTOs and accepted with the intake schema before build; do not silently truncate notes or lists.

### Proposed workflow

Confirmed in [PP-D06](DECISIONS.md): New, Contacted, Consultation, Ready for quote and Closed with a reason; stages may be skipped and reopening is an explicit action. Code enum labels may follow these approved meanings without adding a sequential-stage restriction. A consultation has separate proposed `SCHEDULED/COMPLETED/CANCELLED` state. Do not overload an enquiry state with invoice/payment truth. Use compare-and-set on `revision`; stale assignment/notes/status edits return a conflict without losing another operator's edit.

[PP-D08](DECISIONS.md) permits staff to choose conversion timing, including before quote acceptance/payment; it creates draft setup only. Conversion is an explicit, retryable command. Within one transaction validate current case revision, chosen organization/event and staff authority; write the new linkage/conversion claim and its transition. Refactor concierge domain writes to accept a `TransactionClient` where atomic new organization/event creation is needed, or implement a durable staged conversion with recoverable states and idempotent step references. Record account-invitation intent in the same transaction, enqueue later. Preserve D8 for customers already in one organization; once F38 permits several, require an explicit selected organization and never guess based on the contact's email.

### Permissions, privacy and proposed API

Confirmed in [PP-D02](DECISIONS.md): ADMIN sees/manages all enquiries; SUPPORT sees/manages assigned enquiries only. [PP-D05](DECISIONS.md) resolves SUPPORT creation/assignment: assign to creator and ADMIN handles reassignment. [PP-D09](DECISIONS.md) keeps enquiry records/consultation notes internal after conversion; customers see their issued quotes and booking information only. Propose a dedicated platform-only intake permission, not adding it to the dynamic customer-owned permission set by accident. `concierge:manage` can continue to authorize setup, but it is not automatic financial authority. [PP-D10–12](DECISIONS.md) now permit ADMIN/assigned SUPPORT quote pricing and drafting, catalogue defaults with proposed price/discount overrides, and ADMIN approval of every issued revision. PP-D29 reserves booking refunds to ADMIN, and PP-D33 limits initial sales payments to integrated card flows. These quote permissions grant no broader billing access. Designers, vendors, guests and ordinary unrelated organization members gain no access.

Candidate endpoints **not implemented**: authenticated platform `sales/enquiries` create/list/detail; revision-checked patch; `sales/enquiries/:id/consultations`; explicit assign/close/convert commands. The final organization-scoped path/header awaits F38; no new paths go into API.md/OpenAPI until implemented. Lists use bounded stable cursor/page ordering; detail returns enquiry/contact visibility, activities, consultations and linked quote/booking summaries in one request. Redact absent contact/commercial fields according to permission; do not return them as merely disabled UI controls.

DSAR must export all matching contact/notes and redact approved nonfinancial prospect content on verified erasure, including queued notices and stale conversion drafts. Record subject-privacy revisions so conversion after erasure cannot copy erased contacts into an organization invitation/event. New normalized contacts must respect applicable existing suppressions; do not create unsolicited sends from intake. [PP-D03](DECISIONS.md) sets enquiry contact/note clearing to six calendar months after latest closure, with reopening pausing cleanup; the user delegated this default. Implement bounded recovery-safe cleanup, including duplicated notes/notice payloads. Accepted quote/contract/fiscal retention, backup retention and customer visibility remain separate decisions.

## 5. F40 — component catalogue and versioned quotes

### Proposed domain and immutable offer

- `DesignComponent`: stable key, active/retired state, translated display data, event-type applicability and a revision. Applicability is many-to-many across event type × component, not separate cloned catalogues per event type. Price book/price entries are commerce-owned if shared with F31/F32; catalogue retirement does not remove prior quoted lines. [PP-D13](DECISIONS.md) limits new sales quotes to AMD initially, without changing legacy payment/ticket/subscription currencies.
- `SalesQuote`: tenant/customer/event/enquiry references as appropriate; stable identity, optimistic revision/current issued revision reference and lifecycle. Draft quote creation can work with explicit customer/event context before F39 is finished; make enquiry linkage optional where the agreed workflow permits it.
- `QuoteRevision`: unique `(quoteId, version)`, immutable after issue; currency, translated offer/terms snapshot, issue/expiry clocks, author/approver, exact line snapshots and deterministic calculation/fiscal-policy reference. Separate mutable drafts from issued records, or enforce an immutable issued boundary with DB/service guards. The immutable boundary includes approved substitutions/discounts/terms, not only numeric prices.
- `QuoteLine`: quote revision, stable line ID and order; component/source revision reference; translated/literal captured description, quantity, unit price, discount and line amount strings/BigInts; tax snapshot reference when available. [PP-D19](DECISIONS.md) requires whole-number quantities initially; never let arbitrary client totals be authoritative. Enforce nonnegative/fitting amounts and one currency per offer. Money bounds must fit DB/provider limits and be agreed with commerce.
- `QuoteAcceptance`: unique on the accepted quote revision (or quote, if only one revision may ever be accepted—the intended rule must be decided); exact accepted digest, subject/actor or scoped credential ID, server time, terms/policy version and authorized representation evidence. No arbitrary client timestamp or payer identity substitutes for acceptance. Prevent two incompatible revisions winning acceptance of one quote.
- `QuoteAccessGrant`, only if external non-account approval is chosen: random scoped token stored as a digest, bounded lifetime, revocation and privacy revision; never a guest invitation/buyer ticket token. PP-D17 chooses authenticated-account acceptance initially, so defer this capability model unless the user explicitly expands scope later.

Indexes follow list queries: `(organizationId, state, updatedAt, id)`, `(enquiryId, createdAt, id)` when linked, and `(quoteId, version)` uniqueness. Tenant-consistent references prevent foreign event/enquiry IDs. Referenced issued revisions are restricted against deletion; catalogue relations may retire/set nullable reference only when the immutable snapshot retains provenance and the agreed retention allows it.

### Workflow and transaction boundary

Candidate draft → issue → accepted / rejected / withdrawn / expired; edits to an issued offer create a new revision, never mutate the accepted offer. Before issuing: validate complete component applicability, quantities, currency, translations, total calculation, issuer authority and required fiscal/party data. [PP-D14–15](DECISIONS.md) require ADMIN-chosen expiry before issue and replacement of the earlier unaccepted offer when a new revision is issued. Accepted terms change through explicit amendment only; PP-D16–18 define acceptance and PP-D32 defines credit-carrying amendments.

Acceptance locks the quote root/current offer, relevant revision and acceptance identity in one documented order; verifies scope, expiry using server time, exact expected revision/digest and current authority; writes acceptance once and its durable notification/next-step intent. Repeated identical acceptance returns the stored acceptance; same idempotency key with different terms returns conflict. A concurrent edit/withdraw/expiry cannot produce a booking on stale or mixed terms. Zero price is not automatically a waiver of deposit or an entitlement grant.

Proposed API **not implemented**: catalogue query/curation under the decided staff permission; quote draft create/detail/patch; issue-revision, withdraw/reject/accept commands; bounded revision history. Requests use IDs/quantities and `expectedRevision`, not caller-computed totals. Responses include currency and integer-string amounts, exact revision, actionable allowed transitions and negotiated display copy. [PP-D16–18](DECISIONS.md) choose a named approver with signed-in acceptance, plus ADMIN-recorded external written approval; account-free acceptance links are not initially included. Authorized offer reads use private/no-store and show no unrelated internal margin, consultation notes or guest information.

Quote PDFs/acceptance attachments, if required, are generated by durable jobs in private storage. Reuse worker capture/render/storage patterns, but do not add sales documents to the existing seven export kinds by changing their meaning. Snapshot exact issued revision, not live price book data; downloads recheck current subject/actor authority and revocation. The client renders existing guest invitation previews unchanged.

## 6. F33 — deposit-confirmed sales bookings

### Explicit domain, not Event.status

Use `SalesBooking` (or the product's chosen name) linked to accepted quote revision, organization and event, with a unique source-acceptance relation, operational booking state and separate financial state. Do not add “confirmed” semantics to the existing published/draft Event status or modify invitation publication. A booking can exist before event creation only if the chosen business workflow supports it. `Payment.organizationId` is required today: a pre-tenant enquiry must first be explicitly converted/attached to an authorized customer organization before deposit checkout. Do not weaken payment tenant ownership or create a placeholder tenant to accommodate a platform lead. The schema may keep event linkage optional until explicit setup, consistent with staff-controlled conversion timing; when supplied, its organization must match. Required service/resource details still belong to accepted terms before a commitment.

A deposit obligation snapshots amount/currency, exact quote acceptance, applicable tax/invoice references and versioned payment/cancellation/reschedule terms. Model `BookingDepositAttempt` only if the commerce obligation/attempt contract is not adopted. Unique attempt intent key/fingerprint, unique Payment linkage, immutable business source and accounting allocation prevent one payment being reused for two bookings. Define one-current-payable-obligation constraint and replacement rules from the agreed policy, not by reusing a subscription's plan-change void rule.

Candidate financial states distinguish `UNPAID`, `PAYMENT_PENDING`, `AUTHORIZED`, `CAPTURED`, `REFUND_PENDING`, `REFUNDED` and `MANUAL_REVIEW`; operational states distinguish proposed `PROVISIONAL`, `CONFIRMED`, `CANCELLATION_PENDING`, `CANCELLED`, `COMPLETED`. Final transition tables depend on deposit/hold/refund policy. `AUTHORIZED` never silently confirms a capture-required booking. `Payment.status=REFUNDED` currently includes a reserved refund claim, so completed refund rows/provider evidence decide whether to state that money returned.

### Initiation and settlement algorithm

1. Validate actor/scope, expected booking/quote revision, current accepted terms, computed obligation and local provider capability before writes. Apply `assertChargesEnabled()` before creating/replacing a payable invoice/obligation or resource hold in pilot mode. PP-D30 requires a positive deposit for paid quotes and explicit ADMIN approval for zero-total confirmation without payment; neither simulates capture nor bypasses required availability.
2. Claim the request key and canonical intent in Postgres. In a short transaction lock the sales aggregate/offer and any required resource reservation using the common lock order, then persist the obligation/attempt and notification intent together. Database constraints, not a prior read or Redis lock, decide the single owner.
3. Call the existing payment core outside business DB locks with a server-computed amount, currency, tenant, purpose `DEPOSIT`, event and deterministic attempt-derived idempotency key. Record linkage/registration state durably; retry/repair can find the original claim even after a crash. Do not allow browser-supplied organization, amount, purpose or a new key to bypass the current obligation.
4. Registration uncertainty must not automatically create a new charge attempt. PaymentsService currently marks a thrown registration failure FAILED; agree with commerce whether a lookup by merchant reference or an explicit unresolved attempt is needed when a bank may have registered the order but its reply was lost. Do not invent a provider lookup the port does not support.
5. Browser return triggers server-to-server confirmation only. A deposit settlement service verifies ownership, purpose, amount/currency evidence, accepted quote/obligation revision and refund reservations. The core currently normalizes provider amounts but does not persist/compare them; its normalized outcome also has no currency field. Commerce/payments must define trusted amount/currency evidence at the certified adapter boundary and close that evidence gap before captured status can confirm new paid bookings; do not pretend the existing port already supplies verified currency evidence. Preserve the original obligation amount; do not rewrite price to match a provider mismatch. Quarantine mismatches for reviewed reconciliation and alerting.
6. Conditional settlement claims the eligible attempt/obligation once; writes payment allocation, booking confirmation, resource reservation outcome if applicable, Postgres business transition and notice intent atomically. No external bank/message/storage operation runs inside that transaction. Concurrent callbacks, cron and customer retries converge on the same transition.
7. A bounded monitored sweep repairs unlinked started attempts, settles captured-but-unallocated payments and enqueues missing notices. It must cover the customer who never returns. One failed record cannot starve other tenants; use fair cursors/last-checked times, bounded batch/concurrency and persisted retry/review reasons.

### Cancellation, late outcomes and refunds

PP-D22–24 choose fixed per-quote AMD deposits, immediate charging and no automatic pre-payment holds. PP-D25–27 resolve Aveline-only confirmation scope, an ADMIN-set deposit deadline, and honoring late payments only when accepted terms/required availability remain fulfillable; otherwise full refund. PP-D28–30 resolve single balance collection, refund authority and zero-total booking approval. PP-D31 requires ADMIN-written per-quote cancellation/refund terms and ADMIN review against them. PP-D32–33 resolve accepted amendment/deposit-credit rescheduling and integrated-card-only sales payments. PP-D38 resolves overdue balances as notices plus ADMIN review without automatic cancellation/suspension. Fiscal correction rules remain pending accountant input. Ticket policy D5 is not automatically inherited by a service booking.

Persist cancellation intent and prevent contradictory fulfilment while evaluating its payment result, under the approved resource/booking policy. Claim refund allocation before any bank call using existing `PaymentsService.refund`; expose an unknown outcome as pending/manual review and never repeat an uncertain external refund under a fresh attempt. A definite bank refusal may release its claim under existing core behavior; only completed evidence advances the “refunded” notice/state. Partial refund arithmetic, tax/credit documents, cancellation fees and balance due come from accountant/commercial decisions.

The public generic `refundNonTicket` currently permits DEPOSIT-purpose refunds and existing refund listeners are best effort. Before new booking payments are exposed, route business cancellation/refund through the owning booking service, constrain generic refund bypasses for linked deposits, and add durable repair for money refunded outside the booking request. Changes must preserve historical subscription/ticket refunds and document any deliberate change to staff refund behavior. Payment listeners can accelerate updates but cannot be the sole correctness mechanism.

Rescheduling is an explicit revision/change-order operation, not editing Event.startsAt to rewrite the accepted commercial agreement. Existing invitation date correction/lifetime behavior remains in the Events service. Never automatically refund, reprice, reaccrue vendor commission or reuse customer consent merely because the event date changed.

### Security and API proposal

Proposed authenticated tenant/staff booking detail, start-deposit, confirm-deposit and cancellation commands derive identity and amount from the booking. Authorized external payer links, if the product chooses them, are separate narrowly scoped hashed capabilities with revocation/expiry and explicit payer-versus-contract-signer distinction. Existing guest/ticket/vendor credentials grant none of these rights. Return actionable `PAYMENT_PENDING`/`REVIEW_REQUIRED` states and safe recovery codes; never advertise success from the browser redirect. No API endpoints in this section are implemented.

Commercial access is not inherited from event coordinator/designer permissions. Read and write checks must distinguish seeing appointment/booking operational details from seeing prices, accepting terms, charging/refunding and seeing customer contacts. Staff view across tenants requires explicitly approved platform permission; organization selection alone must never grant access.

## 7. Concurrency, history and privacy across all three features

Proposed lock order, to reconcile with commerce/operations before implementation: idempotency claim → authorized organization/sales case/booking root → quote root/revision → resource reservation rows in stable ID order → obligation/attempt/allocation rows → fiscal number row → domain transition/notice intent. Acquire only rows needed by that command; read-and-CAS alone suffices for simple nonfinancial edits. Payments/refunds have their own short core transactions and are invoked outside held business locks; do not introduce a reverse lock edge via callbacks. Shared privacy locking must be designed with `eraseSubject` before conversion/settlement can copy subject snapshots.

Canonical request fingerprints exclude transport-only changing fields but bind actor/scope, source revision, payer/subject IDs, catalogue lines, amounts, currency and intended action. Reusing a key for changed intent is conflict. Bounded retry handles serialization/deadlock errors only where no uncertain external effect occurred. A message failure cannot roll back an accepted quote, captured payment or booking confirmation.

Domain transitions needed for acceptance/accounting stay in Postgres with restrictive write paths and provenance. Keep free-text contacts in erasable records, not replicated into immutable JSON indiscriminately. Fiscal/acceptance evidence retention and restricted redaction exceptions need reviewed policy; do not declare every record undeletable. DSAR export/erasure, correction, queued-notice cancellation, generated-document revocation and backup retention must be designed before each feature's public use. New event deletion logic must refuse/remove/link sales history under approved policy, rather than cascading away captured money via organization/event deletion.

## 8. Jobs, operations and performance

PP-D21 requires automatic issue/replacement/acceptance emails to the named quote approver; PP-D20 keeps consultation communication manual. Use a transaction-written `SalesNoticeIntent` with unique business-transition/template/recipient identity, subject privacy revision and minimal payload; a bounded dispatcher calls `CommunicationsService.enqueue` with deterministic dedupe key, then records linkage. If a crash happens after enqueue but before linkage, replay finds the same Message. `checkBeforeSending` revalidates quote/booking truth, recipient permission/suppression and privacy revision; add business-reference metadata or a verifiable lookup rather than relying only on toAddress/eventId for several notices to the same customer. Redact contacts/content at erasure and keep only approved structural evidence.

Use existing job/check-in conventions for sales obligation reconciliation, notice repair, quote expiry and agreed retention sweep. Expiry is also checked inline on acceptance; a stopped sweep cannot permit accepting an expired offer. Claims/leases/retry budgets and operator review clocks are persisted. Alert on oldest unresolved capture/refund/attempt, unmatched amounts, notice lag, dead workers, sweep failure and retention backlog; log only safe IDs, no tokens, contact bodies or provider credentials. Real provider tests, alerts and restore checks remain separate deployment gates.

Queue/detail/catalogue/quote actions fetch bounded projections, aggregate counts in Postgres and parallelize independent reads. No N+1 customer/vendor/component fetches. Draft/issue/accept/conversion are short transactions; PDF/large export work is a worker job. Propose p95 targets for approval: <500 ms staff queue/detail, <300 ms non-provider quote/booking mutation on the declared realistic fixture; separate external bank latency from internal settlement and measure after implementation. They are engineering targets, not a production capacity claim. Run measured load separately from builds/tests and preserve existing invitation/RSVP latency gates.

## 9. Migration and rollout

1. Add new tables and optional relations without rewriting existing applied migrations. Reuse existing organization/event IDs, but do not fabricate enquiries, acceptances, paid bookings or consent from VendorBooking/Payment rows. Historical DEPOSIT-purpose payment rows remain unallocated and require reviewed mapping; never auto-confirm a booking from the enum alone.
2. For added columns on populated tables: nullable → safe bounded backfill where evidence exists → validate/restrict. Use additive constraints and tenant-consistent foreign keys; test against populated pilot fixtures, not only empty schema. Add real query indexes and unique intent/allocation guards before enabling writes. Historical fiscal/party information of unknown provenance remains explicitly unknown.
3. Generate SQL with `prisma migrate diff` without a real database as shadow. Review locks/backfill cost and deploy compatibility before applying anything. Never edit applied migrations or reset a real database.
4. Register read-only/disabled sales modules first, then staff intake after access/retention approval, quotes after offer rules, fake deposit end-to-end after payment contracts, and live deposit only after commercial/provider/accounting acceptance. Configuration disabling must stop new intents, not silently drop settlement/refund of already accepted money.
5. Roll back application enablement/route exposure while keeping additive tables, immutable accepted evidence and pending payment repairs. Do not down-migrate away obligations, acceptances or provider outcome history. Define repair/runbook ownership and test restart/redeployment/restore of pending obligations and notice intents.
6. Update PRODUCT_SPEC, ACCESS_CONTROL, API, backend README/OpenAPI, DATA_MODEL/ARCHITECTURE and TODO/BACKLOG in the implementation commit. Proposed endpoints remain confined to design docs until they exist. Frontend contract work is additive and preserves the pilot screens; locale negotiation, display errors and pending/retry states follow existing API conventions.

## 10. TDD and acceptance matrix

| Layer | Distinct responsibility / required cases |
|---|---|
| Unit | Pure approved state transition tables and role matrix; canonical intent fingerprints; integer quote/deposit calculations from reviewed examples, including boundaries/overflow/rounding; translation fallback; expiry and display/recovery derivation |
| Integration | Real tenant-consistent FK/unique constraints; atomic conversion and invitation-intent rollback; concurrent assignment edits; quote issue/accept/withdraw/expiry races; two revisions accepted simultaneously; obligation/idempotency fingerprint conflicts; concurrent initiation/callback/sweep/cancel/refund claims; wrong amount/currency/purpose/tenant evidence refusal; partial/unknown refund allocation; crash after each persistence/external-call boundary and durable repair; erasure versus conversion/acceptance/settlement/notices; populated migration preserves all pilot records |
| HTTP | Authentication and exact platform/tenant/resource permission boundaries, including SUPPORT denied finance unless explicitly approved; foreign IDs; validation field paths, bounds and no silent coercion; stable list/detail response shapes; expected-revision and changed-key conflicts; pilot paid refusal before financial writes; bank redirect cannot confirm; safe external capability handling only if chosen; en/ru/fr/hy errors/pending/recovery and private/no-store document reads |
| Rehearsal | Local fake-provider complete enquiry→quote→deposit→booking→cancel/unknown-refund→repair flow; restart worker and interrupt bank/storage/mail; snapshot privacy/restore; isolated realistic queue/quote/settlement load; controlled real bank/provider evidence only after direction and capability certification |

Fixtures include multiple tenants, pre-account prospects, one and later multiple organizations, contacts with no email/unsupported channel, erased contacts, literal formula-like notes, Armenian/Cyrillic/French/Latin names, stale quote forms, different currencies, bank amount mismatch and a captured deposit without browser return. Tests cannot assume unsupported tax/refund policy; gate those scenario fixtures on the resolved decision register. Unit and independent local work may run concurrently; integration and HTTP tests share guarded `aveline_test` and must run sequentially unless isolated guarded databases are explicitly configured. Full `cd backend && npm run verify` is required per implementation slice.

## 11. Proposed vertical delivery slices and decision gates

| Slice | Concrete deliverable | Gate / parallelism |
|---|---|---|
| S0 — contracts/decision examples | Intake access/retention schema, quote/customer/event identifiers, shared fiscal/obligation/tenant interfaces, approved transition examples | Starts now as design; no product policy fabricated. Coordinate with commerce and F38 before migrations |
| S1 — staff intake and privacy | Enquiry queue/detail/create/edit/assignment plus DSAR export/redaction and optimistic revisions | First useful implementation with minimum intake decisions confirmed; independent of bank, tax, F40 and F38 completion |
| S2 — consultation and conversion | Appointment tracking and explicit idempotent conversion into existing/selected organization/event with durable invite intent | Workflow confirmed in PP-D07–09; keep no-money and no-publication behavior explicit |
| S3 — catalogue and quote drafts | Event-type × component catalogue, bounded draft lines and validated integer snapshots | Can start alongside S1/S2 after link/catalogue contract; fiscal issue stays blocked on F35 rules |
| S4 — issued offers/acceptance | Immutable issued revisions, selected acceptance identity, withdrawal/expiry, acceptance and durable notice intent; private documents if required | Needs offer/approval/signatory/retention rules. No deposit/provider dependency for nonpayable offer workflow |
| S5 — fake deposit settlement | Sales booking + obligation/attempt, amount-evidence validation, claim-first capture allocation, missing-return settlement and repair; pilot charge guard preserved | Needs S4, approved deposit/late/cancel rules, commerce fiscal/attempt contract. No real-money operations |
| S6 — cancellation/reschedule/recovery | Approved refund/correction/change-order behavior, generic refund bypass prevention, durable post-refund repair and operations runbooks | Depends on approved cancellation/rescheduling/accounting examples; unknown outcomes never automatically paid twice |
| S7 — paid acceptance | Certified bank flow, actual amount/currency/status checks, controlled end-to-end outcomes, operator alerts/recovery and frontend acceptance | Separate explicit direction/acceptance; `PILOT_MODE` is not disabled by this plan |

No elapsed-time delivery promise is made until S0 rules and S1/S4 implementation evidence constrain estimates. Each slice has its own small schema/API change, TDD and documentation update; do not wait to merge all sales features as one unreviewable batch.

## 12. Decision status and supplied values

The product interview is complete. Implement the exact sales rules in
[PP-D01–38](DECISIONS.md), uncertain-refund behavior in PP-D57 and operational
retention classification in PP-D58; do not re-request those decisions.

- ADMIN configures actual catalogue components/prices, permitted custom amounts,
  named approvers, expiry/deposit/balance deadlines and accepted cancellation/
  amendment terms through the reviewed workflows before issue.
- Provider specification, one-step amount/reference/currency evidence and
  certification remain external prerequisites for real card payments.
- Fiscal examples, correction documents and accepted evidence retention remain
  accountant/expert inputs. No statutory duration or tax rate is invented.
- Source-specific lock order, bounded DTOs, exact API transport and notification
  intent shape are implementation choices to reconcile with parallel streams.
- No public intake, automatic consultation messages, account-free offer
  acceptance, fractional quantities or manual cash/transfer payment marking is
  added by the initial sales scope. Existing pilot flows remain available.

**Not yet built:** all S1–S7 sales features above. This artifact is a code-grounded implementation design only; existing provider primitives and concierge setup do not satisfy F39/F40/F33 acceptance.
