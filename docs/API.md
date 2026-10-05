# API Guide

Everything a client needs to talk to the Aveline backend. Written for whoever
is building the web or mobile client — human or agent.

**Base URL:** `http://localhost:3000/api/v1` in development.
**Interactive schema:** `http://localhost:3000/docs` (not served in production).
**Machine-readable:** `npm run openapi` in `backend/` writes `openapi.json`,
which most type generators consume directly.

---

## 1. Conventions that apply everywhere

Learn these once and every endpoint behaves predictably.

### Authentication is default-on

Every route needs a bearer token **unless this guide marks it public**. The
public ones exist because the people using them have no account: guests,
ticket buyers, vendors.

```
Authorization: Bearer <accessToken>
```

### Errors have one shape

```json
{
  "statusCode": 404,
  "message": "No event abc123",
  "requestId": "f1dbe1eb-bc66-4af9-b944-5694a0f037d7",
  "path": "/api/v1/events/abc123/dashboard",
  "at": "2026-10-05T09:19:43.932Z"
}
```

`message` is a **string or an array of strings** — validation failures return
an array, one entry per bad field. Handle both.

### Every response carries an id and a timestamp

```
x-request-id: f69941b8-35ae-428f-8b02-d2b7ebe7abaa
Date: Mon, 05 Oct 2026 11:42:13 GMT
```

Both headers are present on **every** response — 200, 401, 404, all of them.
The id also appears in an error body as `requestId`, alongside `at`; success
bodies carry neither, because the header is already there and wrapping every
successful response in an envelope to repeat it would buy nothing.

```ts
const requestId = response.headers.get('x-request-id');
```

**Keep it when you log a failure, and show it in any "report a problem"
screen.** It is what maps a user's screenshot to the exact request in our
logs. You may also send your own:

```
x-request-id: <your id>
```

and we will use it instead of generating one, so a trace survives from your
client through to our logs.

| Status | Means |
|---|---|
| `400` | Validation failed. `message` lists the fields |
| `401` | No token, a malformed one, or an expired one |
| `403` | Authenticated, but this account may not do this |
| `404` | Not found — or found but not visible to you |
| `409` | A conflict: sold out, already used, illegal state change |
| `415` | Unsupported file type |
| `429` | Rate limited |

**401 and 403 mean different things to a client.** 401 → refresh the token and
retry. 403 → do not retry; the account lacks the permission.

### Money is a string

Amounts are **integer minor units as decimal strings**: `"25000"`, never
`25000` and never `250.00`.

Strings because a JavaScript number cannot hold every value we store. Parse
with `BigInt` or a decimal library, not `parseFloat`.

**AMD has no subunit.** `"25000"` is 25,000 dram, not 250. For USD and EUR the
exponent is 2, so `"1050"` is $10.50.

```ts
const exponent = { AMD: 0, USD: 2, EUR: 2, RUB: 2 }[currency] ?? 2;
const display = Number(BigInt(amountMinor)) / 10 ** exponent;
```

### Lists return an envelope

```json
{ "items": [...], "total": 42, "limit": 20, "offset": 0, "hasMore": true }
```

`?limit=` (1–100, default 20) and `?offset=`. **An out-of-range limit is a
400, not a silent clamp** — asking for 500 and receiving 100 would be
undetectable.

### Locale is negotiated, not obeyed

Pass `?locale=hy|ru|en`. If the event does not publish that language you get
its default, and the response says which you actually got:

```json
{ "locale": "hy", "availableLocales": ["hy", "ru", "en"] }
```

**Render `locale`, not what you asked for.** A region tag resolves to its
language (`en-GB` → `en`).

### Rate limits

10 requests/second and 100/minute, per IP. Exceeding either returns `429`.

### Dates

ISO 8601 UTC strings. Events carry an IANA `timezone` (e.g. `Asia/Yerevan`) —
format in **that** zone, not the viewer's, or a 6pm ceremony reads as 2pm to
a guest in London.

---

## 2. Authentication

### Register / log in

```http
POST /api/v1/auth/register    { email, password, name }
POST /api/v1/auth/login       { email, password }
```

Password is at least 10 characters. Both return:

```json
{
  "accessToken": "eyJhbGci...",
  "refreshToken": "a09978c154fc...",
  "tokenType": "Bearer",
  "expiresIn": 900
}
```

`expiresIn` is **seconds**. The access token is short-lived by design.

> Login failures are deliberately indistinguishable: a wrong password and an
> unknown address both return the same 401 with the same message. Do not try
> to tell the user which it was — you cannot, and that is intentional.

### Refreshing — read this carefully

```http
POST /api/v1/auth/refresh     { refreshToken }
```

**The refresh token rotates.** The one you present is revoked and you receive a
new pair. Consequences for the client:

- Store the new `refreshToken` every time. The old one is dead immediately.
- **Never refresh twice concurrently.** Two parallel 401s each triggering a
  refresh means the second presents an already-revoked token and the user is
  signed out. Queue refreshes behind a single in-flight promise.

```ts
let inFlight: Promise<Tokens> | null = null;
function refresh() {
  inFlight ??= doRefresh().finally(() => { inFlight = null; });
  return inFlight;
}
```

```http
POST /api/v1/auth/logout            { refreshToken }   // public
POST /api/v1/auth/logout-everywhere                    // authenticated
```

### What a token does not carry

Roles are **not** in the token. They are read from the database on every
request, so removing someone from an event takes effect immediately rather
than when their token expires. Do not decode the JWT to decide what UI to
show — ask the API and handle 403.

---

## 3. Capability links — the pattern to understand

Three kinds of people use this product without an account. They are
authenticated by **possession of an unguessable URL**, not by a session.

| Who | Link | Grants |
|---|---|---|
| Guest | `/invitations/:slug/g/:guestToken` | Their invitation and their RSVP |
| Ticket buyer | `/ticket-orders/:accessToken` | Their order and tickets |
| Vendor | brief token | One event's brief, scoped |

Treat these tokens as secrets in your UI: do not log them, do not put them in
analytics, do not include them in a shared screenshot.

---

## 4. The guest flow — public, no token

### Read an invitation

```http
GET /api/v1/invitations/:slug                      # generic
GET /api/v1/invitations/:slug/g/:guestToken        # personalised
```

```json
{
  "slug": "anna-davit",
  "template": "classic",
  "theme": { "font": "Noto Serif Armenian", "palette": "ivory-gold" },
  "allowedFonts": ["Noto Serif Armenian", "Cormorant Garamond", "Inter"],
  "locale": "hy",
  "availableLocales": ["hy", "ru", "en"],
  "event": {
    "type": "WEDDING", "hosts": "Anna & Davit",
    "startsAt": "2027-01-02T11:53:26.044Z", "timezone": "Asia/Yerevan",
    "sides": { "a": "Anna", "b": "Davit" }
  },
  "guest": {
    "name": "Armen Petrosyan",
    "household": { "name": "Petrosyan family", "seatsAllotted": 3, "members": [...] },
    "rsvp": { "status": "ATTENDING", "respondedAt": "..." }
  },
  "blocks": [ { "type": "HERO", "sortOrder": 0, "content": {...}, "data": null }, ... ],
  "rsvpQuestions": [ { "id": "...", "type": "SINGLE_CHOICE", "prompt": "...", "options": [...] } ]
}
```

**`guest` is `null` on the generic URL.** Only the personalised one fills it.

### Rendering blocks

`blocks` is **already in display order** — render the array as given. Never
sort by `sortOrder`; it is informational. Disabled blocks are absent entirely.

Each block has `content` (copy, already resolved to one locale) and `data`
(live event data, present only where the block needs it):

| `type` | `data` contains |
|---|---|
| `VENUE`, `MAP` | Array of venues: name, address, latitude, longitude, arriveAt |
| `TIMELINE` | Array of `{ label, occursAt, venueId }` |
| `COUNTDOWN` | `{ target, timezone }` |
| everything else | `null` — use `content` |

Block types you may receive: `HERO`, `STORY`, `COUNTDOWN`, `MUSIC`, `VENUE`,
`MAP`, `TIMELINE`, `DRESS_CODE`, `NOTES`, `GALLERY`, `RSVP`, `SIGNATURE`,
`CHAT`, `CONTACT`.

**Render unknown block types as nothing rather than crashing.** New types ship
without a client release.

### Submit an RSVP

```http
GET  /api/v1/invitations/:slug/g/:guestToken/rsvp     # current answer
POST /api/v1/invitations/:slug/g/:guestToken/rsvp
```

```json
{
  "status": "ATTENDING",
  "attribution": "SIDE_A",
  "party": [{ "firstName": "Lusine", "lastName": "Petrosyan" }],
  "dietary": ["vegetarian"],
  "dietaryNotes": "severe nut allergy",
  "drinkPreference": "wine",
  "songRequest": "Sirun Yar",
  "message": "Congratulations!",
  "locale": "hy"
}
```

`status`: `ATTENDING` | `DECLINED` | `UNDECIDED` | `PENDING`.
`attribution`: `SIDE_A` | `SIDE_B` | `SHARED` | `UNKNOWN`.

```json
{ "status": "ATTENDING", "respondedAt": "...", "partyAdded": 1, "seatsRemaining": 1 }
```

**Submitting again updates rather than duplicating** — safe to retry, and the
right way to implement an "edit my answer" button.

Household capacity is enforced: more names than `seatsAllotted` returns `400`
with a message naming the numbers. Show `seatsRemaining` so the guest sees the
limit before hitting it.

### Find your seat

```http
GET /api/v1/events/:eventId/find-seat?q=Armen
```

---

## 5. Public events and ticketing — public

```http
GET /api/v1/public/events?limit=20&offset=0&category=conference&locale=en
GET /api/v1/public/events/:slug
```

The detail response includes `ticketTypes` with `available` (a count, never
the raw inventory counters) and a `metadata` object:

```json
"metadata": {
  "title": "...", "description": "...", "imageAssetId": null,
  "locale": "en", "alternateLocales": ["hy"],
  "canonicalPath": "/events/design-summit",
  "robots": "noindex,nofollow"
}
```

**Use `metadata` verbatim for `<head>`.** It carries Open Graph copy and the
robots directive. A private or unlisted event returns `noindex,nofollow` — do
not override it. Link previews in chat apps matter far more here than search
ranking.

### Buying tickets

```http
POST /api/v1/public/events/:slug/orders
```

```json
{
  "items": [{ "ticketTypeId": "...", "quantity": 2 }],
  "buyerName": "Ani Grigoryan",
  "buyerEmail": "ani@example.com",
  "provider": "AMERIABANK",
  "returnUrl": "https://yourapp.am/tickets/return",
  "idempotencyKey": "<uuid you generate>"
}
```

**Generate `idempotencyKey` once per checkout attempt and reuse it on retry.**
A double-tapped button with the same key returns the same order rather than
reserving twice.

```json
{
  "orderId": "...", "accessToken": "...", "status": "RESERVED",
  "totalMinor": "30000", "currency": "AMD",
  "reservesUntil": "2026-10-04T12:08:59.273Z",
  "payment": { "orderNumber": "AVL-...", "redirectUrl": "https://bank..." }
}
```

Then:

1. Store `accessToken` — it is the buyer's only way back to their order.
2. Send the browser to `payment.redirectUrl`.
3. The bank returns the buyer to your `returnUrl`.
4. **Call confirm.** The return redirect proves nothing.

```http
POST /api/v1/ticket-orders/:accessToken/confirm
GET  /api/v1/ticket-orders/:accessToken
```

Confirm asks the bank server-to-server and issues tickets only if the money
moved. Safe to call repeatedly.

`reservesUntil` is a real deadline: inventory is released after it and the
order becomes `EXPIRED`. Show a countdown.

Sold out returns `409` with how many remain.

---

## 6. Organizer surfaces — authenticated

### One screen, one request

```http
GET /api/v1/events/:eventId/dashboard
```

Returns `headcount`, `catering`, `bar`, `playlist` and `engagement` together.
**Prefer this over the individual endpoints when rendering a screen** — they
exist for narrower uses, and five calls means five spinners.

Individually: `/headcount`, `/catering-sheet`, `/bar-sheet`, `/playlist`,
`/guest-book`, `/guests`.

```http
GET /api/v1/events
```

Scoped to your own organization — **do not pass an organizationId**, it is
ignored. Platform staff see everything.

### One intent, one request

```http
PATCH /api/v1/invitations/:slug/arrangement
{ "blocks": [ { "type": "RSVP", "variant": "split" }, { "type": "HERO", "enabled": false } ] }
```

**Array order is display order.** Never compute indices. Omitted fields keep
their current value. A rejected arrangement changes nothing and names the bad
block, so you can show the error without refetching.

### Uploading a file

```http
POST /api/v1/events/:eventId/media        # multipart/form-data, field "file"
```

JPEG, PNG, WebP, AVIF, SVG, MP3, M4A. Max 10 MB. Wrong type → `415`, too
large → `413`.

```json
{ "id": "...", "url": "https://...", "kind": "PHOTO", "sizeBytes": 70 }
```

The returned `url` is publicly readable — no credentials needed to display it.

> **We do not resize.** A 6 MB photo is stored as 6 MB and served as 6 MB.
> Downscale client-side before upload until the backend does it.

### Admitting a ticket at the door

```http
POST /api/v1/tickets/:code/admit
```

The scanner screen. `code` is what the QR encodes.

```json
{ "code": "A1B2...", "admittedAt": "2026-10-05T18:02:11.000Z", "holderName": "Ani Grigoryan" }
```

**A code admits exactly once.** A second scan returns `400` with
`"Ticket already used"` — which is the point, and the message to show. Two
staff scanning the same ticket simultaneously cannot both admit it.

`404` means the code is not recognised at all. Distinguish the two in the UI:
"already admitted" is routine, "not recognised" is a problem.

Requires `guest:write`, so door staff need a real account, not a link.

### Payments directly

Ticket checkout handles payment for you — these are for the other cases, such
as taking a deposit on a booking.

```http
POST /api/v1/payments              # public: register an order, get a redirect URL
GET  /api/v1/payments/:orderNumber # public: current state
POST /api/v1/payments/:orderNumber/confirm   # public: ask the bank what happened
POST /api/v1/payments/:orderNumber/refund    # requires billing:read
POST /api/v1/payments/reconcile              # requires billing:read; ops only
```

Registration takes `amountMinor` as a string, a `provider`
(`AMERIABANK` | `INECOBANK` | `IDBANK`), a `returnUrl` and an
`idempotencyKey` you generate. It returns a `redirectUrl` to send the payer to.

The same rule as ticketing applies and is the one people get wrong: **the
return redirect is not proof of payment.** Call confirm, which checks
server-to-server. Statuses are `CREATED`, `PENDING`, `AUTHORIZED`, `CAPTURED`,
`FAILED`, `CANCELLED`, `REFUNDED`, `PARTIALLY_REFUNDED`, `EXPIRED`.

`reconcile` is an operations action — a sweep that re-asks the bank about
anything unresolved. A scheduled job already runs it; the endpoint exists for
when someone needs it sooner. Not something a user-facing screen should call.

Likewise `POST /api/v1/ticket-orders/release-expired` returns inventory held
by abandoned checkouts. Scheduled; exposed for manual use.

### Push registration

```http
POST   /api/v1/devices          { platform: "IOS"|"ANDROID"|"WEB", token, appVersion?, locale? }
DELETE /api/v1/devices/:token
```

Idempotent by token — re-register freely on every app start.

---

## 7. Health

```http
GET /api/v1/health/live      # process is up
GET /api/v1/health/ready     # dependencies
```

`ready` returns `"status": "ok"` or `"degraded"`. **Degraded is still
serving** — only Postgres is required; Redis and Mongo outages cost latency
and analytics, not correctness.

---

## 8. Things that will bite you

1. **Concurrent token refresh signs the user out.** Rotation means the second
   refresh presents a dead token. Serialise it.
2. **`parseFloat` on money loses precision.** Use `BigInt`.
3. **AMD has no decimals.** `"25000"` is twenty-five thousand dram.
4. **Render `locale`, not what you requested.** They differ when the event
   does not publish your language.
5. **Format dates in the event's `timezone`**, not the device's.
6. **Do not sort `blocks`.** They arrive ordered.
7. **Unknown block types must render as nothing**, not throw.
8. **The payment return redirect is not proof.** Always call confirm.
9. **403 is not retryable.** Only refresh on 401.
10. **Capability tokens are secrets.** Keep them out of logs and analytics.

---

## 9. Not built yet

So you can plan around them rather than discover them:

- **No password reset or email verification endpoint.** Both are modelled; no
  route accepts them.
- **No organization invite acceptance.** Memberships are created directly.
- **Nothing actually sends messages.** The outbox works; every channel writes
  to the server log instead of delivering.
- **No seating assignment.** Reading a seat works; assigning is manual.
- **No design write endpoints** beyond block arrangement. Content, themes and
  cover images have no write path.
- **No GDPR endpoints.** The schema supports erasure and export; nothing
  performs them.
- **No image resizing.**

The authoritative list is [GAPS.md](../backend/docs/GAPS.md).
