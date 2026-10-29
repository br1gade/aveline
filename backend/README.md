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

**WhatsApp** sends business-initiated approved templates through Meta's Cloud
API. Configure account/sender/token, an explicitly supported API version, app
secret and webhook verification token together; see
[the setup and live acceptance checklist](docs/WHATSAPP_SETUP.md). A
`MessageTemplate` needs `providerTemplate` (Meta's approved name) and ordered
`providerParams`. Guest consent, account/number eligibility, billing and template
approval must be verified before enabling it. Localized copy alone does not
prove Meta template/language support.

`GET /communications/whatsapp-webhook` verifies the Meta subscription;
`POST /communications/whatsapp-webhook` authenticates exact raw bytes and
acknowledges durable normalized receipts. A minute sweep reconciles scoped
sent/delivered/read/failed outcomes. Read is `DELIVERED` with `readAt`; no new
Message status is introduced. Ambiguous WhatsApp failures never globally
suppress guests. Receipt ingestion is implemented, but real Meta send/subscription
acceptance remains open because there is no account/test number yet.

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
    guests/          guest graph by household; CSV import, check-in
    invitations/     public invitation payload, data-bound + personalized
    rsvp/            the write side — guest responses
    seating/         tables, seat assignment, the packing algorithm
    design/          templates, theme, block content, questions, venues
    organizations/   the tenant a new account creates for itself
    billing/         plans, subscriptions, invoices, promo codes
    vendors/         the partner network and scoped briefs
    exports/         legacy live CSV and private snapshot jobs
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
| `POST` | `/api/v1/auth/register` | Create an account (202 either way; log in next) |
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
| `POST` | `/api/v1/concierge/organizations/resolve-customer` | Bounded customer choices without contact or billing fields |
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
| `GET` | `/api/v1/invitations/:slug` | Invitation payload, revisioned cache per slug and locale |
| `GET` | `/api/v1/invitations/:slug/g/:guestToken` | Personalized for one guest |
| `PATCH` | `/api/v1/invitations/:slug/g/:guestToken/name` | Correct only the link holder's first/last names |
| `GET` | `/api/v1/invitations/:slug/g/:guestToken/rsvp` | Read current response |
| `POST` | `/api/v1/invitations/:slug/g/:guestToken/rsvp` | Submit or update a response |
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
| `POST` | `/api/v1/events/:eventId/attendance-policy/preview` | Preview a mode change |
| `POST` | `/api/v1/events/:eventId/attendance-policy` | Confirm policy change and require fresh attendance |
| `GET` | `/api/v1/events/:eventId/guests/:guestId/attendance-history` | Attendance history across policies |
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
| `GET` | `/api/v1/events/:eventId/design-templates/:templateKey/preview` | Synthetic four-language renderer preview; invitation:read |
| `GET` | `/api/v1/invitations/:slug/template-preview` | Authorized event-content template preview; no publishing or RSVP |
| `PATCH` | `/api/v1/invitations/:slug/question-order` | Atomic complete question order with expectedOrder conflict check |
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
| `GET` | `/api/v1/events/:eventId/seating/arrangements` | Plans by venue plus the unspecified legacy plan |
| `GET` | `/api/v1/events/:eventId/tables` | Tables with seated counts |
| `POST` | `/api/v1/events/:eventId/tables` | Add one table |
| `POST` | `/api/v1/events/:eventId/tables/bulk` | Add numbered tables in one call |
| `PATCH` | `/api/v1/events/:eventId/tables/:tableId` | Rename, resize, move to a venue, or place on the plan |
| `DELETE` | `/api/v1/events/:eventId/tables/:tableId` | Remove an empty table |
| `POST` | `/api/v1/events/:eventId/seats` | Seat one guest at a table |
| `DELETE` | `/api/v1/events/:eventId/seats/:guestId` | Unseat one guest |
| `POST` | `/api/v1/events/:eventId/seating/publish` | Let guests see their tables on their own link |
| `POST` | `/api/v1/events/:eventId/seating/unpublish` | Take the tables off guests' pages |
| `POST` | `/api/v1/events/:eventId/seats/auto-assign` | Queue additive seating; UUID idempotency key required (breaking, 18 October) |
| `GET` | `/api/v1/events/:eventId/seating/jobs` | Latest 50 job summaries, excluding result details |
| `GET` | `/api/v1/events/:eventId/seating/jobs/:jobId` | Job status, revisions and committed result |

Automatic seating now returns a queued resource, not immediate seat counts.
Run `npm run start:seating-worker` separately after the build. Poll the job for
`COMPLETED`/`FAILED`, then refresh tables; manual assignment remains immediate.
The worker retries stale plans and recovers expired claims without replacing
manual seats. See [SEATING_WORKER.md](docs/SEATING_WORKER.md) for limits, deployment
and failure handling.

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
| `POST` | `/api/v1/events/:eventId/exports` | Record one; returns where to download it |
| `GET` | `/api/v1/events/:eventId/exports/:exportId` | One export |
| `GET` | `/api/v1/events/:eventId/exports/:exportId/download` | The CSV, built now; contact columns only with `guest:contact:read` |
| `GET` | `/api/v1/events/:eventId/export-snapshots` | Latest 50 snapshot jobs |
| `POST` | `/api/v1/events/:eventId/export-snapshots` | Queue an immutable private CSV/PDF/XLSX; UUID idempotency key required |
| `GET` | `/api/v1/events/:eventId/export-snapshots/:snapshotId` | Job state, generation metadata and expiry |
| `GET` | `/api/v1/events/:eventId/export-snapshots/:snapshotId/download` | Stored bytes; rechecks current permissions and revocation |

Snapshot CSV, PDF and XLSX support all seven existing kinds. Run `npm run build` then
`npm run start:export-worker` in a separate process. It claims one job at a time
from Postgres, retries at most three attempts and recovers expired 90-second
leases. API startup does not process this queue. Use `PRIVATE_S3_BUCKET` with
anonymous access disabled, or a shared `PRIVATE_STORAGE_ROOT` outside public
storage. Files expire after `EXPORT_RETENTION_DAYS` (default 7, range 1–30).
See [EXPORT_WORKER.md](docs/EXPORT_WORKER.md) for recovery and cleanup, and
[EXPORT_RENDERERS.md](docs/EXPORT_RENDERERS.md) for fonts, layouts, limits and
the database-free 400-person file rehearsal. PDF place cards are six flat
90 × 70 mm cut cards per A4. Snapshot catering/bar totals are venue-specific.
Snapshot headings, titles, metadata and standard status labels support English,
Russian, French and Armenian; human language/print acceptance remains.
The existing `/exports` API remains live CSV during frontend migration;
its records are references to regenerate, never historical snapshots.


#### Check-in on the day

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/events/:eventId/guests/:guestId/check-in` | Record an arrival; a guest arrives once |
| `DELETE` | `/api/v1/events/:eventId/guests/:guestId/check-in` | Undo a mis-scan |
| `GET` | `/api/v1/events/:eventId/arrivals` | Live arrivals against who was expected |
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
| `GET` | `/api/v1/me/organizations` | Bounded own membership selector |
| `GET` | `/api/v1/organizations/current/members` | Bounded member list without contacts |
| `PATCH` | `/api/v1/organizations/current/members/:userId` | Revision-safe role change |
| `DELETE` | `/api/v1/organizations/current/members/:userId` | Revoke all target customer access in this tenant |
| `POST` | `/api/v1/organizations/current/leave` | Self-leave after ownership handover |
| `POST` | `/api/v1/organizations/current/owner-transfers` | Promote an active member; caller stays owner |
| `POST` | `/api/v1/organizations/current/closure-reviews` | Request ADMIN review without removing access |
| `GET` | `/api/v1/admin/organization-access-reviews` | ADMIN review queue |
| `POST` | `/api/v1/admin/organization-access-reviews/:reviewId/resolve` | ADMIN reviewed recovery or soft closure |
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

Paid subscription selection rejects an unconfigured provider with `404` before
creating/replacing an invoice or allocating its number. Existing invoices and
subscriptions are preserved. Free plans need no provider; the free-pilot paid
charge refusal (`403`) still takes precedence. This check validates local adapter
registration, not bank certification or credentials.

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
| `GET` | `/api/v1/events/:eventId/ticket-orders/:orderId` | Review captured attendees and ticket/guest links; contacts/codes permission-filtered |
| `POST` | `/api/v1/events/:eventId/tickets/:ticketId/attendee` | Register an explicitly supplied legacy ticket attendee |
| `POST` | `/api/v1/events/:eventId/tickets/:ticketId/link-guest` | Link an existing invited guest, preserving their answers |
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
| `POST` | `/api/v1/events/:eventId/tickets/:code/admit` | Admit at the door; a code admits once, and only at its own event |
| `POST` | `/api/v1/ticket-orders/release-expired` | Return inventory from abandoned checkouts |

### Signed integration feedback

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/communications/whatsapp-webhook` | Meta subscription challenge; configured verification token required |
| `POST` | `/api/v1/communications/whatsapp-webhook` | Native WhatsApp statuses; exact-byte app-secret HMAC and durable receipt acceptance |
| `POST` | `/api/v1/communications/email-feedback` | Normalized email delivery feedback; public route requiring a trusted HMAC signature |

## Three design decisions worth knowing

**Blocks are data-bound.** An `InvitationBlock` of type `VENUE`, `TIMELINE` or
`COUNTDOWN` stores no copy of the event's data. `invitation-content.ts`
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

CI runs the full verification pipeline with disposable databases and a Mailpit
mail sink, then exercises the production Caddy configuration, builds the API
image and runs disposable API/recovery rehearsals. `npm run test:edge` needs
Docker and checks local TLS, routing and logs with synthetic credentials.
`npm run pilot:rehearsal` also tests real Mongo retention/erasure and dependency
recovery outside Jest. `npm run test:backup` covers capture and protection-check
failures; `npm run backup:rehearsal` restores fresh Postgres/Garage from a local
encrypted test repository. `npm run pilot:smoke` exercises a seeded running API over
HTTP; it creates synthetic account/event data. Remote targets require explicit
`PILOT_SMOKE_ALLOW_REMOTE=true` and a controlled `PILOT_SMOKE_EMAIL`.

Destructive integration/e2e setup rejects `NODE_ENV=production` and database
names other than `*_test` or `*_test_<suffix>`, before connecting or truncating.
Only the public schema is supported. Point `TEST_DATABASE_URL` at a disposable
database; never at the development or production database.

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

Errors retain `message` and add localized `code`, `locale`, `userMessage`,
`action` and field `details`. Job/media summaries add `recovery`; unseated
households add `explanation`. Request interface copy with `Accept-Language`.
See the shared [API contract](../docs/API.md#errors-have-one-shape).

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

What is still open, in short. [`../docs/BACKLOG.md`](../docs/BACKLOG.md) is the
verified list, by priority; `docs/GAPS.md` is the backend's own.

1. **An SMS provider.** The channel is built provider-neutral and is never
   chosen until `SMS_PROVIDER` names an adapter; none is written yet.
2. **Payments against a real sandbox.** No bank credentials yet, so no adapter
   has run against one. See `../docs/PAYMENTS.md` §6–7.
3. **Integrated pilot acceptance.** Automatic seating and all seven export
   kinds now run in dedicated workers. Frontend job adoption, human language review and
   production worker/storage rehearsal remain.

`docs/GAPS.md` is the full list, prioritised.

Multi-venue seating now permits one seat per guest per arrangement. Automatic
seating and unassignment use `?arrangementId=...` when several plans are in use;
assignment derives the arrangement from its table. Guest views, check-in and
CSV outputs carry venue labels. Event-wide and per-venue attendance are now
available through an explicit policy preview/reconfirmation flow:

```http
POST /api/v1/events/:eventId/attendance-policy/preview
POST /api/v1/events/:eventId/attendance-policy
GET  /api/v1/events/:eventId/guests/:guestId/attendance-history
```

Both policy writes require `event:write`; history requires `guest:read`.
Guest/host RSVP writes carry the active `attendanceRevision`; omission works
only at unchanged EVENT_WIDE revision 1. Per-venue payloads use `venueAttendance`
for each person. Transitions preserve history, personal answers, seats and
admissions, while requiring fresh attendance. Reserved seats remain counted
and are flagged `isReservation`. Venue declines release only their own seats.
Headcount adds per-venue totals; catering/bar accept optional `venueId`.
See the shared API contract for payloads, stale-preview handling and frontend
cutover. Apply both new migrations and rerun `seed:production` for the new
four-language venue-response confirmation copy. Production deployment,
frontend reconfirmation screens and language review remain acceptance gates.


### Private guest contributions

The API stages files; run `npm run start:private-media-worker` separately for
raster validation and deletion. See [GUEST_CONTRIBUTIONS.md](docs/GUEST_CONTRIBUTIONS.md).
Guest routes require their personal capability; host reads/moderation are permission checked.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/invitations/:slug/g/:guestToken/acknowledgements` | Current statements, signature upload states and private household history |
| `POST` | `/api/v1/invitations/:slug/g/:guestToken/acknowledgements` | Typed/drawn acknowledgement for explicit household subjects |
| `POST` | `/api/v1/invitations/:slug/g/:guestToken/signature-uploads` | Stage a private drawing |
| `GET` | `/api/v1/invitations/:slug/g/:guestToken/signature-uploads/:mediaId/file` | Owner's processed drawing preview |
| `DELETE` | `/api/v1/invitations/:slug/g/:guestToken/signature-uploads/:mediaId` | Remove an unclaimed drawing |
| `GET` | `/api/v1/invitations/:slug/g/:guestToken/acknowledgements/:acknowledgementId/file` | Private acknowledgement image |
| `GET` | `/api/v1/invitations/:slug/g/:guestToken/gallery` | Approved photos and own pending statuses |
| `POST` | `/api/v1/invitations/:slug/g/:guestToken/gallery` | Stage a photo for validation/moderation |
| `GET` | `/api/v1/invitations/:slug/g/:guestToken/gallery/:mediaId/file` | Authorized WebP variant |
| `DELETE` | `/api/v1/invitations/:slug/g/:guestToken/gallery/:mediaId` | Owner removes a photo, even after approval |
| `GET` | `/api/v1/events/:eventId/acknowledgements` | Private host acknowledgement history |
| `GET` | `/api/v1/events/:eventId/acknowledgements/:acknowledgementId/file` | Authorized host drawing read |
| `GET` | `/api/v1/events/:eventId/gallery` | Host moderation queue |
| `PATCH` | `/api/v1/events/:eventId/gallery/:mediaId` | Approve/reject a READY photo |
| `GET` | `/api/v1/events/:eventId/gallery/:mediaId/file` | Host moderation image read |
| `DELETE` | `/api/v1/events/:eventId/gallery/:mediaId` | Host removal and cleanup |
| `GET` | `/api/v1/privacy/requests/:requestId/guest-media/:mediaId/file` | Verified subject export original attachment |

### Invitation lifetime and cache rehearsal

Publishing captures the free 90-day period after event end/start or an eligible
subscription's plan lifetime. Host event/draft and publication responses expose
captured policy and expiry. Guest access closes at the deadline; host data stays.
Shared/personal caches perform live Postgres access/revision checks even when
warm. The minute `invitations.maintain-access` sweep reports legacy policy rows
and compacts revision metadata. See [API.md](../docs/API.md#invitation-lifetime-and-expired-access)
and [DATA_STORES.md](docs/DATA_STORES.md).

`npm run pilot:cache` profiles 50 simultaneous personalized HTTP readers against
a synthetic 400-person, 100-household, two-venue/800-seat event using the guarded
test database and local Redis. It never truncates tables, removes its event on
exit, and reports warm/cold/disconnected/recovered percentiles without guest
URLs. Run without other test suites (which truncate the shared test database).
Production proxy/TLS, real analytics and mixed writes remain rehearsal gates.

### Batch J disposable backend rehearsal

Build `aveline-api:pilot-j-local`, then run `npm run pilot:production-rehearsal`.
It owns its stores/workers and preserves checkpoint reports under `test-results/pilot/` plus synthetic export
artifacts. `npm run test:pilot` validates rehearsal guards and measurement policy
and is included in `npm run verify`. See [PILOT_REHEARSAL.md](docs/PILOT_REHEARSAL.md)
for the workload, interpretation and remaining external launch gates.
Use `-- --functional-only` to skip load or `-- --load-only` for an isolated
performance run. Do not measure load alongside verification/builds. Local
`npm run backup:rehearsal` now verifies the 400-person graph and approximately
251 MB of private/public files through encrypted fresh-store restoration;
the off-host destination remains an operator gate.

### Organization compatibility cutover

Scoped calls accept `X-Aveline-Organization-Id`; one membership defaults as before,
multiple require explicit selection. Additional writes are off by default in
`runtime_compatibility`, checked under a transaction lock for create/join. API and
standalone workers refuse schema revisions newer than 2 at startup. The migration
retains the user-only unique index; automatic deploy never drops it. See
[organization cutover](docs/ORGANIZATION_CUTOVER.md) for the explicit operator command.

Not yet accepted: deployed-process exclusion, restore/performance evidence and
four-language multi-tab frontend acceptance. No production cutover was run.

F39 staff enquiry services and privacy substrate are additive and disabled by
default. `SALES_INTAKE_ENABLED`, `SALES_INTAKE_SUPPORT_ENABLED`,
`SALES_ENQUIRY_CONVERSION_ENABLED` and `SALES_ENQUIRY_RETENTION_DRY_RUN` accept
literal true/false. Enabling contacts requires `SALES_INTENT_HMAC_KEY_ID`, JSON
`SALES_INTENT_HMAC_KEYS`, an absolute independently protected
`SALES_PRIVACY_JOURNAL_DIR` and a >=32-character `SALES_PRIVACY_JOURNAL_KEY`.
Production also requires explicit `SALES_INTAKE_OPERATIONAL_ACCEPTANCE=true`
after restore/frontend acceptance; local implementation is not that evidence.
Never rotate away intent verification keys while receipts exist. Privacy and
retention processing must continue when write flags are switched off.

### Versioned template authoring (F44)

All invitations pin immutable rendering inputs. Migration captures every legacy
row verbatim, including inactive/unused templates and unusual JSON. Catalogue
activation/retirement never upgrades existing invitations or resets invitation
lifetime. Development reseeding also preserves the first immutable seed release.
Event catalogue results are shared plus that event organization's private templates.

Template authoring is platform-only: ADMIN creates identities/assigns active
SUPPORT; assigned SUPPORT edits drafts; only ADMIN publishes or retires. Customer
OWNER and event DESIGNER do not gain catalogue authoring. Author responses use
`private, no-store`. Omitted draft definition fields are merged; expected revisions
reject concurrent edits. Synthetic previews include en/ru/fr/hy and contain no
customer/guest data or functional RSVP forms.

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/v1/design-templates` | ADMIN creates an inactive identity and first validated draft |
| `GET` | `/api/v1/design-templates/:templateId` | Authorized inventory detail/history/open draft and asset status |
| `POST` | `/api/v1/design-templates/:templateId/drafts` | Open draft from current immutable version |
| `PATCH` | `/api/v1/design-templates/:templateId/drafts/:draftId` | Revision-checked definition merge |
| `POST` | `/api/v1/design-templates/:templateId/drafts/:draftId/validate` | Structural and deployed capability validation |
| `POST` | `/api/v1/design-templates/:templateId/drafts/:draftId/preview` | Four-locale synthetic JSON fixture and expiring preview receipt |
| `POST` | `/api/v1/design-templates/:templateId/drafts/:draftId/publish` | ADMIN atomically publishes exact previewed draft, or fails capability gate |
| `POST` | `/api/v1/design-templates/:templateId/retire` | ADMIN disables future selection, keeping existing pins |
| `POST` | `/api/v1/design-templates/:templateId/assignments` | ADMIN explicitly assigns SUPPORT |
| `POST` | `/api/v1/design-templates/:templateId/assignments/revoke` | ADMIN revokes assignment |
| `POST` | `/api/v1/design-templates/:templateId/drafts/:draftId/assets` | Reserve private raster upload; returns 202 |
| `GET` | `/api/v1/design-templates/:templateId/assets/:assetId/file` | Authorized sanitized artwork, never source/object URL |
| `DELETE` | `/api/v1/design-templates/:templateId/drafts/:draftId/assets/:assetId` | Retire unreferenced staged artwork for durable cleanup |
| `POST` | `/api/v1/invitations/:slug/template-upgrade-preview` | Exact-version event preview with source design revision fence |

Flags default false: `TEMPLATE_AUTHORING_ENABLED`, `TEMPLATE_PUBLISH_ENABLED`,
`TEMPLATE_ADOPTION_ENABLED`, `TEMPLATE_ASSETS_ENABLED`; values must be true/false.
There is no pinning-off flag. Publication additionally requires a reviewed,
deployed manifest from [the renderer contract](../docs/contracts/invitation-renderer-capabilities/README.md).
The production approved registry is empty: payload validation is not browser or
visual acceptance, and enabling a flag alone cannot publish. A trusted synthetic
manifest exercises backend publication in integration tests only.

Run `npm run start:template-asset-worker` separately with a 256MiB process limit.
The worker accepts PNG/JPEG/WebP only, bounds bytes/pixels/dimensions/pages,
strips metadata through reencoding, claims leases with SKIP LOCKED and persists
cleanup tombstones. Author file reads recheck permission after storage IO.
Default-artwork attachment and event materialization require a reviewed manifest
with tested slots. The production registry is empty; integration fixtures exercise
the complete gated path without claiming frontend acceptance.

Not yet built: real frontend capability/visual acceptance and production private
artwork materialization acceptance. These are explicit rollout gates, not evidence
that the backend fixture manifests constitute frontend support.


Staff intake routes (default disabled; active ADMIN or assigned SUPPORT):

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/sales/enquiries` | Create contact and case atomically |
| `GET` | `/api/v1/sales/enquiries` | Assignment-scoped bounded queue |
| `GET` | `/api/v1/sales/enquiries/:enquiryId` | Current case and bounded sections |
| `PATCH` | `/api/v1/sales/enquiries/:enquiryId` | Update merged contact/requirements |
| `POST` | `/api/v1/sales/enquiries/:enquiryId/assignment` | ADMIN assignment |
| `POST` | `/api/v1/sales/enquiries/:enquiryId/stage` | Close/reopen or change stage |
| `POST` | `/api/v1/sales/enquiries/:enquiryId/notes` | Append internal note |
| `GET` | `/api/v1/sales/enquiries/:enquiryId/notes` | Page notes |
| `GET` | `/api/v1/sales/enquiries/:enquiryId/activities` | Page safe history |
| `GET` | `/api/v1/sales/enquiries/:enquiryId/consultations` | Page consultations |
| `POST` | `/api/v1/sales/enquiries/:enquiryId/consultations` | Schedule operator appointment |
| `PATCH` | `/api/v1/sales/enquiries/:enquiryId/consultations/:consultationId` | Edit/cancel/complete appointment |
| `GET` | `/api/v1/sales/consultation-availability` | Own operator occupied intervals only |
| `POST` | `/api/v1/privacy/enquiry-requests` | ADMIN staff-received phone-only request |
| `PUT` | `/api/v1/privacy/requests/:requestId/enquiry-subjects` | Bind reviewed contact IDs |
| `POST` | `/api/v1/privacy/enquiry-subject-candidates` | ADMIN exact email/phone candidates in body |
| `POST` | `/api/v1/sales/enquiries/:enquiryId/conversion` | Explicit atomic organization/draft-event setup |
Not yet accepted: deployed-process exclusion, restore/performance evidence and
four-language multi-tab frontend acceptance. No production cutover was run.

Additional F44 inventory/artwork routes:

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/v1/design-templates` | Staff inventory, 50-row cursor pages; SUPPORT sees active assignments only |
| `POST` | `/api/v1/design-templates/:templateId/drafts/:draftId/discard` | Discard an expected revision and retire eligible transient art |
| `PATCH` | `/api/v1/design-templates/:templateId/drafts/:draftId/artwork` | Atomically replace ordered same-template defaults in reviewed HERO/GALLERY slots |
| `GET` | `/api/v1/invitations/:slug/template-upgrade-previews/:previewId` | Poll requester-bound event artwork preparation and ready preview |
| `GET` | `/api/v1/invitations/:slug/design-assets/:assetId/file` | Current PUBLIC/UNLISTED invitation asset bytes |
| `GET` | `/api/v1/invitations/:slug/g/:guestToken/design-assets/:assetId/file` | Live guest-capability/pin-authorized asset bytes |
| `GET` | `/api/v1/events/:eventId/design-assets/:assetId/file` | Authorized editor's bound/ready-preview asset bytes |
| `GET` | `/api/v1/events/:eventId/design-templates/:templateKey/assets/:assetId/file` | Published same-tenant catalogue artwork sample |

Default artwork is normalized in draft/version references. Publication captures
its exact hash/dimensions/order and the immutable renderer manifest. Event upgrade
preview reserves private event-copy jobs and returns 202/PROCESSING with a poll
path; the separate worker copies sanitized bytes outside database transactions.
Confirmation refuses incomplete copies and binds the ready set atomically with
the exact pin. Initial creation can reserve jobs in its creation transaction and
return additive setup state while preserving the existing 201 event response;
its invitation remains DRAFT and cannot publish until copies are bound. A late
worker cannot bind after the initial pin changes. Event deletion retires copies
through durable tombstones while retaining reusable immutable sources.

Shared cached payloads contain only internal asset descriptors. The public reader
projects them to generic or personal capability file paths after cache retrieval;
credentials never enter shared caches. File readers recheck current status,
expiry/guest capability, pin and source availability after storage IO. Authored
payloads add exact capability identity and named `resolvedTheme`; legacy payloads
retain their exact old fields and values. Verified DSAR export includes only the
subject's authorship/assignment/publication/audit/receipt facts, and closure revokes
active assignments, preview sessions and unbound work without deleting versions.
