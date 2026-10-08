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

### Recovering an account

```http
POST /api/v1/auth/password-reset           { email }              # public
POST /api/v1/auth/password-reset/confirm   { token, password }    # public
POST /api/v1/auth/verify-email                                    # authenticated
POST /api/v1/auth/verify-email/confirm     { token }              # public
```

Requesting a reset **always reports `{ sent: true }`**, for a known address or
an unknown one. Do not try to tell the user which — answering differently is
an account-enumeration oracle, and the person who genuinely forgot checks
their inbox either way.

Confirming a reset **revokes every session**, since a reset is what someone
does when they believe an account is compromised. Expect to sign the user in
again afterwards.

A link is single-use and asking for a new one invalidates the previous one, so
a user who clicks an older email gets a 400. Say so plainly rather than
showing a generic failure.

### Joining an organization

```http
GET    /api/v1/organization/invites            # needs member:manage
POST   /api/v1/organization/invites            { email, role }
DELETE /api/v1/organization/invites/:email
POST   /api/v1/invites/accept                  { token, name, password }  # public
```

Accepting creates the account when the invitee has none, in the same
transaction as the membership — so there is no state where someone has a login
and no reason for it. The response says `accountCreated`, which is how you
decide whether to show a welcome or a sign-in.

Re-inviting the same address replaces the previous invitation rather than
adding a second, so only the most recent link works.

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

### The guest is sent a confirmation

Every RSVP submission queues a confirmation to the household — including a
changed answer, so a guest who switches from attending to declined sees it
acknowledged. There is different copy for each answer: attending, declined and
undecided.

It goes to the household's own recipient on the channel they were invited on,
and carries their personal link so they can change their answer later. Two
identical submissions within a minute produce one confirmation.

Nothing changes in the response, and **a failure to send never fails the
RSVP** — the answer is saved first. A household with no address on file, who
answered from a forwarded link, simply receives nothing. So the on-screen
success state is still the client's to show; the email is reassurance on top
of it, not a replacement for it.

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

### Importing a guest list

```http
POST /api/v1/events/:eventId/guests/import
Content-Type: multipart/form-data
```

One field, `file`: a CSV, up to 2 MB. Requires `guest:write`.

Column headers are matched case-insensitively against a list of spellings, so
you do not need to make the host rename anything. Recognised:

| Field | Accepted headers |
|---|---|
| First name (**required**) | `firstname`, `first name`, `first`, `name`, `guest`, `անուն` |
| Last name | `lastname`, `last name`, `surname`, `last`, `ազգանուն` |
| Email | `email`, `e-mail`, `mail` |
| Phone | `phone`, `mobile`, `telephone`, `tel` |
| Household | `household`, `family`, `group`, `party` |
| Seat allowance | `seats`, `seats allotted`, `allowance`, `plus ones` |
| Side | `side`, `attribution`, `invited by` |
| Locale | `locale`, `language`, `lang` |

`side` accepts `a` / `b`, `side_a` / `side_b`, or free text that starts with
either. `seats` must be a positive integer. A row with no first name is
rejected; everything else is optional.

```json
{
  "importId": "clz...",
  "status": "PARTIAL",
  "rowsImported": 412,
  "rowsFailed": 3,
  "errors": [
    { "row": 7, "message": "A guest needs at least a first name" },
    { "row": 19, "message": "seats must be a positive whole number" }
  ]
}
```

**Partial success is the normal case, and it is a `201`, not an error.** Good
rows are saved; bad rows are reported. `status` is `COMPLETED` (nothing
failed), `PARTIAL` (some failed) or `FAILED` (nothing imported). Show the error
list inline against a re-upload button rather than discarding the upload.

`row` is the spreadsheet row number the host sees — the header is row 1, so the
first data row is 2. Do not renumber it.

Guests sharing a `household` value become one household, which is the unit
seating and catering work on. Rows with no household each get their own.

**Re-importing is safe.** A household that already exists by name is reused and
its guests are matched on name, so correcting a spreadsheet and uploading again
updates rather than duplicating. It never deletes: a guest removed from the CSV
stays on the event.

```http
GET /api/v1/events/:eventId/guests/imports
```

The last imports, newest first, each with `filename`, `rowsImported`,
`rowsFailed`, `status` and `errors` — enough to show "412 of 415 imported" days
later. Requires `guest:read`.

### Tables and seating

```http
GET    /api/v1/events/:eventId/tables
POST   /api/v1/events/:eventId/tables
POST   /api/v1/events/:eventId/tables/bulk
DELETE /api/v1/events/:eventId/tables/:tableId
```

`GET` returns each table with its occupancy and who is at it, which is the
whole seating screen in one request:

```json
[
  {
    "id": "clz...", "name": "Table 1", "capacity": 10, "zone": "Main hall",
    "seated": 7, "available": 3,
    "guests": [{ "guestId": "clz...", "name": "Armen Petrosyan", "position": null }]
  }
]
```

`POST /tables` takes `{ name, capacity, zone?, venueId? }`. For a real room,
use `/tables/bulk` with `{ namePrefix, count, capacity, zone?, venueId? }` —
twenty tables of ten is one request, and names continue from the tables that
already exist (`Table 1` … `Table 20`). It returns `{ "created": 20 }`.

Deleting a table with guests at it returns `409` naming how many, because the
cascade would silently unseat them. Unseat them first.

```http
POST   /api/v1/events/:eventId/seats          { guestId, tableId, position? }
DELETE /api/v1/events/:eventId/seats/:guestId
```

`POST` seats a guest, or moves one who was already seated — there is no
separate move call. A full table returns `409` with its name. Capacity is
checked inside the transaction, so two coordinators filling the last chair at
once cannot both succeed; handle the `409` as a routine outcome of drag-and-drop
and re-fetch the table.

```http
POST /api/v1/events/:eventId/seats/auto-assign
```

Seats everyone who has accepted, then tells you who did not fit:

```json
{
  "seated": 84,
  "households": 31,
  "unseated": [
    { "householdId": "clz...", "size": 5, "reason": "No table has 5 free seats together" }
  ]
}
```

Three things to know before you wire the button:

1. **It is additive, not a re-plan.** Guests already seated keep their seats,
   and their tables count as partly occupied. Running it after a late RSVP
   fills the gaps instead of rearranging a plan the host has adjusted by hand.
   There is no "re-seat everything" call; unseat first if that is the intent.
2. **It never splits a household and never exceeds a capacity.** Those are hard
   constraints. Keeping each side of the family together is a preference it
   satisfies when it can.
3. **It is a good plan, not the optimal one.** It will not find a packing that
   requires rearranging already-seated guests. `unseated` is normal when the
   room is nearly full — present it as "these 2 households need a table",
   not as a failure.

Tables and seats require `seating:write`; reading requires `seating:read`.

### Check-in on the day

```http
POST   /api/v1/events/:eventId/guests/:guestId/check-in
DELETE /api/v1/events/:eventId/guests/:guestId/check-in
```

```json
{
  "guestId": "clz...", "name": "Armen Petrosyan",
  "arrivedAt": "2026-10-05T18:02:11.000Z",
  "table": "Table 4", "wasExpected": true
}
```

The response is the door screen: the name to confirm, the table to point at,
and `wasExpected` — `false` means this guest declined or never responded and
has turned up anyway, which is worth showing the host rather than silently
admitting.

**A guest arrives once.** A second check-in returns `409`. Two people on the
door cannot both record the same arrival, so treat the `409` as "already here"
and show the first arrival time, not as an error. `DELETE` undoes a mis-scan
and a guest can then be checked in again.

```http
GET /api/v1/events/:eventId/arrivals
```

```json
{
  "expected": 96, "arrived": 71, "stillToCome": 25,
  "recent": [{ "name": "Armen Petrosyan", "arrivedAt": "2026-10-05T18:02:11.000Z" }]
}
```

`expected` counts guests who accepted, so `arrived` can exceed it and
`stillToCome` floors at zero. `recent` is the last 20. Poll this; there is no
push yet.

Check-in requires `guest:write`, so door staff need a real account rather than
a link.

### Becoming a tenant — do this once, first

```http
POST /api/v1/organizations      { "name": "Petrosyan Wedding", "kind": "HOST" }
```

**A freshly registered account belongs to no organization, and every
organization-scoped route answers `403` until it does.** Registering is not
enough. Make this call immediately after `POST /auth/register` unless the
account arrived through `POST /invites/accept`, which already placed it in one.

```json
{
  "id": "clz...", "name": "Petrosyan Wedding", "kind": "HOST",
  "events": 0, "members": 1, "plan": null, "subscriptionStatus": null
}
```

The caller becomes `OWNER`. `kind` is `HOST` for a couple or `AGENCY` for a
planner, and only affects presentation today.

**One organization per account.** A second call returns `409` naming the one
that exists. This is a current limitation, not a product decision: the server
resolves "your organization" from your single membership, and allowing two
would make every organization-scoped route act on whichever came back first.

```http
GET   /api/v1/organizations/current
PATCH /api/v1/organizations/current   { "name": "..." }
```

`GET` needs `event:read`; renaming needs `member:manage`.

### Plans and subscriptions

```http
GET /api/v1/plans
```

Public — this is the pricing page.

```json
[
  {
    "key": "managed-monthly", "name": "Managed", "tier": "MANAGED",
    "priceMinor": "25000", "currency": "AMD", "interval": "MONTHLY",
    "entitlements": {
      "maxEventsPerPeriod": 3, "maxGuestsPerEvent": 400, "maxLocales": 3,
      "invitationLifetimeDays": null, "features": ["seating", "check-in"]
    }
  }
]
```

`invitationLifetimeDays: null` means the invitation stays up indefinitely;
a number is how long after the event a free-tier page remains reachable.
**Nothing enforces these entitlements yet** — they are published so you can
build the pricing page and gate the UI, but the server will not refuse a
fourth event today.

```http
GET /api/v1/subscription
```

```json
{ "subscription": { "status": "ACTIVE", "plan": { ... }, "entitlements": { ... },
  "currentPeriodEnd": "2026-11-05T...", "cancelAtPeriodEnd": false } }
```

Always an object. `{ "subscription": null }` means the organization has never
subscribed, which is not an error — render an upgrade prompt, not a failure.
Requires `billing:read`.

```http
POST /api/v1/subscription   { "planKey": "managed-monthly", "provider": "AMERIABANK" }
```

A free plan (`priceMinor: "0"`) activates immediately and returns
`invoice: null`. A paid one needs `provider`, issues an invoice, and returns a
bank URL:

```json
{
  "subscription": { "status": "TRIALING", ... },
  "invoice": { "number": "AV-2026-000001", "status": "ISSUED", "totalMinor": "25000" },
  "payment": { "orderNumber": "...", "redirectUrl": "https://bank..." }
}
```

**Access begins when the payment confirms, not when this call returns.** The
subscription stays `TRIALING` until then — send the payer to `redirectUrl`, and
on their return call:

```http
POST /api/v1/invoices/:number/confirm
```

which asks the bank server-to-server and activates the subscription. Safe to
call twice; a second call never double-activates or double-counts.

Changing plan is the same call with a different `planKey` — it replaces the
subscription in place rather than opening a second.

```http
POST /api/v1/subscription/cancel
POST /api/v1/subscription/resume
```

Cancelling sets `cancelAtPeriodEnd: true` and leaves the status `ACTIVE`:
someone who paid for the month keeps the month. Show them
`currentPeriodEnd`, not "cancelled". `resume` undoes it until that date passes,
after which it returns `400` and the answer is to subscribe again. Both need
`billing:write`.

### Invoices

```http
GET /api/v1/invoices
GET /api/v1/invoices/:number
```

```json
{
  "number": "AV-2026-000001", "status": "ISSUED",
  "subtotalMinor": "25000", "taxMinor": "0", "totalMinor": "25000",
  "currency": "AMD",
  "lines": [{ "description": "Managed (monthly)", "quantity": 1, "totalMinor": "25000" }],
  "issuedAt": "2026-10-05T...", "dueAt": "2026-10-12T...", "paidAt": null,
  "paymentOrderNumber": "..."
}
```

Numbers are gap-free within a year and sort as plain text in issue order.
`lines` is captured at issue, so a later price change never rewrites a document
a customer has filed. **`taxMinor` is always `"0"` — tax is not computed yet.**
Do not present an invoice as a tax document.

### Promo codes

```http
GET    /api/v1/promo-codes
POST   /api/v1/promo-codes          { "code": "SPRING25", "kind": "PERCENT", "value": "25", ... }
PATCH  /api/v1/promo-codes/:codeId  { "maxRedemptions": 200, "validUntil": "...", "isActive": false }
DELETE /api/v1/promo-codes/:codeId
```

Creating takes `code`, `kind` (`PERCENT` or `FIXED`) and `value` — a percentage
1–100, or an amount in minor units. Optional: `eventId` (omitted applies it to
every event), `maxRedemptions`, `minOrderMinor`, `validFrom`, `validUntil`.

Codes are **case-insensitive** and stored upper-cased, so `spring25` comes back
as `SPRING25`. Letters, numbers and hyphens only.

```json
{ "id": "clz...", "code": "SPRING25", "kind": "PERCENT", "value": "25",
  "redemptions": 12, "maxRedemptions": 100, "remaining": 88, "isActive": true }
```

`remaining` is what a host wants to see; it is `null` for an uncapped code.

**`kind` and `value` cannot be changed.** A buyer holding a poster must get
what it advertises, and orders record the discount they were given. `PATCH`
changes only the limits, and lowering `maxRedemptions` below what has already
been used returns `400`. `DELETE` deactivates — nothing is ever deleted,
because a refund is calculated from what the order was charged.

Requires `billing:write` to change and `billing:read` to list, which in
practice means an organization `OWNER`: discounts are revenue.

### Checking a promo code before checkout — public

```http
POST /api/v1/public/events/:slug/promo-check
{ "code": "spring25", "items": [{ "ticketTypeId": "...", "quantity": 2 }] }
```

```json
{ "code": "SPRING25", "isApplicable": true, "subtotalMinor": "20000",
  "discountMinor": "5000", "totalMinor": "15000", "currency": "AMD" }
```

When it does not apply, `isApplicable` is `false` and `reason` is text written
to be shown to the buyer ("This code has run out", "This code has expired",
"We do not recognise that code"). The status is still `200` — a code that does
not apply is an answer, not an error.

Send `items`, not a subtotal: the price is computed from our own ticket prices.

**This is a preview and can go stale.** Redeem by passing `promoCode` to
`POST /public/events/:slug/orders`; the redemption is claimed there, atomically.
A code with one use left can be taken by someone else in between, and that
checkout returns `409 "This code has just run out"`. Treat it as a routine
outcome: clear the code and let the buyer continue at full price.

The order response carries `discountMinor` alongside `totalMinor`.

### Vendors and scoped briefs

```http
GET  /api/v1/vendors?category=CATERING
POST /api/v1/vendors                 { "name": "...", "category": "CATERING", ... }
```

The partner directory. `category` is one of `VENUE`, `CATERING`, `BAR`,
`DECOR`, `PHOTOGRAPHY`, `VIDEOGRAPHY`, `MUSIC`, `PRINT`, `OTHER`.

```http
GET   /api/v1/events/:eventId/vendors
POST  /api/v1/events/:eventId/vendors   { "vendorId": "...", "briefScopes": ["headcount"], "feeAmount": "150000.00" }
PATCH /api/v1/events/:eventId/vendors/:bookingId
DELETE /api/v1/events/:eventId/vendors/:bookingId
```

`briefScopes` is exactly what that vendor may read, from this list:

| Scope | What it shows |
|---|---|
| `headcount` | Confirmed headcount by side |
| `catering` | Covers and dietary requirements |
| `bar` | Drink preferences as quantities |
| `playlist` | Requested songs |
| `timeline` | Running order and access times |
| `seating` | Tables, capacities and who sits where |
| `households` | Guests grouped by household, for formal photographs |
| `contacts` | Guest emails and phone numbers |

Omit `briefScopes` and the vendor's category decides: a caterer gets
`headcount`, `catering`, `timeline`. Defaulting narrows rather than widens, so
forgetting the field is safe. An unrecognised scope is a `400`.

**`feeAmount` is absent from the response unless you hold `vendor:fee:read`.**
It is not `null` — the field is not there at all. A `VIEWER` sees the vendor
and not the commercial terms.

Re-posting the same `vendorId` edits the existing engagement; there is never a
second booking for one vendor on one event.

```http
GET /api/v1/briefs/:briefToken
```

Public, authenticated by the link alone — the same capability pattern as a
guest invitation. Send the vendor
`https://your-app/briefs/<briefToken>`.

```json
{
  "vendor": { "name": "Tashir Catering", "category": "CATERING" },
  "status": "CONFIRMED",
  "event": { "title": "...", "startsAt": "...", "timezone": "Asia/Yerevan", "venues": [...] },
  "granted": [
    { "section": "headcount", "purpose": "Confirmed headcount by side" },
    { "section": "catering", "purpose": "Covers and dietary requirements" }
  ],
  "headcount": { ... },
  "catering": { ... }
}
```

**A section the booking did not grant is absent, not empty.** Render from
`granted` rather than probing for keys. `granted: []` is valid and means the
vendor sees only the event and its venues.

```http
POST /api/v1/events/:eventId/vendors/:bookingId/rotate-brief
```

Issues a new token and **kills the old link immediately** — the only revocation
a capability URL has, for when a brief is forwarded to the wrong supplier.
Cancelling a booking rotates too, so a cancelled engagement's sent link stops
working. An old link returns `404`; a cancelled booking's current link returns
`403`.

### Exports

```http
POST /api/v1/events/:eventId/exports   { "kind": "GUEST_LIST", "format": "CSV" }
GET  /api/v1/events/:eventId/exports
GET  /api/v1/events/:eventId/exports/:exportId
```

`kind` is one of `GUEST_LIST`, `SEATING_CHART`, `PLACE_CARDS`,
`CATERING_SHEET`, `BAR_SHEET`, `PLAYLIST`, `TICKET_MANIFEST`.

```json
{
  "id": "clz...", "kind": "GUEST_LIST", "format": "CSV", "status": "COMPLETED",
  "completedAt": "2026-10-05T...",
  "asset": { "url": "https://storage/...csv", "sizeBytes": 48213 }
}
```

CSV is generated during the request, so `status` is already `COMPLETED` and
`asset.url` is ready to hand to the browser. **Read `status` anyway** — PDF
will be queued when it exists, and a client that already branches on it will
not need changing. `FAILED` carries `failureReason`.

`format` defaults to `CSV`. `PDF` and `XLSX` return `400` today; the message
says so rather than queueing something that never runs.

The files are UTF-8 with a BOM and CRLF endings, so Excel opens Armenian text
correctly, and every cell is quoted — including a defensive tab in front of
anything starting with `=`, `+`, `-` or `@`, so a guest's free text cannot
become a formula in whoever's spreadsheet opens it.

Requires `operations:read`.

### Suppression — who must not be contacted

```http
GET    /api/v1/suppressions
POST   /api/v1/suppressions              { "channel": "EMAIL", "address": "ani@example.am" }
DELETE /api/v1/suppressions/:suppressionId
```

```json
[{ "id": "clz...", "channel": "EMAIL", "address": "ani@example.am",
   "reason": "UNSUBSCRIBED", "scope": "ORGANIZATION", "createdAt": "..." }]
```

`scope` is the field that matters. `ORGANIZATION` is an ordinary unsubscribe
from your events and you can lift it. `GLOBAL` is a hard bounce or a spam
complaint, applies platform-wide, and `DELETE` on it returns `409` — one
customer's send must not be allowed to damage delivery for the others. Show
global entries as informational, without a remove button.

Addresses are matched case-insensitively for email, and `POST` is idempotent.
`reason` defaults to `MANUAL`; a later, stronger reason replaces a weaker one.

**A suppressed recipient still produces a `Message` row**, with status
`SUPPRESSED` and a reason — so "why did my guest never get this?" has an
answer. Nothing is silently dropped. Suppression is checked both when a message
is queued and again when it is sent, because a reminder can wait in the outbox
for weeks.

Listing needs `guest:contact:read`; changing needs `guest:write`.

### Data-subject requests — GDPR

```http
POST /api/v1/privacy/requests   { "kind": "EXPORT", "subjectEmail": "ani@example.am" }
```

**Public, and deliberately uninformative.** A data subject is usually a guest
with no account, so requiring one would make the right unexercisable.

```json
{
  "reference": "clz...", "kind": "EXPORT", "status": "RECEIVED",
  "dueAt": "2026-11-04T...",
  "message": "Your request has been recorded. We will verify your identity and respond within one month."
}
```

The response is **identical whether or not anything is held about that
address** — "we hold nothing about you" is itself information, and anyone can
type any address into this form. Do not build a UI that implies otherwise.

`kind` is `EXPORT` (Article 15), `ERASURE` (Article 17) or `RECTIFICATION`
(Article 16). `dueAt` is one month out, per Article 12. Submitting the same
kind for the same address while one is open returns the existing `reference`
rather than opening a second.

```http
GET   /api/v1/privacy/requests?status=RECEIVED
PATCH /api/v1/privacy/requests/:requestId   { "status": "IN_PROGRESS", "notes": "..." }
POST  /api/v1/privacy/requests/:requestId/fulfil
```

Staff-facing, and they need `privacy:manage` — an organization `OWNER` or
Aveline `ADMIN`, never a coordinator. The list is a deadline queue, soonest
`dueAt` first.

`fulfil` is refused with `400` unless the request is `IN_PROGRESS`, which a
human sets after establishing who the requester is. **Acting on an unverified
request is itself a breach**: the form is public, so without that gate anyone
could erase a stranger's data by typing their address.

An `EXPORT` returns the data as JSON in the response — account, guest records,
ticket orders, messages sent and suppressions. It is assembled on demand and
never stored, because a copy waiting to be collected is a second place it can
leak from.

An `ERASURE` anonymises in place and reports what it touched:

```json
{ "reference": "clz...", "kind": "ERASURE", "guestsAnonymised": 1,
  "ticketOrdersAnonymised": 1, "messagesRedacted": 4, "suppressionsRemoved": 1 }
```

What goes: names, emails, phone numbers, the guest's own free text (their
guest-book message, dietary note and song request), message bodies, and the
invitation token — which is itself identifying and would otherwise still open
their RSVP from a group chat.

What stays, on purpose: the household, the seat, the RSVP status and dietary
tags, and a paid order's amount. A wedding that had 96 covers still had 96
covers, the caterer was already paid for them, and a financial record has its
own retention obligation. So an erased guest appears in sheets as **`Removed`**
with their structural data intact — expect that string in a guest list and do
not render it as a missing value.

`RECTIFICATION` returns `400`: a correction is applied by editing the record,
then the request is closed with `PATCH`.

### Creating an event — start here

```http
POST /api/v1/events
{ "type": "WEDDING", "title": "Anna & Davit", "startsAt": "2027-06-12T15:00:00.000Z",
  "locales": ["hy", "en"] }
```

**This is step two of onboarding**, after `POST /organizations`. It creates the
event, its draft invitation and the caller's ownership in one request, because
nothing can be done with an event that has no invitation and an event nobody
owns cannot be read back.

```json
{
  "id": "clz...", "title": "Anna & Davit", "type": "WEDDING", "status": "DRAFT",
  "hostsLabel": "Anna & Davit", "timezone": "Asia/Yerevan", "defaultLocale": "hy",
  "invitation": { "slug": "anna-davit-3f8a1c20", "status": "DRAFT", "theme": {...} },
  "venues": [], "timeline": []
}
```

`type` is `WEDDING`, `ENGAGEMENT`, `BAPTISM`, `BIRTHDAY`, `ANNIVERSARY`,
`CORPORATE` or `OTHER`. Optional: `hostsLabel` (defaults to the title),
`endsAt`, `timezone` (defaults to `Asia/Yerevan`), `locales`, `defaultLocale`,
`sideALabel` / `sideBLabel`, `visibility`, and `templateKey`.

**The slug is generated, not chosen.** It reads as the hosts' names where they
are URL-safe and falls back to `event-<random>` otherwise — an Armenian title
contains nothing URL-safe, so that is the normal case, not the edge one. Two
events with the same hosts get different slugs. There is no endpoint to choose
a custom slug yet.

**`403` means the account has no organization.** Create one first; the message
says so.

If no design template existed when the event was created, `invitation` comes
back `null` and `POST /events/:id/invitation` adds one later.

### The running order

```http
GET    /api/v1/events/:eventId/timeline
POST   /api/v1/events/:eventId/timeline   { "label": {...}, "occursAt": "...", "venueId": "..." }
PATCH  /api/v1/events/:eventId/timeline/:entryId
DELETE /api/v1/events/:eventId/timeline/:entryId
```

Ceremony, reception, first dance, cake, close. Typed once here and read by
three places: the invitation's `TIMELINE` block, the day-of vendor brief, and
the operations view.

`label` is translated (`{ "hy": "Պսակադրություն", "en": "Ceremony" }`) and
needs at least one language — a blank row on the invitation reads as a bug to
the guests looking at it. `venueId` must be one of this event's venues.
`sortOrder` breaks ties between two things at the same minute; entries come
back ordered by `occursAt` first, so you do not have to maintain it.

Reading needs `event:read`, writing `event:write`.

### Designing the invitation

```http
GET /api/v1/events/:eventId/design-templates
```

```json
[{
  "key": "classic-armenian", "name": "Classic",
  "allowedFonts": ["Noto Serif Armenian", "Mardoto"],
  "palettes": [{ "name": "blush", "colors": ["#f5e1e0", "#b76e79"] }],
  "supportedBlocks": ["HERO", "STORY", "VENUE", "RSVP"],
  "defaultTheme": { "bodyFont": "Mardoto", "palette": "blush" }
}]
```

**Build the design UI from these three lists.** `allowedFonts` and `palettes`
are enforced on write, so a font picker offering anything else produces a
`400`. `supportedBlocks` is what the arrangement call will accept. Keyed by
event because a plan may later narrow the catalogue.

```http
POST /api/v1/invitations/:slug/template   { "templateKey": "minimal" }
```

Switching **disables** blocks the new template does not support rather than
deleting them, so switching back does not lose the host's copy — a disabled
block still holds its content. The theme resets to the new template's
`defaultTheme`, because carrying a font the new template does not ship over
would produce the broken render that validation exists to prevent. Warn before
calling it.

```http
PATCH /api/v1/invitations/:slug/theme
{ "headingFont": "Mardoto", "bodyFont": "Mardoto", "palette": "blush", "colors": ["#1a2b3c"] }
```

Every field is optional and **omitted means "leave as is"** — changing one font
does not clear the palette. A rejection changes nothing and `message` is an
array naming every problem at once, so a form can mark four fields in one
round trip:

```json
{ "message": [
  "bodyFont: \"Comic Sans\" is not one of this template's fonts (Noto Serif Armenian, Mardoto)",
  "palette: \"neon\" is not one of this template's palettes (blush, olive)"
] }
```

`colors` is for a host-tuned palette: one to eight six-digit hex values
(`#1a2b3c`). `#fff`, `red` and `rgb(...)` are rejected. An empty array is a
`400` telling you to omit the field instead, because clearing is not what it
means.

```http
PATCH /api/v1/invitations/:slug/blocks/:type
{ "content": { "hy": { "title": "..." } }, "settings": {}, "variant": "split",
  "assetIds": ["..."], "enabled": true }
```

`:type` is a `BlockType` — `HERO`, `STORY`, `COUNTDOWN`, `MUSIC`, `VENUE`,
`MAP`, `TIMELINE`, `DRESS_CODE`, `NOTES`, `GALLERY`, `RSVP`, `SIGNATURE`,
`CHAT`, `CONTACT`.

**This call edits what is inside a block. It does not create one.** Which
blocks exist, and in what order, is `PATCH /invitations/:slug/arrangement` —
one place decides that. Patching a block the invitation does not have returns
`404` saying so.

`content` is keyed by locale. `assetIds` must belong to this event; one from
another event is a `400`. `VENUE`, `TIMELINE` and `COUNTDOWN` blocks ignore
content you put here for the fields they bind from the event — see
§Rendering blocks.

### Sending the invitation

```http
POST /api/v1/invitations/:slug/send      { "guestIds": ["..."] }
```

The product's core loop. Requires `invitation:publish` — sending *is*
publishing, so it is not a designer's to press.

```json
{
  "queued": 128,
  "alreadySent": 0,
  "recipients": [{ "householdName": "Petrosyan family", "toAddress": "armen@example.am" }],
  "suppressed": [{ "householdName": "Hakobyan", "toAddress": "ani@example.am" }],
  "unreachable": [{ "householdId": "clz...", "householdName": "No Contact",
                    "reason": "No email address for anyone in this household" }]
}
```

**One email per household, not per guest.** A family of three shares one link
and one seat allowance, so inviting each member would mean three emails about
one invitation and three people answering for the same seats. The recipient is
the household's primary guest, or whoever in it has an address if the primary
has none — and the link carries *that* guest's token, so it personalises for
whoever opens it.

**Safe to press twice.** A guest is invited once per invitation; a second call
returns `alreadySent` and queues nothing. Build the button so it can be
clicked again without a confirmation dialog — a host who sees nothing happen
for a second will click anyway.

**Three outcome lists, because each needs a different action from the host:**

| List | What it means | What the host does |
|---|---|---|
| `recipients` | Queued for delivery | Nothing |
| `suppressed` | They opted out, or a previous send hard-bounced | Talk to the guest; do not retry |
| `unreachable` | No usable address on the household | Fix the address, then send again |

`reason` on an unreachable entry is written for a host to read, and quotes a
malformed address back rather than reporting it as missing.

`guestIds` sends only to those guests' households — naming any member invites
the household. Omitted, it invites every household on the event that has not
been invited yet. An id that is not on the event is a `400`, not a silent
no-op.

**A draft is refused** with a `400` saying to publish first: the link resolves
to a page that 404s until then, and four hundred emails cannot be recalled.

**Mail is queued, not sent during the request.** Four hundred SMTP
conversations inside one request would hold it open for minutes and fail
halfway with no record of where it stopped. `queued` means accepted into the
outbox; delivery is the next call's business.

### Which channel a message goes out on

Guests are reached on email, Telegram or WhatsApp, decided per household by
the server. The client does not choose, but two things are visible to it.

**`POST /invitations/:slug/send` and `/remind` report the channel used**, on
each entry in `recipients`:

```json
{ "householdName": "Petrosyan family", "toAddress": "123456789", "channel": "TELEGRAM" }
```

`GET /invitations/:slug/delivery` carries `channel` per household too, and
`toAddress` is whatever that channel addresses — an email address, a Telegram
chat id, or a phone number. Do not assume it is an email address.

**Preference order:** Telegram if the guest opted in, then WhatsApp if there
is a phone number, then email. A channel the guest opted into outranks one
that costs per message.

**An invitation always goes by email.** A Telegram bot cannot message anyone
who has not started a conversation with it, so Telegram can never be first
contact. The sequence is: invitation by email → guest taps a Telegram deep
link → reminders go to Telegram.

**That deep link is yours to place.** Invitation copy can include
`{{telegramLink}}`, which renders as `https://t.me/<bot>?start=<guestToken>`.
Put it in the email and on the invitation page as "get updates on Telegram" —
without it, no guest ever opts in and the channel stays unused. It is empty
when no bot is configured, so render it conditionally.

**Unreachable reasons now distinguish the cases.** A household whose only
address is a Telegram chat that has not opted in reports *"has not opened the
Telegram link yet"*, which is a different action for the host than a missing
address.

### Chasing non-responders

```http
POST /api/v1/invitations/:slug/remind
```

```json
{
  "queued": 42,
  "alreadyRemindedToday": 0,
  "recipients": [{ "householdName": "Petrosyan family", "toAddress": "armen@example.am" }],
  "notInvited": [{ "householdId": "clz...", "householdName": "No Contact",
                   "reason": "No email address for anyone in this household" }]
}
```

Reminds the households that **were invited and have not answered**. A guest who
replied — attending or declined — is never chased; that is what turns a
reminder into a nuisance. Nor is a guest who never received the invitation:
`notInvited` lists them, and the fix for those is to send, not to remind.

**At most one reminder per guest per day.** Pressing twice is safe, and
following up again tomorrow still works. `alreadyRemindedToday` is how many
were skipped for that reason — not an error.

Refused with a `400` once the event has started, and for an unpublished
invitation.

Requires `invitation:publish`, like sending.

### Thanking the guests afterwards

```http
POST /api/v1/invitations/:slug/thank-you
```

Goes to the households where **someone actually checked in** — arrival, not an
RSVP, because thanking a guest who accepted and then did not come is worse
than saying nothing. **If the event has no check-ins at all**, because nobody
ran the door, it goes to everyone who said they would attend instead. A door
that recorded even one arrival is taken as having recorded them all, so a
partial check-in list is never padded out with acceptances. Refused with a
`400` before the event has happened.

```json
{ "queued": 88, "alreadyThanked": 0, "basis": "ARRIVED", "recipients": [...], "notInvited": [] }
```

`basis` is `ARRIVED` or `ACCEPTED` and says which rule chose the recipients —
show it, so a host who never ran check-in is not surprised to find that
everyone who accepted was thanked.

**Once ever, not once a day** — unlike `remind`. A second thank-you is not a
follow-up, so `alreadyThanked` counts the households skipped. Requires
`invitation:publish`.

### Reminders go out on their own, too

Three automatic reminders per event, at **21 days, 7 days and 2 days before**
it starts, to whoever has not answered. Nothing is needed from the client —
this happens on the server — but two things matter for the UI:

1. **Exactly one reminder fires per window.** An invitation sent three days
   before the event has already passed the 21- and 7-day marks; only the
   milestone in force sends, so a guest never receives three emails at once.
2. **A host can switch them off**, per event. They write to guests without
   anyone pressing anything, so some hosts — the ones who chase by phone —
   will want them off:

   ```http
   PATCH /api/v1/events/:eventId/settings   { "remindersEnabled": false }
   ```

   Needs `event:write`. Deliberately not a general event PATCH: a date or
   venue change affects an invitation people already hold, so it belongs with
   a flow that knows how to tell those guests.

Automatic reminders show up in `GET /invitations/:slug/delivery` like any other
message, and stop as soon as a guest answers.

```http
GET /api/v1/invitations/:slug/delivery
```

```json
{
  "invited": 127, "notSent": 1,
  "unreachable": [...],
  "households": [{
    "householdId": "clz...", "household": "Petrosyan family",
    "guest": "Armen Petrosyan", "toAddress": "armen@example.am",
    "status": "SENT", "attempts": 1, "failureReason": null,
    "sentAt": "2026-10-05T18:02:11.000Z"
  }]
}
```

Grouped by household, because "have the Petrosyans been invited?" is the
question a host asks — not "what is the status of message 4f2a".

`status` is `NOT_SENT` (no email exists yet) or a `Message` status: `QUEUED`,
`SENDING`, `SENT`, `DELIVERED`, `FAILED`, `BOUNCED`, `SUPPRESSED`.

**`SENT` means the mail server accepted it, not that it arrived.** A bounce can
follow minutes later, and when it does the status becomes `BOUNCED` with the
server's own words in `failureReason`. `QUEUED` with `attempts` above zero is a
message being retried after a temporary failure — not stuck.

### Custom RSVP questions

```http
GET    /api/v1/invitations/:slug/questions
POST   /api/v1/invitations/:slug/questions   { "type": "SINGLE_CHOICE", "prompt": {...}, "options": {...} }
PATCH  /api/v1/invitations/:slug/questions/:questionId
DELETE /api/v1/invitations/:slug/questions/:questionId
```

`type` is `TEXT`, `LONG_TEXT`, `SINGLE_CHOICE`, `MULTI_CHOICE`, `BOOLEAN` or
`SIGNATURE`. `prompt` is translated (`{ "hy": "...", "en": "..." }`) and must
carry at least one language. `options` is translated too
(`{ "hy": ["Միս", "Ձուկ"] }`) and is **required for the choice types** — a
choice question with no choices cannot be answered, so it is a `400`.

New questions go last; `sortOrder` comes back on each.

**Deleting is refused once any guest has answered**, with a `400` saying how
many and suggesting you make it optional instead — deleting would discard what
those guests told the host, which is not what "remove this field" means to the
person clicking it.

### Venues

```http
GET    /api/v1/events/:eventId/venue-profiles?city=Yerevan
GET    /api/v1/events/:eventId/venues
POST   /api/v1/events/:eventId/venues
PATCH  /api/v1/events/:eventId/venues/:venueId
DELETE /api/v1/events/:eventId/venues/:venueId
```

This is where an address is typed, once. It then appears in the invitation's
venue block, the map block, the day-of timeline and the vendor brief — nothing
re-enters it.

`POST` takes `{ role, name, address, profileId?, mapUrl?, arriveAt? }` where
`role` is `CEREMONY`, `RECEPTION`, `AFTER_PARTY`, `PREPARATION` or `OTHER`.

Naming a `profileId` from the directory **copies** its coordinates and capacity
rather than referencing them, so a hall that moves next year does not rewrite
the address on an invitation already sent.

`DELETE` is refused with a `400` while timeline entries or tables still point
at the venue, naming how many — the cascade would otherwise detach a running
order from where it happens.

Reading needs `event:read`; writing needs `event:write`. Design calls need
`invitation:design`, which a `DESIGNER` has.

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

### Not for you: the Telegram webhook

```http
POST /api/v1/webhooks/telegram
```

Telegram calls this; no client should. It is listed only so it is not mistaken
for something to integrate with. It records a guest's opt-in when they tap the
deep link, and treats blocking the bot as an unsubscribe.

### The audit trail

```http
GET /api/v1/events/:eventId/audit-trail
```

```json
[{
  "action": "events.guests.import.create", "method": "POST",
  "route": "/events/:eventId/guests/import",
  "userId": "clz...", "email": "host@example.am",
  "eventId": "clz...", "statusCode": 201,
  "requestId": "...", "at": "2026-10-05T18:02:11.000Z"
}]
```

Successful writes only, newest first, up to 100. Requires `member:manage`
rather than `event:read`, because the trail names the people who did things —
including Aveline `SUPPORT` staff acting on a customer's behalf, which is who
it mainly exists to hold accountable.

**It records that something changed, never what it changed to.** A guest list,
a reset payload and a card binding do not belong in a second store with
weaker access controls than Postgres. Reads are not recorded either — they are
almost all the traffic and would bury the writes.

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

## 9. Development-only behaviour

Endpoints that email a link **also** return it in the response while the
backend is pre-production, so a flow can be completed locally without opening
a mailbox. The email is really sent either way:

```json
{ "sent": true, "devLink": "http://localhost:5173/reset-password?token=..." }
```

Affects `POST /auth/password-reset`, `POST /auth/verify-email` and
`POST /organization/invites`. All three queue a real email through the outbox
as well — `{ "sent": true }` means the message was accepted into it, and until
recently that was not true of these three at all.

**`devLink` is absent in production.** Build the flow as though it were never
there — read the token from the URL the user arrives on, not from this field.

Mail is really sent in development too: a local SMTP server holds it, and the
dev inbox is at <http://localhost:8025>. So the same flow can be checked the
way a user will see it, formatting included.

## 10. Not built yet

So you can plan around them rather than discover them:

- **SMS is not delivered.** Email, Telegram and WhatsApp are. SMS still writes
  to the server log.
- **No WhatsApp delivery receipts.** Meta reports delivery and read status by
  webhook; we do not consume it, so a WhatsApp message stays `SENT`. Email over SMTP is real, retries a temporary
  failure and suppresses an address that hard-bounces.
- **Nothing enforces plan entitlements.** They are published on `/plans` and on
  the subscription, but the server will not refuse a fourth event on a
  three-event plan.
- **No tax on invoices.** `taxMinor` is always `"0"`.
- **No renewal or dunning.** A subscription's period lapses and nothing
  charges again or moves it to `PAST_DUE`.
- **One organization per account.** See §6.
- **No cover-image write path.** `Invitation.coverAssetId` is modelled; upload
  works, but nothing attaches an asset as the cover.
- **No block creation outside the arrangement call**, and no way to reorder
  custom RSVP questions once added.
- **No image resizing.**
- **PDF and XLSX exports.** CSV works; the other two formats return `400`.
- **Asynchronous bounce reports.** A rejection at send time suppresses the
  address automatically. A bounce that arrives later, as a report to the
  sending mailbox, is not read by anything.

The authoritative list is [GAPS.md](../backend/docs/GAPS.md), and
[GOING_LIVE.md](GOING_LIVE.md) is what blocks production.
