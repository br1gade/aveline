# First post-pilot wave — implementation status

Updated **30 October 2026**. This is the current delivery-status companion to the
25 October execution blueprints. The F38, F39 and F44 backend streams have been
implemented, integrated and functionally verified as recorded below. Production
activation, frontend acceptance and paid-operation approval remain separate gates.

The current HTTP contract is [API.md](../../API.md) and generated
[OpenAPI](../../../backend/openapi.json). Domain behavior is governed by
[access control](../../ACCESS_CONTROL.md), [invitation design](../../INVITATION_DESIGN.md)
and [PP-D01–58](../DECISIONS.md). Historical proposals, sample routes, SQL and
unexecuted-at-planning-time commands in the blueprints do not override those
contracts or establish deployment evidence.

## Delivered backend scope

| Stream | Implemented backend | Acceptance or activation still open |
|---|---|---|
| F38 — organization context and lifecycle | Explicit organization selector and exact resource-derived standing; safe zero/one/many resolution; membership create/join compatibility gate; atomic departure/removal, owner protection and recovery review; current-authority worker/download checks | Additional-membership writes remain disabled by default and the user-only membership index is retained by automatic migration. Operator cutover needs compatible readers/writers, old-process exclusion, reviewed migration/restore evidence, measured performance and four-language multi-tab frontend acceptance |
| F39 — enquiry/consultation intake | Platform staff and assigned-SUPPORT cases, notes and conflict-safe consultations; revision/idempotency checks; explicit atomic organization/draft-event conversion and protected owner-invite delivery; reviewed phone-only privacy, separate accepted-owner identity proof, latest-close retention, signed independent privacy journal and restore replay | Intake/support/conversion flags remain off by default. Production use needs retained intent keys, independently preserved latest journal/manifest, cleanup and alert operation, owner-setup/outbox acceptance, frontend languages and recorded operator acceptance. Consultation messages remain manual |
| F44 — controlled templates | Exact legacy rendering baselines and immutable invitation pins; tenant-scoped catalogue; ADMIN/assigned-SUPPORT drafts, validation and synthetic previews; ADMIN publication/retirement and receipt replay; normalized private raster art, worker preparation, authorized files and cleanup; explicit preview/confirmation adoption and initial-draft artwork readiness | The production capability registry is empty. Flags alone cannot enable authored publication. A reviewed deployed renderer manifest, real font/palette/variant/preview parity, en/ru/fr/hy and mobile/desktop visual acceptance, private-storage/worker operation and the compatible pinned-reader rollback floor remain required |

F39 conversion and ordinary event creation share the same transaction-aware event
creation and tenant-scoped immutable template selection boundary. Initial artwork
reservation writes database intents only; the separate worker prepares private
copies. A draft cannot publish before required copies are bound. Template
publication does not upgrade existing invitations, reset captured lifetime,
change attendance/acknowledgements or rewrite fixed exports.

The shared reader protocol is revision 3. A forward migration raises its minimum
reader floor while preserving the additional-membership write gate. Older
revision-2 runtimes refuse that schema on startup; before any F39/F44 activation,
operators must also exclude already-running older API, worker and maintenance
processes and their database access. This requirement is independent of enabling
multiple memberships; startup checks cannot stop an old process already running.

## Evidence and operating boundaries

Implementation includes unit, real-PostgreSQL integration and HTTP regression
coverage. Local fixtures exercise populated legacy migration parity, tenant and
role boundaries, competing revisions/receipts, worker completion and cleanup,
private-file authority, privacy erasure/restore and conversion rollback. Synthetic
trusted renderer manifests exercise backend transactions only; they are not
frontend capability or visual acceptance. Disposable-database tests do not
activate additional memberships or certify production journal/object preservation.

Verification on **30 October 2026** used isolated PostgreSQL test databases and
local test services:

| Check | Result |
|---|---|
| Lint, source/test TypeScript, build and documentation checks | Passed; zero lint warnings |
| Generated OpenAPI | 200 paths match the source |
| Unit tests | 113 suites, 1,288 cases passed |
| Integration coverage | 70 suites, 602 unique cases green across full runs and affected-suite reruns |
| HTTP coverage | 45 suites, 676 unique cases green across the full run and affected-suite reruns |
| Pilot script tests | 10 passed |
| Backup script tests | 8 passed |

The full runs exposed legacy fixtures that needed the template-adoption dependency,
transactional invitation-mail setup and current safe retry semantics. The committed
revision race now uses two independent attached-media updates: design edits
intentionally share the invitation preview fence, while both exact cache-counter
assertions remain intact. Isolated resets retry only a rolled-back PostgreSQL
`40P01` deadlock, at most three attempts, with scheduled jobs still enabled.
Single-membership creation errors retain the helpful organization name; multiple
memberships remain generic and cannot create another organization while gated off.

Counts above are unique cases rather than sums of reruns. The final checks were
completed through full runs followed by scoped reruns of corrected suites; a fresh
uninterrupted `npm run verify` was not repeated after those fixes.
Measured load and operational restore acceptance run separately from functional
verification. Current setup and recovery
procedures live in the [organization cutover runbook](../../../backend/docs/ORGANIZATION_CUTOVER.md)
and [staff intake recovery runbook](../../../backend/docs/SALES_INTAKE.md); the renderer gate is described in
[the capability contract](../../contracts/invitation-renderer-capabilities/README.md).
No production migration/cutover, external deployment, real send, charge or provider
certification is established by this implementation status.

## Outside this delivered wave

F31/F32 event purchases and add-ons, F33 deposit-confirmed bookings, F34 renewal,
F35 fiscal documents, F36 vendor accounting/payouts, F37 corporate contracts,
F40 quotes, F41 calendars and F42/F43 physical operations/listing revenue remain
planned. PP1a provider-registration validation was earlier groundwork, not tax
or bank acceptance. The decision register approves workflow requirements; it
does not mean every F31–F44 feature has shipped.

Existing pilot frontend, human language/print review, actual providers, hosting/TLS,
off-host recovery and operator-alert gates remain in [TODO](../../TODO.md) and
[GOING_LIVE](../../GOING_LIVE.md). Native F22 and entitlement enforcement retain
their explicit deferrals; free-pilot charging guards remain unchanged.
