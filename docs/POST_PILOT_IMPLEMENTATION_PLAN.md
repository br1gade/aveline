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
| PP3b — component quotes | PP3a and catalogue/version decisions | Draft/revised quotes, captured component prices, expiry and explicit acceptance; stale/concurrent acceptance cannot change the agreed quote |
| PP3c — deposits/bookings | PP3b, deposit policy and PP1b/c | Captured/authorized evidence drives only the approved booking transition; browser redirects never confirm; cover late settlement, cancellation and unknown refunds |
| PP4a — referral accounting | Existing vendor bookings and vendor agreements; PP3 linkage only if agreed accrual terms require it | Ledger/accrual/approval/reversal before disbursement; immutable settlement evidence and restricted fee reads |
| PP4b — listing fees and payouts | PP4a, PP1b/c and payout/listing terms | Separate listing purchase lifecycle from referral money; idempotent claims, reconciliation and unknown payout handling before external transfers |
| PP5a — multiple organizations | Explicit switching/membership contract | Additive scope selection, tenant isolation, invitations and safe legacy defaults before removing the single-membership constraint |
| PP5b — corporate contracts | PP5a, corporate examples and PP1c | Versioned accepted terms, branding and event/billing allocations with contract-scoped permissions |
| PP6 — template authoring | Authoring/version decisions | Reuse existing validation and preview; drafts/review/published versions; existing invitations remain deterministic under the chosen upgrade policy |
| PP7a — availability | Calendar owner/conflict policy; PP3 when service holds share the same calendar | Timezone-aware intervals, transactional conflict/hold handling and scoped vendor access |
| PP7b — physical fulfilment | PP7a where scheduling applies, PP3 quotes, operator examples | Delivery/print/staff state machines; snapshot approvals and scoped briefs; paper/QR fallback builds on existing admission and privacy rules |

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
