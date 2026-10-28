# Background automatic seating

Implemented 18 October 2026. The API durably queues a `SeatingJob`; a dedicated
process computes its plan. Manual seat moves and table edits remain direct.
See [API.md](../../docs/API.md) for the breaking auto-assign contract and
[VENUES_AND_SEATING.md](../../docs/VENUES_AND_SEATING.md) for planning rules.

## Run and monitor

```sh
npm run build
npm run start:seating-worker
```

Production Compose includes `seating-worker`: one concurrent job per process,
256 MiB JS heap, 384 MiB container memory, one CPU and a 60-second graceful stop.
It starts neither HTTP nor cron sweeps and needs Postgres; Redis, Mongo, private
file storage and email providers are not dependencies. API startup accepts jobs
but does not process them. Deploy API and worker from the same release after
applying migrations; coordinate the queued response with the frontend.

The worker polls every two seconds and writes a protected heartbeat at
`/tmp/aveline-seating-worker-heartbeat` after a successful queue operation.
`SEATING_WORKER_HEARTBEAT_PATH` overrides that location. Run
`node scripts/check-seating-worker.mjs` to detect missing/non-numeric/stale
heartbeats (120 seconds). Alert on unhealthy workers, queued work not advancing,
terminal failures and repeated `STATE_CHANGED` retries. Docker health alone
does not restart an unhealthy container. Logs contain job ID, attempt and safe
failure code, not guests, tokens, queries or credentials.

SIGTERM/SIGINT stop new claims, finish the active attempt and close connections.
SIGKILL/container loss leaves a lease that another process can recover. Multiple
workers use `FOR UPDATE SKIP LOCKED`; one arrangement has at most one active job,
enforced by a partial unique index as well as API admission. Keep clocks in sync. The backup coordinator
quiesces/resumes both named worker services and records them in its recovery
journal, including when capture fails or the host restarts.

## Capture, compute and apply

1. Claim a job with a unique owner token and a 90-second lease, renewed every
   15 seconds. Snapshot bounded inputs in a repeatable-read transaction, recording
   attendance and arrangement revisions and capture time. Only IDs, capacities,
   attribution and household relationships enter the planner; names/contact
   details/capabilities are not persisted in job inputs or results.
2. Compute the existing additive household plan outside every database
   transaction. Already-seated people stay put; late members join their family's
   existing table or remain unseated with a reason. Capacity and household
   cohesion remain hard constraints.
3. Take the event policy fence exclusively; recheck requester standing and
   archived state. Lock guest/answer/table inputs without waiting on busy rows,
   then lock the arrangement and reload bounded current inputs. A changed
   revision or busy input discards the plan and retries. Revalidate whole
   eligible households, table space and venue budget before inserting.
4. Insert all new seats, clear their release markers and mark the job completed
   in one transaction guarded by the current lease. A stale owner rolls the
   whole transaction back. Record the applied revision and result counts/reasons.

`SeatingArrangement.revision` is maintained by database triggers, including
bulk SQL and cascades: table/seat/release changes affect their arrangements;
guest/RSVP/current attendance changes, venue/timeline edits and policy/archive
transitions conservatively invalidate event arrangements. An edit followed by
an undo still changes the revision. Ticket cancellation and subject erasure
cannot let a pre-change plan be applied. Erasure retains anonymous operational
headcounts according to the existing privacy policy; retry uses the current
anonymized graph. Event/arrangement deletion cascades its jobs.

Permission checks lock the current user and membership rows during application,
so a revocation cannot commit between the check and seat publication. Capture
locks are released before computation. Table mutations take the policy fence
before table locks; busy identity/answer rows cause a retry without splitting
households or waiting while holding a partial household.

## Bounds and outcomes

Each arrangement permits 500 tables and 5,000 seats; its event permits 5,000
guests for automatic planning. Bounds are checked before capture and apply
locks. Capture/application transactions have 20-second timeouts and 5-second
maximum connection waits. Computation has a 30-second elapsed limit checked
before applying; bounded inputs and process limits constrain its resource use.
These are safety limits, not production throughput guarantees.

Each job has at most three total claims, including crash recovery and state
conflicts. Retry delay is bounded exponential backoff. Terminal failures need
an explicit new UUID request; repeating an accepted UUID returns its same job.
Safe failure codes:

| Code | Meaning |
|---|---|
| `STATE_CHANGED` | Inputs changed or are busy; retry from a fresh snapshot |
| `ACCESS_REVOKED` | Requester is inactive, removed or lacks seating permission; terminal |
| `EVENT_UNAVAILABLE` | Event is archived; terminal |
| `INPUT_LIMIT_EXCEEDED` | Guest/table/seat bounds exceeded; terminal |
| `PLANNING_LIMIT_EXCEEDED` | Computation exceeded its elapsed limit; terminal |
| `LEASE_EXHAUSTED` | Final claim expired without completion; terminal |
| `LEASE_LOST` | Former owner cannot apply; current owner/lease decides the outcome |
| `INVALID_PLAN` / `PLANNING_FAILED` | Safe validation/internal failure; bounded retries |

Status and committed results are available through authenticated event routes.
The latest-50 history omits result details; fetch an individual job for unseated
household IDs, sizes and reasons. Results describe that attempt, not the current
live room; refresh tables after completion. No queued client applies seats itself.

## Verification and remaining release gates

Real database tests exercise manual moves/table edits/late answers, mode changes,
permission removal, archive, raw ticket cancellation, erasure, input bounds,
lease-owner changes, exhausted leases and real worker termination/replacement
with graceful shutdown during an active recovered claim. Four-script 400-person fixtures cover two separate
venues in both attendance modes, including 400/200 venue eligibility and SQL
checks against split households or overfull tables. HTTP tests verify queue-only
admission, UUID validation, deduplication, polling and current authorization.

Verification on 18 October: `npm run verify` passed lint, docs, OpenAPI, build,
**1,070 unit + 424 integration + 583 HTTP tests = 2,077 tests**. All eight
backup/coordinator checks passed; Compose configuration validates without
loading service environment files.

Job HTTP summaries now add localized `recovery` copy and actions while retaining
machine `failureReason` values. Deferred invalidation advances each arrangement
once per transaction at completion; the worker flushes its seat/release triggers
before recording `appliedRevision`. This shortens cross-household revision locks
without allowing a stale captured plan to apply.

Frontend polling/result displays, human translation review, actual production
worker health/recovery and the mixed-write/load rehearsal remain launch gates.
More sophisticated zone/adjacency preferences and non-additive re-planning stay
outside this batch; manual corrections remain available.
