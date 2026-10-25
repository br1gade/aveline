# Post-pilot backend delivery plan

Prepared **25 October 2026** (Asia/Yerevan), against `eb77cd4` with verified
pilot backend `99121d2`. This session starts the implementation work requested
for F31–F44. It does not approve paid operation or close pilot acceptance.
[TODO.md](TODO.md) remains the execution handoff; [BACKLOG.md](BACKLOG.md)
retains feature IDs. The groupings below refine PP1–PP7 without assigning dates.

## 1. Audit of the starting implementation

| Scope | What exists | What remains |
|---|---|---|
| PP1 / F35 | Provider registry, hosted redirect adapters, reconciliation, refund claims, invoice numbering and captured price lines | Actual bank specification/certification; invoice tax and accountant-approved document rules |
| PP2 / F31, F32, F34 | Organization subscription selection and first-period invoice/payment settlement; free plans; monthly/yearly/PER_EVENT interval enum | Event-bound purchase records and fulfilment, add-on catalogue, renewal, consent, dunning and retry/cancellation policies |
| PP3 / F39, F40, F33 | Staff concierge creates an organization/event; vendor bookings have operational states; payment purpose supports deposits | Enquiry/consultation records, component catalogue, versioned quotes, acceptance and deposit-to-booking linkage |
| PP4 / F36, F43 | Vendor booking fee/currency, fee-read permissions, private/curated directory and scoped brief links | Referral accrual/settlement accounting, payout execution, listing-fee purchase/renewal and commercial rules |
| PP5 / F37, F38 | Organization/event memberships, branded media, one subscription per organization | Corporate contract lifecycle and allocations; explicit organization selection throughout authorization and invitations |
| PP6 / F44 | Seeded template catalogue, constrained themes/blocks, synthetic and event preview serializers | Authoring, review/publication/versioning and safe treatment of existing invitations |
| PP7 / F41, F42 | Vendor bookings/briefs, event venues/timeline, durable export workers and unified ticket/guest admission | Availability/conflicts, delivery/print orders, staff scheduling, paper-ticket distribution and offline admission policy |

Code anchors: [billing](../backend/src/modules/billing/subscriptions.service.ts),
[payment registration](../backend/src/modules/payments/payments.service.ts),
[provider registration](../backend/src/modules/payments/payments.module.ts),
[concierge](../backend/src/modules/organizations/concierge.service.ts),
[organization creation](../backend/src/modules/organizations/organizations.service.ts),
[authorization](../backend/src/infra/auth/auth.guard.ts),
[vendor bookings](../backend/src/modules/vendors/vendors.service.ts),
[template editing](../backend/src/modules/design/design.service.ts) and
[domain schema](../backend/prisma/schema.prisma).

Important distinctions from the audit:

- `PER_EVENT` currently changes the subscription period to an indefinite one;
  it does not bind a purchase to an event. F31 is still unbuilt.
- `bindingRef`/`bindingProvider` and `PAST_DUE` exist in the schema; no card
  binding flow or renewal/dunning scheduler implements them.
- `VendorBooking.feeMinor` is an entered fee, not an accrued referral ledger
  or proof of money paid to a vendor. Existing booking confirmation is not
  evidence of a deposit.
- Membership currently has a unique user constraint, and organization-scoped
  requests resolve a single membership. Removing that constraint alone would
  make billing/team actions ambiguous. F38 requires an explicit scope contract.
- Template records are referenced by existing invitations. Editing a shared
  template in place would affect published events; versioning needs a decision.
- `taxMinor = 0` means tax is unimplemented, not a decision that customers or
  transactions are tax exempt. No tax/legal assertions are established here.

The audit found stale wording in PAYMENTS §8 saying nothing charges at all;
first-period subscription charging already works outside pilot mode. That
section is corrected with this batch. This plan describes proposals, not new
HTTP endpoints.

## 2. Decisions still required

The user confirmed on **25 October** that **bank choice and tax treatment are
undecided**. Keep them open. Credentials belong in private deployment settings.

| Decision | Input needed before dependent implementation |
|---|---|
| Bank/provider | Actual specification, merchant/test access, amount/status mapping, refund uncertainty handling, callback authentication and certification; one-step/two-step and card-binding authority |
| Tax and invoices | Jurisdiction/seller identity, accountant-reviewed inclusive/exclusive examples, exemptions, rounding level/rule, required buyer/seller fields, numbering, credit/void/refund and retention treatment |
| Packages/add-ons | Catalogue and prices/currencies, per-event ownership, quantities, upgrades, fulfilment and refunds; relation to organization subscriptions and captured invitation lifetime |
| Renewals | Explicit billing consent and evidence, method binding/revocation, billing anchor/proration, retry schedule, grace period, cancellation/reactivation, notifications and failed-payment recovery |
| Intake and quotes | Required fields/contact channels and consent, spam/access controls, staff ownership/statuses, component catalogue/prices, revision/expiry/approval and acceptance evidence |
| Deposits | Full charge versus authorization, fixed/percentage calculation, what is reserved and when, partial payments/balance, expiry/late payment, cancellation/refund/reschedule policy |
| Vendor revenue | Who owes whom, accrual trigger, margin basis, tax, payout timing/approval/rail, failed/unknown transfers, reversals/refunds and listing-fee terms |
| Corporate/multiple organizations | Contract examples, signers/roles, term/renewal, event allowances/branding, payer and invoice allocation, membership/switching/invitation/default-organization behavior |
| Authoring | Author/reviewer roles, template examples, supported rendering/assets/fonts, draft/review/publication/version behavior and opt-in upgrades for existing events |
| Physical operations | Calendar ownership/timezone, holds/conflicts, fulfilment partners/states, print approval, staff roles, paper credential handling and offline scan/conflict reconciliation |

These are unanswered post-pilot questions, in addition to the already decided
D1–D38 pilot decisions. The session also asked which commercial workflow should
follow groundwork; no answer is recorded yet. Do not infer consent or financial
policy from published tier descriptions or an enum.

## 3. Dependency-aware implementation order

| Slice | Depends on | Delivery and acceptance boundary |
|---|---|---|
| PP1a — local financial preconditions | Existing validate-before-write rule | Refuse unconfigured subscription providers before invoice issue/replacement; preserve old invoice, subscription, payment and number counter; real-DB and HTTP regression evidence |
| PP1b — provider acceptance | Bank decision/access | Match actual sandbox fields/amount/statuses; exercise duplicate/late/unknown payment and refund outcomes. Local fake tests do not certify a bank |
| PP1c — invoice tax | Accountant examples | Snapshot agreed fiscal data/rates, deterministic integer calculations and correction/refund documents; safe legacy migration and reconciliation examples |
| PP2a — event packages/add-ons | Catalogue, PP1c document contract | Event-bound orders, captured prices and fulfilment; idempotent checkout/settlement/refund; preserve organization subscription and pilot behavior |
| PP2b — recurring billing | Consent/lifecycle, PP1b/c, bank method binding | Consent evidence and revocation first, then durable renewal claims/invoices, bounded retries and notices; prove concurrent workers cannot charge twice |
| PP3a — enquiries/consultations | Intake fields/roles/privacy decision | Intake and staff follow-up without taking money or automatically creating a confirmed booking; permission, validation, retention and four-language errors |
| PP3b — component quotes | Catalogue/version decisions and agreed enquiry/customer/event links; quote engine can run in parallel with PP3a | Draft/revised quotes, captured component prices, expiry and explicit acceptance; stale/concurrent acceptance cannot change the agreed quote |
| PP3c — deposits/bookings | PP3b, deposit policy and PP1b/c | Captured/authorized evidence drives only the approved booking transition; browser redirects never confirm; cover late settlement, cancellation and unknown refunds |
| PP4a — referral accounting | Existing vendor bookings and vendor agreements; PP3 linkage only if agreed accrual terms require it | Ledger/accrual/approval/reversal before disbursement; immutable settlement evidence and restricted fee reads |
| PP4b — listing fees / payout execution | Listing fees need inbound billing/tax contracts and listing terms, independently of PP4a. Referral payouts need PP4a and a separately supported payout rail | Separate listing purchase lifecycle from referral money; idempotent claims, reconciliation and unknown payout handling before external transfers |
| PP5a — multiple organizations | Explicit switching/membership contract | Additive scope selection, tenant isolation, invitations and safe legacy defaults before removing the single-membership constraint |
| PP5b — corporate contracts | Corporate examples; multi-organization access integrates after PP5a, fiscal billing after PP1c | Versioned accepted terms, branding and event/billing allocations with contract-scoped permissions |
| PP6 — template authoring | Authoring/version decisions | Reuse existing validation and preview; drafts/review/published versions; existing invitations remain deterministic under the chosen upgrade policy |
| PP7a — availability | Calendar owner/conflict policy; PP3 when service holds share the same calendar | Timezone-aware intervals, transactional conflict/hold handling and scoped vendor access |
| PP7b — physical fulfilment | Operator examples; calendar conflicts integrate with PP7a only where shared resources apply; paid orders integrate with agreed quote/package billing | Delivery/print/staff state machines; snapshot approvals and scoped briefs; paper/QR fallback builds on existing admission and privacy rules |

Independent lanes after their decisions: PP3a, PP5a and PP6 can proceed while
bank/accountant work remains open. PP7 workflow design can proceed independently;
financial fulfilment depends on its quote/booking contract. Corporate terms may
be designed before PP5a, but multi-tenant implementation must follow PP5a.
Prioritize the next lane with the product owner; do not force every nonfinancial
slice to wait for bank certification. No delivery dates are committed before
these decisions and the first end-to-end slice in the chosen lane.

Every slice follows red → green → refactor, populated-data-safe migrations,
API/README/OpenAPI updates in the same change, and full sequential verification.
Integration and HTTP suites share guarded `aveline_test`; run them sequentially.
Run measured load separately. Reassess estimates and dependencies after each
accepted vertical slice rather than treating feature sizes as commitments.

### Dependency map and parallel delivery

Refined **25 October 2026** after reviewing the existing modules. Distinguish
three kinds of dependency: a prerequisite needed to finish an integrated flow,
a shared contract that can be agreed before either side is implemented, and a
commercial gate needed before real-money use. None makes an unrelated feature
wait for an entire batch to finish. All new workflow/financial rules in §2 still
need decisions; independence does not resolve those decisions.

| Feature | Implementation / integration dependency | Can develop in parallel with |
|---|---|---|
| F39 — enquiry/consultation intake | Existing staff/tenant access; agreed fields, workflow and retention | Every other feature; agree the quote link with F40 first |
| F40 — component quotes | Catalogue, captured prices, version/acceptance rules; agreed links to customer/event/enquiry | F39; draft quote engine does not require completed intake or bank acceptance. Fiscal totals integrate with F35 |
| F33 — deposits confirm bookings | Accepted quote for the quoted-engagement flow, booking transition contract and payment settlement; final fiscal integration with F35 | Quote/payment-independent booking validation can be prepared earlier; completed flow joins F40 and payments |
| F35 — invoice tax | Accountant-approved rules/examples and invoice snapshot/correction contract | Bank adapter acceptance, intake, quotes, tenancy, design and operations |
| F31 — event package purchases | Agreed catalogue/order/settlement contract, existing event/payment core and fiscal integration | F32, F34 and sales; no dependency on enquiry intake |
| F32 — add-ons | Same agreed commerce contract; item/quantity/fulfilment/refund rules | F31; package linkage is conditional on whether add-ons require a package, which is undecided |
| F34 — renewal/dunning | Existing subscriptions plus consent, binding, renewal invoice and retry rules | F31/F32; event packages are not a prerequisite |
| F38 — multiple organizations | Explicit organization selection, membership/invitation and legacy-default contract | All feature engines; agree selection early so new org-scoped APIs do not need redesign |
| F37 — corporate contracts | Contract/version rules; F38 for multi-organization access and agreed fiscal contract for billing | F38 for contract drafting/storage; complete multi-org integration follows F38 |
| F44 — template authoring | Existing template constraints/preview; author/reviewer and immutable-version/upgrade rules | All other features; print integration may consume its versioned designs later |
| F41 — vendor availability | Existing vendor bookings; calendar ownership/timezones, holds/conflicts | Intake, quotes, billing, tenancy, design and vendor accounting |
| F42 — logistics/print/staff/paper tickets | Split into independent subfeatures below | Other lanes and its own subfeatures after their interfaces are agreed |
| F36 — referral accounting/payouts | Existing vendor bookings and commercial accrual rules; ledger before payout execution | F41 and F43. F33 is needed only if agreed accrual depends on its deposit/booking transition |
| F43 — vendor listing fees | Listing lifecycle/terms and inbound billing/fiscal integration | F36; collecting a listing fee does not require paying a referral |

**Split F42 before assigning work:** paper/QR distribution builds on existing
tickets, admission and manifest exports; it does not require F41 or F44. Its
distribution/privacy/offline policy still needs agreement. Logistics and staff
tracking can begin with existing events/vendors; conflict enforcement joins F41
only for resources using that calendar. Paid print orders join the chosen
quote or package/add-on purchase flow. Design-based print generation consumes
an approved design/snapshot contract; F44 is needed only if that workflow uses
newly authored template versions. Existing export workers need not be rebuilt.

**Suggested parallel lanes:**

1. Sales: F39 and F40, then integrate F33 when quote and payment rules are ready.
2. Commerce: invoice/tax contract F35 and bank acceptance independently; F31/F32
   share one order contract, while F34 uses the existing subscription lifecycle.
3. Tenancy/corporate: F38, with F37 contract drafting in parallel and multi-org
   access/billing integration afterwards.
4. Design: F44 using existing previews and renderer constraints.
5. Operations: F41 plus separate F42 paper-ticket, logistics, print and staffing
   slices; join calendar and commercial flows only where their rules require it.
6. Vendor revenue: F36 ledger/accrual and F43 listing fees independently; payout
   execution follows its ledger and separately approved banking support.

With four implementation streams, start sales, commerce, tenancy/corporate and
design; add operations/vendor revenue as capacity or partner decisions allow.
This is a proposed allocation, not authorization to start agents or new chats.
First agree the organization-scope, invoice/order, quote/booking and template
version interfaces. Shared contracts require short coordination, not completion
of every feature on either side.

**Commercial gates:** actual charges for deposits, packages, add-ons, renewals,
listing fees and corporate invoices require the applicable bank acceptance,
accounting rules and paid-operation approval. Recurring billing additionally
requires supported binding/consent. Vendor payouts require their own supported
transfer rail; card acquiring does not establish payout capability. Local fake
payment integration can progress independently of bank certification, once the
relevant business rules are confirmed. No tax calculation is guessed while tax
rules remain undecided. Keep `PILOT_MODE` guards throughout.

**Integration constraints:** parallel contributors use separate branches/worktrees.
Coordinate shared Prisma schema, permissions, API/OpenAPI and billing changes;
order/review migrations together without modifying applied migrations. Merge
and verify integrated changes sequentially. The current integration/HTTP suites
share guarded `aveline_test`, so they must never run concurrently across lanes;
parallel database suites require separately configured guarded test databases.
Measured load remains separate from builds/tests. Unit tests and independent
implementation can run in parallel.

## 4. First implementation batch and its limits

PP1a implements only the confirmed local precondition: provider registration
must exist before committing a paid subscription intent. No bank request is made
by preflight. It does not verify credentials, reachability, certification or
permission to charge; failures after contacting a configured bank remain under
the existing payment/reconciliation behavior.

The HTTP status stays `404` for an unconfigured provider. The error now precedes
invoice creation/number allocation or replacement of an existing payable invoice.
No response field is removed or retyped and no migration is needed. The central
pilot charge guard still takes precedence (`403`), and free plans need no
provider. Regression tests cover all three unconfigured real-bank enums, both a
first invoice and a rejected replacement of an existing invoice; HTTP covers the
status/message and absence of committed billing records.

Verification on 25 October: the six new integration regressions first failed
on committed invoice writes/replacement, then passed after the fix. Full
`cd backend && npm run verify` passed zero-warning lint, docs, generated OpenAPI
(157 paths), build, 10 pilot helpers, **1,195 unit / 516 integration / 662 HTTP
tests** (2,373 across the three layers). The focused billing runs also passed
25 integration and 22 HTTP tests. Final documentation edits passed `docs:check`.
No migration, measured load, bank certification or external rehearsal was needed
or performed for this slice. The reviewed batch is recorded in Git on
`codex/post-pilot-backend`; the original `main` checkout remains clean.

F35 and all other commercial features remain open; PP1a is groundwork, not a
completed tax feature.

## 5. Preserved release boundaries and remaining work

Keep the free pilot and `PILOT_MODE` guards; paid acceptance is a separate human
decision. Preserve en/ru/fr/hy, attendance/reconfirmation, captured invitation
lifetime, fixed export snapshots, guest capabilities, privacy and retention.
Any required API rename/removal/type change needs an explicit frontend cutover.
Do not introduce plan-limit enforcement without revisiting its deferred decision.

Native F22 remains explicitly deferred until the user selects a provider and
reopens it. Later platform candidates in TODO are not part of this delivery plan.
Frontend integration/human language and print review, real providers, hosting/TLS,
off-host backup acceptance and operator alerts remain pilot launch gates. No paid
accounts, real sends, live charges or external deployment are authorized here.

## 6. Three-agent production implementation design

The user requested three parallel planning agents on 25 October 2026. The
resulting documents are implementation proposals, not shipped API contracts or
approval of unresolved policy. They cover all fourteen F31–F44 features:

| Design owner | Feature scope | Detailed plan |
|---|---|---|
| Sales and bookings | F39, F40, F33 | [Sales and bookings](post-pilot/SALES_AND_BOOKINGS.md) |
| Commerce and vendor revenue | F35, F31, F32, F34, F36, F43 | [Commerce and vendor revenue](post-pilot/COMMERCE_AND_VENDOR_REVENUE.md) |
| Organizations, design and operations | F38, F37, F44, F41, F42 | [Organizations, design and operations](post-pilot/ORGANIZATIONS_DESIGN_AND_OPERATIONS.md) |

Each design separates existing code, proposed engineering and undecided product
rules. Schema names, routes, states, error codes and delivery slices are proposals
until implemented, reviewed and reflected in API.md/OpenAPI. The plans preserve
the pilot and its outstanding external/frontend acceptance work.

### Shared contracts and ownership

| Interface | Owner and consumers | Integration requirement |
|---|---|---|
| Organization context and permissions | Organizations owns; every new org-scoped feature consumes | Select and authorize a concrete organization per request; event resources derive tenant from event. Remove all arbitrary first-membership assumptions before allowing multiple memberships. SUPPORT's current non-billing role must not gain price/payment access implicitly |
| Commercial terms and fiscal documents | Sales owns accepted quote versions; commerce owns fiscal snapshots/invoices | Pass immutable accepted lines, currency and quote revision/digest to commerce. Compute approved tax once at the agreed boundary; never recompute accepted terms from a mutable catalogue or treat a quote as a legal invoice |
| Payment intent, evidence and settlement | Commerce owns common payment integration; each selling domain owns its resulting transition | Persist and fingerprint payer/tenant/resource/purpose/amount/currency intent. Validate provider evidence and settle the owning domain once. Do not infer amount proof from CAPTURED alone or refund completion from a claimed Payment status |
| Booking and calendar reservation | Sales owns customer booking; operations owns resource occupancy | Customer bookings are distinct from VendorBooking. Agree claim/hold identity and combined lock order before joining a deposit to a calendar; booking confirmation must not race a conflicting resource claim |
| Template/design/print snapshot | Design owns versions/capabilities; print consumes approved snapshots | Templates may select only layouts the renderer actually supports. Published versions and print approvals retain exact inputs; current invitation lifetime/export snapshots must not be silently rewritten |
| Durable notification intent | Domain owner writes intent; communications delivers | Current enqueue API is not caller-transaction-aware. Persist recoverable intent with business writes, then enqueue using a stable dedupe key and repair scan, or first implement/review a transaction-aware enqueue boundary. No provider call while domain locks are held |

The proposed organization selector in the platform plan is optional
`X-Aveline-Organization-Id`: validate membership each request, retain the single-
membership fallback, and reject ambiguous multi-membership requests without
a selector. This is a concrete frontend/product proposal awaiting a decision,
not a header already accepted by the API. Event tenancy remains resource-derived.

Commerce's concrete proposed exchange contracts are `IssueInvoiceFromSource`,
`VerifiedPaymentEvidence`, `ConfirmedRefundEvidence`, `FulfilPaidLine` and
`AccrueReferralFromSource`. Their candidate fields are in the commerce plan;
consumers must agree these shapes before adding competing source/evidence tables.
A proposed COMMERCE payment purpose serves package/add-on/listing orders;
SUBSCRIPTION and DEPOSIT keep their distinct domain owners. Enum deployment and
legacy invoice-source isolation precede new writers; names remain proposals.

Module-specific notice-intent names in the plans are illustrative: converge on
one small transaction/replay contract before implementing several competing
outbox adapters. Domain owners retain their recipient/privacy and repair rules.
Local lock sequences are proposals too; reconcile their combined lock graph with
existing admission/attendance/refund/worker locks and test opposing operations
before adopting them. Do not assert a global order just from these documents.

These contracts coordinate domains; they do not require a general event bus,
new database service or one universal workflow framework. Extract a shared
implementation only when actual consumers justify it. Keep authoritative state
in Postgres and critical claims protected by database constraints/transactions;
Redis scheduler locks are not a financial correctness boundary.

### Concrete audit prerequisites for new commercial flows

- PaymentGateway currently has register/status/refund/cancel methods; capture,
  stored-method binding, recurring debit and vendor transfer are not implemented
  capabilities. Each needs selected-provider evidence and a dedicated contract
  before use. Acquiring does not establish payout support.
- PaymentsService.start currently replays an existing key without a generic
  intent fingerprint. Ticket checkout adds its own fingerprint; new domains
  must obtain the same changed-intent protection at their owning boundary.
- PaymentsService.confirm currently maps provider outcomes to statuses without
  validating the captured/authorized amount against intent. New paid-flow
  acceptance must cover mismatches and unverifiable evidence explicitly.
- A thrown registration call currently becomes FAILED even when the external
  outcome may be unknown. New attempt recovery must distinguish explicit refusal
  from an unobserved result, and must not retry a possible charge under a new key.
  No merchant-reference lookup or provider idempotency guarantee is assumed.
- Subscription settlement reads billing interval from mutable Plan today. New
  invoices/renewals need purchased interval/period terms captured immutably.
- Refund totals/status are claimed before the provider call. A completed refund
  record or equivalent verified evidence, not a claimed REFUNDED status alone,
  must trigger completion notices/reversals.
- MoneySweepService currently settles ticket orders and subscriptions only;
  deposits, commerce orders and listing purchases need their own durable
  recovery/settlement paths.
- Organization changes affect AuthGuard, AccountService invite acceptance,
  EventsService.creatorRole and ConciergeService customer lookup, not only the
  membership unique constraint. New permissions must be reviewed explicitly.

These are observed implementation limitations to address and test before the
new paid features rely on them. This planning pass did not reproduce incidents,
change payment behavior or approve existing providers for production.

### Delivery waves and review gates

1. **Agree contracts and policies:** organization selection/roles; fiscal and
   immutable commercial terms; quote acceptance and booking/resource ownership;
   renderer/template versions; notification intent. Gather the relevant product
   decisions in each detailed plan. No accountant/provider rule is invented.
2. **Build independent internal slices:** staff intake, draft quote engine,
   organization-context compatibility, contract drafts, template drafts/preview,
   availability primitives, operational tracking, referral accrual proposals and
   listing catalogue. A feature starts only after its own required rules are
   decided; it need not wait for unrelated banks or workflows.
3. **Integrate local domain flows:** accepted quotes/bookings, package/add-on
   orders, renewal claims, listings and fiscal documents using confirmed rules
   and fake providers. Join resource conflicts and design/print approvals where
   the chosen workflow actually requires them. Test duplicate/late/unknown
   outcomes, tenant isolation and privacy alongside the happy path.
4. **Prove production operation:** populated-data migrations, feature flags,
   historical compatibility, leased worker recovery, private-file access,
   monitoring/alerts, recovery rehearsals, four-language frontend acceptance and
   representative performance. New financial flows additionally require actual
   provider/accountant evidence and explicit paid-operation approval.

Use separate implementation branches/worktrees per accepted slice; the current
coordination branch is `codex/post-pilot-backend`. One integration owner orders
shared schema/permissions/payment changes and the resulting migrations. No
parallel integration/HTTP runs against shared `aveline_test`; use separately
configured guarded stores or serialize them. Run measured load separately from
builds/tests. Native F22 and entitlement enforcement remain deferred.

### Decision review batches

Resolve these in small workstream-specific batches, before their dependent
implementation, rather than asking for every roadmap decision at once:

- **Sales first slice:** staff visibility/financial separation, required intake
  fields and retention. Then catalogue/pricing, quote authority/acceptance and
  deposit/change/refund examples before those flows become payable.
- **Commerce:** accountant-reviewed fiscal examples and bank capability evidence;
  catalogue fulfilment/refund rules; renewal consent/retry rules; vendor accrual,
  listing and payout terms. These financial decisions remain undecided.
- **Organizations/design:** selector/invitation/owner behavior, corporate parties/
  signers, private/global templates, author/reviewer publication and version
  adoption. The proposed header contract is ready for review.
- **Operations:** actual resources/calendar owners/conflict rules; independent
  paper distribution and online/offline admission choice; staff/logistics access
  and print proof/production-release policy.

The detailed plans include the full decision registers. No unresolved tax rate,
retention duration, billing consent, refund promise or vendor entitlement is
made a default by this design package.

### Safest first implementation candidates

- **Without new commercial policy:** commerce C1 captures newly purchased invoice
  interval/source terms and tests a catalogue interval edit between issue and
  settlement. Historical unknown terms stay unknown. C2 then strengthens payment
  ownership/evidence/uncertainty before the new paid flows depend on it.
- **After minimum intake decisions:** sales S1 implements staff-only enquiry
  queue/edit/assignment with privacy support. Draft quote catalogue work can run
  alongside it once the shared link contract and catalogue rules are agreed.
- **After selector/version decisions:** platform F38 starts selector compatibility
  while the current membership constraint remains; F44 can start legacy version
  pinning and private draft preview. Neither needs live banking.

This planning batch changes documentation only. The three agents reviewed source
and wrote design artifacts; no product code, migration, provider call, database
write, real send, charge or deployment was performed. Documentation consistency,
relative links and Git whitespace are checked after assembling the package;
functional suites are not rerun for unchanged product code.
