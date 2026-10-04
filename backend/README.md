# Aveline Backend

Event invitations, the guest graph, and the operations derived from them.
Product definition lives in [`../docs/PRODUCT_SPEC.md`](../docs/PRODUCT_SPEC.md).

**Stack:** TypeScript · NestJS 11 · PostgreSQL 16 · Prisma 6

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
npm run db:up          # Postgres in Docker on :5433
npx prisma generate
npx prisma migrate dev
npm run db:seed        # one demo wedding, prints guest links
npm run start:dev
```

API at `http://localhost:3000/api`, OpenAPI docs at `http://localhost:3000/docs`.

> The container binds **5433**, not 5432, so it does not collide with a
> Postgres already running on the host.

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
    operations/      derived views: headcount, catering, bar, playlist
prisma/
  schema.prisma      the domain model
  seed.ts            one realistic wedding
```

## Endpoints

### Public — no auth, guest-facing

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/invitations/:slug` | Invitation payload, default locale |
| `GET` | `/api/invitations/:slug/g/:guestToken` | Personalized for one guest |
| `GET` | `/api/invitations/:slug/g/:guestToken/rsvp` | Read current response |
| `POST` | `/api/invitations/:slug/g/:guestToken/rsvp` | Submit or update a response |
| `GET` | `/api/events/:eventId/find-seat?q=` | Guest seat lookup by name |

### Organizer — **auth not yet implemented** (see Next)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/events` | List events |
| `GET` | `/api/events/:id` | Detail with venues and timeline |
| `GET` | `/api/events/:id/guests` | Guest graph grouped by household |
| `GET` | `/api/events/:id/headcount` | Live headcount by response and side |
| `GET` | `/api/events/:id/catering-sheet` | Covers plus dietary requirements |
| `GET` | `/api/events/:id/bar-sheet` | Drink preferences as quantities |
| `GET` | `/api/events/:id/playlist` | Deduplicated song requests |
| `GET` | `/api/events/:id/guest-book` | Messages left by guests |

## Two design decisions worth knowing

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

## Verified working

The RSVP slice runs end to end against a live database:

- Personalized invitation resolves Armenian/Russian/English with fallback
- Named plus-ones become household members and inherit attribution
- Household capacity is enforced (`3 allotted, 3 named, 1 more submitted` → 400)
- Unknown guest token → 404; invalid enum → 400 with field detail
- Headcount, catering, bar and playlist all derive correctly from the responses

```bash
npm test        # 10 unit tests
npm run build
```

## Next

Nothing here is blocked on design — these are the obvious increments.

1. **Authentication and tenant scoping.** Organizer endpoints are currently
   open. Every `/api/events/*` route needs an authenticated user scoped to the
   owning organization before this is deployed anywhere.
2. **Seating assignment.** `Table` and `Seat` are modelled and the read path
   (`find-seat`) works; the assignment algorithm with household and side
   constraints is not written.
3. **Vendor brief endpoints.** `VendorBooking.briefScopes` and `briefToken` are
   modelled; the scoped read endpoints are not built.
4. **Check-in.** `CheckIn` is modelled; no endpoint yet.
5. **Rate limiting** on the public RSVP route.
6. **E2E test suite** against a throwaway database.
