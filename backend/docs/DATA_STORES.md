# Data Stores

Three stores. Each has one job, and the boundary between them is a rule, not a
preference.

| Store | Holds | Losing it costs |
|---|---|---|
| **PostgreSQL** | The entire domain. The only source of truth | Everything |
| **Redis** | Cached reads, rate limits, sweep locks. Rebuildable | Latency |
| **MongoDB** | Append-only analytics. Never domain state | Insight, not correctness |

---

## 1. PostgreSQL — the domain, all of it

Every entity in [PRODUCT_SPEC.md](../../docs/PRODUCT_SPEC.md) §4 lives here and nowhere
else. The guest graph is the product's core asset and it is deeply relational:
households own guests, guests carry attribution, seats reference both tables
and guests, memberships join users to organizations and events. Foreign keys,
unique constraints and transactions are the features we are paying for.

**Nothing that must be correct lives outside Postgres.**

### Why JSON columns rather than a document store

`InvitationBlock.content`, `Invitation.theme` and `RsvpQuestion.prompt` hold
variably shaped, translated data. They stay in Postgres as `Json` columns
because they belong to aggregates with foreign keys. Moving them to MongoDB
would split one aggregate across two stores with no transaction spanning them —
an invitation whose blocks could be written without the invitation, or orphaned
when it is deleted. JSONB handles the shape; splitting the aggregate solves
nothing and costs consistency.

---

### Email delivery correctness

**Email provider budgets live in Postgres.** `EmailSendQuota` is a shared token
bucket with integer credits plus a UTC daily budget. Reservations serialize on
one sender-budget row and persist across API/Redis restarts. Production defaults
to 60 sends/minute, burst 5 and 1,000/day; tune `EMAIL_SENDS_PER_MINUTE`,
`EMAIL_SEND_BURST`, `EMAIL_SENDS_PER_DAY` and `EMAIL_SEND_CONCURRENCY` to the
selected provider. Configured concurrency is capped at 20. A quota wait happens
before claiming a message and consumes no retry attempt. Reservations for a
send that subsequently fails/loses its claim remain consumed conservatively.
If the quota database is unavailable, dispatch stops before claiming a message
and reports failure to the sweep monitor; no email is sent without its allowance.

**Email feedback also lives in Postgres.** The signed provider-neutral boundary
stores only receipt/message ids, an outcome and clocks. Message changes and
global suppressions are applied transactionally, with row locks; duplicate,
out-of-order and pre-acknowledgement feedback cannot undo permanent outcomes.
Unmatched receipts rotate by `lastCheckedAt` so fifty unknown ids cannot starve
the rest, expire after seven days, and processed receipts expire after thirty.
There is no native provider adapter yet.

**WhatsApp receipts also live in Postgres.** A single atomic insert accepts up
to 1,000 normalized outcomes after raw-byte authentication. `WhatsAppReceipt`
retains scope/provider reference, outcome, error code and clocks, never contact
numbers, raw descriptions or full payloads. Composite channel/account/sender/
provider-reference uniqueness on Message prevents cross-sender correlation.
A row-locked minute sweep processes at most 200 receipts, five at once, and
rotates unmatched work by `lastCheckedAt`. Pending expires at seven days,
processed at thirty. Early callbacks wait for scoped send acknowledgement;
erased contacts are never mutated. Delivery/read evidence cannot be downgraded
by sent/failure. Failures never automatically suppress or resend. Redis holds
only the sweep lock; an outage delays application while accepted receipts
remain durable. The `whatsapp.receipts` monitor must notice sweep failure and
lag must be measured during real pilot acceptance.


---

## 2. Redis — speed, never truth

Redis holds only data that can be rebuilt from Postgres. The governing rule:

> **A cache outage must not become a product outage.**

Every method in `CacheService` degrades to "not cached" and lets the request
proceed against Postgres. The client is configured with
`enableOfflineQueue: false` and `maxRetriesPerRequest: 1` so an unreachable
Redis fails immediately rather than queueing requests behind it.

### In use

**Shared and personalized invitation caches.** Shared payloads use
`aveline:invitation:<slug>:<negotiatedLocale>:v2:<eventId>:<revision>`; personal
projections use `aveline:personal:v1:<eventId>:<guestId>:<negotiatedLocale>:<revision>`.
Shared TTL is `INVITATION_CACHE_TTL` (default 300 seconds); personal TTL is at
most 300 seconds. Locale is negotiated against the event's published list,
never an arbitrary query string. Old revisions expire naturally. Personal
projections contain names, household, attendance, RSVP and authorized seating;
they exclude raw capabilities, contacts, signature evidence and token-bearing
links. Telegram links are generated only after final authorization.

Each request reads **Postgres before and after** retrieving/building the
payload: publication, expiry, visibility, guest identity/erasure and revision
are authoritative even on a warm hit. Missing/expired/revoked access returns
404; a changed revision retries at most three times, then returns 409 for the
client to retry. There is no Redis page-meta authorization shortcut. Both
invitation GET routes return `Cache-Control: private, no-store`; Redis caching stays server-side.

**Durable invalidation.** Row triggers on events, invitations, templates,
blocks, questions, media, venues/timeline, guests/households, RSVP/attendance,
seating, tickets and private contributions append one `GuestPageChange` per
event/transaction. The revision is `GuestPageVersion.revision` plus the count
of committed ledger rows, in one SQL snapshot. Counting rather than taking the
largest transaction id handles older transactions committing last. Rollback
also rolls back its invalidation. This covers raw SQL, imports, workers and
erasure, including Redis downtime. An old in-flight reader may populate its
old key, but the final revision check retries and future reads cannot use it.

The minute `invitations.maintain-access` sweep locks up to 50 version scopes
and atomically compacts at most 1,000 ledger rows into base counts without
changing visible revisions. The append ledger deliberately has no event FK:
writes must not acquire event locks after household/seating locks. Up to 1,000
orphan metadata rows are reclaimed per run. Metadata contains only ids and
transaction numbers. Redis failure pauses the sweep, so monitor ledger growth;
request correctness does not depend on the sweep running. Restore Postgres
with an empty/rebuilt Redis: restoring an older database can rewind revisions.

Existing explicit invalidation uses `SCAN`, never `KEYS`, and retains the general
cache adapter’s Redis generation guard. Invitation freshness now depends on the
durable revision rather than successful Redis deletion. A cache outage falls
back to Postgres for both layers, and recovery cannot revive stale access.

### Measured

The earlier ~20 ms Redis-outage measurement predates personalized caching and
live capability/revision checks. Use `npm run pilot:cache` for the current
400-person, 100-household, two-venue/800-seat HTTP workload, with 50 concurrent
distinct guest/locale reads in each warm, cold, disconnected and recovered phase.
It uses the guarded test database without truncation and reports no capability
URLs. Production proxy/TLS, analytics and mixed writes still require batch J.

Latest local p95 (19 October): warm 39.2 ms, cold 103.7 ms, disconnected
116.7 ms, recovered 63.2 ms; zero unexpected responses. Earlier warm bursts
reached 108 ms; the latest recovered phase misses the 50 ms warm target.
Production acceptance needs an actual-host rerun and remediation of missed
budgets in batch J. The full
workload and percentiles are recorded in
[PILOT_IMPLEMENTATION_PLAN.md](../../docs/PILOT_IMPLEMENTATION_PLAN.md#9-milestone-h--lifetime-and-personalized-cache).

### Also in use

**Rate limiting** is not in Redis: the throttle counts in each instance's
memory. A signed-in caller is counted per account, anyone else per address
(10/s, 100/min), and a guest's own invitation page more generously (50/s,
3,000/min) because a whole room opens it on one Wi-Fi.

**Distributed locks.** Each scheduled sweep takes a lock with `SET NX EX`, one
atomic operation, so two API instances cannot both run it. If Redis is
unreachable the sweeps are skipped rather than run unguarded: delaying a
message is better than sending it twice.

### Intended, not yet built

- **Throttle counts in Redis**, so several API instances share one limit

### Decided differently

**Sessions live in Postgres, not Redis.** They were going to go here, but a
session must be revocable and auditable, and losing the store would sign
everyone out — which fails the "only what can be rebuilt" rule above.

**Idempotency is a database constraint**, not a Redis key. A unique column
holds under concurrency; a cache entry can be evicted at exactly the wrong
moment.

---

## 3. MongoDB — append-only observability



MongoDB holds data that is written far more often than it is read, never joined
against the domain, and whose shape changes as we learn what to measure.

### The test for putting something in Mongo

All four must hold. If any fails, it belongs in Postgres.

1. **Append-only.** Written once, never updated in place.
2. **Never joined** to domain entities in a query.
3. **Variably shaped**, and the shape will keep changing.
4. **Losing it costs insight, not correctness.** No user-visible behaviour
   depends on it.

### In use

**Invitation engagement** (`invitation_events`). Who opened an invitation, in
which language, when. Feeds the engagement panel on the operations dashboard
and tells us which invitations are actually being read — the leading indicator
for response rate.

**Audit trail** (`audit_trail`). Who did what — method, route, account,
organization, event, status — and never a request body. What makes `SUPPORT`
staff acting on a customer's behalf accountable.

**Both expire on their own** (decided 10 October 2026): invitation views
after 13 months, enough to compare a season with the same one a year on; the
audit trail after two years, long enough to answer a dispute about what
support did. TTL indexes on `at` do it, created at start-up with the
`{eventId, at}` index each collection is read by. Neither grew bounded
before.

**One connection, however many callers.** Calls arriving while the client
was still connecting each opened a client of their own, and only the last
was kept; they now share the connect in progress.

**Erasure reaches both.** Once an erasure has committed in Postgres, the
person's address is removed from their audit entries (the entries stay) and
their invitation views lose the `guestId`, browser and referrer that tied
them to the person (the counts stay).

Writes are fire-and-forget: a guest's page never waits on analytics, and a
Mongo outage returns an empty summary rather than failing the dashboard.
Aggregation runs in Mongo, never by pulling documents into Node, because the
collection grows without bound.

#### Two failures found by actually stopping Mongo

Both were fixed; both are the reason this section exists.

**The read held the whole dashboard.** The driver's server-selection timeout is
far longer than the dashboard's entire latency budget, so an unreachable Mongo
turned a 15 ms response into a 2 s one. `invitationViewSummary` now bounds
itself with its own timeout and yields an empty summary first. Analytics is the
least important panel on the screen, so it is the one that gives way.
Measured: **2.0 s → 6 ms** with Mongo down.

**The client never recovered.** The driver permanently closes its topology when
a connection attempt fails, so starting the API while Mongo was down disabled
analytics until the process restarted — long after Mongo itself was healthy.
`MongoConnection` now owns the client's lifetime, builds it lazily, and discards
it whenever an operation reports a closed topology, so the next call builds a
fresh one. Verified by starting the API with Mongo stopped, then starting Mongo:
engagement resumed with no restart.

### Intended, not yet built

- **Delivery logs** — email, SMS and webhook receipts, whose payload shapes are
  dictated by third parties

### Where Mongo would be wrong

Being explicit, because this is the mistake to avoid:

- **Guests, households, seats** — relational, constrained, transactional
- **Invitation blocks and themes** — belong to an aggregate with foreign keys
- **Anything a user edits and expects to persist correctly**

---

## 4. Local development

```bash
npm run db:up    # Postgres :5433, Redis :6380, Mongo :27018
```

All three bind non-default ports so they cannot collide with instances already
running on the host.

Redis runs with `--maxmemory 256mb --maxmemory-policy allkeys-lru` and
`appendonly no`: it is a cache, so eviction is correct behaviour and
persistence would be waste.

### Tests

Integration and e2e run against real Postgres. Redis and Mongo failures are
covered by **unit** tests that inject a failing client, because what matters is
that the service degrades rather than that the server is reachable — and those
tests must stay fast and runnable with neither container up.

**Mongo cannot be reached from Jest at all.** Driver 7's handshake builds
its client metadata as a `Map` and BSON-serialises it; inside Jest's sandbox
that comes out empty and the server refuses the connection ("Missing
required sub-document 'driver'"). So no e2e test exercises a real Mongo
write — the app degrades as designed and the tests pass. Index and TTL
behaviour was checked against real Mongo from plain Node. Redis is
unaffected and has a real-server integration test.

Both of the failures above were found by stopping a container against a running
API, not by a test. **Run the degraded path by hand before trusting it**: a unit
test proves the error is caught, not that the timeout is short enough or that
the client recovers.


### Private export jobs

`ExportSnapshot` is the durable queue, not Redis: losing a claim or publication
must not silently lose an accepted host request. Export-specific claims use
Postgres row locks, attempt tokens and expiring leases. Consistent inputs and
subject references are captured in a short repeatable-read transaction;
CSV/PDF/XLSX rendering and storage IO happen afterwards in a separate process. An object ledger
is committed before upload. Publication checks standing and ownership again.
Erasure fences capture/publication and revokes affected jobs; the cleanup ledger
survives cascading event deletion. See [EXPORT_WORKER.md](EXPORT_WORKER.md).

Not yet built: translated standard export headings and conversion of
legacy live-CSV clients to the additive snapshot contract.

### Automatic seating jobs

`SeatingJob` uses its own durable Postgres claims/leases, independent of storage
or Redis. A partial unique index permits one active job per arrangement. Database
triggers maintain arrangement revisions across tables, seats, release flags,
guests, RSVP/attendance, venue/timeline edits and policy/archive changes. The
worker captures bounded repeatable-read inputs, computes outside transactions,
and applies only after locking/revalidating current inputs and standing. Seats
and completion commit together; stale owners roll back every seat. See
[SEATING_WORKER.md](SEATING_WORKER.md). Frontend integration and actual production
recovery/load acceptance remain open.


## Private guest images and acknowledgements

`QuestionStatement`, `GuestAcknowledgement` and `GuestMedia` live in Postgres.
The private storage port holds raw/drawing/gallery files and processed variants;
no raw key/public URL enters a media library or guest payload. Image processing
uses a separate bounded worker with leases/claim tokens, not Redis correctness or
inline decoding. Removed/orphaned tombstones survive event deletion and repeatedly
reclaim late writes. Metadata/subject records follow verified privacy erasure;
physical file cleanup is asynchronous and durable. See
[GUEST_CONTRIBUTIONS.md](GUEST_CONTRIBUTIONS.md) for quotas, access and recovery.
Production storage isolation/restore and frontend acceptance remain launch gates.

### Local rehearsal diagnostics

The disposable J runner uses `scripts/pilot/serve.mjs` with the shared application
factory. A local-only OpenTelemetry processor aggregates Prisma connection
acquisition durations; it stores no span attributes or SQL and has no network
exporter. Private sampler files also capture RSS/event-loop delay. This adds no
production HTTP diagnostic endpoint or correctness dependency; see
[PILOT_REHEARSAL.md](PILOT_REHEARSAL.md). Production acceptance remains open.
