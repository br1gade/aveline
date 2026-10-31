# Remaining work — pilot and post-pilot TODO

Updated **30 October 2026** (Asia/Yerevan). Baseline: backend pilot work through
`99121d2`, merged into `main` and `dev`. An unchecked box means work or acceptance
is still outstanding; it does not necessarily mean the backend feature is missing.

The agreed backend pilot features are implemented. Local verification, all eight
latency gates, worker recovery and encrypted fresh-store restoration passed.
The pilot is **not yet approved for real guests**: frontend integration and the
external acceptance below remain. See the [rehearsal evidence](../backend/docs/PILOT_REHEARSAL.md).

This is the execution checklist. [BACKLOG.md](BACKLOG.md) owns feature IDs and
product decisions; [GOING_LIVE.md](GOING_LIVE.md) owns release requirements;
[PILOT_IMPLEMENTATION_PLAN.md](PILOT_IMPLEMENTATION_PLAN.md) owns the agreed
17-item pilot scope and original batches A–J. Keep these documents consistent
when an item is completed or its scope changes.

## 1. Decisions and access needed

Roles below indicate who needs to supply an input, not an assigned individual.
Record named owners and evidence before closing the corresponding task.
Configure credentials through private deployment settings, outside chat and Git.

| Input | Needed from | Unblocks |
|---|---|---|
| Latest frontend branch/test URL and delivery estimate | Frontend team | T1, T8 |
| Hosting choice, budget, web/API/media domains and deployment/DNS access | Product owner/operator | T2–T6 |
| SMTP provider, sending domain/address and controlled recipients | Product owner/operator | T3 |
| Meta setup owner, account/app, sender and controlled recipient | Product owner/operator | T4 |
| Backup destination, retention/cadence, acceptable data loss and recovery time | Product owner/operator | T5 |
| On-call owner, alert destination and monitoring accounts | Operator | T6 |
| Language reviewers, intended spreadsheet application and A4 printer | Product owner/team | T7 |
| Whether SMS is required, and how phone-only guests will be reached | Product owner | Conditional SMS work below |
| Revised pilot date and final release approver | Product owner | T8; full scope takes priority over the old target date |

**Scope decisions already made:** the pilot is free; retain `PILOT_MODE=true`
and keep live charge initiation disabled. Bank/payment certification is required
before paid operation, not before this free pilot. Native F22 email feedback
integration is explicitly deferred; real email sending is still required.

## 2. Before the pilot

### T1 — Finish and integrate the frontend

Owner: frontend team, with backend support. Needs: latest frontend branch/test
URL, contract review and delivery estimate. Existing frontend work is on a separate
branch; assess what is already implemented before treating these as new screens.

- [ ] Finish and integrate the host/organizer and guest interfaces in English,
  Russian, French and Armenian, including localized validation and recovery copy.
- [ ] Accept event-wide/per-venue RSVP, explicit attendance-mode reconfirmation,
  multi-venue seating and guest name corrections.
- [ ] Accept named attendees and their venue choices at free checkout, personal
  acknowledgement links and unified guest/ticket check-in.
- [ ] Integrate queued seating and fixed CSV/PDF/XLSX snapshots: status, failure,
  retry/regeneration and download; preserve manual seating operations.
- [ ] Accept typed/drawn household-representative acknowledgements and invited-
  guest galleries, including processing, moderation and owner removal states.
- [ ] Accept question ordering, template previews, listing hero/share metadata,
  logos, multiple directory venues per vendor and expired guest-access states.
- [ ] Review frontend adoption of the new API contracts; retire the legacy live
  CSV compatibility surface only after adoption is verified and a cutover agreed.

**Backend requests from the client** (`frontend/docs/BACKEND_REQUESTS.md` on the
frontend branches). Answered on 31 October 2026: FR-3, FR-7, FR-10, FR-13,
FR-17, FR-19, FR-21, FR-22, FR-25, FR-27, FR-31, FR-35, FR-36, FR-38, FR-40,
FR-45; FR-4, FR-18, FR-24 and FR-44 as far as the schema goes (every property
typed, every path parameter declared); FR-29 and FR-34 by a policy test that
fails if a role may write guests or send without reading contacts.

- [ ] Still open on the backend, by the client's priority: FR-1 response
  schemas (blocking typed responses), FR-6 effective permissions, FR-5 `GET /me`,
  FR-2 per-operation security, FR-11 deployment topology (with T2), FR-26/28/32/33
  stable codes for English-only refusals, FR-23, FR-20, FR-30, FR-37, FR-39,
  FR-41, FR-42/43 (template layouts and block fields, a design decision).

Done when: the integrated frontend demonstrates the required pilot flows against
the current backend, with the frontend acceptance for original batches A–H closed.
Contracts: [API](API.md), [OpenAPI](../backend/openapi.json).

### T2 — Deploy the pilot environment

Owner: operator. Needs: hosting/domain choices, budget and secure access.

- [ ] Configure the real frontend origin, API/media domains, DNS and public TLS.
- [ ] Deploy Postgres, Redis, Mongo, public/private object storage, API and the
  export, seating and private-media workers with production secrets/settings.
- [ ] Verify private exports, gallery originals and signatures cannot be read
  anonymously or through the public media route.
- [ ] Apply migrations, production seed and smoke checks; verify restart,
  redeploy, worker heartbeat and expiry/revision-maintenance behavior.
- [ ] Confirm free-pilot charging guards and permitted contact channels.

Done when: the deployed release is reproducible and its smoke, access and
restart checks pass. Runbook: [deployment](../backend/docs/DEPLOYMENT.md).

### T3 — Verify real email sending

Owner: operator/product owner. Needs: SMTP provider, sender/domain, DNS access
and controlled test recipients; the public frontend origin is needed for links.

- [ ] Configure and verify sender authentication/DNS and provider send limits.
- [ ] Send invitations, reminders, confirmations, account and thank-you messages;
  check intended language, links and correlation with internal message records.
- [ ] Verify retry/quota behavior and controlled sending with the chosen service.
- [ ] Record the native F22 exception; do not treat provider-neutral ingestion
  as proof that real bounce/complaint callbacks are already connected.

Done when: controlled recipients receive correct real messages and provider
configuration/send evidence is recorded. Native F22 remains in PP8 below.

### T4 — Finish WhatsApp setup and live acceptance (original batch I)

Owner: product owner/operator. Needs: Meta account/app, sender/test number,
controlled recipient, secure configuration and the public HTTPS callback.

- [ ] Complete account/sender setup and verify provider eligibility and the
  supported API version during setup.
- [ ] Verify consent, template approval and actual provider support for every
  required language; escalate unsupported languages rather than silently dropping them.
- [ ] Verify a real send and actual signed delivery/failure callbacks; verify
  read evidence when the provider emits it, without treating its absence as unread.
- [ ] Verify subscription, receipt reconciliation, restart/retry behavior and
  frontend host indicators. Record at-least-once duplicate-delivery risk.

Done when: the [WhatsApp acceptance checklist](../backend/docs/WHATSAPP_SETUP.md)
has real-provider evidence, not just local fixtures.

### T5 — Configure and prove off-host recovery

Owner: operator, with product-owner recovery decisions. Needs: a separate backup
destination, encryption/access configuration, retention/cadence and maintenance window.

- [ ] Approve the acceptable data-loss window (RPO) and recovery-time target (RTO).
- [ ] Configure the off-host destination, retention and automated backup timers.
- [ ] Download an actual remote recovery set into fresh stores; verify paired
  domain/media restoration, guest capabilities, private access and generated files.
- [ ] Measure capture interruption and recovery against approved targets; prove
  missed-backup/disk-pressure alerts and document who performs recovery.
- [ ] Rebuild/clear derived caches when restoring older database history.

Done when: actual off-host restore evidence and operator-approved recovery
targets exist. The passed local ~251 MB drill does not close this gate.
Runbook: [deployment and recovery](../backend/docs/DEPLOYMENT.md).

### T6 — Activate monitoring and operator alerts

Owner: operator. Needs: named on-call owner, alert destination and monitoring access.

- [ ] Configure error reporting, scheduled-sweep check-ins and external uptime checks.
- [ ] Prove notifications reach the operator for dependency/storage failures,
  outbox/job failures or lag, stopped workers/sweeps, missed backups and disk pressure.
- [ ] Verify recovery notifications, credential redaction and a usable incident runbook.

Done when: controlled failures reach a named operator and that operator can
follow the recovery procedure. Production-wide tracing remains separately deferred.

### T7 — Review language and printed outputs

Owner: product owner/reviewers, with frontend/backend corrections as needed.
Needs: fluent reviewers for all four languages, the intended spreadsheet viewer
and an A4 printer. Backend translations are already implemented; review and
correction are needed, not a new translation set from scratch.

- [ ] Review terminology, grammar and clarity in backend errors/recovery copy,
  export headings, messages and guest acknowledgement statements.
- [ ] Review host/guest interface copy in its actual frontend context once available.
- [ ] Open representative CSV/PDF/XLSX files, check scripts, long names, columns
  and formula safety, and physically print seating documents and A4 flat place cards.
- [ ] Record reviewers, corrections and acceptance evidence for en/ru/fr/hy.

Done when: human language, native spreadsheet and physical-print acceptance is recorded.

### T8 — Final integrated rehearsal and release decision (original batch J / F45)

Owner: frontend/backend teams and operator; product owner approves release.
Needs: T1–T7, controlled recipients, a representative event and a release candidate.

- [ ] Run complete host, guest and mobile-door journeys in all four languages,
  including both attendance modes, free ticket attendees and reconfirmation.
- [ ] Verify seating, snapshots, acknowledgements, moderation, expiry and erasure
  through the actual frontend and deployed storage/workers.
- [ ] Repeat 50-reader/10-writer warm/cold/degraded load through the real TLS/proxy
  path, retaining all results and the existing latency thresholds.
- [ ] Rehearse dependency/worker interruptions, manual seating conflicts,
  provider reconciliation, redeploy and actual off-host recovery.
- [ ] Fix and retest issues found; record the accepted 17 required feature items,
  the native F22 exception, operator ownership and the go/no-go decision.
- [ ] Confirm the revised pilot date and operating/guest support arrangements.

Done when: the product owner accepts the integrated production-environment
evidence. Local success and a merged branch alone do not approve launch.

### Conditional pilot work — SMS

- [ ] Decide whether SMS is required and confirm how every pilot guest can be reached.
- [ ] If required, choose a provider, obtain its documentation and secure test
  access, implement the `SmsProvider` adapter and verify controlled sending.
- [ ] If omitted, record explicit pilot channel coverage/approval; do not silently
  exclude phone-only guests. The general launch checklist still lists SMS as open.

### Work that can proceed while the frontend finishes

T2–T6 and backend/message/export review in T7 can progress in parallel, subject
to their listed inputs. Frontend review and final T8 acceptance depend on T1.
Selecting providers or paid infrastructure and deploying externally still need
the product owner's direction; this TODO does not authorize purchases or sends.

## 3. Post-pilot batches — proposed grouping

These group existing open backlog features. The interactive initial-policy
review is complete: [58 decisions](post-pilot/DECISIONS.md) define the approved
workflows and explicit deferrals. Implementation order follows dependencies;
estimates and delivery dates are not committed. Use the recorded rules rather
than requesting them again; assign implementation ownership/acceptance evidence
per slice. None is added to the free-pilot release gate. F45 remains T8 above.

The [post-pilot delivery plan](POST_PILOT_IMPLEMENTATION_PLAN.md) records the
25 October implementation audit, confirmed policy, external inputs and slice dependencies.
Bank and tax choices remain undecided; PP1a local validation is implemented and
verified. Commercial features remain open. The plan now also distinguishes
[feature dependencies and parallel lanes](POST_PILOT_IMPLEMENTATION_PLAN.md#dependency-map-and-parallel-delivery),
including independent F36/F43 and the separate F42 workflows. Three detailed
[production implementation designs](POST_PILOT_IMPLEMENTATION_PLAN.md#6-three-agent-production-implementation-design)
now cover all fourteen features, with shared contracts, delivery waves and
feature-specific gates. Product-policy interview complete; bank/tax/protected-
record retention remain external inputs, and actual commercial/operator values
are ADMIN configuration before use. The first
[execution wave](post-pilot/execution/README.md) has delivered F38, F39
and F44 backend slices. Their [current status](post-pilot/execution/IMPLEMENTATION_STATUS.md)
separates implemented behavior from frontend, operational and activation gates.
The other commercial/resource/logistics features remain planned.

### PP1 — Paid-launch readiness and invoice tax (F35)

- [x] Validate local provider registration before issuing/replacing subscription
  invoices; preserve payable invoices and numbering on refusal. Verified 25 October;
  this does not certify a bank or implement tax. See the delivery plan for evidence.
- [ ] Choose the bank/provider; obtain the actual integration specification,
  merchant/sandbox access and required certification before enabling live charges.
- [ ] Verify amounts/status mappings, payment/refund/reconciliation behavior and
  supported one-step/two-step operation with the selected provider.
- [ ] Implement invoice tax after jurisdiction, accounting rules, required invoice
  fields and accountant-reviewed examples are supplied; verify void/refund behavior.
- [ ] Approve paid-operation acceptance before changing free-pilot charging guards.

Needs: product-owner commercial decisions, bank access/specification, accountant
input and paid acceptance scenarios. Sources: [payments](PAYMENTS.md), F35 in [backlog](BACKLOG.md).

### PP2 — Event packages, add-ons and recurring billing (F31, F32, F34)

- [ ] Implement per-event package purchase and add-ons.
- [ ] Implement subscription renewal/dunning with explicit consent, payment-method
  support and agreed retry, cancellation and notification rules.
- [ ] Revisit deferred plan/entitlement enforcement using pilot evidence; agree
  limits, overage behavior and existing-customer treatment before enforcing them.

Needs: catalogue/pricing, entitlement decisions, billing lifecycle rules and PP1
before real-money use. Published plan descriptions alone are not enforcement.

### PP3 — Intake, quotes and confirmed bookings (F39, F40, F33)

- [x] Implement staff/assigned-SUPPORT enquiry and consultation backend, explicit
  atomic draft setup, verified privacy, retention and recovery journal.
- [ ] Accept intake frontend/languages, independently preserved latest privacy
  journal/restore, cleanup/alerts and owner-setup/outbox operation before enabling
  production intake/support/conversion flags.
- [ ] Build component-based quotes across event types, with version/approval rules.
- [ ] Connect captured deposits to confirmed bookings without using browser
  redirects as payment proof; agree cancellation and rescheduling behavior.

Needs: frontend/operator intake acceptance; configured service catalogue and
commercial terms plus payment/fiscal acceptance from PP1 before taking deposits.
Initial intake roles, workflow and retention are already decided and implemented.

### PP4 — Vendor revenue (F36, F43)

- [ ] Implement referral settlement/payout accounting.
- [ ] Implement vendor listing fees, including renewal/cancellation where required.

Needs: vendor commercial agreements, fee/refund/payout rules, settlement ownership
and provider/accounting support. Existing referral amounts do not perform payouts.

### PP5 — Corporate contracts and multiple organizations (F37, F38)

- [ ] Implement branded multi-event corporate contracts and their access/billing rules.
- [x] Implement exact organization context, explicit selector, membership lifecycle,
  ownership/recovery protection and compatible reader/writer guards.
- [ ] Accept frontend per-tab/language behavior, old-runtime exclusion and reviewed
  migration/restore/performance evidence; then perform the separate operator
  cutover before enabling additional memberships. Automatic migration retains
  the user-only membership index and additional writes default off.

Needs: corporate contract examples/configured billing and branding terms, plus
organization activation evidence. PP-D44–49 already decides the initial scope;
backend context support does not implement F37 corporate contracts.

### PP6 — Production template authoring (F44)

- [x] Implement immutable legacy pins, tenant-private drafts/artwork, staff
  assignment, validation/preview, ADMIN publication and explicit version adoption.
- [x] Preserve existing invitations/lifetime and require explicit adoption under
  PP-D50; template publication never upgrades consuming events automatically.
- [ ] Supply a reviewed deployed renderer manifest and accept fonts, palette roles,
  variants, inert previews, en/ru/fr/hy and mobile/desktop rendering.
- [ ] Accept private storage/worker operation and the pinned-reader rollback floor
  before enabling authored publication/assets. The approved registry is empty;
  flags alone cannot enable publication.

Needs: actual frontend and operator evidence. Initial author/reviewer/versioning
policy is decided; backend fixtures do not prove renderer or production acceptance.

### PP7 — Availability and physical fulfilment (F41, F42)

- [ ] Add vendor availability calendars and booking/conflict rules.
- [ ] Add delivery/logistics tracking and printed-companion orders.
- [ ] Add on-site staff assignment and paper/QR ticket fallback workflows.

Needs: vendor/operator participation, calendar ownership, fulfilment and print
partners, staffing roles, hand-off states and operational examples. Coordinate
booking/quote relationships with PP3; decide offline admission/conflict rules.

### PP8 — Native email feedback (F22, explicitly deferred)

- [ ] Revisit the exception when ready; select a native provider adapter or mailbox
  bounce parser based on the chosen email service.
- [ ] Map actual delivery/bounce/complaint events into the existing provider-neutral
  ingestion, with authentication, correlation, replay and suppression acceptance.

Needs: provider selection, event documentation and secure controlled test access.
No pilot deadline is assigned to this batch.

### Later platform and product follow-ups — not scheduled batches

- [ ] Prioritize from actual pilot evidence: image cropping/focal points, CDN,
  centralized log shipping, shared rate limits and broader metrics/tracing.
- [ ] Plan replicas, failover and full high availability when availability targets
  and an operating budget have been agreed.
- [ ] Revisit disputed-refund tooling or partial order cancellation only if product
  policy changes. Whole-order cancellation and manual dispute handling remain the
  current decisions; manual privacy identity verification also remains deliberate.
- [ ] Evaluate bank webhook verification if the selected gateway uses push callbacks.

Sources: [backend gaps](../backend/docs/GAPS.md), [launch checklist](GOING_LIVE.md)
and [product specification](PRODUCT_SPEC.md). These are candidates for later
planning, not promises to implement every long-range gap immediately.

## 4. Keeping this TODO current

- [ ] Name owners and link private acceptance evidence for the remaining pilot tasks.
- [ ] Tick an item only when its stated outcome is met; distinguish local evidence
  from deployed/provider evidence.
- [ ] When adopting a post-pilot batch, agree its scope and update the governing
  backlog/plan before implementation. Update this TODO in the same change when done.

Not yet completed: the unchecked work above. Backend implementation/local rehearsal
completion must not be mistaken for frontend, provider or production sign-off.
