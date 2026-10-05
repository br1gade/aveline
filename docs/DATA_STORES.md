# Data Stores

Three stores. Each has one job, and the boundary between them is a rule, not a
preference.

| Store | Holds | Losing it costs |
|---|---|---|
| **PostgreSQL** | The entire domain. The only source of truth | Everything |
| **Redis** | Cached reads, rate limits, job queue. Rebuildable | Latency |
| **MongoDB** | Append-only analytics. Never domain state | Insight, not correctness |

---

## 1. PostgreSQL — the domain, all of it

Every entity in [PRODUCT_SPEC.md](PRODUCT_SPEC.md) §4 lives here and nowhere
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

## 2. Redis — speed, never truth

Redis holds only data that can be rebuilt from Postgres. The governing rule:

> **A cache outage must not become a product outage.**

Every method in `CacheService` degrades to "not cached" and lets the request
proceed against Postgres. The client is configured with
`enableOfflineQueue: false` and `maxRetriesPerRequest: 1` so an unreachable
Redis fails immediately rather than queueing requests behind it.

### In use

**Invitation payload cache.** The hottest read in the product: one link opened
by every guest, usually within minutes of being sent, and the payload is
identical for everyone reading the same language. Keyed by slug **and** locale
so a cached Armenian page can never be served to a Russian reader. TTL is a
backstop; any write that changes what the page renders invalidates immediately.

The **personalized** variant is deliberately *not* cached — it is per-guest by
definition, so caching it would multiply the keyspace by the guest count for no
reuse at all.

Invalidation uses `SCAN`, never `KEYS`. `KEYS` blocks the Redis event loop
across the whole keyspace and stalls every other client on a shared instance.

**Every component of a cache key must be bounded.** The locale in the key comes
from a public query parameter, and it was briefly taken at face value: 50
requests with junk locales created 50 entries. On an unauthenticated endpoint
with `allkeys-lru`, that lets anyone evict every real entry and send the load to
Postgres. The locale is now negotiated against the event's published list, so
the keyspace per invitation is bounded by the number of languages it offers.
Measured after the fix: 100 junk requests, 1 key.

Treat this as the general rule, not a one-off. Before any value becomes part of
a cache key, ask what bounds it.

### Measured

With Redis stopped mid-flight, the invitation endpoint keeps serving correct
content in ~20 ms — the payload is simply rebuilt from Postgres each time.

### Also in use

**Rate limiting.** A global throttle (10/s, 100/min) stands in front of every
route, which matters most for the unauthenticated ones — RSVP, ticket checkout
and payment registration.

**Distributed locks.** Each scheduled sweep takes a lock with `SET NX EX`, one
atomic operation, so two API instances cannot both run it. If Redis is
unreachable the sweeps are skipped rather than run unguarded: delaying a
message is better than sending it twice.

### Intended, not yet built

- **Job queue** (BullMQ) for retryable per-item work — exports, image
  processing, seating computation. Cron plus a lock covers periodic sweeps and
  is far less machinery; a queue is for work that must retry individually
- **Per-actor rate limits** rather than one global throttle

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

- **Audit trail** — who changed what. Matters most for `SUPPORT` staff acting
  on a customer's behalf. Blocked on authentication
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

Both of the failures above were found by stopping a container against a running
API, not by a test. **Run the degraded path by hand before trusting it**: a unit
test proves the error is caught, not that the timeout is short enough or that
the client recovers.
