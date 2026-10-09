# API Guide

Everything a client needs to talk to the Aveline backend. Written for whoever
is building the web or mobile client — human or agent.

**Base URL:** `http://localhost:3000/api/v1` in development.
**Interactive schema:** `http://localhost:3000/docs` (not served in production).
**Machine-readable:** [`backend/openapi.json`](../backend/openapi.json), which
most type generators consume directly. The build fails if it is out of date
with the code, so the committed file is current.

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

**The generic URL works only for an `UNLISTED` or `PUBLIC` event.** A
`PRIVATE` event — the default, and every wedding — is reachable by personal
link only, so its generic URL is `404`, the same answer as an unpublished
one (spec §13.1; decided 9 October 2026). A personal URL whose token is no guest's
is `404` too, whatever the visibility. A host who wants one link to share
in a group chat sets the event `UNLISTED`. The editor previews through
`GET /invitations/:slug/design`, never the generic URL.

```json
{
  "slug": "anna-davit",
  "template": "classic",
  "theme": { "font": "Noto Serif Armenian", "palette": "ivory-gold" },
  "allowedFonts": ["Noto Serif Armenian", "Cormorant Garamond", "Inter"],
  "coverUrl": "https://media.../3f2c....jpg",
  "musicUrl": null,
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
    "rsvp": { "status": "ATTENDING", "respondedAt": "..." },
    "seating": null
  },
  "blocks": [ { "type": "HERO", "sortOrder": 0, "variant": "full-bleed", "content": {...},
                "media": [ { "id": "...", "url": "https://media.../3f2c....jpg",
                             "kind": "PHOTO", "altText": null } ],
                "data": null }, ... ],
  "rsvpFields": {
    "dietary": { "isEnabled": true, "options": null },
    "drinkPreference": { "isEnabled": true, "options": [{ "key": "wine", "label": "Wine" }] },
    "songRequest": { "isEnabled": false, "options": null },
    "message": { "isEnabled": true, "options": null },
    "attribution": { "isEnabled": true, "options": null }
  },
  "rsvpQuestions": [ { "id": "...", "type": "SINGLE_CHOICE", "prompt": "...", "options": [...] } ]
}
```

**`guest` is `null` on the generic URL.** Only the personalised one fills it.

**`rsvpFields` says how to build the RSVP form's built-in questions.** A
question with `isEnabled: false` is not asked — leave it off the form; sending
it is a `400`. One with `options` is a choice: show the labels, send the
`key` (for `dietary`, a list of keys). One with `options: null` is free text,
as before.

**Both take `?locale=`** to show the page in another language the event
publishes (`availableLocales`). The personalised page otherwise uses the
guest's own language; asking for one the event does not publish falls back to
it, and `locale` in the response says which you got. Switching does not change
the guest's stored language — an RSVP with `locale` does that. Build a
language switcher from `availableLocales`.

The event's `title` and `hosts`, and each venue's `name` and `address`, come
back in the page's language when the host has translated them, and in the
original otherwise.

### Rendering blocks

`blocks` is **already in display order** — render the array as given. Never
sort by `sortOrder`; it is informational. Disabled blocks are absent entirely.

Each block has `content` (copy, already resolved to one locale) and `data`
(live event data, present only where the block needs it):

| `type` | `data` contains |
|---|---|
| `VENUE`, `MAP` | Array of venues: id, role, name, address, latitude, longitude, mapUrl, arriveAt — `id` is what a timeline entry's `venueId` points at |
| `TIMELINE` | Array of `{ label, occursAt, venueId }` |
| `COUNTDOWN` | `{ target, timezone }` |
| everything else | `null` — use `content` |

**`variant`** is the layout the host chose for the block (`split`,
`full-bleed`, …) or `null` for the template's default.

**`media`** is the block's photos or audio, in the host's order, each with
`url`, `kind` (`PHOTO`, `AUDIO`, …) and `altText` already resolved to the
page's locale (`null` when the host gave none). Empty when the block has none.

**`coverUrl` and `musicUrl` are derived from the blocks**, not set
separately: the cover is the first photo on the `HERO` block, and the music is
the `MUSIC` block's audio. A disabled `MUSIC` block means `musicUrl` is
`null`. Use them for things outside the block flow — a share-preview image,
a single audio player with an on/off control — and `media` inside blocks.

Block types you may receive: `HERO`, `STORY`, `COUNTDOWN`, `MUSIC`, `VENUE`,
`MAP`, `TIMELINE`, `DRESS_CODE`, `NOTES`, `GALLERY`, `RSVP`, `SIGNATURE`,
`CHAT`, `CONTACT`.

**Render unknown block types as nothing rather than crashing.** New types ship
without a client release.

### Submit an RSVP

```http
GET  /api/v1/invitations/:slug/g/:guestToken/rsvp     # current answer, and the household
POST /api/v1/invitations/:slug/g/:guestToken/rsvp
```

**One link answers for the whole household** (decided 8 October 2026). The
invitation goes to one person per household; that person answers for
themselves at the top level and for everyone else named in the household in
`members`. Build the form from `GET`, which lists them:

```json
{
  "guest": { "id": "clz...", "firstName": "Armen", "lastName": "Petrosyan" },
  "household": {
    "name": "Petrosyan family", "seatsAllotted": 3,
    "members": [{ "id": "clz...", "firstName": "Lusine", "lastName": "Petrosyan",
                  "addedByGuest": false, "status": "PENDING",
                  "dietary": [], "dietaryNotes": null }]
  },
  "rsvp": { "status": "ATTENDING", "respondedAt": "...", "dietary": ["vegetarian"],
            "answers": [{ "questionId": "clz...", "value": 1 }], ... }
}
```

```json
{
  "status": "ATTENDING",
  "attribution": "SIDE_A",
  "members": [{ "guestId": "clz...", "status": "DECLINED", "dietary": ["vegan"] }],
  "party": [{ "firstName": "Narek", "lastName": "Petrosyan" }],
  "dietary": ["vegetarian"],
  "dietaryNotes": "severe nut allergy",
  "drinkPreference": "wine",
  "songRequest": "Sirun Yar",
  "message": "Congratulations!",
  "locale": "hy",
  "answers": [{ "questionId": "clz...", "value": 1 }]
}
```

`status`: `ATTENDING` | `DECLINED` | `UNDECIDED` — `PENDING` is a `400`, since
it means "not answered".
`attribution`: `SIDE_A` | `SIDE_B` | `SHARED` | `UNKNOWN`. It is recorded only
when the host has not set the guest's side; a side the host set stands.
`locale` must be one of the event's `availableLocales`; anything else is a
`400` starting `locale:`.

- **`members`** — answers for others already in the household: `guestId`
  (from `household.members`), `status` (`ATTENDING`, `DECLINED` or
  `UNDECIDED` — not `PENDING`), and optionally their own `dietary`,
  `dietaryNotes` and `answers` to the host's questions — so each person
  chooses their own meal. A required question binds every member marked
  `ATTENDING`, as it does the respondent. Someone left out keeps their
  answer. Naming yourself, someone outside the household, or an invalid
  member answer is a `400` starting `members:`.
- **`party`** — people to add who are not in the household yet. Matched by
  name, ignoring capitals and spacing, against everyone already in it, so a
  name already there is not added again and does not count against the
  seats twice. **Each new plus-one answers for themselves**: `status`
  (the respondent's if omitted), `dietary`, `dietaryNotes` and `answers`, as a
  member does — and a required question binds an attending plus-one, so a
  missing one is a `400` starting `party: Narek must answer`. Later, a
  plus-one follows the respondent's `status` only while their answers agree:
  switching to `DECLINED` takes them with you, but one you answered
  `DECLINED` in `members` stays declined when you edit something else.
- **`answers`** — the host's own questions (`rsvpQuestions` on the
  invitation). The value depends on the question's `type`:

  | `type` | `value` |
  |---|---|
  | `TEXT` | a string, up to 500 characters |
  | `LONG_TEXT` | a string, up to 4,000 characters |
  | `BOOLEAN` | `true` or `false` |
  | `SINGLE_CHOICE` | the **position** of the chosen option in `options`, from 0 |
  | `MULTI_CHOICE` | a list of positions, each at most once |

  **Send the position, not the text.** Options are translated, and the page
  receives them in the guest's language; position is the same in every
  language, so the host's count of who chose fish does not split across
  "Fish", "Рыба" and "Ձուկ". A question marked `required` must be answered by
  a guest who is `ATTENDING` — not by one who declines — and an answer given
  in an earlier submission counts. Any problem is a `400` whose message starts
  `answers:`. `SIGNATURE` questions cannot be answered yet.

```json
{ "status": "ATTENDING", "respondedAt": "...", "partyAdded": 1, "membersAnswered": 1,
  "seatsRemaining": 1 }
```

**Submitting again updates rather than duplicating** — safe to retry, and the
right way to implement an "edit my answer" button. **Omitted fields keep their
value**: send only what changed. `respondedAt` is when they first answered and
does not move on an edit.

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
identical submissions within a minute produce one confirmation; a changed
answer is always confirmed, so the last confirmation matches the answer that
stands.

A reminder still waiting in the outbox is withdrawn the moment the household
answers (its status becomes `CANCELLED`), and a household gets at most one
reminder a day, scheduled and manual together.

Nothing changes in the response, and **a failure to send never fails the
RSVP** — the answer is saved first. A household with no address on file, who
answered from a forwarded link, simply receives nothing. So the on-screen
success state is still the client's to show; the email is reassurance on top
of it, not a replacement for it.

### Find your seat

There is no lookup by name. A guest finds their table **on their own
personalized invitation**, in `guest.seating`, and only once the host has
published the seating (decided 9 October 2026). Until then it is `null`;
show nothing rather than "no table".

```json
"seating": {
  "table": "Table 3",
  "household": [
    { "id": "clz...", "name": "Armen Petrosyan", "table": "Table 3" },
    { "id": "clz...", "name": "Lusine Petrosyan", "table": "Table 3" }
  ]
}
```

`table` is `null` for a guest not seated yet — say so and send them to the
hosts. A guest sees their own household and never anyone else's. The shared,
un-personalized page carries no seating at all.

**Breaking, 9 October 2026:** `GET /events/:eventId/find-seat` is gone. It
listed guests' names and tables to anyone who had the event id.

---

## 5. Public events and ticketing — public

```http
GET /api/v1/public/events?limit=20&offset=0&category=conference&locale=en
GET /api/v1/public/events/:slug
```

Browse lists an event until it ends (an event with no end time, until it
starts); the detail page keeps loading by link afterwards. **Ticket sales
stop when the event starts** — checkout is then a `400` saying so — and an
archived event's listing cannot be published again (decided 10 October 2026).

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

### Setting up ticket sales

Until recently none of this could be done through the API, so if you built
against seeded data, this is new.

**1. Make the event public.** A private event is reachable only by invitation
link and is never listed.

```http
PATCH /api/v1/events/:eventId/settings   { "visibility": "PUBLIC" }
```

`UNLISTED` also allows a listing and sales, but keeps the event out of public
browse. **Setting it back to `PRIVATE` takes the listing down in the same
act.**

**2. Put tickets on sale.**

```http
POST   /api/v1/events/:eventId/ticket-types
       { "name": { "hy": "Ընդհանուր", "en": "General" }, "priceMinor": "15000",
         "quantityTotal": 200, "minPerOrder": 1, "maxPerOrder": 10,
         "salesStartAt": "...", "salesEndAt": "..." }
GET    /api/v1/events/:eventId/ticket-types
PATCH  /api/v1/events/:eventId/ticket-types/:typeId
DELETE /api/v1/events/:eventId/ticket-types/:typeId
```

`priceMinor` is a string, and `"0"` is a free ticket. The list returns `sold`,
`held` (seats in someone's checkout right now) and `available`.

**The price can change at any time, and only affects future buyers** — every
order captures its unit price when it is placed, so early-bird pricing on one
ticket type works. Two buyers of the same type can therefore have paid
different amounts; if that matters for an event, use two ticket types.

Capacity cannot go below what is sold or held; the error names the number.
`DELETE` works only on a type nothing has been sold or held against — after
that, `PATCH { "isActive": false }` stops selling it.

**3. Write the announcement and publish it.**

```http
PUT  /api/v1/events/:eventId/listing
     { "headline": { "en": "Autumn Jazz Night" }, "summary": {...}, "body": {...},
       "categories": ["concert"], "ogTitle": {...}, "ogDescription": {...},
       "isIndexable": false, "slug": "autumn-jazz-night" }
POST /api/v1/events/:eventId/listing/publish
POST /api/v1/events/:eventId/listing/unpublish
```

`PUT` creates or edits; omitted fields are left alone. `slug` is optional and
generated from the title when omitted — an Armenian title becomes
`event-<random>`, because it contains nothing URL-safe. A taken slug is `409`.

Publishing is refused for a private event, without a headline in any
language, or once the event has started. Unpublishing does not affect tickets
already sold.

All of this needs `event:write` (reading, `event:read`).

### Cancelling an order

```http
GET  /api/v1/events/:eventId/ticket-orders?status=PAID
POST /api/v1/events/:eventId/ticket-orders/:orderId/cancel
```

The list needs `operations:read`; **`buyerEmail` is absent unless you also hold
`guest:contact:read`** — door staff and viewers see orders, not addresses.

**Cancelling is how a ticket order is refunded.** It voids every ticket on the
order, puts the seats back on sale, returns any promo-code use, refunds the
payment, and emails the buyer — as one action, exactly once. Free orders end
`CANCELLED`, paid ones `REFUNDED`.

```json
{ "orderId": "clz...", "status": "REFUNDED", "refundedMinor": "30000", "currency": "AMD",
  "tickets": [{ "code": "...", "status": "VOID" }] }
```

- **Whole orders only.** A buyer who can bring three of four is refunded the
  order and buys again.
- **Refused if any ticket was already admitted** (`409`): refunding after
  attendance is a dispute with the buyer, not a cancellation.
- **Safe to retry and safe to double-click.** A second call returns the
  cancelled order rather than an error, and never refunds twice.
- **Requires `billing:write`** — money leaves the business, so in practice the
  organization owner.

`POST /payments/:orderNumber/refund` now **refuses ticket payments** and
points here, because refunding the money alone left a buyer refunded and still
able to get in. It remains for other payments, is staff-only, and takes a
validated `{ "amountMinor": "15000", "reason": "..." }`.

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

**A buyer who paid is never left without tickets or money.** Before a hold is
released the bank is asked; a captured payment is settled instead. If the
payment arrives after the hold was released — the buyer took their time at
the bank — confirm on an `EXPIRED` order still works: the tickets are issued
if the seats are still there, and if they were sold meanwhile the payment is
refunded in full and the buyer emailed. The order then reads `PAID` or
`REFUNDED`. A buyer who never comes back is settled by the same rule within
minutes, and receives their tickets by email. Decided 9 October 2026.

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

`playlist` is `{ "uniqueTracks": 12, "tracks": [{ "track": "Sirun Yar",
"requests": 3 }] }`, most requested first. Only guests who are coming count,
and requests that differ only in capitals or spacing are one track, shown in
the spelling most guests used.

`headcount` is the screen a host watches as answers come in:

```json
{
  "invited": 412, "households": 160, "attending": 230, "declined": 41,
  "undecided": 12, "pending": 129, "responseRate": 69,
  "bySide": [{ "side": "SIDE_A", "invited": 210, "attending": 120, "declined": 20,
               "undecided": 5, "pending": 65 }],
  "byHousehold": [{ "id": "clz...", "name": "Petrosyan family", "seatsAllotted": 3,
                    "attending": 2, "declined": 1, "undecided": 0, "pending": 0 }],
  "trend": [{ "date": "2027-05-01", "responses": 18, "cumulative": 18, "responseRate": 4 }]
}
```

`byHousehold` is in name order — "have the Petrosyans answered?". `trend` has
one entry per day that brought answers, in the **event's** time zone, with the
running total and response rate: plot it to see whether answers are still
arriving or a reminder is due. A day with no answers is absent, not zero.

Bar-sheet `preferences` and catering-sheet `requirements` each carry `key` —
what guests sent — beside the label (`drink`, `requirement`) in the event's
language. For free text the two are the same.

### Answers to the host's own questions

```http
GET /api/v1/events/:eventId/answers?locale=en
```

Needs `operations:read`. One entry per question on the invitation, in order:

```json
{
  "locale": "en",
  "questions": [{
    "id": "clz...", "type": "SINGLE_CHOICE", "required": true,
    "prompt": "Meat or fish?", "options": ["Meat", "Fish"], "answered": 96,
    "tally": [{ "option": "Meat", "attending": 51, "total": 53 },
              { "option": "Fish", "attending": 40, "total": 43 }],
    "responses": [{ "guestId": "clz...", "name": "Lusine Petrosyan",
                    "household": "Petrosyan family", "status": "ATTENDING",
                    "value": 0, "display": "Meat" }]
  }]
}
```

- `tally` counts each option twice: among guests coming (`attending`, what a
  caterer orders) and among everyone who answered (`total`). `BOOLEAN`
  questions tally as `Yes` / `No`. Free-text questions have `tally: null`;
  read their `responses`.
- `display` is the answer in words; `value` is what was stored (a position,
  for choices).
- Prompt and options are in `?locale=` when the event publishes it, else the
  event's default; `locale` says which you got.

The same answers appear in the guest-list export, one column per question.

```http
GET /api/v1/events
```

Every event the caller can reach: their organization's, if their role there
can read events, plus any event they were brought onto directly through a
team invitation. An account with neither gets `[]`. **Do not pass an
organizationId** — it is ignored. Platform staff see everything.

### Setting an event up for a customer (Aveline staff)

```http
POST /api/v1/concierge/organizations                       { "name": "Petrosyan Wedding", "ownerEmail": "anna@example.am" }
POST /api/v1/concierge/organizations/:organizationId/events  { ...as POST /events }
GET  /api/v1/concierge/organizations?search=petrosyan
```

For an Aveline staff console, not the host app: they need `concierge:manage`,
which only platform staff hold. The first opens the customer's organization
— staff do not become a member — and emails the customer an owner
invitation (`{ organization, invite }`, with `devLink` outside production).
The second creates an event in it, with its draft invitation; staff then
design and run it through the usual routes using their platform role. When
the customer accepts at `/accept-invite`, choosing their own password, they
own the organization and its events. The search lists organizations with
their `owners`, `pendingOwnerInvites` and number of `events`.

### Archiving and deleting an event

```http
POST   /api/v1/events/:id/archive
POST   /api/v1/events/:id/unarchive
DELETE /api/v1/events/:id
GET    /api/v1/events?archived=true
```

All need `event:delete`, which owners hold. Decided 9 October 2026:

- **Archive is always allowed, and reversible.** The event leaves
  `GET /events` (list archived ones with `?archived=true`), its invitation
  stops taking answers but stays readable for the people who were coming, and
  its public listing comes down. The invitation cannot be reopened or
  published while archived (`400`). `unarchive` restores the event's status;
  the invitation stays closed until the host reopens it.
- **Delete is for an event that was never published and no money moved
  through.** It removes everything, uploaded files included. A published
  event — guests may hold its invitation — or one with payments or ticket
  orders is refused with `409` saying to archive it instead.

### The event's team

```http
GET    /api/v1/events/:eventId/team
POST   /api/v1/events/:eventId/team/invites           { "email": "door@example.am", "role": "COORDINATOR" }
DELETE /api/v1/events/:eventId/team/invites/:email
PATCH  /api/v1/events/:eventId/team/:userId           { "role": "VIEWER" }
DELETE /api/v1/events/:eventId/team/:userId
POST   /api/v1/event-invites/accept                   { "token": "...", "name": "...", "password": "..." }
```

All but the last need `member:manage`, which an event `OWNER` holds for their
event. Roles are `OWNER`, `COORDINATOR`, `DESIGNER` and `VIEWER` — see
[ACCESS_CONTROL.md](ACCESS_CONTROL.md) for what each may do.

`GET` returns `{ members: [{ userId, name, email, role, since }], invites:
[{ email, role, expiresAt }] }` — the invitations still open.

**Inviting emails a link** to `/accept-event-invite?token=…` on the client.
Build that page to post the token, a name and a password to
`/event-invites/accept`. Accepting grants the event role and **nothing in the
organization**: the person sees this event and no other. An address that
already has an account must give that account's own password — `409`
otherwise, saying to sign in or reset it first — the same rule as
organization invitations. Inviting someone already on the team is a `400`;
re-inviting an address replaces its earlier link.

**Changes apply on the person's next request** — a removed coordinator is
locked out at once. **An event always keeps an owner**: demoting or removing
the last one is a `400` saying to make someone else an owner first.

### Loading the invitation into the editor

```http
GET /api/v1/invitations/:slug/design
```

Needs `invitation:read` — a `DESIGNER` has it. **Load the editor from this,
never from the public page.** The public page is for guests: it 404s on a
draft, resolves every text to one language, and leaves out switched-off
blocks and settings. Built on it, an editor would lose the host's other
languages the first time it saved.

```json
{
  "slug": "anna-davit-3f8a1c20", "status": "DRAFT",
  "event": { "id": "clz...", "title": "Anna & Davit", "locales": ["hy", "en"],
             "defaultLocale": "hy", "startsAt": "...", "timezone": "Asia/Yerevan" },
  "template": { "key": "classic", "name": "Classic", "allowedFonts": [...],
                "palettes": [...], "supportedBlocks": ["HERO", "RSVP", ...] },
  "theme": { "palette": "sage" },
  "effectiveTheme": { "bodyFont": "Noto Serif Armenian", "palette": "sage" },
  "coverUrl": "https://media.../3f2c.jpg", "musicUrl": null,
  "blocks": [{ "type": "HERO", "sortOrder": 0, "enabled": true, "variant": "split",
               "content": { "hy": { "title": "..." }, "en": { "title": "..." } },
               "settings": {}, "assetIds": ["..."], "media": [{ "id": "...", "url": "...",
               "kind": "PHOTO", "altText": {} }] }],
  "questions": [{ "id": "...", "type": "SINGLE_CHOICE", "required": true,
                  "prompt": { "hy": "...", "en": "..." }, "options": { "hy": [...], "en": [...] },
                  "answerCount": 12 }],
  "publishBlockers": ["Add a venue with an address, so guests know where to go"]
}
```

- `blocks` is in page order and **includes switched-off blocks** (`enabled:
  false`), so the editor can offer to turn them back on.
- `content`, `prompt` and `options` carry **every language**. Edit one
  language at a time with `PATCH /blocks/:type` (see "Designing the invitation").
- `theme` is what the host chose; `effectiveTheme` is what renders, with the
  template's defaults underneath.
- `publishBlockers` is what still stands between the host and publishing —
  show it while they work, not only when they press publish. Empty means
  ready.
- `answerCount` tells the editor a question has answers; deleting it is
  refused once it does.

### One intent, one request

```http
PATCH /api/v1/invitations/:slug/arrangement
{ "blocks": [ { "type": "RSVP", "variant": "split" }, { "type": "HERO", "enabled": false } ] }
```

**Array order is display order.** Never compute indices. Omitted fields keep
their current value. Blocks you leave out follow the ones you send, in the
order they already had, and the response lists every block — so sending just
`[RSVP]` moves RSVP to the top. A rejected arrangement changes nothing and names the bad
block, so you can show the error without refetching.

### Importing a guest list

```http
POST /api/v1/events/:eventId/guests/import
Content-Type: multipart/form-data
```

One field, `file`: a CSV, up to 2 MB and 2000 guests. Requires `guest:write`.
A larger file is refused with `413` as it arrives; more rows than 2000 is a
`400` — neither creates an import record.

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

`side` accepts `a`, `side a`, `b`, `side b`, `both` or `shared`, in any
case; anything else is recorded as unknown. `seats` must be a whole number
from 1 to 20. A row with no first name is rejected; everything else is
optional.

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

**Named guests never outnumber a household's seats**, the same rule as adding
a guest by hand. If the file gives `seats` for a household, a row past that
number is reported against its row and not saved. If it does not, the
household is given a seat for everyone the file names — including, on a
re-import, the ones already there.

**Re-importing is safe.** A household that already exists by name is reused and
its guests are matched on name, so correcting a spreadsheet and uploading again
updates rather than duplicating. It never deletes: a guest removed from the CSV
stays on the event. A blank cell — or a column the file does not have —
leaves what is stored, so a re-import without a `side` column keeps the sides
already set.

```http
GET /api/v1/events/:eventId/guests/imports
```

The last imports, newest first, each with `filename`, `rowsImported`,
`rowsFailed`, `status` and `errors` — enough to show "412 of 415 imported" days
later. Requires `guest:read`. A mistyped email is quoted back only in the
import's own response; the stored history keeps the row and the reason, not
the address.

### Reading the guest list

```http
GET /api/v1/events/:eventId/guests              # every household and guest
GET /api/v1/events/:eventId/guests/:guestId     # one guest, for an edit form
```

Needs `guest:read`. The list is grouped by household, households by name,
the primary first within each:

```json
[{
  "id": "clz...", "name": "Petrosyan family", "seatsAllotted": 3, "seatsNamed": 2, "notes": null,
  "guests": [{
    "id": "clz...", "firstName": "Armen", "lastName": "Petrosyan", "name": "Armen Petrosyan",
    "email": "armen@example.am", "phone": "+374 91 000000", "token": "k7m2...",
    "locale": "hy", "attribution": "SIDE_A", "isPrimary": true, "addedByGuest": false,
    "isAnonymized": false, "rsvpStatus": "ATTENDING",
    "rsvp": { "status": "ATTENDING", "respondedAt": "...", "dietary": ["vegan"],
              "dietaryNotes": null, "drinkPreference": "wine", "songRequest": null, "message": null },
    "table": "Table 4", "seatReleased": null, "isCheckedIn": false, "arrivedAt": null
  }]
}]
```

`seatReleased` is `{ "table": "Table 4", "releasedAt": "..." }` for a guest
whose decline freed their seat — see *A decline frees the seat* below — and
`null` otherwise.

**`email`, `phone` and `token` are present only for callers holding
`guest:contact:read`** — owners and coordinators, not viewers or designers.
Absent means "not yours to see", not "empty"; build the screen so it works
without them. `token` is the guest's personal link segment and lets whoever
holds it answer as the guest, which is why it travels with the contact
details.

The single-guest read returns the same fields plus `householdId` and
`answers` — `[{ "questionId", "value" }]` for the host's own questions, in the
format described under "Submit an RSVP". Use it to fill the edit form for
`PATCH /guests/:guestId`. A guest on another event is a `404`.

### Recording an answer for a guest

```http
PATCH /api/v1/events/:eventId/guests/:guestId/rsvp
{ "status": "ATTENDING", "dietary": ["vegetarian"], "answers": [{ "questionId": "clz...", "value": 1 }] }
```

Needs `guest:write`. For answers that arrive by phone or in person. Takes
`status` (`ATTENDING`, `DECLINED` or `UNDECIDED`), and optionally `dietary`,
`dietaryNotes`, `drinkPreference`, `songRequest`, `message`, `answers` and
`notifyGuest`. The same rules as the guest's own form — omitted fields keep
their value, answers are checked against their questions (`400` starting
`answers:`) — with two differences:

- **Required questions are not enforced.** The host may not know the meal yet.
- **The guest is not messaged** unless `notifyGuest` is `true`; they gave the
  answer themselves, so a confirmation would be a surprise.

Returns the guest's answer as stored. A guest whose data was erased is a
`400`; one on another event is a `404`. Who recorded it is in the audit
trail.

### Editing the guest list

```http
POST   /api/v1/events/:eventId/guests
PATCH  /api/v1/events/:eventId/guests/:guestId
DELETE /api/v1/events/:eventId/guests/:guestId
PATCH  /api/v1/events/:eventId/households/:householdId
```

All four require `guest:write`. Import is how a list arrives; these are how a
host keeps it right afterwards — the forgotten cousin, the address that
bounced, the plus-one who is no longer coming.

**Adding** takes `firstName` (required), and optionally `lastName`, `email`,
`phone`, `locale`, `attribution` (`SIDE_A` / `SIDE_B` / `SHARED` / `UNKNOWN`).
With `householdId` the guest joins that household, which must have a free
seat. Without it they get a new household of their own, named after them,
with `seatsAllotted` seats (1–20, default 1). Either way it returns the guest:

```json
{
  "id": "clz...", "householdId": "clz...",
  "firstName": "Ani", "lastName": "Hakobyan",
  "email": "ani@example.am", "phone": null, "locale": null,
  "attribution": "SIDE_A", "isPrimary": true, "token": "k7m2..."
}
```

`token` is the guest's capability link segment — treat it as a credential
(see [§3](#3-capability-links--the-pattern-to-understand)). `isPrimary` is the household member whose
link the invitation is sent to; the first person in a household is primary.

**Editing** takes the same fields, all optional. **Omitted means unchanged; an
empty string clears `email` or `phone`.** Addresses are validated the same way
as on import, and an email is stored lower-cased — show what comes back, not
what was typed. A guest whose data was erased at their request cannot be
edited (`400`).

Sending `householdId` **moves** the guest. The destination needs a free seat.
If the guest was the primary of the household they left, the next person in
it becomes primary; if nobody is left, that household is removed — an empty
household is an invitation addressed to no one. Refetch `GET /guests` after a
move rather than patching your local copy: two households changed.

**Removing** deletes the guest with their answer and seat, so the headcount,
catering sheet and seating plan stop counting them. The same primary hand-off
and empty-household removal apply:

```json
{ "removed": "clz...", "isHouseholdRemoved": false }
```

**A guest who has been checked in cannot be removed** (`400`). The check-in is
the record that they came. Undo the check-in first if it was a mistake. (A
product decision, 8 October 2026.)

**A household's seats** can be changed, and it can be renamed, but
`seatsAllotted` cannot go below the number of guests already named in it:

```json
{ "id": "clz...", "name": "Petrosyan family", "seatsAllotted": 4, "seatsNamed": 3 }
```

Every refusal is a `400` whose `message` starts with the field it is about —
`householdId: ...` for a full household, `email: ...` for a bad address,
`seatsAllotted: ...` for seats below the named count — so you can put the
error next to the right input. A guest or household id that is not on this
event is a `404`.

**Capacity holds under concurrency.** A host adding someone to a household at
the same moment its guest submits a plus-one cannot together overfill it: one
of the two is refused. Show the refusal; do not retry it.

### Tables and seating

```http
GET    /api/v1/events/:eventId/tables
POST   /api/v1/events/:eventId/tables
POST   /api/v1/events/:eventId/tables/bulk
PATCH  /api/v1/events/:eventId/tables/:tableId
DELETE /api/v1/events/:eventId/tables/:tableId
```

`GET` returns each table with its occupancy, who is at it and where it sits
on the plan, which is the whole seating screen in one request:

```json
[
  {
    "id": "clz...", "name": "Table 1", "capacity": 10, "zone": "Main hall",
    "venueId": "clz...", "posX": 120.5, "posY": 40, "shape": "round",
    "seated": 7, "available": 3,
    "guests": [{ "guestId": "clz...", "name": "Armen Petrosyan", "position": null }],
    "released": [{ "guestId": "clz...", "name": "Ani Sargsyan", "releasedAt": "..." }]
  }
]
```

**A decline frees the seat.** When a guest declines — on their own link or
recorded by the host — their seat is given back, so `seated` and `available`
are true. The table lists them in `released` so the plan can show the gap and
why. The flag clears when they are seated again, or when the host dismisses it
with `DELETE /seats/:guestId`. Answering `ATTENDING` or `UNDECIDED` keeps the
seat. Decided 9 October 2026.

`POST /tables` takes `{ name, capacity, zone?, venueId? }`. For a real room,
use `/tables/bulk` with `{ namePrefix, count, capacity, zone?, venueId? }` —
twenty tables of ten is one request, and numbering continues from the highest
number already used with that prefix (`Table 1` … `Table 20`, then `Table 21`
even if `Table 3` was deleted). It returns `{ "created": 20 }`.

`PATCH /tables/:tableId` changes any of `name`, `capacity`, `zone`,
`venueId`, `posX`, `posY` and `shape` (`round`, `rectangle`, `square`,
`oval`); omitted fields are unchanged and `null` clears `zone`, `venueId` and
the position. Use it to save a table's place when it is dragged on the plan.
`capacity` cannot go below the guests already seated, a name another table
has is refused, and `venueId` must be one of this event's venues — each a
`400` whose message starts with the field. The position is in the editor's
own units; the server stores it and does not interpret it.

Deleting a table with guests at it returns `409` naming how many, because the
cascade would silently unseat them. Unseat them first.

```http
POST   /api/v1/events/:eventId/seats          { guestId, tableId, position? }
DELETE /api/v1/events/:eventId/seats/:guestId
```

`POST` seats a guest, or moves one who was already seated — there is no
separate move call. `DELETE` unseats a guest, or dismisses the `released` flag
of one whose decline already freed their seat. A full table returns `409` with its name. Capacity is
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
   Someone accepting late joins the table their household already sits at —
   or, if it is full, is listed in `unseated` with that reason, never put
   elsewhere.
   There is no "re-seat everything" call; unseat first if that is the intent.
2. **It never splits a household and never exceeds a capacity** — not even
   when a planner is seating someone by hand at the same moment, or the button
   is pressed twice. Those are hard constraints. Keeping each side of the family together is a preference it
   satisfies when it can.
3. **It is a good plan, not the optimal one.** It will not find a packing that
   requires rearranging already-seated guests. `unseated` is normal when the
   room is nearly full — present it as "these 2 households need a table",
   not as a failure.

```http
POST /api/v1/events/:eventId/seating/publish     → { "seatingPublishedAt": "2027-06-10T..." }
POST /api/v1/events/:eventId/seating/unpublish   → { "seatingPublishedAt": null }
```

Publishing lets each guest see their household's tables on their personal
link (see *Find your seat*). Guests read the live plan, so moving someone
after publishing needs no second step; unpublish while the plan is being
reworked. `GET /events/:eventId` carries `seatingPublishedAt` for the toggle.

Tables, seats and publishing require `seating:write`; reading requires
`seating:read`.

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
  "expected": 96, "arrived": 73, "stillToCome": 25, "unexpected": 2,
  "recent": [{ "name": "Armen Petrosyan", "arrivedAt": "2026-10-05T18:02:11.000Z" }]
}
```

`expected` counts guests who accepted, so `arrived` can exceed it and
`stillToCome` is the expected guests — those who said they are coming — who
have not arrived yet. Anyone else who arrives, a walk-in or someone who
declined and came anyway, counts in `arrived` and in `unexpected`, never
against `stillToCome`. `recent` is the last 20. Poll this; there is no
push yet.

Check-in requires `guest:write`, so door staff need a real account rather than
a link.

### Becoming a tenant — do this once, first

```http
POST /api/v1/organizations      { "name": "Petrosyan Wedding", "kind": "HOST" }
```

**A freshly registered account belongs to no organization, and every
organization-scoped route answers `403` until it does** (`GET /events` answers
`[]`). Registering is not enough. Make this call immediately after
`POST /auth/register` unless the account arrived through
`POST /invites/accept`, which already placed it in one — or through
`POST /event-invites/accept`, which places it on one event and needs no
organization.

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

Changing plan is the same call with a different `planKey`. **Nothing changes
until the new invoice is paid**: the current plan and status stay as they are,
and paying applies the invoice's plan with a period starting then. A paid
change abandoned at the bank leaves the customer exactly where they were. A
newer change replaces the open invoice, which becomes `VOID`; if that old
invoice is paid anyway, the payment is refunded. A customer who pays and never
returns is settled within minutes.

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

The vendors an organization chooses from: **its own**, which only it sees,
and **Aveline's curated list**, which everyone sees — each entry carries
`isCurated`. A vendor a host adds belongs to their organization (decided 9
October 2026; the list used to be shared by every customer, contact details
included). Aveline staff add to the curated list. Booking another
organization's vendor is a `404`. `category` is one of `VENUE`, `CATERING`,
`BAR`, `DECOR`, `PHOTOGRAPHY`, `VIDEOGRAPHY`, `MUSIC`, `PRINT`, `OTHER`.

```http
GET   /api/v1/events/:eventId/vendors
POST  /api/v1/events/:eventId/vendors   { "vendorId": "...", "briefScopes": ["headcount"], "feeMinor": "150000" }
PATCH /api/v1/events/:eventId/vendors/:bookingId
DELETE /api/v1/events/:eventId/vendors/:bookingId
```

`briefScopes` is exactly what that vendor may read, from this list:

| Scope | What it shows |
|---|---|
| `headcount` | Confirmed headcount by side — the numbers only; household names come with `households` |
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

`feeMinor` is money like every other amount here: integer minor units as a
string — `"150000"` is 150,000 dram — in `feeCurrency`. **Breaking, 9 October
2026:** it was `feeAmount`, a two-place decimal string.

Booking a vendor whose engagement was cancelled engages them again: the
booking goes back to `ENQUIRED` with a new, working `briefToken`.

**`feeMinor` is absent from the response unless you hold `vendor:fee:read`.**
It is not `null` — the field is not there at all. A `VIEWER` sees the vendor
and not the commercial terms. **`briefToken` is likewise absent from
`GET /events/:eventId/vendors` unless you hold `vendor:write`**: the link is a
credential, and one with the `contacts` scope reads guests' phone numbers.

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
POST /api/v1/events/:eventId/exports                      { "kind": "GUEST_LIST", "format": "CSV" }
GET  /api/v1/events/:eventId/exports
GET  /api/v1/events/:eventId/exports/:exportId
GET  /api/v1/events/:eventId/exports/:exportId/download  → text/csv
```

`kind` is one of `GUEST_LIST`, `SEATING_CHART`, `PLACE_CARDS`,
`CATERING_SHEET`, `BAR_SHEET`, `PLAYLIST`, `TICKET_MANIFEST`.

```json
{
  "id": "clz...", "kind": "GUEST_LIST", "format": "CSV", "status": "COMPLETED",
  "failureReason": null, "createdAt": "2026-10-05T...", "completedAt": "2026-10-05T...",
  "downloadPath": "/api/v1/events/clz.../exports/clz.../download"
}
```

**There is no public file.** `POST` records the export — the list is the
history of who exported what, and when — and `downloadPath` is where the
signed-in client fetches it, **with the same `Authorization` header as any
other call**. An `<a href>` will not work; fetch it, then hand the browser the
blob (`URL.createObjectURL`) with the filename from `Content-Disposition`. The
response is `Cache-Control: no-store`.

The file is built at download time from the event as it is then, so
downloading the same export tomorrow gives tomorrow's guest list. Who may see
what is checked on every download, not when the export was asked for:

- `Email` and `Phone` columns appear only for a caller holding
  `guest:contact:read`. A `VIEWER` gets the guest list without them.
- `TICKET_MANIFEST` carries door codes and buyers' emails, so it needs
  `guest:contact:read` both to ask for and to download — `403` otherwise.

**Breaking, 9 October 2026:** the `asset: { url, sizeBytes }` field is gone.
Its URL was public and never expired.

Read `status` anyway — PDF will be queued when it exists, and a client that
already branches on it will not need changing. `FAILED` carries
`failureReason`.

`format` defaults to `CSV`. `PDF` and `XLSX` return `400` today; the message
says so rather than queueing something that never runs.

The files are UTF-8 with a BOM and CRLF endings, so Excel opens Armenian text
correctly, and every cell is quoted — including a defensive tab in front of
anything starting with `=`, `+`, `-` or `@`, so a guest's free text cannot
become a formula in whoever's spreadsheet opens it.

The guest list carries a `Dietary notes` column and one column per host
question, headed `Q1: <prompt>` in the event's language, with each answer in
words. The catering sheet lists every dietary note under its counts, with
the guest it belongs to.

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

The list is your own suppressions, plus the platform-wide ones that touch
an email or phone on your own guests — never another customer's.

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

**A suppressed address loses to the guest's others.** A guest who blocked the
Telegram bot is reached by email; only a guest with nothing else is reported
as `SUPPRESSED`. A `GLOBAL` suppression comes only from the recipient — a
bounce, a complaint, blocking the bot. A rejection caused by our own message
(a WhatsApp template problem, a Telegram message too long) is retried and
reported as `FAILED`, never held against the guest. A guest who starts or
unblocks the bot again lifts their own Telegram suppression.

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

Aveline staff only: they need `privacy:manage`, which only a platform `ADMIN`
holds. **No customer account can call these**, an organization owner included
— a request is matched across every customer, so acting on one reaches other
tenants' data. Do not build a host-facing screen for them. The list is a
deadline queue, soonest `dueAt` first.

Status moves forward only: `RECEIVED` → `VERIFYING` → `IN_PROGRESS` →
`COMPLETED`, or `REJECTED` from any open state. An `EXPORT` or `ERASURE` is
completed only by `fulfil`; `PATCH` to `COMPLETED` is refused for them, so an
erasure cannot be reported that never happened.

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
  "householdsRenamed": 1, "ticketOrdersAnonymised": 1, "messagesRedacted": 4,
  "suppressionsRemoved": 1, "accountsClosed": 1 }
```

Addresses are matched regardless of capitals. What goes: names, emails, phone
numbers, the guest's own free text (guest-book message, dietary note, song
request, drink preference), their dietary tags and every answer to the host's
questions — special-category data that could point at them (decided 9
October 2026) — their
Telegram and push connections, every message sent to them on any channel —
body and address — with anything still queued stopped, and the invitation
token, which is itself identifying and would otherwise still open their RSVP
from a group chat. An account with that address is closed: it can no longer
sign in, its sessions are revoked, and its name and email are replaced.

A household whose every member has been erased is renamed `Removed` and its
notes cleared; one with someone still in it keeps its name.

What stays, on purpose: the household, the seat, whether they came, and a
paid order's amount. The headcount does not change; the catering sheet's
requirement counts drop by the erased guest's. A wedding that had 96 covers still had 96
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

**`403` means the account has no organization, or its role there cannot
write events** — an organization `MEMBER` or `VIEWER` is read-only.

**An account belongs to one organization, for now.** A second
`POST /organizations` is a `409`, and so is accepting an invitation into a
second organization — the message names the one the account is already in.

**Email addresses are compared without regard to capitals**: `Ani@X.am` and
`ani@x.am` are the same account, and signing in works with either. `defaultLocale` must be one of `locales` — a `400` naming it otherwise.

### Correcting an event

```http
PATCH /api/v1/events/:id
{ "startsAt": "2027-07-03T15:00:00.000Z", "locales": ["hy", "en", "ru"] }
```

Needs `event:write`. Takes `type`, `title`, `hostsLabel`, `startsAt`,
`endsAt`, `timezone`, `locales`, `defaultLocale`, `sideALabel`, `sideBLabel`
and `translations` — per-language versions of the title and hosts,
`{ "en": { "title": "...", "hostsLabel": "..." } }`, edited one language at a
time (`null` removes one; a problem is a `400` starting `translations:`). The
plain `title` and `hostsLabel` are what shows in a language with no
translation. **Omitted means unchanged**; `null` clears `endsAt` and the side
labels, and is refused for the rest. The edit is validated as a whole before
anything is written — the end after the start, a real IANA time zone, each
language once, the default among them — and any problem is a `400` whose
message starts with the field. Guests see the change at once.

The response is the event, as from `GET /events/:id`, plus a `notice`:

```json
{ "notice": { "isSuggested": true, "changed": ["startsAt"], "householdsInvited": 128 } }
```

**Guests who already hold the invitation are not told automatically**
(decided 8 October 2026). When `isSuggested` is true — the date, end or time
zone changed, and the invitation reached someone — offer the host a "let your
guests know" action, which calls `POST /invitations/:slug/notify-changes`.
A change of wording alone never suggests it. Venue writes return the same
`notice`, with `changed: ["venues"]`.

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

**`isInternal: true` marks an entry for the people running the day** —
"caterer arrives 10:00", "speeches cue". It is left off the invitation's
`TIMELINE` block and stays in the vendor brief and the host's own list, where
every entry carries `isInternal`. Default `false`.

`PATCH` takes any of the same fields; omitted ones are unchanged, and
`venueId: null` detaches the entry from its venue.

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
  "blockVariants": { "HERO": ["full-bleed", "split", "stacked"], "RSVP": ["split", "stacked"] },
  "defaultTheme": { "bodyFont": "Mardoto", "palette": "blush" }
}]
```

**Build the design UI from these lists.** `allowedFonts` and `palettes`
are enforced on write, so a font picker offering anything else produces a
`400`. `supportedBlocks` is what the arrangement call will accept.
`blockVariants` is the layouts each block may take: a block's `variant` must
be one of them or `null` (the template's default), and a block type with no
entry takes none — a `400` naming the block and layout otherwise. Switching
template resets any layout the new one does not offer to `null`. Keyed by
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

`variant` must be one of the template's `blockVariants` for that block, and
`enabled: true` is refused for a block the template cannot render — each a
`400` starting with the field.

**This call edits what is inside a block. It does not create one.** Which
blocks exist, and in what order, is `PATCH /invitations/:slug/arrangement` —
one place decides that. Patching a block the invitation does not have returns
`404` saying so.

`content` is keyed by locale, and **each language is edited on its own**: a
language you send replaces that language's copy, a language you leave out is
kept, and a language sent as `null` is removed. So
`{ "content": { "en": { "title": "Welcome" } } }` changes the English and
leaves the Armenian alone. `settings` is not translated and is replaced
whole. `assetIds` are uploads from
`POST /events/:eventId/media`, in display order; sending `[]` clears them. They
must belong to this event, and be a kind the block can show — **audio on the
`MUSIC` block, images on every other block**. Either mistake is a `400` whose
message starts with `assetIds:`. To set the invitation's cover, attach a photo
to `HERO`; to set its music, attach audio to `MUSIC` (add the block through the
arrangement call first). `VENUE`, `TIMELINE` and `COUNTDOWN` blocks ignore
content you put here for the fields they bind from the event — see
§Rendering blocks.

### Publishing the invitation

```http
POST /api/v1/invitations/:slug/publish
POST /api/v1/invitations/:slug/close
POST /api/v1/invitations/:slug/reopen
```

A new invitation is a **draft**: guests get a `404` and `send` refuses it.
Publishing makes it live. Requires `invitation:publish`.

**Publishing is refused until three things are true**, and every one that is
missing is named at once so a form can mark them all in one round trip:

```json
{ "message": [
  "Turn on the RSVP block, or guests will have no way to answer",
  "Add a venue with an address, so guests know where to go",
  "This event has already started; an invitation now would arrive late"
] }
```

**Closing stops new responses but keeps the page readable** — the venue, the
time and the dress code still matter to everyone who is coming. `reopen`
undoes it. There is **no way back to draft**: once links have gone out,
un-publishing would turn every one of them into a `404` in a guest's chat
history.

The public payload carries `isAcceptingResponses`. **Read it to decide whether
to show the RSVP form** — it is `false` for a closed invitation, which is
still served. The RSVP endpoint enforces the same rule independently, so an
answer can never be accepted after closing even if a cached page briefly says
otherwise.

Publishing the invitation also marks the event itself published.

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

**Safe to press twice.** A household whose invitation reached any of its
members, or is on its way, is counted in `alreadySent` and not sent another —
even if a different member would be chosen now, say because the primary has
since been given an email. Build the button so it
can be clicked again without a confirmation dialog — a host who sees nothing
happen for a second will click anyway.

**Pressing it again also retries what failed.** A household whose every earlier
attempt failed, bounced or was suppressed is tried again. That is how a
bounce is fixed: correct the address with `PATCH /events/:eventId/guests/:guestId`,
then send — the new address is queued. Until the address is corrected, a
bounced one stays suppressed and comes back in `suppressed`, not `recipients`.
A guest who was reached on one channel and has since linked another (say,
Telegram) is *not* invited again.

**Three outcome lists, because each needs a different action from the host:**

| List | What it means | What the host does |
|---|---|---|
| `recipients` | Queued for delivery | Nothing |
| `suppressed` | They opted out, or a previous send hard-bounced | A bounce: correct the address. An opt-out: talk to the guest |
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
is a phone number, then email, then SMS — for a guest with a phone and nothing
else. A channel the guest opted into outranks one that costs per message, and
SMS is only chosen once a provider is configured. `channel` may be `SMS`, and
its `toAddress` is the phone number as the host typed it.

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

**At most one reminder per household per day**, counting the scheduled ones
too. Pressing twice is safe, and following up again tomorrow still works. `alreadyRemindedToday` is how many
were skipped for that reason — not an error.

Refused with a `400` once the event has started, and for an unpublished
invitation.

Requires `invitation:publish`, like sending.

### Telling guests the details changed

```http
POST /api/v1/invitations/:slug/notify-changes   { "note": "We have moved to the garden." }
```

Needs `invitation:publish`. Sends an "updated details" message to every
household the invitation **reached** — someone who never received it has
nothing to update — on the channel each was invited on, carrying their own
link, which always shows the current details. `note` is optional, up to 500
characters, and is added to the message.

```json
{ "queued": 128, "alreadyNotified": 0, "recipients": [...], "unreachable": [...] }
```

Only ever sent when the host asks — offer it after an edit whose `notice`
says `isSuggested`. Pressing it twice within a minute sends once
(`alreadyNotified`); a later change can be announced again. Refused for a
draft invitation.

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

**The report needs `guest:read`** — it is the guest list by household — so a
`DESIGNER` gets `403`. **`toAddress` is absent unless you hold
`guest:contact:read`**: a `VIEWER` sees who was invited and what happened, not
where it went. An `unreachable` reason names the guest whose address is
malformed but never quotes the address.

`status` is `NOT_SENT` (nothing has been sent to this address yet) or a
`Message` status: `QUEUED`, `SENDING`, `SENT`, `DELIVERED`, `FAILED`,
`BOUNCED`, `SUPPRESSED`, `CANCELLED` (withdrawn before sending).

Each row also has `reminders` — how many reminders the household has had —
and `lastRemindedAt`.

After a host corrects a bounced address, the row shows the new `toAddress` as
`NOT_SENT` until it is sent — the bounce was at the old address and is no
longer the household's status.

**`SENT` means the mail server accepted it, not that it arrived.** A bounce can
follow minutes later, and when it does the status becomes `BOUNCED` with the
server's own words in `failureReason`. `QUEUED` with `attempts` above zero is a
message being retried after a temporary failure — not stuck. `SENDING` is
momentary; a message interrupted mid-send (a crash, a deploy) is returned to
the queue within about fifteen minutes and tried again, so in rare cases a
guest can receive the same message twice rather than not at all.

### How the built-in RSVP questions are asked

```http
PATCH /api/v1/invitations/:slug/rsvp-fields
{ "drinkPreference": { "options": [{ "key": "wine", "label": { "hy": "Գինի", "en": "Wine" } },
                                   { "key": "soft", "label": { "en": "Soft drinks" } }] },
  "songRequest": { "isEnabled": false } }
```

Needs `invitation:design`. The built-in questions — `dietary`,
`drinkPreference`, `songRequest`, `message`, `attribution` — are all asked, as
free text, until configured. For each one sent:

- `isEnabled: false` stops asking it. A host with no bar should not ask about
  drinks.
- `options` gives `dietary` or `drinkPreference` fixed choices: a `key`
  (lowercase letters, digits, dashes) and a translated `label`, up to 30.
  Guests send the key; the bar and catering sheets count keys and show labels,
  so "Wine", "Вино" and "Գինի" are one row. `options: null` returns it to free
  text.

Each question sent replaces that question's settings; the rest are kept. The
response is all five, resolved. A problem is a `400` whose message starts with
the question's name. The editor reads the current settings from
`GET /invitations/:slug/design` (`rsvpFields`).

Answers recorded before a choice list existed keep their free text and show
as typed. A key removed from the list later shows as the key.

### Custom RSVP questions

```http
GET    /api/v1/invitations/:slug/questions
POST   /api/v1/invitations/:slug/questions   { "type": "SINGLE_CHOICE", "prompt": {...}, "options": {...} }
PATCH  /api/v1/invitations/:slug/questions/:questionId
DELETE /api/v1/invitations/:slug/questions/:questionId
```

`type` is `TEXT`, `LONG_TEXT`, `SINGLE_CHOICE`, `MULTI_CHOICE` or `BOOLEAN`.
`SIGNATURE` is refused (`400` starting `type:`) until signatures can be
captured. `prompt` is translated (`{ "hy": "...", "en": "..." }`) and must
carry at least one language. `options` is translated too
(`{ "hy": ["Միս", "Ձուկ"] }`) and is **required for the choice types** — a
choice question with no choices cannot be answered, so it is a `400`. Every
language must offer the **same number of choices**, since an answer is a
position.

New questions go last; `sortOrder` comes back on each.

`PATCH` changes only the fields sent — `{ "required": false }` makes a question
optional and leaves its wording and choices alone. The result must still be
answerable: emptying a choice question's `options` is a `400` naming
`options`. **Once any guest has answered**, options may be reworded or added
at the end, never removed or reordered, and the type cannot change — each a
`400` saying how many have answered (answers are stored by position, so a
removed option would silently turn every later answer into a different one).

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
`role` is `CEREMONY`, `RECEPTION`, `AFTER_PARTY`, `PREPARATION` or `OTHER`, and
`arriveAt` is ISO 8601. Both also take `latitude` and `longitude` (given
together, or the first one sent is named in a `400`) and `capacity`; a value
sent overrides what the directory entry supplies. `PATCH` takes any of the
same fields except `profileId`; omitted ones are unchanged, and `null` clears
`mapUrl`, `arriveAt`, the coordinates and `capacity`. Both take `translations` —
`{ "en": { "name": "...", "address": "..." } }`, one language at a time, the
same rules as an event's — and guests see the venue in their page's language.

`POST`, `PATCH` and `DELETE` return a `notice` — see "Correcting an event" —
so the client can offer to tell guests who already hold the invitation. The
guest page reflects the change immediately.

Naming a `profileId` from the directory **copies** its coordinates and capacity
rather than referencing them, so a hall that moves next year does not rewrite
the address on an invitation already sent.

The directory itself is kept by Aveline staff (`directory:manage`):
`POST /venue-profiles` adds a hall (`name`, `address`, `city?`, `latitude?`,
`longitude?`, `capacity?`, `notes?`), and `PATCH /venue-profiles/:profileId`
corrects one or retires it with `isActive: false` — it disappears from the
list hosts see, and venues already copied from it keep their copy. Hosts
cannot write to it: every customer reads the same directory.

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

```http
GET    /api/v1/events/:eventId/media                 # the library
PATCH  /api/v1/events/:eventId/media/:assetId        { "altText": { "en": "Anna and Davit" } }
DELETE /api/v1/events/:eventId/media/:assetId
```

`GET` (needs `invitation:read`) lists the event's uploads newest first, each
with `id`, `url`, `kind`, `mimeType`, `sizeBytes`, `altText` (keyed by
language), `createdAt` and `usedBy` — the block types showing it, e.g.
`["HERO"]`. Generated exports are not in it; they are under `/exports`.

`PATCH` (needs `invitation:design`) sets alt text one language at a time: a
language sent replaces that one, `null` removes it, the rest are kept. Each
value is text up to 300 characters — a `400` starting `altText:` otherwise.
Guests receive it already resolved to their language, as `media[].altText`.

`DELETE` (needs `invitation:design`) removes the upload and its file. It is
refused with `409` while a block shows it, naming the block — take it off
there first, with `PATCH /invitations/:slug/blocks/:type`.

**Photos are resized after upload, in the background.** Within about a minute
each JPEG, PNG, WebP or AVIF photo gains smaller WebP copies at 480, 960 and
1600 pixels wide — only those narrower than the original — turned upright from
the phone's orientation tag. Media on the guest page, in the editor and in the
library then carry `width`, `height` and `variants`
(`[{ width, height, url, sizeBytes }]`). **Build `srcset` from `variants` and
fall back to `url`**: until the copies exist, and for SVG, `variants` is `[]`.
The original is kept and stays at `url`.

### Admitting a ticket at the door

```http
POST /api/v1/events/:eventId/tickets/:code/admit
```

The scanner screen. `code` is what the QR encodes; the scanner is opened for
one event, and a code from any other event is `404`.

```json
{ "code": "A1B2...", "admittedAt": "2026-10-05T18:02:11.000Z", "holderName": "Ani Grigoryan" }
```

**A code admits exactly once.** A second scan returns `400` with
`"Ticket already used"` — which is the point, and the message to show. Two
staff scanning the same ticket simultaneously cannot both admit it.

`404` means the code is not recognised at all. Distinguish the two in the UI:
"already admitted" is routine, "not recognised" is a problem.

Requires `guest:write` on that event, so door staff need a real account, not a
link — invite them to the event as a coordinator (`/events/:eventId/team`).

**Breaking, 9 October 2026:** the path was `/tickets/:code/admit`. With no
event in it, only Aveline staff could scan, and they could scan any event.

### Payments directly

Payments are started only by Aveline's own flows — ticket checkout and
subscriptions — which decide the organization, purpose and amount. **There is
no public endpoint to start one** (removed 9 October 2026: it let anyone
register a charge against any organization). What remains:

```http
GET  /api/v1/payments/:orderNumber           # public: current state
POST /api/v1/payments/:orderNumber/confirm   # public: ask the bank what happened
POST /api/v1/payments/:orderNumber/refund    # requires billing:write; not for tickets
POST /api/v1/payments/reconcile              # requires billing:read; ops only
```

The same rule as ticketing applies and is the one people get wrong: **the
return redirect is not proof of payment.** Call confirm, which checks
server-to-server. Statuses are `CREATED`, `PENDING`, `AUTHORIZED`, `CAPTURED`,
`FAILED`, `CANCELLED`, `REFUNDED`, `PARTIALLY_REFUNDED`, `EXPIRED`.

`reconcile` is an operations action — a sweep that re-asks the bank about
anything unresolved, and expires only what the bank still calls unpaid. A scheduled job already runs it; the endpoint exists for
when someone needs it sooner. Not something a user-facing screen should call.

Likewise `POST /api/v1/ticket-orders/release-expired` returns inventory held
by abandoned checkouts. Scheduled; exposed for manual use.

### Push registration

```http
POST   /api/v1/devices          { platform: "IOS"|"ANDROID"|"WEB", token, appVersion?, locale? }
DELETE /api/v1/devices/:token
```

`DELETE` stops only a device of your own; any other token is `404`.
Registering a token that another account had moves it to yours — the device
is now signed in as you.

Idempotent by token — re-register freely on every app start.

---

### Not for you: the Telegram webhook

```http
POST /api/v1/webhooks/telegram
```

Telegram calls this; no client should. It is listed only so it is not mistaken
for something to integrate with. It records a guest's opt-in when they tap the
deep link, treats blocking the bot as an unsubscribe, and lifts that
unsubscribe when the guest starts or unblocks the bot again.

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

- **No SMS provider yet.** The SMS channel is built — chosen last, for a
  guest with a phone and no other way in — but no provider is connected, so
  it is never chosen until one is. Email, Telegram and WhatsApp are delivered.
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
- **No block creation outside the arrangement call**, and no way to reorder
  custom RSVP questions once added.
- **PDF and XLSX exports.** CSV works; the other two formats return `400`.
- **Asynchronous bounce reports.** A rejection at send time suppresses the
  address automatically. A bounce that arrives later, as a report to the
  sending mailbox, is not read by anything.

The authoritative list is [GAPS.md](../backend/docs/GAPS.md), and
[GOING_LIVE.md](GOING_LIVE.md) is what blocks production.
