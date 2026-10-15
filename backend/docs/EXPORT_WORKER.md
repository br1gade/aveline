# Private export worker

The API accepts durable `ExportSnapshot` jobs. `npm run build` followed by
`npm run start:export-worker` starts a separate process; it runs no HTTP server
and no cron delivery sweeps. Production Compose includes this service with
one concurrent job, a 384 MiB JS heap, 512 MiB container memory limit, one CPU
and a 60-second graceful stop. Multiple processes can claim independent jobs.

Configure the same database and private store in API and worker. With S3,
production requires `PRIVATE_S3_BUCKET`, different from public `S3_BUCKET`.
Provision it with authenticated read/write only, no website/anonymous/CDN
policy. `npm run storage:up` provisions a distinct private development Garage
bucket; it does not deploy production. Filesystem fallback requires a shared
protected volume at `PRIVATE_STORAGE_ROOT`, outside every static/public root.
Production Compose assumes S3; add a shared volume before choosing filesystem.

## Recovery and limits

Each claim has a unique token and a 90-second lease renewed every 15 seconds.
Claims use `FOR UPDATE SKIP LOCKED`. Expired work is reclaimed up to three total
attempts; backoff after failure is bounded. A final expired claim becomes
`FAILED`/`LEASE_EXHAUSTED`. Generation/storage/permission/conflict errors expose
`GENERATION_FAILED`, never database queries, inputs or provider credentials.
The API history exposes attempts and failureReason. Regenerate terminal jobs
with a new UUID; do not edit queue rows to retry them in production.

A repeatable-read capture records time, timezone, attendance revision and the
opaque Postgres visibility token. It registers subject fingerprints for erasure.
Capture is capped at 20 seconds and 5,000 each of guests, seats, tickets, orders
and attendee records, plus 5,000 tables, 200 custom questions and 100,000
answers. CPU CSV encoding and upload happen after that transaction;
output is capped at 20,000 rows and 10 MiB. One job runs at a time per process.
Attempts that exceed limits fail rather than consuming unbounded API resources.
Standard headings remain English until the four-language export rollout.

The worker writes `/tmp/aveline-export-worker-heartbeat` after successful store/
queue work. `node scripts/check-export-worker.mjs` exits nonzero when absent or
older than 120 seconds. Compose overrides the API image's HTTP healthcheck.
Dependencies failing repeatedly make the heartbeat stale; Docker health does
not itself restart unhealthy processes, so alert on it. Inspect snapshot states
through authenticated event routes and worker logs (`jobId`, attempt, safe code).
A pending job waiting indefinitely usually means no healthy worker is running.

SIGTERM/SIGINT stop new claims and finish the current attempt before closing
connections. A forced kill or memory termination leaves an expiring lease;
a recovered owner cannot be overwritten by the old owner. Configure NTP on
API/worker/database hosts because application lease checks use UTC clocks.

## Private artifact lifecycle

A ledger row is committed **before** upload, with a new UUID per attempt. No
private file becomes a public MediaAsset. Publication requires the current
lease, requester permissions and an unretired object. Downloads check current
viewer permission and job expiry/revocation before and after storage IO.
Contact-bearing output is refused after contact permission loss; regenerate
a redacted file. Manifests always require contact permission.

Erasure updates a shared privacy fence before taking other domain locks.
Capture/publication hold a shared fence briefly; an overlapping repeatable-read
capture retries rather than resurrecting pre-erasure data. Fingerprints locate
old snapshots even after the source email changes. Erasure conservatively
revokes existing snapshots in affected events, including redacted sheets.
Deletion cascades jobs but leaves object ledger rows, preventing lost cleanup.

Files expire after `EXPORT_RETENTION_DAYS` (default 7, range 1–30); event source
data and job audit metadata remain. Each worker iteration cleans at most 50
eligible artifacts. Cleanup first retires the object atomically, preventing
publication races, then deletes bytes without holding a database lock. Failed
deletes remain pending. Opaque tombstones repeat deletion after 60 seconds,
catching even a delayed stale upload. Revoked/expired files are refused at once;
physical deletion is asynchronous and depends on storage availability. Monitor
cleanup warnings and ledger backlog; retaining tombstones is intentional.

## Not yet built / release checks

PDF and XLSX renderers/font acceptance, background seating, full translation
of standard export headings, frontend adoption and production rehearsal remain.
Legacy `/exports` CSV routes still build live data; their audit rows are not
past snapshots. After the frontend moves, retire that compatibility surface.

Rehearse on the actual production store: anonymous request denial; worker
termination during capture/upload/finalize; bounded lease recovery; storage
outage and recovery; erasure during generation; event deletion; expiry and
cleanup. Unit/integration/HTTP tests cover application guards and filesystem
artifacts; they cannot establish a production bucket policy or operating setup.
