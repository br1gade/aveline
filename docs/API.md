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

## 9. Development-only behaviour

While the backend is pre-production, endpoints that would normally email a
link return it in the response instead, because no mail transport exists yet:

```json
{ "sent": true, "devLink": "http://localhost:5173/reset-password?token=..." }
```

Affects `POST /auth/password-reset`, `POST /auth/verify-email` and
`POST /organization/invites`.

**`devLink` is absent in production.** Build the flow as though it were never
there — read the token from the URL the user arrives on, not from this field.
It exists so you can complete the flow locally today.

## 10. Not built yet

So you can plan around them rather than discover them:

- **Nothing actually sends messages.** The outbox works; every channel writes
  to the server log instead of delivering. Reset and invite links come back in
  the response body in development — see §9.
- **Nothing enforces plan entitlements.** They are published on `/plans` and on
  the subscription, but the server will not refuse a fourth event on a
  three-event plan.
- **No tax on invoices.** `taxMinor` is always `"0"`.
- **No renewal or dunning.** A subscription's period lapses and nothing
  charges again or moves it to `PAST_DUE`.
- **One organization per account.** See §6.
- **No design write endpoints** beyond block arrangement. Content, themes and
  cover images have no write path.
- **No image resizing.**
- **PDF and XLSX exports.** CSV works; the other two formats return `400`.
- **No automatic suppression from bounces.** A hard bounce can be recorded, but
  nothing records one, because no real mail transport is wired yet.

The authoritative list is [GAPS.md](../backend/docs/GAPS.md), and
[GOING_LIVE.md](GOING_LIVE.md) is what blocks production.
