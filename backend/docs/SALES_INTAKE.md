# Staff intake operations and recovery

Backend commands, HTTP, reviewed phone-only privacy, latest-close cleanup,
consultation exclusion and explicit atomic draft conversion are implemented.
Production remains **disabled** until independent journal preservation, renderer/
frontend four-language acceptance and operator acceptance evidence are supplied.
Native pilot/payment/lifetime guards are unchanged; there is no deployment here.

## Gates and first installation

All intake/support/conversion flags default false. Enable ADMIN first only after
privacy restore acceptance, SUPPORT after assignment/retention acceptance, and
conversion after setup/outbox acceptance. Literal true/false is required. Keep
`SALES_INTENT_HMAC_KEY_ID` and every retained key in JSON `SALES_INTENT_HMAC_KEYS`;
receipts have no approved expiry, so old verification keys must remain available.

Configure an absolute protected `SALES_PRIVACY_JOURNAL_DIR` and a dedicated
`SALES_PRIVACY_JOURNAL_KEY` (at least 32 characters). The mounted directory and
latest signed manifest must survive independently of any selected DB/media
snapshot. A paired old backup or the restored DB is not proof of the latest
checkpoint. Treat opaque receipts as restricted pseudonymous records. No new
journal/financial/backup retention duration is established here.

For a genuinely fresh installation only, with API/outbound workers stopped and
no intake contacts or redaction history, run the API runtime command:

```sh
RESTORE_QUIESCED=true SALES_PRIVACY_NEW_INSTALL=true node dist/intake-privacy-recovery.js initialize
```

It creates a signed zero manifest explicitly; ordinary app boot, checkpoint and
restore never initialize a missing journal. Existing signed nonzero evidence
cannot be reset. Runtime includes `flock` from util-linux and the journal helper
in `scripts/`; unsupported/missing locking fails closed when needed. Production
intake boot also requires `SALES_INTAKE_OPERATIONAL_ACCEPTANCE=true`, whose evidence
is a deployment-owner acceptance record, not successful compilation.

## Normal recovery and monitoring

The minute privacy sweep continues while writes are disabled and while Redis is unavailable. PostgreSQL SKIP LOCKED/idempotence and the process-owned filesystem flock provide cross-instance correctness; this sweep reports directly through a Sentry monitor rather than requiring the Redis job lease. It claims due
CLOSED cases with SKIP LOCKED in batches of 100, at most five batches per run.
Closing records six calendar months from that closure in UTC with end-of-month
clamping. Reopening cancels the active deadline and never restores cleared data.
A dry-run count is available through SALES_ENQUIRY_RETENTION_DRY_RUN; it is a
canary only and cannot satisfy a production cleanup commitment.

The filesystem writer executes under OS flock through async file fsync, rename
and directory fsync. It runs outside the database transaction. A killed writer's
fsynced next sequence is recovered before new work; independent writer processes
serialize on the file lock. DB acknowledgements then CAS stable receipt IDs to
signed sequences. A request with committed redaction remains IN_PROGRESS until
all its subjects' receipts are acknowledged, including when 100 older receipts
precede it. The recovery sweep finalizes eligible requests; fulfil retries also
resume their saved applied marker without matching already-erased addresses.

Alert on overdue cleanup, uncheckpointed count/age, sweep failure/missed check-in,
and NEEDS_REVIEW owner-delivery age. Sweep diagnostics contain aggregate counts,
never addresses, note bodies, keys, fingerprints or invitation tokens. Investigate
journal failure before enabling more writes; redaction remains committed. Recovery
never generates or rotates a missing invitation token. Explicit authorized
re-invitation is a separate existing account action.

## Restoring an older snapshot

Keep API/outbound workers stopped and set RESTORE_QUIESCED=true for restore.
Apply current migrations to the restored database. Independently locate and
verify the **latest** protected journal/manifest and note its sequence. Then run:

```sh
RESTORE_QUIESCED=true SALES_PRIVACY_JOURNAL_LATEST_VERIFIED=true SALES_PRIVACY_RESTORE_SEQUENCE=<verified-latest-sequence> node dist/intake-privacy-recovery.js
```

This command never starts Nest, transports or workers. It validates the complete
signed contiguous chain against the explicit high-water mark, replays every
receipt idempotently by stable case/contact IDs, clears restored text/address
history/command fingerprints and subject-derived owner invitations/messages,
imports acknowledged receipts, runs current due-retention and finalizes eligible
privacy requests. A zero-outstanding report is required before following the
existing restart/smoke runbook. A large backlog may need repeated offline runs.
Missing/latest/sequence/signature mismatch means remain offline and repair from
independent protected evidence. Never create a fresh zero manifest after restore.

Automated evidence uses a disposable isolated test database: dump before erasure,
commit/checkpoint erasure, restore that old dump, replay the newer journal twice,
assert restored contact/note/address/receipt copies are cleared. It also kills a
writer after sequence fsync and races two independent writer processes. These
local tests do not certify production storage preservation, alerts, recovery
operator practice or frontend language acceptance; those gates remain open.

## Data and access boundaries

ADMIN manages every enquiry; SUPPORT only currently assigned cases and only
self-schedules consultations. Reads/children/history/replays recheck current
standing. Reassignment does not move appointments and availability reveals only
occupied intervals to the former operator. All internal notes belong to the
primary prospect; no unrelated people's identifiers should be recorded.

Privacy review binds exact contact IDs after identity verification, including
phone-only people and historical/shared-address candidates. Retention clears
case text without global suppression or account/financial deletion. Verified
erasure also cancels subject-derived owner setup; independently supplied owners
are not inferred to be the prospect. Converted cases stay internal. Linked events
cannot be silently deleted through ordinary event deletion while their sales
references remain; reviewed link repair is a future staff command.

## Accepted-owner and large-scope privacy review

A phone-only contact binding does not prove the identity of an accepted account.
Binding reports candidate account IDs reached only through explicit primary-
contact invitation provenance. Before full ERASURE can complete, ADMIN must
separately verify the exact accepted account ID and record its evidence reference.
The backend then uses the account's real verified email through the existing
privacy workflow. Independent owners are not inferred from equal addresses;
multiple distinct accounts require separate reviewed scopes. Missing/changed proof
leaves IN_PROGRESS, with no automatic account closure.

Only the opaque additionally verified User ID is added to a signed receipt.
Actual old-dump restore tests prove replay closes that restored account and
revokes its sessions again; the journal never stores its email or credentials.
A scoped pre-existing hashed unsubscribe is promoted to ERASED rather than left
removable, including known historical contact-address fingerprints. Only this
linked organization/channel guard retains those hashes after contact history
clearing; another organization's row remains untouched. Replay restores that
ERASED guard before removing the old restored addresses.

Candidate search returns items/nextCursor. Review every relevant page and use
append:true for additional verified binding batches after the first verified
replacement. Each call remains bounded to 100 IDs, while the complete reviewed
request scope can exceed100 cases. No unseen page is silently discarded.

Committed conversion receipts are checked under the privacy/case/live-User locks
before preparing organization, template or event setup. Retries therefore retain
the original command effect after a template retires or an event is published,
while returning the current authorized case projection. Privacy-invalidated keys
stay spent and reassigned operators lose replay access immediately. New intents
retain the complete setup validation and lock order.

Privacy fulfilment uses the subject resolved under its request and privacy fences
for both the database effect and postcommit file/audit/analytics cleanup. Pending
checkpoint checks use the complete captured contact set; a reviewed append before
execution cannot be skipped by an older preflight snapshot. Applied markers
freeze binding and resume from the persisted scope. Subject EXPORT likewise
holds its request lock through projection and completion and reads its sections
through the same transaction, preventing a concurrent rebind from relabelling
an earlier subject's data.
