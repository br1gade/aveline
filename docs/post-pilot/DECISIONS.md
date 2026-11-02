# Post-pilot product decisions

Updated **25 October 2026** (Asia/Yerevan). This is the decision register for
the interactive review of the three implementation plans. Decisions describe
intended behavior; they do not mean the corresponding feature is implemented.
Do not infer answers for other features or turn undecided financial rules into
defaults. Existing D1–D38 pilot decisions remain in [BACKLOG.md](../BACKLOG.md).

## Round 1 — enquiry intake, access and retention (F39)

| ID | Decision | Status / authority |
|---|---|---|
| PP-D01 | Initial enquiries are staff-entered only: operators record phone, messaging and in-person enquiries. No public intake form in the first slice | Confirmed directly by user |
| PP-D02 | ADMIN may see/manage all enquiries; SUPPORT may see/manage only enquiries assigned to them | Confirmed directly by user; creation/assignment/reassignment resolved in PP-D05 |
| PP-D03 | Clear enquiry contact details and notes six calendar months after the most recent closure. Reopening before cleanup pauses/cancels that deadline; a later closure starts a new interval. Already cleared information is never restored by reopening | User delegated the retention choice to the assistant; assistant selected this operational default |

PP-D03 applies to enquiry contact details, consultation notes and identifying
free text copied into enquiry activity/history or notice payloads, so the same
information cannot survive just because it was duplicated. It does not choose
retention for separately accepted quotes, contracts, fiscal documents, guest
records or backups; those policies remain separate. Verified earlier erasure
still follows the privacy workflow. Financial/accepted records must not be
silently deleted by the enquiry sweeper.

The six-month period is a product default for follow-up after a closed enquiry,
not a claimed legal retention period. Official guidance explains that GDPR does
not specify a universal duration for different types of data; purpose and any
applicable statutory obligations determine retention. See the
[Data Protection Commissioner's guidance](https://www.dataprotection.ie/en/faqs/responsibilities-data-controllers/how-long-should-personal-data-be-held-meet-obligations-imposed-gdpr).

## Round 2 — enquiry fields, assignment and workflow (F39)

| ID | Decision | Status / authority |
|---|---|---|
| PP-D04 | Contact name and at least one email or phone are required. Event type, approximate date/timezone, estimated guest count, preferred language, source and notes are optional | Confirmed directly by user |
| PP-D05 | A SUPPORT-created enquiry is automatically assigned to its creator. ADMIN handles reassignment; SUPPORT cannot transfer ownership through ordinary edits | Confirmed directly by user; assignment and authorization changes must commit together |
| PP-D06 | Enquiry stages are New, Contacted, Consultation, Ready for quote and Closed. Stages may be skipped; reopening is allowed. Closure requires a reason | Confirmed directly by user; these stages do not establish quote acceptance, payment or booking confirmation |

ADMIN-created enquiries can remain under ADMIN control; their initial operator
assignment will be explicit rather than silently giving an unrelated SUPPORT
operator access. Reassignment revokes the previous SUPPORT operator's access
and grants the new assigned operator access immediately. Contact validation and
bounds remain normal implementation choices; optional date-only requirements
are not converted into invented midnight booking timestamps.

## Round 3 — consultations, conversion and customer visibility

| ID | Decision | Status / authority |
|---|---|---|
| PP-D07 | Block overlapping scheduled consultations for the same operator | Confirmed directly by user; enforce atomically, not only through calendar preview |
| PP-D08 | Staff explicitly choose when to convert/link an enquiry into customer organization/event setup, including before quote acceptance or payment | Confirmed directly by user; conversion creates draft setup, not a confirmed paid booking |
| PP-D09 | Enquiry records and consultation notes remain internal after conversion. Customers see their issued quotes and booking information, not the enquiry record | Confirmed directly by user; customer-facing commercial access remains subject to its own permissions |

Existing D8 still governs reuse of an existing customer organization. When
multiple organizations become possible, staff must select the intended tenant
explicitly. Repeated conversion must not create duplicate setup or issue a
second owner invitation. Consultation cancellation releases the operator's
scheduled interval; no overlap rule is inferred for unrelated resource types.

## Round 4 — quote drafting, issue authority and pricing

| ID | Decision | Status / authority |
|---|---|---|
| PP-D10 | ADMIN and the assigned SUPPORT operator may see quote prices and prepare quote drafts. Customers access their own issued offers only | Confirmed directly by user; SUPPORT access remains bound to assigned enquiry/customer case, not arbitrary cross-tenant pricing |
| PP-D11 | ADMIN approval is required before every quote is issued to the customer | Confirmed directly by user; approval must cover the exact issued revision/terms |
| PP-D12 | Catalogue prices are defaults. Staff may propose custom prices or discounts in drafts, subject to ADMIN approval before issue | Confirmed directly by user; actual catalogue entries/prices can be configured through admin tools later |

These decisions grant quote-specific commercial visibility and drafting, not
general billing, refund authority, bank details or vendor settlement access.
Editing an approved draft requires approval of its new revision before issue;
ADMIN approval cannot be reused for different prices or terms. Reassignment
changes the assigned SUPPORT operator's quote access as well as enquiry access.

## Round 5 — sales quote currency, expiry and replacement

| ID | Decision | Status / authority |
|---|---|---|
| PP-D13 | New sales quotes use AMD only initially, one currency per quote/payment, with no automatic conversion | Confirmed directly by user; existing supported currencies in other payment/ticket/subscription flows are not removed |
| PP-D14 | ADMIN must set an explicit expiry date/time before issuing each quote | Confirmed directly by user; acceptance checks the stored deadline using server time |
| PP-D15 | A newly issued revision replaces the earlier unaccepted offer. Accepted terms change only through an explicit amendment | Confirmed directly by user; replacement/acceptance races must serialize on the quote root |

Draft edits do not replace an issued offer until the new revision is approved
and issued. A stale offer cannot be accepted after replacement or expiry. AMD
amounts remain integer dram strings. No policy for other product-line currencies
is inferred from the sales-quote choice.

## Round 6 — customer quote acceptance

| ID | Decision | Status / authority |
|---|---|---|
| PP-D16 | A customer approver is explicitly named for each quote; being an organization OWNER alone does not grant quote-acceptance authority | Confirmed directly by user |
| PP-D17 | Ordinary acceptance requires signing in to a customer account and explicitly accepting the exact offer; email/account is required. No account-free acceptance link in the initial scope | Confirmed directly by user |
| PP-D18 | ADMIN may record acceptance received outside Aveline only with the approving person's identity and a written-evidence reference | Confirmed directly by user; SUPPORT cannot use this exception |

Both acceptance paths must verify the named approver, exact current offer and
expiry/replacement rules. Store actual acting ADMIN separately from the
customer approver for externally recorded acceptance; never impersonate a
customer session. This records commercial acceptance, not a claim of certified
legal electronic signature. Private evidence visibility/retention follows the
separate accepted-record policy, still to be decided.

## Round 7 — quantities and customer notices

| ID | Decision | Status / authority |
|---|---|---|
| PP-D19 | Quote quantities are whole numbers only initially; no fractional hours/days | Confirmed directly by user; AMD prices/totals remain integer dram strings |
| PP-D20 | Staff handle consultation confirmations, changes and reminders manually; no automatic consultation messages initially | Confirmed directly by user; existing account-invitation emails are unchanged |
| PP-D21 | Issuing/replacing a quote and recording acceptance automatically queue transactional email notices to the named customer approver | Confirmed directly by user; no marketing permission is inferred |

Automatic quote notices must be recoverable from transaction-written intent,
deduplicated by the business transition/recipient, and recheck current offer,
privacy and suppression rules before sending. A failed email does not lose an
acceptance or make an expired/replaced offer acceptable. Real sending still
requires configured/accepted email service and explicit operational rollout.

## Round 8 — deposit amount, charge and pre-payment holds

| ID | Decision | Status / authority |
|---|---|---|
| PP-D22 | ADMIN sets a fixed AMD deposit amount for each quote; it is part of the approved offer before customer acceptance | Confirmed directly by user; changes require a newly approved revision/amendment |
| PP-D23 | Charge the agreed deposit immediately rather than authorize a hold for later capture | Confirmed directly by user; selected-provider one-step charge/evidence support remains a paid-operation gate |
| PP-D24 | Quote acceptance creates no automatic date/resource hold. Recheck required availability before confirming a booking | Confirmed directly by user; no capacity is inferred from an old preview |

A captured deposit is not by itself permission to double-book a required
resource. Availability checks/claims and booking settlement must join atomically
where resources are part of the agreed booking. Late/unfulfillable payment,
confirmation scope, deadlines, zero deposits, balance and refund rules are resolved
in PP-D25–38 and PP-D57. These choices do not enable live charges or bypass PILOT_MODE.

## Round 9 — booking scope, deposit deadline and late settlement

| ID | Decision | Status / authority |
|---|---|---|
| PP-D25 | Confirmed deposit booking promises the Aveline services in the accepted quote; vendor services require separate explicit confirmation | Confirmed directly by user; do not infer vendor confirmation/payment from sales booking status |
| PP-D26 | ADMIN sets an explicit deposit payment deadline in each approved quote, separate from quote acceptance expiry | Confirmed directly by user; deadline is captured with accepted terms |
| PP-D27 | A late deposit may confirm only if accepted terms and required availability can still be honored; otherwise refund in full | Confirmed directly by user; verified settlement plus atomic required-resource claims govern confirmation |

PP-D29 restricts discretionary staff refund commands to ADMIN. It does not
remove the system's obligation to perform the compensating full refund required
by PP-D27 when a captured late/unfulfillable payment cannot buy the agreed
service. Record system policy/evidence separately from an acting human; both
paths use the same idempotent refund claim and uncertainty safeguards.

No replacement price/terms can be silently substituted to honor a late payment.
An uncertain refund remains pending until completed evidence exists; full refund
is the required economic outcome, not permission to announce money returned
before the provider confirms it. Required Aveline service/resource availability
must be distinguished from separately confirmed vendor engagements.

## Round 10 — balance, refund authority and zero-total bookings

| ID | Decision | Status / authority |
|---|---|---|
| PP-D28 | Collect one remaining-balance payment after the deposit, with its due date set by ADMIN in the accepted quote | Confirmed directly by user; no general installment scheduler in the initial sales scope |
| PP-D29 | Only ADMIN may initiate booking refunds | Confirmed directly by user; quote drafting/enquiry assignment does not grant SUPPORT refund permission |
| PP-D30 | Paid quotes require a positive deposit. A zero-total quote may confirm without a payment only through explicit ADMIN approval | Confirmed directly by user; no deposit waiver for a positive-total quote |

Validate deposit against accepted total and derive remaining amount from the
immutable accepted terms and confirmed allocations; do not collect more than
owed. A fully prepaid quote has no extra balance to collect. Idempotent ADMIN
approval records who confirmed a zero-total booking and does not simulate a
captured payment or bypass required resource availability. Capture the balance
deadline with accepted terms; PP-D38 resolves late balance as notices and ADMIN review.

## Round 11 — cancellation, rescheduling and payment methods

| ID | Decision | Status / authority |
|---|---|---|
| PP-D31 | ADMIN states cancellation/refund terms in each quote before acceptance and reviews refund requests against those terms | Confirmed directly by user |
| PP-D32 | Reschedule through an ADMIN-prepared amendment for customer acceptance; carry the deposit as credit and explicitly settle any price difference after availability checks | Confirmed directly by user |
| PP-D33 | Sales bookings initially support integrated card payments only | Confirmed directly by user; no ADMIN manual transfer/cash payment recording in the initial scope |

Capture those terms with the exact approved/accepted quote revision. The initial
workflow uses ADMIN review, not automatic inference of percentages/fees from
free text. Refund amount must remain within confirmed paid amounts minus other
reserved/completed refunds, and the decision records its reason/evidence. Fiscal
correction rules still require accountant input.

The original Round 11 was partially answered; the user subsequently answered
both remaining questions in the follow-up interaction. Existing accepted terms
are not silently overwritten by a requested reschedule. Retain the prior booking
and its payment evidence until the accepted amendment and required availability
can be applied consistently. No manual “mark paid” route is initially included.

## Round 12 — packages, add-ons, refunds and overdue balances

| ID | Decision | Status / authority |
|---|---|---|
| PP-D34 | Organization OWNER may buy packages/add-ons from an ADMIN-maintained AMD catalogue; ADMIN may assist on the customer's behalf. Catalogue entries, prices and terms are versioned and captured on orders | Confirmed directly by user; SUPPORT quote drafting does not grant catalogue purchase/refund authority |
| PP-D35 | One current base package per event. Upgrades use an explicitly priced, ADMIN-approved change and retain purchase history | Confirmed directly by user; no silently computed proration or rewrite of prior purchases |
| PP-D36 | ADMIN configures prerequisites per add-on. Standalone purchase is allowed only when its catalogue terms permit it | Confirmed directly by user; do not impose a universal package prerequisite or make every add-on standalone |
| PP-D37 | ADMIN may refund a whole package/add-on order or selected lines/amounts under the terms shown before purchase, with review and a recorded reason | Confirmed directly by user; captured amounts minus reserved/completed refunds bound money returned |
| PP-D38 | An overdue booking balance sends overdue notices and flags ADMIN review; no automatic cancellation or service suspension | Confirmed directly by user; no automatic guest-access or invitation-lifetime change |

Upgrade/cancellation/refund terms are captured before purchase/approval. New
catalogue prices cannot alter existing order amounts. Actual offers and amounts
can be entered later through the ADMIN catalogue; paid operation still requires
bank/tax acceptance. These decisions do not re-enable deferred plan-limit
enforcement or reset captured invitation lifetime.

## Round 13 — recurring billing and dunning

| ID | Decision | Status / authority |
|---|---|---|
| PP-D39 | Automatic renewal is optional and requires explicit organization OWNER opt-in to the plan terms and payment method; otherwise renewal is manual | Confirmed directly by user; no silent consent from historical purchases or ADMIN assistance |
| PP-D40 | Renewal periods follow the agreed period-end date. Do not automatically charge a backlog of missed periods; route it to ADMIN review | Confirmed directly by user; no unagreed catch-up debit |
| PP-D41 | ADMIN configures bounded retry timing, maximum attempts and grace policy in plan terms before customer opt-in. Unknown bank outcomes pause new charge attempts | Confirmed directly by user; actual policy values must be configured before enabling automatic debit |
| PP-D42 | On exhausted retries/grace, stop retries, mark past due and flag ADMIN review; preserve guest access and captured invitation lifetime | Confirmed directly by user; no automatic cancellation or entitlement enforcement is granted |
| PP-D43 | Changed prices or material billing terms require new OWNER consent before charging | Confirmed directly by user; a notification alone is not renewed consent |

Preserve current cancel-at-period-end behavior and existing D19 subscription
refund behavior. Card binding/recurring debit support still requires a selected
certified provider; no live debit follows from these product decisions. Worker
lease retries must not multiply the business charge-attempt budget. A new period
is not silently bought under changed terms or by collecting old missed periods.

## Round 14 — organizations and corporate scope

| ID | Decision | Status / authority |
|---|---|---|
| PP-D44 | Any signed-in customer may create an additional organization and becomes its OWNER; roles in other organizations do not carry over | Confirmed directly by user; enable only after F38 tenant-selection/uniqueness cutover is safe |
| PP-D45 | Organization selection is explicit and remembered per browser tab. Ambiguous actions require selection; direct event links derive permissions from the event | Confirmed directly by user; no arbitrary first-membership fallback |
| PP-D46 | Members may leave an organization. Its last OWNER must first appoint another OWNER or use an ADMIN-reviewed closure process | Confirmed directly by user; preserve ownership and accepted/financial history |
| PP-D47 | Initial corporate contracts have one payer organization and cover multiple events owned by that organization | Confirmed directly by user; no cross-organization parties/access grants in the initial F37 scope |
| PP-D48 | ADMIN issues versioned corporate terms; a named customer approver signs in to accept; amendments require acceptance. Contract billing schedules and service-activation conditions are explicit | Confirmed directly by user; acceptance alone is not proof of payment or eligibility |
| PP-D49 | Leaving/removal revokes organization membership and the person’s separately granted event roles within that organization. Required ownership handover must happen first | Confirmed directly by user; preserve last organization/event OWNER protections and access to unrelated organizations |

All organization/corporate batch choices and the event-access follow-up are
answered. Revocation must not leave a window where a removed member retains
access through event roles. Existing event-only invitees who are not leaving an
organization are unaffected. Unanswered options in other batches are not decisions.

## Round 15 — template ownership, authoring and version adoption

| ID | Decision | Status / authority |
|---|---|---|
| PP-D50 | ADMIN maintains shared templates; custom customer templates are organization-private. ADMIN may assign SUPPORT to prepare drafts; only ADMIN publishes. Published versions stay fixed. Existing events adopt new template/brand versions only by explicit preview/confirmation. Event DESIGNER rights do not automatically grant authoring | Confirmed directly by user as one workflow package |

Private catalogue/draft/version/asset access must validate the owning organization
and explicit author assignment; it is not granted to every SUPPORT operator or
event designer. A published version cannot be changed through reseeding, asset
replacement or global brand edits. New renderer code/layout capabilities still
require frontend implementation; authoring configures supported renderer inputs.

## Round 16 — vendor availability

| ID | Decision | Status / authority |
|---|---|---|
| PP-D51 | ADMIN manages explicit bookable resources such as halls/crews. Each resource is exclusive to one reservation at a time; ADMIN configures setup/travel buffers. Assigned SUPPORT reserves for their events. Manual holds require expiry, quote acceptance creates no hold, customers see availability without other customer details, and vendor self-service/recurring calendar rules are deferred | Confirmed directly by user as an initial workflow package |

Use atomic conflict enforcement across all reservation writers, including
buffered intervals and manual hold expiry. A crew/resource calendar is not a
person/guest record or a paid booking ledger. Resources must be explicitly
configured; do not invent reservations from historical event/vendor status.
Existing vendor brief tokens do not gain vendor-wide calendar edit rights.

## Round 17 — paper ticket fallback

| ID | Decision | Status / authority |
|---|---|---|
| PP-D52 | Authorized event staff with guest-contact permission may generate private printable ticket PDFs using existing ticket codes. Reprints retain the code; scans check current ticket/cancellation/acknowledgement state online. Lost-ticket/reissue cases require ADMIN review. Offline admission is deferred | Confirmed directly by user as the initial fallback workflow |

Printing does not issue a new admission credential, reset USED/VOID status,
bypass acknowledgements or expose buyer/guest contact data unnecessarily.
Generation/download recheck current access and subject revocation. ADMIN review
of a lost ticket is not an automatic code-reissue algorithm; a later explicit
reissue operation must preserve admission history and revoke old credentials.

## Round 18 — logistics and staffing

| ID | Decision | Status / authority |
|---|---|---|
| PP-D53 | ADMIN and assigned SUPPORT manage event-owned delivery tasks/staff shifts. Tasks track Planned, In progress, Completed or Cancelled with actor/time and handoff evidence. Workers see assigned tasks/needed contacts only; assignment grants no general guest/billing access. Shared resource/shift conflicts use the calendar. Start with manual partner coordination; no payroll/carrier API integration | Confirmed directly by user as the initial operations workflow |

Task scope is separate from organization/event role grants. Staff may record
factual handoffs but cannot infer completion from a scheduled time. Conflicts
must be enforced across reservation writers and shift edits, with no leakage of
other tenants' task/contact details. Exact partner instructions and shift details
are entered per task; no wage/employment or automatic carrier policy is inferred.

## Round 19 — print production

| ID | Decision | Status / authority |
|---|---|---|
| PP-D54 | Print orders link to accepted quotes/purchased add-ons and capture quantity/specifications/design version. A named customer approver signs in to approve the exact private proof. Changes require a new proof/approval. ADMIN releases production only after accepted payment conditions are verified; staff manually coordinate with printers and track handoff/delivery. Neither payment nor proof approval automatically places a printer order | Confirmed directly by user as the initial print workflow |

Production release references an immutable approved proof/order revision;
post-release changes cannot silently replace partner artifacts. Unknown partner
handoff must not create a duplicate order. No printer API, physical spend or live
partner send is authorized by confirming this future workflow. Payment conditions
are captured in the accepted source terms; no manual gateway-capture override.

## Round 20 — vendor referral agreements and accounting

| ID | Decision | Status / authority |
|---|---|---|
| PP-D55 | Support both vendor fees owed to Aveline and amounts Aveline owes vendors, with direction explicit per agreement. ADMIN approves versioned fee/percentage, accrual-trigger and settlement terms and controls settlements. Commercial records remain private; external transfers are disabled until a supported transfer provider is verified | Confirmed directly by user as the referral accounting scope |

Direction/currency/source agreement must be explicit on each accrual and
settlement. Do not infer debt from mutable VendorBooking.feeMinor/status or
create an automatic transfer/netting policy from this decision. Corrected debt
uses evidence-linked reversals rather than rewriting history. ADMIN-configured
commercial values and a verified transfer rail are still required before actual
settlement execution; no live money movement is authorized by this interview.

## Round 21 — vendor listing fees

| ID | Decision | Status / authority |
|---|---|---|
| PP-D56 | ADMIN manages AMD-priced versioned listing agreements with explicit payer, term, placement and refund terms. A named vendor representative signs in to accept. Payment activates only ADMIN-approved listing service/term. Renewal is manual initially. Expiry removes purchased visibility/placement without cancelling vendor bookings/briefs. No initial vendor-specific self-service billing portal | Confirmed directly by user as the listing-fee workflow |

Payer identity and authority must be established independently of existing
vendor brief capabilities. A listing term controls only purchased listing rights,
not Vendor.active or private event operations. No automatic listing renewal or
referral transfer is inferred from this listing purchase. Actual prices and
terms are configured before offer; bank/fiscal acceptance remains required.

## Round 22 — order exceptions

| ID | Decision | Status / authority |
|---|---|---|
| PP-D57 | ADMIN may publish explicitly free package/add-on offers which OWNER can claim without bank payment; invitation lifetime is unchanged. Downgrades/post-delivery changes require ADMIN review under accepted terms with no automatic proration. An uncertain refund retains affected booking/resource reservations and pauses only affected fulfilment pending ADMIN/provider resolution; unrelated event/guest access is unchanged | Confirmed directly by user as the exception workflow |

A free published catalogue offer is distinct from a custom zero-total sales quote,
which still requires PP-D30 explicit ADMIN booking approval. Free claims do not
simulate a captured payment. Refund uncertainty never allows duplicate refunds,
resource resale or an announcement that money returned without confirmed evidence.
The PP-D38 no-suspension rule for merely overdue balances is unchanged: this
fulfilment pause applies to explicit uncertain-refund handling, not late payment.

## Round 23 — operational retention and evidence classes

| ID | Decision | Status / authority |
|---|---|---|
| PP-D58 | Clear new nonfinancial operational contact details/notes six months after the event has ended and related tasks have closed. Temporary artifacts retain existing short worker expiry. Accepted quotes/contracts, financial/settlement evidence and approved production proofs require a separate expert-reviewed retention schedule before production; do not invent durations. Existing pilot host data/media retention is unchanged; verified privacy requests still apply | Confirmed directly by user |

Cleanup needs evidence that both the event has ended and related work is closed;
unknown anchors require operator review rather than an invented completion date.
Classify accepted evidence separately from transient files so approval cannot
leave a proof subject to an unrelated short-lived export cleanup. Copies of
operational contact/note fields in history/notices follow the same class. This
does not clear ordinary retained pilot guest/host data or delete financial facts.

## Interview completion and remaining inputs

The initial product-policy interview is **complete**, with **58 recorded
decisions (PP-D01–58)**, including the explicitly delegated enquiry-retention
choice. There are no unanswered interview cards. This means the agreed initial
scope can be implemented; it does not mean the features or production acceptance
are complete. New API/schema names remain implementation proposals.

| Remaining item | Classification / required action |
|---|---|
| Bank/acquiring and recurring-method support | External prerequisite; bank choice remains explicitly undecided. Obtain actual specifications, secure access and capability/certification evidence before live use |
| Outbound vendor transfers | Separate external prerequisite; verify a supported transfer rail, beneficiary controls and reconciliation. Acquiring credentials do not establish payout capability |
| Tax/fiscal rules and protected-record retention | Expert input remains undecided: seller/jurisdiction, reviewed calculation/correction examples, required invoice fields and approved quote/contract/financial/proof retention schedule. Do not guess these rules or enable affected production use |
| Catalogue/agreement/contract values | ADMIN configuration before sale: actual components/offers/prices, add-on prerequisites, deposit/balance/acceptance deadlines, cancellation/refund terms, corporate billing/activation, vendor direction/rate/trigger/settlement and listing term/placement |
| Renewal values | ADMIN configures bounded retry timing/attempt count/grace before consent; actual consent wording and provider method evidence must be approved before real recurring billing |
| Resources/partners | Operator configuration: real resources/buffers, shifts, print specifications, printer/fulfilment partners, approvers, handoff details and destinations |
| Renderer/front-end contract | Engineering/team integration: explicit organization-context transport, supported renderer capability manifest, examples/assets/fonts and four-language frontend acceptance |
| Pilot production acceptance | Existing TODO T1–T8 and conditional SMS coverage remain separate; no launch gate is closed by this interview |

These are not unanswered choices between the reviewed initial workflows. Runtime
values are supplied through the agreed ADMIN workflows, while external fiscal,
provider and legal-evidence inputs remain gates for dependent paid/production
operation. They need not block independent intake, tenancy, template or local
fake-provider implementation. No arbitrary financial/retention value becomes a
default just because the policy model is now agreed.

## Explicit initial scope boundaries

- Native F22, general plan-limit enforcement and unrelated later platform work
  remain deferred under existing decisions.
- No initial public enquiry form, automatic consultation messages, fractional
  quote quantities, account-free quote acceptance or manual cash/transfer sales
  payment recording.
- Initial corporate contracts cover one payer organization and its own events;
  cross-organization contracts are a future expansion, not an F38 prerequisite.
- No initial vendor calendar self-service/recurrence, capacity-sharing inventory,
  offline admission, carrier/payroll/printer API integration, vendor-specific
  billing portal or automatic listing renewal.
- No automatic overdue-balance cancellation/suspension, automatic proration,
  unconsented renewal, missed-period catch-up debit or implicit vendor transfer.
- No arbitrary renderer code from authoring, silent template/brand upgrades,
  rewritten accepted terms or captured-lifetime reset.

Bank/tax choices were explicitly left undecided on 25 October. This register
never authorizes paid accounts, purchases, real messages, live charges, vendor
transfers or external deployment. PILOT_MODE charging guards stay in place.

Not yet built: F31–F44 remain unimplemented except the previously recorded PP1a
provider-precondition groundwork. See the [delivery plan](../POST_PILOT_IMPLEMENTATION_PLAN.md).
