# Architecture

The frame every feature plugs into. Read this before adding a module — most
of what a new feature needs already exists here, and inventing a second copy
is how a codebase stops being navigable.

---

## 1. Shape

```
src/
  infra/            cross-cutting; owned by nobody, used by everybody
    auth/           sessions, the guard, @Public / @RequirePermission
    cache/          Redis read-through, degrades to Postgres
    analytics/      MongoDB engagement, self-healing connection
    storage/        storage port; adapters/ holds Garage (S3) and local disk
    jobs/           scheduled sweeps behind a Redis lock
    health/         liveness and readiness
    logging/        structured logs, request-id correlated
    observability/  Sentry error reporting
  common/           locale resolution, error filter, request correlation
  modules/          the domain
    access/         permission policy — pure, table-driven
    events/ guests/ invitations/ rsvp/ operations/
    seating/        tables, seats, the packing algorithm
    payments/       providers/ holds one adapter per bank
    ticketing/      inventory, checkout, admission
    public-events/  announcements and listings
    communications/ outbox; channels/ holds one transport each
    media/          uploads, recorded as MediaAsset
    devices/        push registration tokens
  prisma/           PrismaService
```

**`infra/` versus `modules/`.** If two unrelated features would both need it,
it is infrastructure. If it encodes a product rule, it is a module. Payments
is a module despite feeling infrastructural, because what a captured payment
*means* is a product decision.

## 2. Request lifecycle

All routes are served under `/api/v1`.

```
boot
  → initialiseSentry        first, before any module loads
  → validateEnv             missing config stops the boot, not the first request

request
  → RequestIdMiddleware     assigns x-request-id, honours one from upstream
  → pino-http               logs the request, carrying that id
  → ThrottlerGuard          10/s, 100/min
  → AuthGuard               verify token → resolve roles → check permission
  → ValidationPipe          whitelist, reject unknown fields, transform
  → controller → service → Prisma
  → SerializeInterceptor    BigInt → string, globally
  → AllExceptionsFilter     one error shape, request id attached;
                            5xx reported to Sentry, 4xx never
```

### Logging

Structured, via pino replacing Nest's logger app-wide — so the fifteen
services already calling `new Logger(X)` emit correlated lines without any of
them changing.

| | |
|---|---|
| **Format** | JSON in production for a log shipper; pretty locally for a human |
| **Level** | `LOG_LEVEL`, defaulting to `info` in production and `debug` elsewhere |
| **Correlation** | Every line carries the same `x-request-id` the response does, so a user's screenshot maps to the exact request |
| **Severity** | 4xx is `warn`, 5xx is `error`. A 404 is the caller's mistake; logging it as an error buries real incidents |
| **Redaction** | Authorization and cookie headers, passwords, refresh tokens and email addresses never reach a line |
| **Noise** | Health checks are not logged. Every few seconds they would drown everything else |

### Error reporting

Sentry, **errors only**. Tracing is set to zero and profiling needs an
integration that is simply not added — both are a separate decision with their
own cost.

`beforeSend` strips what the SDK would otherwise carry off-site: credential
headers, capability tokens embedded in URLs, and request bodies entirely —
bodies here hold guest names, emails and dietary notes, none of which helps
diagnose a stack trace and all of which is personal data.

Only 5xx is reported. Without a `SENTRY_DSN` it stays off, which is how
development is quiet without needing a flag.

### Service health in Sentry — without tracing

Two things watch the system, neither of which is tracing:

**Cron check-ins.** Each sweep runs inside `Sentry.withMonitor`, so Sentry
alerts when one stops running *at all*. That is the failure mode worth
catching: these three sweeps were implemented and inert for weeks and nothing
said so.

**Dependency transitions.** `HealthWatchService` probes Postgres, Redis and
Mongo every minute and reports only *changes* — edge-triggered, never
level-triggered. A check that re-reported "Redis is down" on every probe would
send one alert a minute for an entire outage, and the first thing anyone does
with a repeating alert is mute it, which is also how the next one gets missed.

Severity follows [DATA_STORES.md](DATA_STORES.md): losing Postgres is `fatal`
because it holds the domain; Redis and Mongo are `warning` because they
degrade the product rather than break it.

Verified by stopping Redis against a running app: silent while healthy, one
alert on failure, no repeat for the duration, one recovery message carrying
the outage length — and the API served normally throughout.

Tracing is still off. It would sample spans and cost a budget to answer what a
four-line probe already answers.

### Authentication is default-on

`AuthGuard` is registered as an `APP_GUARD`, so **every route requires a
session unless it says otherwise**. A route opts out with `@Public()`, which
is a visible decision in the diff rather than an omission nobody notices.

Three populations reach the system without accounts, each by capability
token: guests (invitation link), ticket buyers (order token), vendors (brief
token). See [ACCESS_CONTROL.md](../../docs/ACCESS_CONTROL.md).

### Authorization is two questions, kept apart

1. **May this kind of actor do this kind of thing?** — `access-policy.ts`, a
   pure function over lookup tables, exhaustively testable without a database.
2. **What is their standing on *this* resource?** — the guard, reading
   membership from the database on every request.

Roles are never read from the token. A token minted before someone was
removed from an event must not still carry their old role.

### Event scope must be declared

Ownership cannot be inferred from parameter names. `/events/:eventId/...`
names the event directly, `/invitations/:slug/...` indirectly, and
`/payments/:orderNumber` not at all. A route that is scoped to an event but
does not name it as `:eventId` or `:id` says so with `@EventScope(...)`.

This was found the hard way: the block-arrangement route is keyed by
invitation slug, so the guard found no event, resolved no roles, and returned
403 to a user who should have been allowed. Guessing silently denies.

## 3. Background work

Three sweeps keep the system honest, and each was implemented and **inert**
until `JobsService` existed:

| Sweep | Interval | Without it |
|---|---|---|
| `communications.dispatchDue` | 1 min | Invitations are never sent |
| `payments.reconcile` | 5 min | A paid order stays pending |
| `ticketing.releaseExpiredReservations` | 5 min | Abandoned baskets hold seats forever |

Each takes a Redis lock with `SET NX EX` — one atomic operation, so exactly
one instance runs it. The TTL is shorter than the interval and never extended:
an instance that dies holding the lock delays one run rather than stopping the
sweep forever. If Redis is unreachable, sweeps are skipped rather than run
unguarded, because double-dispatching messages is worse than delaying them.

**BullMQ is still the right answer for queued, retryable, per-item work** —
image processing, exports, seating computation. Cron plus a lock is correct
for periodic sweeps and is far less machinery.

## 4. Degradation

| Store | Unreachable | Effect |
|---|---|---|
| **Postgres** | Readiness fails | Hard outage. It holds the domain |
| **Redis** | Readiness still passes | Cache misses go to Postgres; sweeps pause |
| **MongoDB** | Readiness still passes | Engagement reports zero |

Only Postgres gates readiness. Taking an instance out of rotation for a Redis
outage turns a slowdown into an outage. Measured: with Redis and Mongo both
stopped, the invitation endpoint serves correct content in ~20 ms.

## 5. Conventions a new module follows

- **Ports with adapters** where a third party is involved. Payments, messaging
  and storage all use it: one interface, one adapter per provider, selected by
  configuration, with a fake for tests. A missing provider reads as "not
  configured" rather than failing when a customer is mid-flow.
- **Lookup tables over branching.** `access-policy.ts` and the ArCa status map
  are the references. Adding a case is adding a row.
- **Money is integer minor units.** Never a float. AMD has no subunit.
- **Idempotency is a database constraint**, not a check. Read-then-create
  still double-charges under concurrency.
- **Invariants live in the WHERE clause.** Ticket inventory is a conditional
  `UPDATE` plus `CHECK` constraints, not a read-decide-write.
- **Translated content is `Json` keyed by locale**, resolved with fallback.
  A requested locale is negotiated against what the event publishes, never
  trusted — it becomes a cache key.
- **Errors are thrown, never returned.** The filter decides what a client sees.
- **Lists return a page envelope.** `PaginationQuery` in, `toPage(...)` out —
  `{ items, total, limit, offset, hasMore }`. An out-of-range limit is a 400,
  not a silent clamp: a client asking for 500 and receiving 100 cannot tell.
- **Money needs no manual conversion.** `SerializeInterceptor` turns every
  BigInt into a string on the way out. Strings, not numbers, because a
  JavaScript number cannot hold every integer we store.
- **Files go through `StorageService`**, never straight to disk or a bucket.
  It enforces the type allowlist and size ceiling wherever the file came from,
  and the adapter behind it is chosen by configuration. See [STORAGE.md](STORAGE.md).

## 6. Adding a feature

1. Read the governing doc; check its "not yet built" section.
2. Write the failing test at the cheapest layer that can fail for the real
   reason (`CLAUDE.md` §8).
3. Build it, reusing the infrastructure above rather than a second copy.
4. Decide `@Public()` or `@RequirePermission(...)`, and `@EventScope(...)` if
   the route does not name its event directly.
5. Update the doc in the same commit.
6. `npm run verify`.

## 7. Production posture

Three things behave differently when `NODE_ENV=production`, each because the
development default is dangerous:

| Setting | Development | Production |
|---|---|---|
| `JWT_SECRET` | a known default | **required**, boot fails without it |
| CORS | any origin | **only** `CORS_ORIGINS`, else none |
| `/docs` | served | not served |
| `FAKE` payment gateway | registered | refused |

## 8. Still missing from the frame

- **BullMQ** for queued work with retries and backoff. Cron plus a lock covers
  periodic sweeps; per-item retryable work needs a queue
- **Audit trail** — Mongo-shaped, and unblocked now that auth exists
- **Structured JSON logging** — request ids correlate, but the format is still
  Nest's human-readable default
- **Metrics and tracing**
- **Per-actor rate limits** — the throttle is global, not per account
- **Outbound webhook signature verification**
- **API versioning** — the prefix is `/api` with no version in it

See [BACKEND_GAPS.md](GAPS.md) for the product-level list.
