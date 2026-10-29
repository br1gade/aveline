# First post-pilot wave — implementation status

Updated **30 October 2026**. This is the current delivery-status companion to the
25 October execution blueprints. The F38, F39 and F44 backend streams have been
implemented and integrated for final release verification. Backend delivery does
not mean production activation, frontend acceptance or paid-operation approval.
The integration owner records the final combined verification result; no final
whole-branch test totals or production acceptance are asserted here.

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

## Evidence and operating boundaries

Implementation includes unit, real-PostgreSQL integration and HTTP regression
coverage. Local fixtures exercise populated legacy migration parity, tenant and
role boundaries, competing revisions/receipts, worker completion and cleanup,
private-file authority, privacy erasure/restore and conversion rollback. Synthetic
trusted renderer manifests exercise backend transactions only; they are not
frontend capability or visual acceptance. Disposable-database tests do not
activate additional memberships or certify production journal/object preservation.

The final integrated `npm run verify` result and any reader-floor follow-up belong
to the integration owner's release record. Measured load and operational restore
acceptance run separately from functional verification. Current setup and recovery
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
