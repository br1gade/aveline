# Private guest contributions

F25 acknowledgements and F19 gallery backend delivery, 19 October 2026. Shared
client contract: [API.md §11](../../docs/API.md#11-private-acknowledgements-and-guest-gallery).

## Domain and access

`QuestionStatement` stores immutable translated wording/revision. A SIGNATURE
question points at its current version. `GuestAcknowledgement` records actual
signer separately from represented subject, exact rendered text/language, declared
name, method, drawing reference and server time. Repeated identical intent is
idempotent; editing wording requires a fresh acknowledgement. No legal identity
verification or digital certificate is implied by a typed/drawn declaration.
Required current statements gate affected attending RSVPs and both admission paths.
Ticket buyers provide every attendee, then each attendee signs using a personal
invitation. The minute outbox sweep sends one personal-link email per paid/valid
ticket/person with contact email. No guest credential appears in buyer order APIs.
Hosts handle missing contact, suppression and later reconfirmation through existing
invitation send/share tools. All four pilot languages have default attendee copy;
human translation and browser acceptance remain release gates.

`GuestMedia` is a separate durable ledger, outside public `MediaAsset`. Originals,
display and thumbnail UUID keys never appear in ordinary JSON or URLs. Capability
reads enforce publication, expiry, erasure and current event/household membership;
checks repeat after storage reads. Host acknowledgement reads need guest contact
permission; gallery moderation needs guest write. Designers cannot read either.

## Worker and recovery

```sh
npm run build
npm run start:private-media-worker
node scripts/check-private-media-worker.mjs
```

Compose runs the same release image with a separate entry point, one image at a
time, one CPU, 256 MiB JS heap and 768 MiB total process memory. Sharp concurrency
is one and its cache disabled. Actual host memory/latency acceptance remains open.
The API never decodes images. It reserves count/storage under the event lock, writes
a STAGING ledger before the original, then conditionally queues it. Crashes leave a
cleanup record. The worker claims QUEUED or expired PROCESSING work using Postgres
SKIP LOCKED, a random claim token and two-minute lease. Up to three attempts; stable
INVALID_IMAGE/STORAGE_UNAVAILABLE/ATTEMPTS_EXHAUSTED codes contain no source bytes,
filenames or keys. Recovery retains output keys and accepts an already written file
only when bytes match. Removed/orphaned work cannot become READY.

Originals and derivatives use the existing private storage port and private S3
bucket or separate private filesystem root. Never publish that bucket/root through
the edge; see [EXPORT_WORKER.md](EXPORT_WORKER.md) for provisioning. Both workers
must use the same settings. JPEG orientation is applied, metadata stripped and
animation rejected. Signature: 1 MiB upload, 4 million pixels, PNG display at most
2048px/1 MiB. Gallery: 10 MiB upload, 40 million pixels, WebP display at most
2048px/2 MiB and thumbnail at most 480px/512 KiB. No general guest original route.

Gallery quotas: 20 active images per uploader, 1,000 per event, 2 GiB including
raw/derivatives. Pending images reserve raw bytes plus 2.5 MiB, reduced to exact
bytes on READY. Signature technical quotas separately: 20 active per uploader,
5,000/event, 2 GiB; reserve raw plus 1 MiB. Removal frees count immediately but
frees bytes only after successful physical cleanup. A storage outage returns 503
and retains the ledger for cleanup.

Cleanup runs each worker iteration in batches of 100. Staging abandoned for two
minutes, unclaimed drawings after 24 hours, failed images after 24 hours and files
whose event/uploader disappeared become REMOVED. Removed files are inaccessible
immediately. Originals/derivatives are deleted, then reserved/stored bytes cleared.
Tombstones retain UUID keys and are retried hourly, reclaiming arbitrarily late
writes from interrupted claims. These are durable cleanup metadata, not retained
photo content. Late writes may briefly consume physical bytes after a reservation
was reclaimed; monitor bucket capacity and cleanup failures. Graceful stop finishes
active work. SIGKILL or OOM recovers after the lease; production must restart unhealthy
processes and alert on failed/pending backlogs.

Heartbeat: `/tmp/aveline-private-media-worker-heartbeat`, override with
`PRIVATE_MEDIA_WORKER_HEARTBEAT_PATH`. Missing/invalid/>120s old is unhealthy.
Errors use fixed codes, never capabilities or images. Backup capture stops this
writer alongside the API, export/seating workers and Garage for a consistent
Postgres/private bucket copy. Rehearse restore including tombstones and a pending
image before pilot.

## Retention and privacy

Hosts retain data after guest expiry. Owner removal remains possible after host
approval while the invitation is available. Ordinary guest deletion refuses signed
evidence; verified privacy erasure removes records for either signer/subject,
RSVP references and uploader files. Access is revoked in the transaction; physical
deletions are retried asynchronously by the worker. DSAR exports include metadata
and protected original attachment routes tied to a verified EXPORT request and
matching subject. Originals are untrusted and returned as octet-stream attachments.
Deleting an event cascades acknowledgements but retains orphan cleanup ledger rows.

## Not yet accepted

Four-language guest signing/representative confirmation, pending/errors/gallery
upload, host moderation, personal ticket-link handling and accessibility must be
implemented/accepted in the frontend. Production S3 isolation, real worker memory,
crash/deletion/backup recovery and the full mixed-write pilot rehearsal remain
launch gates. No deployment or live email account has been created by this batch.
