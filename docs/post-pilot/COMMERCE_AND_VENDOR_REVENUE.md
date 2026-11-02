# Commerce and vendor revenue — implementation design

**Decision precedence:** confirmed choices and explicitly delegated defaults in [DECISIONS.md](DECISIONS.md) supersede unresolved alternatives in this proposal. All other options remain proposals until answered.

Planning proposal prepared **25 October 2026** against `eb1b6e2` on
`codex/post-pilot-backend`. Covers **F35, F31, F32, F34, F36 and F43**.
Nothing in this document is a shipped API, a tax determination, an approved
commercial policy or permission to charge/pay anyone. Bank choice and tax
treatment are explicitly undecided. The free pilot remains free.

## 1. Confirmed boundaries and audited starting point

The governing sources are [product](../PRODUCT_SPEC.md),
[payments](../PAYMENTS.md), [access](../ACCESS_CONTROL.md),
[API](../API.md), [TODO](../TODO.md), [backlog](../BACKLOG.md) and the
[delivery plan](../POST_PILOT_IMPLEMENTATION_PLAN.md). Follow the repository's
[feature workflow](../../.claude/skills/feature/SKILL.md).

| Existing code/model | Reuse | Limit relevant to this plan |
|---|---|---|
| `backend/src/modules/payments/payments.service.ts`: `start`, `confirm`, `refund`, `reconcile`, `onRefunded` | Database idempotency claim, monotonic transitions, claim-before-refund and bounded/fair payment polling | New commercial source ownership, intent fingerprint, registration uncertainty and durable purpose settlement are not implemented |
| `backend/src/modules/payments/providers/payment-provider.ts`: `PaymentGateway` | Hosted register/status/refund/cancel boundary and integer money conversion | There is no capture command, stored-card binding API, recurring debit API, merchant-reference lookup or payout API |
| `backend/src/modules/billing/subscriptions.service.ts`: `subscribe`, `issueInvoice`, `markInvoicePaid`, `applyPaidPlan`, `endRefundedPlan` | Free plan, first paid period, delayed plan application, cancellation/resume and D19 full-refund behavior | Organization subscription only; tax is zero, invoice creation privately embedded, no renewal scheduler/consent flow |
| `backend/src/modules/billing/invoice-number.ts`: `nextInvoiceSequence` | Counter update and invoice issuance in one transaction | Existing annual series is application behavior, not accountant approval for every future legal document |
| `backend/src/modules/billing/billing-period.ts`: `periodAfter` | UTC month-length clamping and existing first-period behavior | `PER_EVENT` becomes an indefinite subscription period, not an event purchase; PP-D40 now defines period-end anchoring and no automatic backlog catch-up |
| `backend/src/infra/jobs/money-sweep.service.ts`: `reconcilePayments` | Reconcile then settle the owning domain | It explicitly settles only ticket orders and subscriptions; new purposes will not fulfil themselves |
| `backend/src/modules/communications/communications.service.ts`: `enqueue`, `enqueueMany`, `checkBeforeSending` | Durable messages, deterministic dedupe keys, suppression/quota and last-minute applicability checks | `enqueue` uses injected PrismaService, not a caller's TransactionClient; current method cannot promise atomicity with a billing transaction |
| `backend/src/modules/exports/export-queue.ts`: `claim`, `ownedExport`, `renew`, `fail` | Reference for Postgres claim/lease/fencing and bounded attempts | Reuse the pattern, not export tables or export-specific retry counts for money movement |
| `backend/src/modules/vendors/vendors.service.ts`: `book`, `updateBooking`, `cancelBooking` | Existing organization/private versus curated vendors and operational bookings | `feeMinor` is an editable agreed fee, not referral debt, accrual, settlement, transfer evidence or vendor inventory |
| `backend/prisma/schema.prisma`: `Invoice`, `Payment`, `Refund`, `Subscription`, `VendorBooking` | Existing financial history and compatibility fields | One subscription per organization; binding columns are unused; no order/renewal/referral/listing lifecycle |

Confirmed constraints: amounts cross the API as integer minor-unit strings;
Postgres owns correctness; external calls never execute under long database
locks; capability secrets stay out of logs; preserve en/ru/fr/hy, snapshot
exports, attendance/reconfirmation and captured invitation lifetime. Existing
SUPPORT/concierge access does not grant billing access. Native F22 and general
plan-limit enforcement remain deferred. No provider is considered certified
because its adapter is merely registered.

### Audit findings that must shape implementation

1. `PaymentsService.start` returns an existing global idempotency key without
   comparing its organization, amount, currency or source intent. New workflows
   must validate a canonical owner fingerprint before using that result.
2. `start` currently catches every registration error as terminal `FAILED`.
   A provider may have accepted registration before transport/local persistence
   failed. New debit flows must model that uncertainty and never interpret a
   timeout or expired worker lease as permission to charge again.
3. `ProviderOutcome` carries authorized/captured `amountMinor`, but `confirm`
   maps outcomes to status and `extraFieldsFor` does not retain/validate that
   amount. Currency is not part of current normalized status evidence. A new
   financial flow must validate source/reference/amount/currency evidence,
   extending the adapter contract where the bank actually supplies it. A bank
   that cannot establish the required evidence is an unresolved acceptance gate.
4. Refund claims increase `Payment.refundedMinor` and may set `REFUNDED` before
   the bank call completes. Use confirmed `Refund.COMPLETED`/equivalent provider
   evidence for fiscal corrections, debt reversals and 'money returned' notices,
   not the payment status alone.
5. `onRefunded` is an in-memory map with one listener per purpose; errors are
   logged after external money movement. It is insufficient as the sole trigger
   for a guaranteed new fiscal/fulfilment/reversal effect.
6. `applyPaidPlan` reads a mutable Plan interval when settlement occurs. Capture
   purchased billing terms for new invoices/cycles; later catalogue edits must
   not change what a pending invoice buys. Do not guess historical terms.
7. `settleCapturedInvoices` scans invoice/payment rows without a commercial
   source discriminator. Extend/scoped settlement before introducing non-plan
   invoices; package/listing/deposit invoices must not activate subscriptions.

These are design prerequisites discovered by code inspection, not changes made
in this planning task. Existing behavior stays compatible until separately
implemented and tested in a reviewable slice.

## 2. Shared financial contracts — agree before parallel implementation

Commerce owns invoice issuance/calculation, payment evidence and purpose
settlement contracts. Sales owns accepted quote and booking meaning; tenancy
owns organization selection; fulfilment owns service completion. Do not create
a generalized accounting/workflow platform in advance of these concrete flows.

### Proposed models and invariants

| Proposed aggregate/table | Minimum persisted facts and constraints | Real query/index |
|---|---|---|
| Invoice additions and captured billing terms | Nullable source kind/id or typed source relation, calculation version, captured line/fiscal metadata, seller/buyer snapshots where approved, purchased period/interval for new billing; retain current public fields | Source identity unique where one issuance is intended; organization + issue time/id for paging; existing status/payment lookup retained |
| `CommerceProduct` / immutable `CommerceProductVersion` | Stable key, PACKAGE/ADD_ON/LISTING kind, translated description, event applicability, active offer version; price/currency and approved fulfilment/tax references captured on version | Product key unique; active catalogue ordering; version unique per product |
| `CommerceOrder` / `CommerceOrderLine` | Organization, optional event, version, owner intent key/fingerprint, currency, immutable priced lines and fiscal totals, status, source refs, timestamps | Unique organization + request key; organization + createdAt/id history; status + next action time for sweeps; composite tenant/event agreement |
| `CommercePaymentAttempt` | Order/invoice association, unique attempt number and payment link, immutable amount/currency/provider/intention, registration/submission evidence, safe failure/unknown state, lease owner/expiry for pending work | Order + attempt number unique; payment id unique; due state + nextCheckAt/id |
| `CommerceFulfilment` | Line + fulfilment action/version, payment evidence, status, external service/print ref only when applicable | Unique line + action/version prevents duplicate fulfilment; status + nextAttemptAt for worker |
| `BillingNoticeIntent` | Source event/version, template key, recipient identity reference, locale, applicability, dispatch/dedupe identity; no capabilities or unnecessary guest data | Unique source effect + recipient + template; pending + dueAt/id |
| Durable settlement receipt/effect | Typed purpose/source + payment/refund evidence id + effect kind, transactionally applied result | Unique source + evidence + effect kind; unresolved + dueAt/id |

Names and exact schema are engineering proposals, not committed domain terms.
Use typed FKs/composite tenant constraints for correctness-critical relations;
do not rely only on free-form source IDs. Keep financial documents/order lines
immutable after issue/acceptance; corrections reference prior evidence instead
of overwriting it. Mutable workflow status remains separate from money facts.
Do not silently convert existing Plan rows into products or assign old payments
to new source types without reliable provenance.

### Commands and evidence exchanged across streams

- **Accepted quote → invoice/order:** immutable quote revision, seller/customer
  organization references, optional event, priced line snapshots, currency,
  approved calculation/version and permitted deposit/balance terms. Commerce
  validates tenant/currency/totals; sales cannot send arbitrary payable totals
  from a browser. Quoted custom prices require the approved quote authority.
- **Payment evidence → source settlement:** evidence identity, unique payment,
  source purpose/id, organization/event, expected and observed amount/currency,
  verified provider reference, captured/authorized timestamp and normalized
  outcome. Only the owning source applies its transition; authorization alone
  must not be treated as capture. Any authorization-based booking requires an
  explicit product choice and supported provider operations.
- **Confirmed refund → source correction:** unique refund evidence, original
  payment/source and confirmed amount/currency. Finance chooses the approved
  correction document rule; sales/fulfilment chooses service cancellation.
- **Organization context:** resolved selected organization and live permissions,
  not a caller-supplied tenant id trusted on its own. F38 changes selection;
  all finance commands must already accept explicit resolved context internally.
- **Fulfilment request:** immutable paid line and action/version, organization,
  event and minimal service metadata. F42 can consume print/logistics work;
  payment acceptance is not proof that work was delivered.
- **Vendor accrual input:** stable booking/source event identity and version,
  commercial agreement version and financial evidence if the agreement requires
  it. No guessing accrual from mutable `VendorBooking.status` alone.

Proposed named interface shapes for cross-stream review:

| Contract | Fields owned by the issuing stream |
|---|---|
| `IssueInvoiceFromSource` | resolved organization; typed source kind/id/revision; accepted immutable lines/currency; approved calculation reference; idempotent issuance key |
| `VerifiedPaymentEvidence` | evidence/payment ids; typed owner source; organization/event; expected and observed amount/currency; provider/merchant reference; observed outcome/time |
| `ConfirmedRefundEvidence` | refund/payment/source ids; confirmed amount/currency/time; original evidence and provider reference |
| `FulfilPaidLine` | unique order-line/action/version; captured product/quote revision; event/organization; minimal approved delivery inputs |
| `AccrueReferralFromSource` | source event id/version; booking/agreement version; financial evidence only if required by agreement; derived amount/currency/direction |

Propose one new `PaymentPurpose.COMMERCE` for F31/F32/F43, with a typed order
owner, while retaining SUBSCRIPTION for renewal and DEPOSIT for sales bookings.
The exact enum name is an integration decision; do not put every new purpose
under OTHER and register multiple competing in-memory listeners. A dedicated
commerce refund command must own its fulfilment/correction effects; extend the
generic refund guard for new purpose ownership rather than bypassing it.

### Transaction and provider boundary

Proposed common write ordering for new commercial intents:

1. Validate complete payload, live authorization, active offer/accepted revision,
   pilot guard and local required provider capability before financial writes.
2. In one short transaction, take a scoped request-key claim; compare fingerprint
   on replay; lock organization/source root, then order/invoice/cycle root in a
   consistent order; lock invoice counter last if issuance is needed. Persist
   domain intent, immutable terms, payment association/claim and notice/settlement
   intent together. Use database uniqueness/conditional transitions as backstop.
3. Commit, then call the provider. The public compatibility `PaymentsService.start`
   may delegate to a split claim/register implementation; a new transaction-aware
   internal claim API is required rather than calling its current network flow
   inside the transaction. Only the successful claimant may submit.
4. Persist normalized evidence before applying fulfilment; settlement transaction
   locks source root, then payment/refund evidence and unique effect record. The
   sweeper repeats it safely after HTTP failure or process death. Review exact
   locks with existing subscription/refund paths to avoid reversed-order cycles.
5. An expired lease fences writes by the old worker but does not establish that
   a provider call never happened. Recover by provider reference/merchant id or
   certified idempotent lookup where supported. Otherwise park `OUTCOME_UNKNOWN`
   for restricted reconciliation; never submit a new debit/transfer blindly.

New domain ids must be linked to payment claims before provider calls to close
'bank accepted but source never learned its payment id' windows. Do not treat
Redis JobLock as a financial uniqueness guarantee. Postgres claims remain
correct across overlapping schedulers, Redis failures and worker restarts.

For invoices, keep counter allocation + issuance atomic. Do not hold the counter
lock across a bank call or PDF render. Snapshot all amounts/terms before leaving
it. Failed creation rolls back the counter; issued document correction follows
the accountant's chosen rules rather than deleting/reusing filed numbers.

## 3. F35 — invoice tax and paid-launch groundwork

**Delivery:** extend the current invoice issuer into a narrow billing service
used by subscription, package/add-on, listing and accepted-quote flows. Reuse
current `Invoice` and numbering where appropriate; do not start an unrelated
invoice system. Public current fields remain strings with the same meanings.

**Required decisions before calculation:** seller jurisdiction/identity,
applicable customer/service/location rules, inclusive/exclusive prices,
exemptions and evidence, allowed currencies, rate effective dates, line versus
invoice rounding, rounding mode, discounts/deposits treatment, required invoice
fields, correction/void/credit/refund documents and financial retention.
Accountant-reviewed input/output examples are the acceptance fixtures. No rate,
legal classification, rounding rule or retention period is supplied here.

**Proposed design:** represent a rate as integer numerator/denominator and retain
remainder until the explicitly chosen rounding boundary. Use BigInt throughout;
never infer tax from a float or label. Persist calculationVersion, applied rate
facts/reasons, taxable base, net/tax/gross per line and document totals. Validate
that line/document totals reconcile under that algorithm. A zero tax amount
must distinguish unimplemented legacy data from an approved zero/exemption
reason; preserve historical zero invoices without relabeling them as exempt.

Issue a complete immutable fiscal snapshot in the same transaction as its
number/source linkage. Later seller, buyer, price, rate or catalogue changes
cannot rewrite it. Draft edits use expected version; issued corrections create
linked evidence under the approved accountant policy. Do not blindly apply the
legacy subscription 'full refund → VOID' rule to every future tax document;
keep D19's subscription access behavior while representing its approved fiscal
correction separately.

**Proposed API additions, not shipped:** owner/authorized finance reads for
invoice calculation provenance and correction history; a private finance
preview/issue operation consumed by domain workflows, not a public arbitrary
charge endpoint. New fiscal fields are additive and old invoices can report
`LEGACY_UNASSESSED` provenance without invented historical rates. Restrict buyer
and seller sensitive fields separately from operational vendor views.

**Slices:** (a) captured purchased interval/source provenance for newly issued
invoices and regression coverage; (b) approved example-driven pure calculation;
(c) transaction-aware issuance/source ownership; (d) correction/refund evidence;
(e) private document generation only if required, reusing durable worker/storage
patterns. Bank certification is independent of pure tax calculation but remains
necessary before paid launch.

## 4. F31/F32 — event packages and add-ons

PP-D57 additionally resolves free published catalogue claims, reviewed downgrades/post-delivery changes, no automatic proration and uncertain-refund reservation/affected-fulfilment behavior.

Confirmed in [PP-D34–37](DECISIONS.md): OWNER/ADMIN catalogue purchases in AMD;
one base package per event; explicitly priced ADMIN-approved upgrades; per-add-on
prerequisites/standalone eligibility; ADMIN-reviewed whole/line/amount refunds
under pre-purchase terms. Catalogue/prices/terms are versioned, with actual values
configured later. The unresolved alternatives below are narrowed by that register.

**Delivery:** one targeted CommerceOrder aggregate for these concrete purchases,
not an organization subscription with a PER_EVENT interval. Event remains owned
by its organization. A package purchase records the event and purchased tier/
service terms; an add-on line records actual quantity and delivery requirements.
PP-D36 makes this an explicit per-add-on ADMIN catalogue rule.

**Proposed states:** DRAFT/PRICED → AWAITING_PAYMENT → PAID, with CANCELLED/EXPIRED
for unpaid intents and separate fulfilment/correction/refund progress. State
names are candidates; do not encode refund uncertainty as definitely refunded
or service delivery as simply paid. Changing an unpaid cart means a new priced
revision and a deliberate new attempt, not mutating what an existing bank order
can pay. Acceptance after quote/offer expiry, partial payment and upgrades need
explicit policy before enabling those transitions.

Order creation validates same-event/organization links, allowed line kinds and
bounded unique lines/quantities. Server loads all offer versions in one query,
calculates totals and captures descriptions/prices/currency and fiscal terms.
Use database checks for positive quantities/nonnegative price totals, consistent
currency, unique positions and tenant-linked event/order relations. Discounts or
coupons are not automatically extended from ticket PromoCode to commerce; that
is separate pricing scope. Product retirement blocks new intents but never
rewrites existing orders.

**Settlement:** verify purpose/source/amount/currency before conditionally moving
the order from its payable state. Write one fulfilment effect per line. A paid
package may record its purchased capabilities but must not activate deferred
plan-limit enforcement or silently recalculate an invitation's already captured
lifetime. If the purchase should extend published guest access, that needs an
explicit separate policy and migration/API design. An unrelated subscription
plan change cannot void package invoices.

**Refund/cancellation:** order-level command owns payment and service effects;
prevent generic finance refunds from bypassing required service reconciliation.
No assumed 'whole order only' rule: current ticket whole-order policy does not
automatically govern add-ons. PP-D37 approves reviewed whole/line/amount refunds, and PP-D35 approves explicitly
priced ADMIN-reviewed upgrades. Agree tax correction, completed-service treatment
and any downgrade rules before those transitions are enabled. Freeze conflicting
fulfilment/financial actions while a refund has unknown outcome; do not assert
refund completion until evidence exists. Scope that freeze to the relevant
financial/service intent, not unrelated event operations.

**Proposed API additions, not shipped:** event commerce catalogue; create/read
priced order; order checkout/confirm; cancel/refund under approved rules;
fulfilment summary. Reads use an envelope with bounded cursor pagination.
Writes carry idempotencyKey plus expected order/offer version. Responses expose
money strings, localized captured line labels and safe payment/fulfilment state;
never bank tokens, raw payloads or vendor settlement amounts. Return changed
intent/stale version as conflict; validation names the field. Keep current
subscription/ticket endpoints unchanged and document any intentional cutover.

**Slices:** catalogue/version reads → server-priced draft order → fake checkout
with durable payment association → evidence-based paid/fulfilment settlement →
approved cancellation/refund integration → real provider acceptance. F31/F32
can run together against the agreed order contract; F39 and F34 are independent.

## 5. F34 — renewal and dunning

Confirmed in [PP-D39–43](DECISIONS.md): OWNER opt-in only, period-end anchoring,
no automatic missed-period backlog charges, ADMIN-configured bounded retry/grace
terms before consent, exhausted attempts stop in PAST_DUE with ADMIN review,
preserved guest access/captured lifetime, and fresh consent for changed prices
or material terms. Existing cancel-at-period-end and D19 behavior remain.

**Delivery:** extend existing organization Subscription rather than routing
renewals through event packages. Existing subscriptions must not silently
become consenting recurring customers. Existing bind-reference columns are not
proof of usable payment method, authorization, correct merchant or consent.

**Proposed records:**

- `BillingConsent`: organization, actual authorizing user, consent statement/
  commercial terms version, method/provider/merchant scope, captured agreement,
  accepted/revoked clocks and revocation generation. Keep necessary evidence
  only; exact evidence and retention need approval.
- `StoredPaymentMethod`: organization/provider/merchant, protected opaque binding
  ref, status and consent relation; no PAN/CVV or bank credentials. Restrict its
  reads to the payment adapter, never serialize the ref to the client or logs.
- `RenewalCycle`: subscription, agreed target period start/end, captured plan
  price/interval/tax/terms, invoice and attempt ids, dueAt/nextAttemptAt,
  status/version; unique subscription + target period, indexed due state/time.
- `RenewalAttempt`: unique cycle + attempt number, payment link/submission key,
  consent generation, normalized outcome and lease/fencing metadata. Provider
  calls and ambiguous outcomes retain their own immutable attempt identity.

**Proposed process:** bounded scheduler claims a due cycle under a subscription
lock after checking pilot guard, live method/consent, cancellation and agreement
version. It creates the cycle/invoice once. A debit-capable adapter submits after
commit. Captured evidence atomically pays the cycle and applies exactly its
captured period; concurrent manual payment/worker/callback cannot advance it
twice. Do not start a renewal period from 'now' or charge multiple missed months
without an approved anchor/catch-up policy. MONTHLY/YEARLY can be eligible;
PER_EVENT must never renew merely because its synthetic end date changes.

For definite declines, persist outcome and next attempt from the approved
retry/grace policy. Proposed lifecycle ACTIVE → PAST_DUE → ACTIVE after recovery,
or approved terminal cancellation/expiry. PP-D41–42 resolve a configurable bounded retry/grace policy and exhausted
PAST_DUE/ADMIN-review outcome without automatic guest-access restrictions; actual
retry/grace values must be configured before opt-in and live debit.
Unknown outcomes pause new debit attempts pending reconciliation. A technical
worker retry is not a business payment retry; never let a queue's maxAttempts
multiply charges.

Cancellation/revocation races use the same subscription/consent lock order as
claiming. Recheck consent immediately before submission; define an auditable
linearization point for an already authorized in-flight attempt and expose its
outcome honestly. Revoking future consent cannot retroactively establish that
an external debit did not happen. Decide refunds for that case rather than
inventing them. Preserve current cancel-at-period-end semantics and D19; a
refund of an old cycle must not cancel a newer paid period.

**Provider gate:** the existing PaymentGateway has no binding/recurring debit
methods. Add small capability-specific ports only after chosen provider docs
establish binding, consent reference, idempotent submission, lookup/revocation
and notification support. Unsupported capability fails before creating a payable
renewal attempt. Ordinary hosted redirects are not unattended recurring debits.

**Proposed API additions, not shipped:** owner method-binding initiation/confirm,
consent display/accept/revoke, renewal history and manual recovery checkout.
Provider callbacks verify native authenticity where used. Browser redirects are
never evidence of binding or payment. New notice templates support en/ru/fr/hy;
financial notices use the billing contact policy, not an arbitrary event guest.

**Slices:** explicit consent/method state (no charges) → unique cycle generation
with fake clock → deterministic notices → fake recurring gateway/uncertainty
recovery → approved lifecycle policy → provider binding certification and paid
acceptance. No dependency on F31/F32, F36 or template authoring.

## 6. F36 — referral accounting and payout execution

[PP-D55](DECISIONS.md) confirms both receivable vendor fees and vendor payables, explicitly directed per ADMIN-approved versioned agreement. ADMIN controls settlement, commercial data stays private and outbound transfers remain disabled pending verified provider support. Actual fee/trigger/settlement values are configured per agreement.

**Delivery:** a vendor payable subledger for actual referral agreements, separate
from the mutable booking fee. First establish who owes whom; a referral margin
could be receivable from a vendor rather than payable to one. The backlog's
'payouts' label must not silently choose the direction. PP-D55 approves both explicit directional workflows; no general-purpose
accounting engine or implicit netting/transfer policy is required.

**Proposed records:** `VendorCommercialAgreementVersion` captures direction,
basis/rate or fixed fee, currency, accrual/eligibility/cancellation evidence and
approved settlement terms. `ReferralAccrual` identifies agreement version,
booking/optional accepted-quote/payment source, trigger identity and amount.
`VendorLedgerEntry` is append-only with source/effect uniqueness; reversals link
the original entry instead of editing it. `VendorSettlement` groups same-vendor,
same-currency eligible entries and an approved statement. `PayoutAttempt` holds
unique settlement/attempt key, destination-version reference, provider/reference,
amount/currency, claimant/fence and uncertain/confirmed evidence.

Scope organization-owned vendors to their organization and curated partners to
explicit platform authority. Existing `vendor:fee:read` permits viewing a fee,
not bank details or authorizing transfers. New accrual/settlement/payout actions
need explicit permission decisions; SUPPORT currently cannot access billing.
Separate destination maintenance, approval and execution when the approved
operating model requires it; do not assume two-person approval is already policy.
Protect destination data and verify changes by the chosen operator procedure.

**Accrual:** lock booking/agreement and financial source in a documented order;
validate agreement/time/source evidence and insert one accrual per unique trigger.
Later booking fee/status changes cannot rewrite an accrued amount. F33 is only
a dependency if agreement terms accrue at its confirmed deposit/booking event;
F41 availability is not required. Cancellations/refunds reverse according to
contract terms, not an assumed percentage. Unknown refunds cannot yet prove a
reversal basis requiring money returned.

**Settlement/payout:** atomically reserve eligible ledger entries against one
settlement; conditional claim prevents concurrent payout batches using them
twice. Provider call occurs after claim commit. Proposed evidence states are
PREPARED → APPROVED → SUBMITTED → CONFIRMED, with explicit REJECTED and UNKNOWN;
PP-D55 gives ADMIN approval/settlement authority under versioned agreement terms. UNKNOWN does not
release entries or allow a fresh transfer. Reconcile against the original
transfer identity; actual returned transfers create reversal evidence. Keep
inbound acquiring and outbound transfer ports separate.

**Proposed API additions, not shipped:** restricted vendor statement/accrual
reads, agreement version preparation/approval, settlement preparation/approval,
payout initiation and reconciliation evidence. No vendor/public brief exposes
these records. Claims/refusal/unknown outcomes are auditable without raw
bank-account details in logs or API errors.

**Slices:** agreed directional contract → evidence-derived accrual and statements
without transfers → approved reversal rules → settlement reservations → sandbox
transfer adapter and unknown-outcome drill → separately approved real payout.
F43 listing fees can proceed independently. No gateway payout capability is
assumed from Visa/ArCa acquiring credentials.

## 7. F43 — vendor listing fees

[PP-D56](DECISIONS.md) confirms ADMIN-managed AMD agreements, explicit payer/term/placement/refund terms, named-representative signed-in acceptance, activation of only the approved listing service, manual renewal and safe expiry that preserves bookings/briefs. No initial vendor-specific billing portal; automatic listing renewal is a deferred expansion.

**Delivery:** a listing commercial lifecycle attached to a vendor/directory
listing, separate from referral debt and existing `Vendor.active` eligibility.
Do not overload `active` so an unpaid listing makes a booked vendor disappear
from its existing event briefs or private organization roster.

**Proposed records:** `VendorListingAgreementVersion` captures payer/customer,
vendor/listing identity, term, placement/service purchased, renewal/cancellation
and refund terms. `VendorListingTerm` captures purchased start/end boundaries,
commerce order/invoice and paid evidence, plus publication/eligibility state.
Use unique agreement + term identity, listing/term lookup and due expiry indexes;
reject overlapping terms only where the commercial rules require exclusivity.

Treat the payer as an explicitly authorized billing principal. Vendors currently
have scoped event brief capabilities, not billing accounts. Decide whether a
vendor receives a real owner account/organization or only staff-managed billing;
never let an existing brief token purchase, cancel or read invoices. F38 is
needed only if the selected payer/account workflow requires multiple orgs.

Use the shared CommerceOrder/fiscal service with LISTING lines, or the same
narrow checkout contract if the final aggregate naming differs. Payment evidence
activates only the purchased term/placement. Keep public publication separately
approved/moderated if that is chosen; do not promise directory promotion simply
because payment succeeded. PP-D56 makes purchased placement/term explicit in the ADMIN-approved agreement; no new ranking algorithm is implied.

Expiry processing is bounded, checks captured term/version and changes only
paid visibility rights. Cancellation/refunds preserve history and follow the
listing agreement. Automatic listing renewal is not silently included: if
required, it depends on F34's approved consent/method/cycle capabilities; a
manual next-term purchase does not. F36 is never a prerequisite.

**Proposed API additions, not shipped:** authorized listing offer/term/history
reads, checkout/confirm, cancellation and staff publication controls. Existing
vendor read/brief shapes stay compatible; new listing summaries expose no
payer contacts, prices reserved for finance or settlement bank details.

**Slices:** payer/access decision → agreement/term snapshots → fake shared
checkout → paid-term activation/expiry → cancellation/corrections → optional
consented renewal. Run in parallel with referral ledger development.

## 8. Authorization, privacy, localization and operational behavior

New financial writes use live organization OWNER/platform ADMIN permissions
unless a new role grant is explicitly approved. Quote/concierge actors may
receive only operational facts needed by their approved workflow; financial
invoice totals, tax ids, method refs and vendor bank destinations are not
included through that route. F38's selected-organization contract must be used
consistently by lists, mutations and worker intents. Recheck source ownership
and user eligibility where a delayed command applies; system billing authority
must be a captured valid consent/agreement, not a stale user token.

Extend privacy export/erasure matching to billing contacts, commercial parties
and notice queues with approved financial retention exclusions. Do not erase
required fiscal evidence or retain unnecessary contacts by default; both need
a concrete policy. Revoke future consent/method use on eligible account closure,
stop pending non-applicable notices and redact non-required personal fields.
Restoration must preserve revocations, ledger/settlement claims and unknown
attempts so a replay cannot re-enable billing or pay a vendor twice. Invoice
attachments use private authenticated delivery and retention appropriate to
financial documents, not the guest snapshot export's automatic seven-day TTL.

All new DTOs bound money string length, line/quantity counts, date ranges,
filters/page sizes, free text and metadata. Page histories by stable timestamp+
id; aggregate balances/counts in Postgres; no unbounded per-invoice network or
N+1 queries. UI errors expose stable codes plus en/ru/fr/hy display copy through
existing locale negotiation. Capture customer-facing contractual text/version
and locale when agreed; translating a later catalogue must not alter a filed
invoice. External provider response descriptions are not public error copy.

Use `BillingNoticeIntent` created with the source transaction; a bounded dispatcher
renders/enqueues with deterministic keys after commit and records the result.
A repair sweep revisits pending intents after process crashes. Delivery remains
at-least-once as in CommunicationsService; never claim exactly-once external
email delivery. Notices recheck payment/cancellation/consent applicability and
configured suppression rules. Do not treat email delivery failure as permission
to create another financial attempt.

Add monitored sweeps for due orders, captured-but-unsettled payments, unknown
attempts, renewal cycles, listing expiry and pending vendor settlements. Keep
bounded batches, fair ordering, per-item failure isolation, statement/transaction
timeouts and lease fencing. Record counts, oldest age, safe failure class and
latency; alerts/runbooks cover missing sweeps, stale claims, unavailable provider,
settlement lag, fiscal mismatch and unknown transfer. Never log raw bindings,
bank destinations, capability tokens or contacts. Manual reconciliation requires
restricted evidence-bearing commands; no operator's database edit is the plan.

## 9. Migrations, rollout and recovery

1. Add new tables and nullable source/provenance/term columns; leave existing
   payment/invoice/subscription response fields untouched. Add tenant/FK and
   amount/uniqueness constraints appropriate to actual proposed queries.
2. Classify legacy sources only from reliable FKs (`planId`, subscription links,
   typed orders), preserve uncertain rows as explicit legacy cases. Do not parse
   a human description to invent purchased intervals, consent, tax treatment,
   vendor debt or method ownership. Produce bounded operator review counts.
3. Backfill in bounded restartable batches and validate constraints/indexes
   against a populated migration fixture. Introduce NOT NULL only after reliable
   new-write coverage/backfill; leave irrecoverable historical fields nullable.
   Enum/schema deployment must be reader-compatible before writers use new
   purpose values. Review migration lock duration on realistic data.
4. Deploy read-compatible schema/readers, then dark new writers/workers. Keep
   new paid purposes, recurring submissions and payouts disabled, in addition
   to PILOT_MODE. These are operational cutover controls, not entitlement rules.
5. Rehearse fake/sandbox full lifecycles, uncertainty recovery and restoration.
   Enable only an agreed cohort/feature after provider/accountant/product
   acceptance. No real account creation, external sends, charges or deployment
   occurs as part of this planning task.
6. Roll back by disabling new initiation/schedulers, retaining compatible readers
   and financial facts, and continuing reconciliation of in-flight attempts.
   Do not drop paid history or roll an unknown provider effect back to 'unpaid'.
   Already submitted money must be reconciled under its recorded terms.

Generate new SQL with safe Prisma diff and review it; never edit an applied
migration, reset real databases or use them as shadow databases. Coordinate
schema/OpenAPI/permissions ownership across parallel streams; merge migrations
sequentially. Update API/README/OpenAPI and governing product/access/payment/
data-model/store/runbook documents with behavior when it actually ships.

## 10. TDD and production acceptance

| Layer | Deliberate coverage |
|---|---|
| Unit | Approved tax calculation domain sets/rounding boundary and reconciliation; immutable offer/cycle fingerprints; transition tables; period/catch-up/cancel policy once supplied; permission matrix; safe outcome classification; notice applicability; no framework/getter tests |
| Integration | Tenant composite constraints; counter rollback/concurrency; payment intent linkage before external call; concurrent identical/different-intent retries; duplicate capture/refund/effect; invoice source isolation; mutable catalogue edits between issue/pay; cycle uniqueness and consent/cancel races; ledger/reservation/reversal concurrency; listing visibility independence; all-or-nothing writes and populated legacy migration |
| HTTP | Auth/permission and cross-organization boundaries, bounded DTO failures naming fields, idempotency/version conflicts, money strings/additive nullable legacy provenance, read model/envelope/pagination, protected invoice/method/destination fields, pilot refusal before financial writes and en/ru/fr/hy errors |
| Worker/fake-provider recovery | Crash before/after provider acceptance and before/after local commit; lost redirect; duplicate/out-of-order callbacks; long-lived unknown registration/debit/refund/payout; expired lease plus old-worker completion; Redis failure; one poison item; restart/restore with consent revoked and pending claims |
| Bank/accountant/operator acceptance | Actual amount/currency/reference mapping; authenticated callbacks if offered; selected bank certification; approved calculation/correction examples; binding/revocation/debit only when supported; separate transfer rail acceptance; recovery evidence and alerts reaching an operator |

Extend existing `backend/test/integration/billing.int-spec.ts`,
`payments.int-spec.ts`, `transaction-safety.int-spec.ts` and HTTP billing tests
where they cover existing behavior; add separate commerce/renewal/settlement
suites rather than putting every branch into old broad suites. Inject clocks
and fake gateways for dates and uncertainties; use real Postgres for claims,
constraints and concurrent transactions. Preserve current ticket late-payment,
refund and D19 tests. Do not run integration/HTTP lanes concurrently against
shared `aveline_test`. Run full `npm run verify` after every accepted vertical
slice; load measurements run separately from builds/tests.

Proposed new interactive local-read/write p95 budgets are <=300 ms excluding an
explicitly bounded provider call, with query/batch/memory counts recorded; agree
actual workloads before treating them as product commitments. Existing invitation,
RSVP/dashboard/arrangement budgets must not regress. Catalogue/quote pricing
must be bounded and served in one screen request. Bulk fiscal rendering or
statements belong to durable jobs, not a transaction/request CPU loop.

A feature is production-ready only when its financial invariants, layered tests,
populated migration, permission/privacy review, four-language frontend contract,
provider/accounting acceptance where applicable, operator alert/recovery evidence
and explicit paid-operation approval are met. Local fake tests are not bank
certification, and a merged schema is not consent to recurring debit.

## 11. Delivery sequence, parallelism and decisions

| Slice | Deliverable | Dependencies / independent work |
|---|---|---|
| C0 | Agree fiscal snapshot, typed source/evidence, org context and notice-intent contracts | Joint review with sales/tenancy; no commercial rule invented |
| C1 | New-invoice purchased-term snapshot and source-isolated settlement regression | Safe engineering groundwork; preserve unknown legacy terms; no tax/provider access needed |
| C2 | Durable payment association/fingerprint and evidence/uncertainty handling for new flows | Required before new paid workflows, can use fake provider |
| C3 | Example-driven F35 calculator/issuer/correction provenance | Blocks on accountant examples; bank acceptance proceeds independently |
| C4 | F31/F32 catalogue + server-priced orders + fake settlement/fulfilment | Product/quantity/refund choices and C0/C2; final fiscal integration C3 |
| C5 | F34 consent/method state and fake unique renewal cycles | Lifecycle/consent decisions and C0/C2/C3; independent of C4; live debit additionally needs provider capability |
| C6 | F36 agreement direction/accrual/statements, then reservation/transfer | Vendor terms; C0 evidence; no F43/F41 requirement; F33 linkage only if accrual rules need it |
| C7 | F43 payer/agreement/term + shared checkout/expiry | Listing/payer decisions and C0/C2/C3; no F36 dependency; auto-renewal only if agreed and C5 ready |
| C8 | Sandbox/certification and operator acceptance per paid purpose | Chosen bank/transfer rail, account/specification, prior feature acceptance; no bundled blanket enablement |

C1 is the safest first engineering slice because it makes the terms already
captured by an invoice govern its eventual first-period settlement, without
inventing prices, taxes or recurring consent. Write a failing regression that
changes Plan.interval between issuing/paying, snapshot new terms, and preserve
legacy behavior explicitly. If the business does not want that immutable-term
meaning, flag the conflict before implementation; do not silently reinterpret
old invoices. C2 is the next common prerequisite for production paid flows.

### Completed policy review and remaining configuration

Use [PP-D34–43](DECISIONS.md) for catalogue sales and renewals, PP-D55–57 for
vendor direction/listings/order exceptions and PP-D58 for retention classes.
The initial product interview is complete; broader historical alternatives in
this design do not require the user to approve the same policies again.

- **External finance inputs:** selected acquiring/recurring provider specs and
  certification; separate outbound transfer support; seller/jurisdiction and
  accountant-reviewed tax, corrections and financial/evidence retention.
- **ADMIN configuration:** actual offers/prices/prerequisites and versioned
  cancellation/upgrade terms, bounded retry/grace values and consent text,
  vendor fees/direction/accrual/settlement terms, listing payer/placement/term.
  Missing mandatory values block the affected sale/debit; do not invent defaults.
- **Engineering coordination:** transaction-aware payment claim/evidence/source
  settlement interfaces, finite money/quantity bounds, compatible enum rollout,
  deterministic workers and proof of recovered uncertainty.
- **Initial scope:** OWNER opt-in renewals only, no automatic backlog debit or
  unconsented price changes; listings renew manually; no automatic netting or
  transfer is inferred. General entitlement enforcement remains deferred.

Still not built: all six commercial features, their new models/APIs/workers,
the shared contracts proposed above and actual provider/accountant acceptance.
This document is the implementation design, not evidence those features exist.
