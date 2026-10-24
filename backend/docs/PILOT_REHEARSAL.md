# Disposable backend production rehearsal

Batch J / F45, 24 October 2026. The frontend is still being implemented. The user
selected a disposable local environment. This procedure exercises the production
application and workers with synthetic data; it cannot approve the pilot.

## Run

From `backend/`, with Docker available and the existing development stores left
running:

```sh
docker build -t aveline-api:pilot-j-local .
npm run test:pilot
npm run pilot:production-rehearsal
```

`PILOT_REHEARSAL_IMAGE` can select a different locally built image. Rebuild after
source/dependency changes. The runner mounts its current helper scripts read-only
and starts an independent network, Postgres database, Redis, Mongo, Mailpit, API
and three real workers. Its HTTP client accepts only loopback HTTP origins; the
API port is bound to 127.0.0.1. No environment credentials are inherited by the
containers. SMTP terminates in Mailpit; no real delivery is attempted.

Migrations deploy into the empty, owned database and the production seed runs
twice. No reset, shadow database or shared test database is used. Only resources
created by this invocation are removed. Do not interrupt cleanup with SIGKILL;
if the runner is forcibly killed, inspect its unique `aveline-j-*` resources and
remove only those resources. New runs record the exact prefix as
`environment.resourcePrefix` in the checkpoint report. Temporary credentials remain in the private state
directory until cleanup; never publish that directory or container inspection.

Sanitized checkpoints and generated artifacts are written to the ignored
`backend/test-results/pilot/aveline-j-*/` directory. `report.json` is replaced
atomically before each stage; `isRunning: true` means the run has not finished.
`exports-progress.json` records each completed file. These outputs survive host
restarts. Capability-bearing fixture state, database containers and working
storage remain disposable and are removed during normal cleanup. The report contains summaries and artifact hashes. All retained
files contain synthetic data only. Do not point this runner at real guests.

## Evidence and limits

The functional fixture has 400 named people, 100 households, two guest-facing
venues, 100 eight-seat tables and all four required locales. Historical fixture
attendance is inserted directly into the disposable database; subsequent policy
transitions, RSVP, guest corrections and normal host operations use HTTP. Those
fixture writes do not claim to exercise 400 guest submissions. The first
transition verifies that published seats become reservations. The per-venue
fixture then clears only its own seats and sets consistent RSVP summaries, so
the second worker pass must actually seat 320 and 240 eligible people.
Subject erasure is invoked by the guarded fixture through the normal transactional
erasure function; export revocation is checked through HTTP. The final check
targets the drawing uploader and waits for its cleanup ledger and actual private
file removal. Operator identity-verification and privacy UI acceptance remain
outside this local fixture.

The local Mailpit journey also exercises invitation sending, retry after SMTP
interruption, daily reminder deduplication, admission-based thank-you selection
and thank-you deduplication. Event dates are changed through HTTP for the
post-event part. Real provider delivery remains a separate gate.

The journey covers both attendance modes and explicit transitions in both
directions, two actual seating worker runs per mode, four-script invitation
responses, question ordering, named free checkout with per-attendee venue choices,
admission, listing/logo media, typed representative and drawn acknowledgements,
private image processing, host moderation and guest removal. It downloads all
seven export kinds in CSV/PDF/XLSX in four locales (84 worker-produced artifacts),
checks file boundaries and completed-snapshot immutability, then verifies expiry
retains host access and subject erasure revokes old exports. A second event tests
the 2,000-person CSV limit without enlarging the load fixture.

The load phases use 50 distinct personal links and a mix of four languages, four
waves per profile and at least 1.1 seconds between waves, respecting the ordinary
rate limits. Cold waves clear only the owned rehearsal Redis database. Warm,
Redis-disconnected, first recovery and recovered-warm phases are separate. Mixed
waves send 50 reads with 10 RSVP writers in distinct households. Dashboard and
block arrangement are measured separately after each mixed wave. Reports state
the request counts: the latter four-sample probes are smoke measurements, not a
statistically strong production capacity claim. Durations include the complete
HTTP body, and profiles retain unexpected status counts. The script fails on an
unexpected response or missing evidence; it also exits unsuccessfully when a
required p95 budget is missed. A failed budget must be investigated and rerun,
not renamed as acceptance. Run this workload without concurrent builds or test
suites. `--functional-only` skips load measurement for a functional rerun and
reports performance as unmeasured (`null`); it cannot close any latency gate.
The unit test command runs in one process to bound verification memory use.

The local server uses the same application factory/middleware as `main.ts`.
A private diagnostic sampler records peak RSS and event-loop delay. Prisma's
OpenTelemetry connection-acquisition spans provide duration/count/percentile
summaries (including waits and connection work, not a pure isolated pool-queue
measurement). No SQL, span attributes, user identifiers or collector/exporter are
retained. Only the first 50,000 timing samples are retained for percentiles;
aggregate count/total/max cover all spans. Missing instrumentation is unavailable,
not evidence of zero wait. These values cover the server lifetime up to capture;
API restart resets its sampler. Load telemetry is captured before restart.

Recovery checks stop/restart owned Redis, Mongo and Postgres, preserve a queued
export while its worker is killed, and restart the API before reading committed
data. A separate check locks the owned database’s standing/privacy fences,
observes both actual export and seating workers in RUNNING, kills them and the
lock holder, then waits for their real 90-second leases to expire. Both jobs
must finish on attempt two. No claim timestamp is rewritten. Private storage
permissions are temporarily removed to verify download 503 and recovery; Mailpit
is stopped to verify retry preservation and restarted for delivery. Only the
local fixture’s mail retry times and historical invitation send dates are
advanced, so this does not establish real-clock SMTP backoff or reminder-wait
acceptance. The immediate-reminder refusal is checked before aging those
synthetic invitation records. Filesystem storage on this machine is not S3
or off-host recovery evidence.

## Recorded local evidence — 24 October 2026

The isolated full workload used one API process with a ten-connection pool,
three separate workers and filesystem storage. It returned zero unexpected
statuses across 1,248 profiled requests. Its performance gate **failed**:

| Profile | Requests | p95 observed | Required p95 |
|---|---:|---:|---:|
| Cold personal invitations | 200 | 2,089.1 ms | <200 ms |
| Warm personal invitations | 200 | 160.0 ms | <50 ms |
| Recovered warm invitations | 200 | 121.4 ms | <50 ms |
| Concurrent RSVP writers | 40 | 3,516.5 ms | <300 ms |
| Dashboard smoke probes | 4 | 102.3 ms | <500 ms |
| Arrangement smoke probes | 4 | 40.0 ms | <300 ms |

Redis-disconnected personal reads also returned 200; their p95 was 1,851.4 ms.
Connection-acquisition p95 over the pre-restart server lifetime was 863.4 ms;
peak API RSS was 395,427,840 bytes. This points to connection use as an area to
investigate, rather than establishing a single cause. Profile cold-load query
fan-out, duplicated shared loads and concurrent transactions before tuning the
pool or changing cache behavior. Preserve live capability/revision checks.
A measured rerun is required after remediation.

That full run reached all 84 exports, dependency recovery, both actual worker
lease recoveries, local SMTP/storage recovery and the 2,000-person import. It
stopped at an incorrect fixture expectation: fresh invitations correctly could
not be reminded immediately. The corrected functional rerun explicitly checks
that wait, ages only synthetic invitation records, then verifies three reminder
sends and two admission-based thank-you sends with deduplication. The final
functional rerun passed every stage, including erasure of five
acknowledgements and one uploader drawing, with the cleanup ledger cleared and
the actual private files absent. It does not supply replacement performance
evidence.

All 28 PDF files were readable (924 total pages), all 28 workbook ZIP packages
passed CRC checks and were readable, and all 28 CSV files were present. Workbook
inspection found no executable formula cells. Sample guest-list, seating and
place-card pages were visually inspected, and PDF extraction retained all four
scripts. The workbook reader reported a missing default-style warning; native
spreadsheet/print and translation acceptance remain open.

The existing small backup drill passed with the corrected image: encrypted
local repository, fresh Postgres/Garage, one guest credential and media original/
variant intact. This is separate from the realistic/off-host recovery gate.

## Launch gates still open

- Frontend integration and human host/guest/mobile-door walkthroughs in English,
  Russian, French and Armenian, including localized validation/error text.
- Standard export headings/reasons remain English; current locale support
  resolves translated question/content labels and formats PDF times. Human
  translation review and native spreadsheet/print acceptance remain necessary.
- In-flight image-worker kill, concurrent manual seating conflicts and real
  provider at-least-once send reconciliation. Local seating/export lease kills
  and local mail/private-storage failures have runnable checks; deployment
  acceptance still requires repeating them against the intended stores.
- Real email sender/domain and Meta account/test number/template/callback proof.
  F22 native email feedback remains the explicit provider-neutral exception.
- Public API/host/media TLS, external uptime and alert delivery to an operator.
- Fresh-store restore of a realistic recovery set fetched from the configured
  off-host destination, including private images and generated artifacts; measured
  restoration/capture interruption and approved RPO/RTO/maintenance policy.
- Every missed performance budget remediated and its workload rerun on the
  intended deployment. Local success cannot replace production acceptance.

The pre-existing `npm run backup:rehearsal` exercises paired Postgres/Garage and
an encrypted local restic repository. It remains a separate small fixture and
must not be described as the realistic or off-host launch rehearsal.

## Rehearsal-discovered regressions

The first run rejected ordinary JSON login bodies. Nest identifies existing JSON
parsers by middleware function name; the route-scoped WhatsApp parser suppressed
its global parser. A named wrapper now preserves global parsing, with a failing-
then-passing HTTP regression test. All ten WhatsApp HTTP boundary tests pass,
including exact signatures, malformed/large bodies and compression rejection.
No endpoint or client payload contract changed.

The next run exposed binary corruption: the global BigInt JSON serializer
expanded `StreamableFile` objects. It now preserves the stream instance. Unit
and HTTP coverage include real CSV/PDF/XLSX bytes with the production serializer;
private drawing coverage checks the PNG signature with that interceptor enabled.
The gallery rehearsal also checks the WebP file boundary.
