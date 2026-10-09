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

## Mail in development

`npm run db:up` starts a local SMTP server alongside the databases. Mail is
really sent, over real SMTP, and never leaves the machine.

```
Dev inbox   http://localhost:8025
SMTP        localhost:1025   (no credentials; anything is accepted)
Clear it    curl -X DELETE http://localhost:8025/api/v1/messages
```

Leaving `SMTP_HOST` unset falls back to writing email to the log — acceptable
locally, and a **startup failure** under `NODE_ENV=production`, because an
invitation written to a log file looks exactly like one that was delivered.

Production starts on Google Workspace SMTP (`smtp.gmail.com:587` with an app
password). Paid Workspace allows 2,000 messages/day there, and 10,000/day
through `smtp-relay.gmail.com` — enough for a 400-guest wedding and its
reminders.

The reason to move to a transactional provider is not the cap: Workspace has
no bounce or complaint webhooks, no suppression API and no delivery events, so
a bounce arriving after the send is never recorded. Moving is a change of
credentials, not of code, since the adapter speaks plain SMTP.

## Chat channels

Email always works from nothing, which is why an invitation goes out on it.
The chat channels each have a constraint worth knowing before wiring them up.

**Telegram** is free and needs no approval — create a bot with `@BotFather`,
set `TELEGRAM_BOT_TOKEN`. The constraint is absolute: **a bot cannot message
anyone who has not started a conversation with it.** So the invitation email
carries a deep link, `t.me/<bot>?start=<guestToken>`, available to template
copy as `{{telegramLink}}`. Tapping it posts `/start` to
`POST /webhooks/telegram`, which records the chat id — and reminders then go
there instead of to email. Set `TELEGRAM_WEBHOOK_SECRET` so only Telegram can
call that endpoint; production refuses to boot without it once a bot token is
set, because otherwise anyone who guessed a guest token could register their
own chat against that guest.

**WhatsApp** can reach someone cold, which is why it exists here, but it is
gated: a Meta Business account, a verified business, a dedicated number, and
**message templates approved in advance**. It will not send free text at all,
so a `MessageTemplate` used on WhatsApp needs `providerTemplate` (Meta's
template name) and `providerParams` (the variable names in the order Meta
expects them). Every delivered template is billed.

A channel is only used when **both** its transport is configured and the
organization has copy for it. An organization with no Telegram template keeps
getting email, with nothing to configure — and nothing fails mid-send with
"template not found" after half the households have been written to.

Preference order is in `channel-preference.ts`: Telegram if the guest opted
in, then WhatsApp if we have a number, then email. An opted-in channel
outranks a paid one.

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
    design/          templates, theme, block content, questions, venues
    organizations/   the tenant a new account creates for itself
    billing/         plans, subscriptions, invoices, promo codes
    vendors/         the partner network and scoped briefs
    exports/         generated CSV documents
    privacy/         data-subject requests and suppression lists
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
| `POST` | `/api/v1/event-invites/accept` | Accept an invitation to one event; grants nothing in the organization |
| `POST` | `/api/v1/concierge/organizations` | Open a customer's organization and invite them as owner (Aveline staff) |
| `POST` | `/api/v1/concierge/organizations/:organizationId/events` | Create an event for that customer (Aveline staff) |
| `GET` | `/api/v1/concierge/organizations` | Find a customer's organization by name (Aveline staff) |
| `POST` | `/api/v1/events/:eventId/media` | Upload an image or audio file (multipart) |
| `GET` | `/api/v1/events/:eventId/media` | The event's uploads, with the blocks that show each |
| `PATCH` | `/api/v1/events/:eventId/media/:assetId` | Set alt text, one language at a time |
| `DELETE` | `/api/v1/events/:eventId/media/:assetId` | Remove an upload and its file; refused while shown |
| `POST` | `/api/v1/devices` | Register this device for push (idempotent by token) |
| `DELETE` | `/api/v1/devices/:token` | Stop sending to this device |
| `POST` | `/api/v1/webhooks/telegram` | Telegram opt-ins and blocks (**called by Telegram**) |
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
| `POST` | `/api/v1/events` | **Create an event** and its draft invitation |
| `POST` | `/api/v1/events/:id/invitation` | Add an invitation to an event that has none |
| `GET` | `/api/v1/events` | List events |
| `GET` | `/api/v1/events/:id` | Detail with venues and timeline |
| `PATCH` | `/api/v1/events/:id` | Correct title, dates, time zone, languages; says whether to tell guests |
| `PATCH` | `/api/v1/events/:id/settings` | Flip automatic RSVP reminders on or off |
| `POST` | `/api/v1/events/:id/archive` | Put the event away; its invitation closes, nothing is deleted |
| `POST` | `/api/v1/events/:id/unarchive` | Bring an archived event back as it was |
| `DELETE` | `/api/v1/events/:id` | Delete for good — only if never published and no money moved |
| `GET` | `/api/v1/events/:eventId/team` | Who works on this event, and invitations still open |
| `POST` | `/api/v1/events/:eventId/team/invites` | Invite someone to this event with a role |
| `DELETE` | `/api/v1/events/:eventId/team/invites/:email` | Withdraw an open invitation |
| `PATCH` | `/api/v1/events/:eventId/team/:userId` | Change someone's role; never the last owner |
| `DELETE` | `/api/v1/events/:eventId/team/:userId` | Take someone off; they lose access at once |
| `GET` | `/api/v1/events/:id/audit-trail` | Who changed what on this event |
| `GET` | `/api/v1/events/:id/dashboard` | **Everything the operations screen needs, in one request** |
| `GET` | `/api/v1/events/:id/guests` | Guest graph grouped by household |
| `GET` | `/api/v1/events/:id/headcount` | Live headcount by response and side |
| `GET` | `/api/v1/events/:id/catering-sheet` | Covers plus dietary requirements |
| `GET` | `/api/v1/events/:id/bar-sheet` | Drink preferences as quantities |
| `GET` | `/api/v1/events/:id/playlist` | Deduplicated song requests |
| `GET` | `/api/v1/events/:id/guest-book` | Messages left by guests |
| `GET` | `/api/v1/events/:eventId/answers` | Answers to the host's own questions, counted and listed |

#### Designing the invitation

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/events/:eventId/design-templates` | The template catalogue and its constraints |
| `POST` | `/api/v1/invitations/:slug/template` | Switch template; unsupported blocks are disabled |
| `POST` | `/api/v1/invitations/:slug/publish` | Make it live — needs an RSVP block, a venue and a future date |
| `POST` | `/api/v1/invitations/:slug/close` | Stop accepting responses; the page stays readable |
| `POST` | `/api/v1/invitations/:slug/reopen` | Accept responses again |
| `POST` | `/api/v1/invitations/:slug/send` | **Send it** — one email per household, safe to press twice |
| `POST` | `/api/v1/invitations/:slug/remind` | Chase the households that have not answered |
| `POST` | `/api/v1/invitations/:slug/notify-changes` | Tell every invited household the details changed |
| `POST` | `/api/v1/invitations/:slug/thank-you` | Thank the guests who actually came |
| `GET` | `/api/v1/invitations/:slug/delivery` | Who has been invited and what happened to each email |
| `GET` | `/api/v1/invitations/:slug/design` | **Load the editor**: drafts, every language, switched-off blocks, publish blockers |
| `PATCH` | `/api/v1/invitations/:slug/theme` | Fonts and colours, validated against the template |
| `PATCH` | `/api/v1/invitations/:slug/rsvp-fields` | Switch built-in RSVP questions off, or give dietary and drink fixed choices |
| `PATCH` | `/api/v1/invitations/:slug/blocks/:type` | Edit one block's content |
| `GET` | `/api/v1/invitations/:slug/questions` | Custom RSVP questions |
| `POST` | `/api/v1/invitations/:slug/questions` | Add one |
| `PATCH` | `/api/v1/invitations/:slug/questions/:questionId` | Change one |
| `DELETE` | `/api/v1/invitations/:slug/questions/:questionId` | Remove one; refused once answered |

#### Venues

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/events/:eventId/timeline` | The running order |
| `POST` | `/api/v1/events/:eventId/timeline` | Add something to it |
| `PATCH` | `/api/v1/events/:eventId/timeline/:entryId` | Change an entry |
| `DELETE` | `/api/v1/events/:eventId/timeline/:entryId` | Remove an entry |
| `GET` | `/api/v1/events/:eventId/venue-profiles` | The reusable venue directory |
| `POST` | `/api/v1/venue-profiles` | Add a hall to the shared directory (Aveline staff) |
| `PATCH` | `/api/v1/venue-profiles/:profileId` | Correct or retire a hall (Aveline staff) |
| `GET` | `/api/v1/events/:eventId/venues` | This event's venues, in order |
| `POST` | `/api/v1/events/:eventId/venues` | Add one; directory details are copied |
| `PATCH` | `/api/v1/events/:eventId/venues/:venueId` | Change one |
| `DELETE` | `/api/v1/events/:eventId/venues/:venueId` | Remove one nothing depends on |

#### Guest list

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/events/:eventId/guests/import` | Import a CSV guest list (multipart `file`) |
| `GET` | `/api/v1/events/:eventId/guests/imports` | History of past imports |
| `GET` | `/api/v1/events/:eventId/guests/:guestId` | One guest with their answers, for an edit form |
| `PATCH` | `/api/v1/events/:eventId/guests/:guestId/rsvp` | Record an answer phoned in; the guest is not messaged unless asked |
| `POST` | `/api/v1/events/:eventId/guests` | Add one guest, to an existing household or a new one |
| `PATCH` | `/api/v1/events/:eventId/guests/:guestId` | Correct details, or move to another household |
| `DELETE` | `/api/v1/events/:eventId/guests/:guestId` | Remove a guest; refused once checked in |
| `PATCH` | `/api/v1/events/:eventId/households/:householdId` | Rename, or change seats (not below those named) |

#### Tables and seating

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/events/:eventId/tables` | Tables with seated counts |
| `POST` | `/api/v1/events/:eventId/tables` | Add one table |
| `POST` | `/api/v1/events/:eventId/tables/bulk` | Add numbered tables in one call |
| `PATCH` | `/api/v1/events/:eventId/tables/:tableId` | Rename, resize, move to a venue, or place on the plan |
| `DELETE` | `/api/v1/events/:eventId/tables/:tableId` | Remove an empty table |
| `POST` | `/api/v1/events/:eventId/seats` | Seat one guest at a table |
| `DELETE` | `/api/v1/events/:eventId/seats/:guestId` | Unseat one guest |
| `POST` | `/api/v1/events/:eventId/seats/auto-assign` | Seat everyone attending; reports who did not fit |

#### Vendors and briefs

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/vendors` | The partner directory, optionally by category |
| `POST` | `/api/v1/vendors` | Add a vendor to the directory |
| `GET` | `/api/v1/events/:eventId/vendors` | This event's vendors; fees only with `vendor:fee:read` |
| `POST` | `/api/v1/events/:eventId/vendors` | Engage a vendor and mint their brief link |
| `PATCH` | `/api/v1/events/:eventId/vendors/:bookingId` | Change status, scopes or fee |
| `POST` | `/api/v1/events/:eventId/vendors/:bookingId/rotate-brief` | Replace the brief link |
| `DELETE` | `/api/v1/events/:eventId/vendors/:bookingId` | Cancel an engagement |

#### Exports

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/events/:eventId/exports` | Past exports, newest first |
| `POST` | `/api/v1/events/:eventId/exports` | Generate one; CSV is produced inline |
| `GET` | `/api/v1/events/:eventId/exports/:exportId` | One export and its file |

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

### Organization and billing

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/organizations` | Create your organization; the caller becomes OWNER |
| `GET` | `/api/v1/organizations/current` | Your organization, its plan and its counts |
| `PATCH` | `/api/v1/organizations/current` | Rename it |
| `GET` | `/api/v1/plans` | The price list with entitlements (**public**) |
| `GET` | `/api/v1/subscription` | Your subscription, or `{ "subscription": null }` |
| `POST` | `/api/v1/subscription` | Start or change a plan |
| `POST` | `/api/v1/subscription/cancel` | Cancel at the end of the paid period |
| `POST` | `/api/v1/subscription/resume` | Undo a cancellation |
| `GET` | `/api/v1/invoices` | Your invoices, newest first |
| `GET` | `/api/v1/invoices/:number` | One invoice with its captured line items |
| `POST` | `/api/v1/invoices/:number/confirm` | Settle after the bank |
| `GET` | `/api/v1/promo-codes` | Your promo codes and how much of each is left |
| `POST` | `/api/v1/promo-codes` | Create one |
| `PATCH` | `/api/v1/promo-codes/:codeId` | Change its limits |
| `DELETE` | `/api/v1/promo-codes/:codeId` | Deactivate it |

### Privacy

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/privacy/requests` | Ask what is held, or for erasure (**public**) |
| `GET` | `/api/v1/privacy/requests` | Open requests, soonest due first |
| `PATCH` | `/api/v1/privacy/requests/:requestId` | Move one through verification |
| `POST` | `/api/v1/privacy/requests/:requestId/fulfil` | Carry out a verified request |
| `GET` | `/api/v1/suppressions` | Addresses that will not be contacted |
| `POST` | `/api/v1/suppressions` | Stop contacting an address |
| `DELETE` | `/api/v1/suppressions/:suppressionId` | Resume; global entries cannot be lifted |

### Selling tickets

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/events/:eventId/ticket-types` | What is for sale, with sold, held and available |
| `POST` | `/api/v1/events/:eventId/ticket-types` | Put a kind of ticket on sale |
| `PATCH` | `/api/v1/events/:eventId/ticket-types/:typeId` | Change it; price changes apply to future buyers |
| `DELETE` | `/api/v1/events/:eventId/ticket-types/:typeId` | Remove one nothing has been sold against |
| `GET` | `/api/v1/events/:eventId/listing` | The public announcement page |
| `PUT` | `/api/v1/events/:eventId/listing` | Create or edit it |
| `POST` | `/api/v1/events/:eventId/listing/publish` | Make it public |
| `POST` | `/api/v1/events/:eventId/listing/unpublish` | Take it down |
| `GET` | `/api/v1/events/:eventId/ticket-orders` | Orders on the event, newest first |
| `POST` | `/api/v1/events/:eventId/ticket-orders/:orderId/cancel` | Cancel and refund an order, exactly once |

### Public — vendor briefs and discounts

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/briefs/:briefToken` | A vendor's brief — only the sections their booking lists |
| `POST` | `/api/v1/public/events/:slug/promo-check` | What a promo code is worth on a basket |

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

## Dependencies

Node 26 LTS. [`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md) records what is
current, what is pinned, and what blocks each pin — NestJS 12 and `nanoid` 6
are ESM-only and need a module-system migration; Prisma 7 needs a driver
adapter; TypeScript 7 waits on `ts-jest`.

Read it before running `npm outdated` and reaching for `--force`.

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
npm run openapi:check  # fails when the committed openapi.json is stale
```

`docs:check` compares documented endpoints against the controllers, verifies
every link in every doc resolves, and checks that each permission the policy
grants is described. `openapi:check` regenerates the schema in memory and
fails if the committed `openapi.json` differs — so a route change must be
committed with its regenerated schema. `npm run verify` runs both.

The config enforces the house rules: complexity ≤ 10, depth ≤ 3, 60 lines per
function, boolean names as assertions (`isPublished`, `hasSeats`), and
`no-floating-promises` / `no-misused-promises` to catch the async mistakes that
cause races. Never add `eslint-disable` to silence a complexity rule — extract.

## Next

1. **SMS.** Email, Telegram and WhatsApp are delivered. SMS still resolves to
   the console transport; it is one adapter behind the same two-method port,
   and it is the channel that reaches guests who read neither email nor chat.
2. **Reminders on other channels.** RSVP reminders go out by email on a
   three-week / one-week / two-day schedule, and by hand on request. SMS would
   reach the guests who do not read email, and needs a transport first.
10. **Design endpoints.** Templates, blocks, media and themes are modelled and
   `PATCH /invitations/:slug/arrangement` rearranges a page, but there is no
   endpoint to create a block, and theme values are not validated against the
   template's `allowedFonts` / `palettes`.
10. **Promo codes, subscriptions and invoices.** Modelled; no endpoints.
10. **Vendor brief endpoints.** `briefScopes` and `briefToken` are modelled; the
   scoped reads are not built.
10. **Suppression lists and GDPR data-subject requests.** `Guest.consentAt` and
   `anonymizedAt` exist and `Organization.deletedAt` supports soft deletion;
   no endpoint exercises them.
10. **Rate limiting** and **idempotency keys** on the public RSVP route —
   Redis is wired, the limiter is not.
10. **Job queue** (BullMQ on Redis) for exports and image processing. Seating
   runs inline because it is milliseconds on realistic guest lists; exports
   are not.
10. **Audit trail** in MongoDB.
10. **Payments**: no bank credentials yet, so no adapter has run against a real
   sandbox. See `../docs/PAYMENTS.md` §6–7.

`docs/GAPS.md` is the full list, prioritised.
