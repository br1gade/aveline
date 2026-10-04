# Aveline Backend

Event invitations, the guest graph, and the operations derived from them.

| Doc | Covers |
|---|---|
| [`../CLAUDE.md`](../CLAUDE.md) | Engineering rules — binding |
| [`../docs/PRODUCT_SPEC.md`](../docs/PRODUCT_SPEC.md) | Product definition and domain model |
| [`../docs/ACCESS_CONTROL.md`](../docs/ACCESS_CONTROL.md) | Accounts, roles, permissions |
| [`../docs/VENUES_AND_SEATING.md`](../docs/VENUES_AND_SEATING.md) | Venues, tables, seats |
| [`../docs/INVITATION_DESIGN.md`](../docs/INVITATION_DESIGN.md) | Templates, blocks, media, signatures |
| [`../docs/DATA_STORES.md`](../docs/DATA_STORES.md) | Postgres / Redis / MongoDB — what goes where and why |

**Stack:** TypeScript · NestJS 11 · PostgreSQL 16 · Prisma 6 · Redis 7 · MongoDB 7

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
npm run db:up          # Postgres :5433, Redis :6380, Mongo :27018
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
    guests/          guest graph by household; find-your-seat lookup
    invitations/     public invitation payload, data-bound + personalized
    rsvp/            the write side — guest responses
    operations/      derived views + the one-call dashboard
    access/          permission policy (pure, table-driven)
  infra/
    cache/           Redis read-through cache, degrades to Postgres
    analytics/       MongoDB engagement events, fire-and-forget
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

### Public — no auth, guest-facing

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/invitations/:slug` | Invitation payload, cached per slug and locale |
| `GET` | `/api/invitations/:slug/g/:guestToken` | Personalized for one guest |
| `GET` | `/api/invitations/:slug/g/:guestToken/rsvp` | Read current response |
| `POST` | `/api/invitations/:slug/g/:guestToken/rsvp` | Submit or update a response |
| `GET` | `/api/events/:eventId/find-seat?q=` | Guest seat lookup by name |
| `PATCH` | `/api/invitations/:slug/arrangement` | Reorder, toggle and re-variant every block atomically |

### Organizer — **auth not yet implemented** (see Next)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/events` | List events |
| `GET` | `/api/events/:id` | Detail with venues and timeline |
| `GET` | `/api/events/:id/dashboard` | **Everything the operations screen needs, in one request** |
| `GET` | `/api/events/:id/guests` | Guest graph grouped by household |
| `GET` | `/api/events/:id/headcount` | Live headcount by response and side |
| `GET` | `/api/events/:id/catering-sheet` | Covers plus dietary requirements |
| `GET` | `/api/events/:id/bar-sheet` | Drink preferences as quantities |
| `GET` | `/api/events/:id/playlist` | Deduplicated song requests |
| `GET` | `/api/events/:id/guest-book` | Messages left by guests |

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

## Linting

```bash
npm run lint         # must be clean, zero warnings
npm run lint:fix
```

The config enforces the house rules: complexity ≤ 10, depth ≤ 3, 60 lines per
function, boolean names as assertions (`isPublished`, `hasSeats`), and
`no-floating-promises` / `no-misused-promises` to catch the async mistakes that
cause races. Never add `eslint-disable` to silence a complexity rule — extract.

## Next

1. **Authentication and the access guard.** `src/modules/access/access-policy.ts`
   is a pure, fully tested policy, but nothing calls it yet and there is no
   session or token issuance. Every `/api/events/*` route is currently open.
2. **Seating assignment.** `Table` and `Seat` are modelled and the read path
   (`find-seat`) works; the constrained assignment algorithm is not written.
   See `../docs/VENUES_AND_SEATING.md` §5 for the intended approach.
3. **Design endpoints.** Templates, blocks, media and themes are modelled;
   nothing writes them over HTTP, and theme values are not yet validated
   against the template's `allowedFonts` / `palettes`.
4. **Upload pipeline** for `MediaAsset` — storage, resizing, `sizeBytes`.
5. **Vendor brief endpoints.** `briefScopes` and `briefToken` are modelled; the
   scoped reads are not built.
6. **Check-in.** `CheckIn` is modelled; no endpoint yet.
7. **Rate limiting** and **idempotency keys** on the public RSVP route —
   Redis is wired, the limiter is not.
8. **Job queue** (BullMQ on Redis) for seating, exports and image processing.
9. **Audit trail** in MongoDB — blocked on authentication, since there is no
   actor to record yet.
