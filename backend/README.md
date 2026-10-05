# Aveline Backend

Event invitations, the guest graph, and the operations derived from them.

> **Status: under local development.** Not deployed, no real users, no real
> money. Everything runs against local containers. See
> [../docs/GOING_LIVE.md](../docs/GOING_LIVE.md) for what has to be true before that changes.

| Doc | Covers |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Engineering rules — binding here |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The frame: lifecycle, auth, jobs, degradation |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | Every model and the database's invariants |
| [`docs/DATA_STORES.md`](docs/DATA_STORES.md) | Postgres / Redis / MongoDB |
| [`docs/STORAGE.md`](docs/STORAGE.md) | Garage object storage |
| [`docs/GAPS.md`](docs/GAPS.md) | What is still unbuilt, prioritised |
| [`../docs/API.md`](../docs/API.md) | **The client contract — update it when a response shape changes** |
| [`../docs/PRODUCT_SPEC.md`](../docs/PRODUCT_SPEC.md) | Product definition and domain model |
| [`../docs/ACCESS_CONTROL.md`](../docs/ACCESS_CONTROL.md) | Accounts, roles, permissions |
| [`../docs/INVITATION_DESIGN.md`](../docs/INVITATION_DESIGN.md) | Templates, blocks, media, signatures |
| [`../docs/VENUES_AND_SEATING.md`](../docs/VENUES_AND_SEATING.md) | Venues, tables, seats |
| [`../docs/PAYMENTS.md`](../docs/PAYMENTS.md) | Card acquiring: gateways, sandboxes |
| [`../docs/GOING_LIVE.md`](../docs/GOING_LIVE.md) | Production blockers |

**Stack:** TypeScript · NestJS 11 · PostgreSQL 16 · Prisma 6 · Redis 7 · MongoDB 7

All routes are under `/api/v1`.

---

## The idea in one paragraph

An invitation is the only moment when every guest voluntarily hands you
structured data, weeks ahead of the event. Ask the right questions once, and
the headcount, catering sheet, bar order, playlist and seating constraints stop
being manual work and become queries. This codebase is that thesis: the guest
graph is the single source of truth, and everything under `modules/operations`
is a derived view over it. Nothing in that module is separately maintained.

## Quick start

```bash
cp .env.example .env
npm install
npm run db:up          # Postgres :5433, Redis :6380, Mongo :27018, Garage :3900
npm run storage:up     # Garage alone, printing credentials for .env
npx prisma generate
npx prisma migrate dev
npm run db:seed        # one demo wedding, prints guest links
npm run start:dev
```

API at `http://localhost:3000/api`, OpenAPI docs at `http://localhost:3000/docs`.

> All three bind non-default ports so they cannot collide with instances
> already running on the host.
>
> Redis and Mongo are **optional at runtime**. With either down the API still
> serves correctly — the invitation payload is rebuilt from Postgres and the
> engagement panel reports zero. Only latency and insight degrade.

## Layout

```
src/
  common/            locale resolution with graceful fallback
  prisma/            PrismaService (global module)
  modules/
    events/          event detail, venues, timeline
    guests/          guest graph by household; CSV import, check-in, find-your-seat
    invitations/     public invitation payload, data-bound + personalized
    rsvp/            the write side — guest responses
    seating/         tables, seat assignment, the packing algorithm
    operations/      derived views + the one-call dashboard
    access/          permission policy (pure, table-driven)
    payments/        card acquiring; providers/ holds one adapter per bank
    ticketing/       inventory, checkout, admission
    public-events/   announcements, listings, preview metadata
    communications/  outbox messaging; channels/ holds one transport each
  infra/
    auth/            sessions, the guard, @Public / @RequirePermission
    cache/           Redis read-through cache, degrades to Postgres
    analytics/       MongoDB engagement events, fire-and-forget
    storage/         file storage port, local-disk adapter
    jobs/            scheduled sweeps behind a Redis lock
    health/          liveness and readiness
prisma/
  schema.prisma      the domain model
  seed.ts            one realistic wedding
test/
  setup/             test database lifecycle
  fixtures/          event fixture builder
  integration/       service-level, real Postgres
  e2e/               HTTP-level, real Postgres
```

## Endpoints

### Authentication

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/auth/register` | Create an account, get a token pair |
| `POST` | `/api/v1/auth/login` | Exchange credentials for a token pair |
| `POST` | `/api/v1/auth/refresh` | Rotate a refresh token; the old one is revoked |
| `POST` | `/api/v1/auth/logout` | Revoke one session |
| `POST` | `/api/v1/auth/logout-everywhere` | Revoke every session |
| `POST` | `/api/v1/auth/password-reset` | Request a reset link (always reports success) |
| `POST` | `/api/v1/auth/password-reset/confirm` | Set a new password; revokes every session |
| `POST` | `/api/v1/auth/verify-email` | Send a verification link to the signed-in account |
| `POST` | `/api/v1/auth/verify-email/confirm` | Confirm an email address |
| `GET` | `/api/v1/organization/invites` | Pending invitations |
| `POST` | `/api/v1/organization/invites` | Invite someone; re-inviting replaces the link |
| `DELETE` | `/api/v1/organization/invites/:email` | Revoke a pending invitation |
| `POST` | `/api/v1/invites/accept` | Accept an invitation, creating the account if needed |
| `POST` | `/api/v1/events/:eventId/media` | Upload an image or audio file (multipart) |
| `POST` | `/api/v1/devices` | Register this device for push (idempotent by token) |
| `DELETE` | `/api/v1/devices/:token` | Stop sending to this device |
| `GET` | `/api/v1/health/live` | Process is running |
| `GET` | `/api/v1/health/ready` | Dependencies reachable; only Postgres is required |

**Every route requires a session unless it is marked `@Public()`.** Organizer
routes additionally declare `@RequirePermission(...)`, and routes not keyed by
`:eventId` declare `@EventScope(...)` so the guard can resolve ownership.

### Public — no auth, guest-facing

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/invitations/:slug` | Invitation payload, cached per slug and locale |
| `GET` | `/api/v1/invitations/:slug/g/:guestToken` | Personalized for one guest |
| `GET` | `/api/v1/invitations/:slug/g/:guestToken/rsvp` | Read current response |
| `POST` | `/api/v1/invitations/:slug/g/:guestToken/rsvp` | Submit or update a response |
| `GET` | `/api/v1/events/:eventId/find-seat` | Guest seat lookup by name (`?q=`) |
| `PATCH` | `/api/v1/invitations/:slug/arrangement` | Reorder, toggle and re-variant every block atomically |

### Organizer

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/events` | List events |
| `GET` | `/api/v1/events/:id` | Detail with venues and timeline |
| `GET` | `/api/v1/events/:id/dashboard` | **Everything the operations screen needs, in one request** |
| `GET` | `/api/v1/events/:id/guests` | Guest graph grouped by household |
| `GET` | `/api/v1/events/:id/headcount` | Live headcount by response and side |
| `GET` | `/api/v1/events/:id/catering-sheet` | Covers plus dietary requirements |
| `GET` | `/api/v1/events/:id/bar-sheet` | Drink preferences as quantities |
| `GET` | `/api/v1/events/:id/playlist` | Deduplicated song requests |
| `GET` | `/api/v1/events/:id/guest-book` | Messages left by guests |

#### Guest list

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/events/:eventId/guests/import` | Import a CSV guest list (multipart `file`) |
| `GET` | `/api/v1/events/:eventId/guests/imports` | History of past imports |

#### Tables and seating

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/events/:eventId/tables` | Tables with seated counts |
| `POST` | `/api/v1/events/:eventId/tables` | Add one table |
| `POST` | `/api/v1/events/:eventId/tables/bulk` | Add numbered tables in one call |
| `DELETE` | `/api/v1/events/:eventId/tables/:tableId` | Remove an empty table |
| `POST` | `/api/v1/events/:eventId/seats` | Seat one guest at a table |
| `DELETE` | `/api/v1/events/:eventId/seats/:guestId` | Unseat one guest |
| `POST` | `/api/v1/events/:eventId/seats/auto-assign` | Seat everyone attending; reports who did not fit |

#### Check-in on the day

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/events/:eventId/guests/:guestId/check-in` | Record an arrival; a guest arrives once |
| `DELETE` | `/api/v1/events/:eventId/guests/:guestId/check-in` | Undo a mis-scan |
| `GET` | `/api/v1/events/:eventId/arrivals` | Live arrivals against who was expected |
| `POST` | `/api/v1/payments` | Register an order, get the bank form URL (idempotent) |
| `GET` | `/api/v1/payments/:orderNumber` | Payment state |
| `POST` | `/api/v1/payments/:orderNumber/confirm` | Server-to-server outcome check |
| `POST` | `/api/v1/payments/:orderNumber/refund` | Full or partial refund |
| `POST` | `/api/v1/payments/reconcile` | Sweep unresolved payments |

### Public — announcements and ticketing

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/public/events` | Browse published public events |
| `GET` | `/api/v1/public/events/:slug` | One announcement, availability, preview metadata |
| `POST` | `/api/v1/public/events/:slug/orders` | Reserve tickets and start payment (idempotent) |
| `GET` | `/api/v1/ticket-orders/:accessToken` | A buyer's own order and tickets |
| `POST` | `/api/v1/ticket-orders/:accessToken/confirm` | Settle after the bank; issues tickets |
| `POST` | `/api/v1/tickets/:code/admit` | Admit at the door; a code admits once |
| `POST` | `/api/v1/ticket-orders/release-expired` | Return inventory from abandoned checkouts |

## Three design decisions worth knowing

**Blocks are data-bound.** An `InvitationBlock` of type `VENUE`, `TIMELINE` or
`COUNTDOWN` stores no copy of the event's data. `InvitationsService.hydrateBlock`
pulls it live from the Event at render time. This is what makes unlimited free
revisions economically trivial — correcting a venue address is one UPDATE, not
a re-edit of every block that mentions it.

**Plus-ones are people, not a number.** A `Household` has a `seatsAllotted`
entitlement; named party members become real `Guest` rows inside it, flagged
`addedByGuest`. Seating, catering and check-in all operate on households. A flat
guest list with an `plusOnes: 2` integer cannot express this, and seating becomes
intractable without it.

**A screen is one request; an intent is one request.** `/dashboard` returns
headcount, catering, bar, playlist and engagement together, its independent
queries running concurrently. `PATCH /arrangement` reorders, toggles and
re-variants every block in one transaction, with display order taken from the
array order so the client never computes an index. Both exist because bad
operational UX is usually an API shape problem — see `../docs/PRODUCT_SPEC.md`
§12.

## Testing

Three layers, each with a distinct job. See `../CLAUDE.md` §6.

| Layer | Location | Subject | Database |
|---|---|---|---|
| Unit | `src/**/*.spec.ts` | Pure logic, derivations, access policy | Mocked |
| Integration | `test/integration/**/*.int-spec.ts` | Services against real Prisma | Real |
| E2E | `test/e2e/**/*.e2e-spec.ts` | HTTP: status codes, validation, shapes | Real |

```bash
npm run test:unit    # fast, no database
npm run test:int     # needs Postgres
npm run test:e2e     # needs Postgres
npm run verify       # lint + build + all three
```

Integration and e2e create and migrate a separate `aveline_test` database
automatically, and truncate between tests with a single `TRUNCATE ... CASCADE`
rather than a per-table delete loop.

## Logging and errors

Structured via pino: JSON in production, readable locally, and **every line
carries the same request id as the response** — so a user's screenshot maps to
the exact request.

```bash
LOG_LEVEL=warn npm run start:dev    # trace|debug|info|warn|error|fatal
```

Health checks are not logged. 4xx logs as `warn`, 5xx as `error`.

Sentry also watches service health without tracing: each scheduled sweep
reports a cron check-in, so one that stops running is noticed, and dependency
outages alert once on failure and once on recovery rather than every minute.

Errors go to Sentry when `SENTRY_DSN` is set, and nowhere when it is not.
**Errors only** — tracing is off and profiling is not installed. Credential
headers, capability tokens in URLs and request bodies are stripped before
anything leaves. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Linting

```bash
npm run lint         # must be clean, zero warnings
npm run lint:fix
npm run docs:check   # fails when the docs contradict the code
npm run openapi      # regenerate openapi.json for the client team
```

`docs:check` compares documented endpoints against the controllers, verifies
every link in every doc resolves, and checks that each permission the policy
grants is described. `npm run verify` runs it.

The config enforces the house rules: complexity ≤ 10, depth ≤ 3, 60 lines per
function, boolean names as assertions (`isPublished`, `hasSeats`), and
`no-floating-promises` / `no-misused-promises` to catch the async mistakes that
cause races. Never add `eslint-disable` to silence a complexity rule — extract.

## Next

1. **Real message transports.** The outbox and dispatcher work; every channel
   resolves to the console transport. SMTP, SMS and chat providers implement
   the same two-method port. Nothing leaves the server until one is wired.
2. **Design endpoints.** Templates, blocks, media and themes are modelled and
   `PATCH /invitations/:slug/arrangement` rearranges a page, but there is no
   endpoint to create a block, and theme values are not validated against the
   template's `allowedFonts` / `palettes`.
3. **Promo codes, subscriptions and invoices.** Modelled; no endpoints.
4. **Vendor brief endpoints.** `briefScopes` and `briefToken` are modelled; the
   scoped reads are not built.
5. **Suppression lists and GDPR data-subject requests.** `Guest.consentAt` and
   `anonymizedAt` exist and `Organization.deletedAt` supports soft deletion;
   no endpoint exercises them.
6. **Rate limiting** and **idempotency keys** on the public RSVP route —
   Redis is wired, the limiter is not.
7. **Job queue** (BullMQ on Redis) for exports and image processing. Seating
   runs inline because it is milliseconds on realistic guest lists; exports
   are not.
8. **Audit trail** in MongoDB.
9. **Payments**: no bank credentials yet, so no adapter has run against a real
   sandbox. See `../docs/PAYMENTS.md` §6–7.

`docs/GAPS.md` is the full list, prioritised.
