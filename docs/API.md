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

**Free-pilot deployments:** `PILOT_MODE=true` refuses paid ticket checkout and
paid subscription selection with `403` and the message "Payments are disabled
for the free pilot". No payable order/invoice is committed. Free ticket orders
and free subscriptions continue to work. Treat this as an unavailable paid
capability, not a retryable payment failure.

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

Errors also include additive display fields: `code`, `locale`, `userMessage`,
`action` and `details: [{field, code, userMessage}]`. Send `Accept-Language`
(`en`, `ru`, `fr`, `hy`; region tags and weighted preferences supported) for
host or guest interface copy. A supported `?locale=` takes precedence; otherwise
the fallback is English. These UI strings do not change the event's published
content language. Keep using the original `message` and status for compatibility.
Field paths identify invalid inputs; an unidentifiable business error has a null
field. Details are bounded to 100 entries. Display the translated `userMessage`
and map field paths to the form's translated labels.

`attendanceRevision:` conflicts have code `ATTENDANCE_CHANGED` and action
`RELOAD`: fetch the latest invitation and reconfirm. Other actions are `EDIT`,
`SIGN_IN`, `REQUEST_ACCESS`, `CONTACT_HOST`, `REGENERATE`, `WAIT`, `REUPLOAD`,
`CONTACT_SUPPORT` or `RETRY`. A retry is a user choice; never automatically repeat
a non-idempotent purchase based only on this guidance. Readiness failures retain
their structured report in `message`.

Export snapshot, seating job and private-media summaries retain `failureReason`
and add `recovery: {code, locale, userMessage, action}` (null without a failure).
Queued/running retries say `WAIT`; exhausted state-change failures say `RETRY`
without promising another automatic attempt. Subject-erased exports say `REGENERATE`. Send the
same language preference when polling. Common display types are included as
`HttpErrorDto`, `FieldFeedbackDto` and `JobRecoveryDto` in OpenAPI.
Completed seating results retain each unseated household's original `reason`
and add an `explanation` with the same display shape and action `EDIT`. This
also translates older saved planner results; unknown historical text gets safe
generic guidance, with the original reason preserved.

`path` has its credential replaced: a guest's link comes back as
`/invitations/:slug/g/[token]`, an invite's address as `[email]`, a payment's
order number as `[order]`. An error report or a screenshot of one is not a
working link.

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

**Send times in the extended form**: `2027-06-12T15:00:00Z` (seconds,
fraction and offset optional). Compact or week forms (`20270612`,
`2027-W01`) and impossible dates (`2027-02-30`) are a `400` naming the field.

**Translated content is keyed by language codes** (`hy`, `en`, `ru`, `en-GB`).
Any other key — in block copy, a question's prompt or options, a timeline
label, alt text — is a `400` naming the field.

---

## 2. Authentication

### Register, then log in

```http
POST /api/v1/auth/register    { email, password, name }   → 202 { "accepted": true }
POST /api/v1/auth/login       { email, password }
```

**Register does not sign in.** It answers `202 { "accepted": true }` whether
the address was new or already had an account — refusing a taken address told
anyone which addresses hold accounts. The owner of an existing account is
emailed a sign-in link instead. So the client always logs in next with the
same credentials: for a new account that succeeds; for a taken address with
someone else's password it fails with the usual 401, and "check your email"
is the honest thing to show.

**Breaking, 10 October 2026:** register returned a token pair with `201`, and
a taken address answered `401`.

Password is at least 10 characters. Login returns:

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
    "seating": null,
    "telegramLink": "https://t.me/AvelineBot?start=k7m2..."
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

### Correct your own name

```http
PATCH /api/v1/invitations/:slug/g/:guestToken/name
      { "firstName": "Ani", "lastName": "Dupont" }
```

No account is required: the personal link identifies exactly one guest. Names
are trimmed and limited to 100 characters; first name must be nonempty.
Null characters are rejected as a field error before storage. Either
field may be omitted; `lastName: null` (or empty text) clears the surname.
The response is `{ id, firstName, lastName, name }`. No guest ID, household,
contact, locale or RSVP fields may be supplied. Wrong/rotated links, erased
guests, drafts and expired invitations return 404; a closed but readable
invitation still permits correction. Existing credentials, household membership,
answers and seats are preserved. Host/guest reads and new exports use the new
name; previously generated files remain fixed snapshots. New ticket manifests
use the current linked guest name (falling back to the captured holder for
unlinked legacy tickets); original checkout attendee captures remain intact.

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

`status` in EVENT_WIDE mode: `ATTENDING` | `DECLINED` | `UNDECIDED` — `PENDING` is a `400`, since
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
  `answers:`. SIGNATURE takes a versioned typed/drawn acknowledgement object; see the private acknowledgements section.

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
identical submissions in the same minute produce one confirmation; a changed
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

### Attendance modes and reconfirmation

Events default to `EVENT_WIDE`, revision 1. The host may choose `PER_VENUE`:
every person is invited to every guest-facing venue. Preparation and exclusively
internal venues are excluded, using the same rule as invitation venue display.

Personal invitation responses include `guest.attendance`; each
`guest.household.members` entry also has `attendance`. The RSVP read includes
`attendance` and each other household member's attendance. Host guest reads
include the same projection. Only current answers are in guest projections.

```json
{
  "mode": "PER_VENUE", "revision": 2, "status": "ATTENDING",
  "needsReconfirmation": true,
  "venues": [
    { "venueId": "hall-id", "venue": "Reception", "status": "ATTENDING", "respondedAt": "..." },
    { "venueId": "church-id", "venue": "Ceremony", "status": "PENDING", "respondedAt": null }
  ]
}
```

Venue labels on the invitation use the negotiated page language. `PENDING`
means no answer for that venue. The person-level summary is ATTENDING if any
eligible venue is accepted; otherwise PENDING if any is unanswered, otherwise
UNDECIDED if any is undecided, otherwise DECLINED. With no eligible venues the
summary is PENDING. Counts never count a person twice at event level.
`needsReconfirmation` is true after a policy transition while attendance is
still pending for the person or any eligible venue. A newly added venue starts
pending; it does not inherit an earlier answer.

In per-venue mode, omit `status` and send bounded `venueAttendance` instead:

```json
{
  "attendanceRevision": 2,
  "venueAttendance": [{ "venueId": "hall-id", "status": "ATTENDING" }],
  "members": [{ "guestId": "member-id", "venueAttendance": [{ "venueId": "hall-id", "status": "DECLINED" }] }],
  "party": [{ "firstName": "Anna", "venueAttendance": [{ "venueId": "church-id", "status": "ATTENDING" }] }]
}
```

Each person submitted must have at least one venue answer, at most 100, with no
repeated, foreign or hidden venue IDs. Other venues and omitted members keep
their answers. New plus-ones need their own venue answers; they do not implicitly
follow the respondent in this mode. Dietary/custom required questions bind each
person whose summary is ATTENDING. Venue declines release seats only at that
venue; event-wide declines release every seat. Unspecified legacy seats remain
reservations in per-venue mode until the host explicitly unseats them.

**Frontend cutover:** guest submissions and host-recorded RSVPs use
`attendanceRevision`. It may be omitted only for an unchanged EVENT_WIDE event
at revision 1. Once mode changes, stale or missing revisions return **409** with
an `attendanceRevision:` message: reload the form and ask for fresh attendance.
Returning to EVENT_WIDE does not restore old-client compatibility. Invalid
payloads return 400 naming `status`, `venueAttendance` or `attendanceRevision`.

Host policy transitions are a preview followed by explicit confirmation;
both require `event:write`:

```http
POST /api/v1/events/:eventId/attendance-policy/preview
     { "mode": "PER_VENUE" }
POST /api/v1/events/:eventId/attendance-policy
     { "mode": "PER_VENUE", "expectedRevision": 1,
       "previewToken": "<32-character fingerprint>", "transitionId": "<client UUID>" }
GET  /api/v1/events/:eventId/guests/:guestId/attendance-history
```

Preview returns `mode`, `expectedRevision`, `previewToken`, `affected`
(`guests`, `responses`, `seatedGuests`, `seats`),
`seatsRetainedAsReservations: true`, and `request` containing the fields to
confirm. Add a client-generated UUID to `request` and reuse the exact payload
on retry. A changed revision, RSVP or seating/venue state invalidates the preview
with 409; preview again. Choosing the current mode or PER_VENUE without any
eligible venue returns 400. Repeated identical transitions return the originally
created revision, even if a later transition has since occurred; a reused UUID
with a different payload is 409.

Transition returns `{ mode, revision, notice }`. It preserves old attendance
under its original revision, keeps dietary/custom answers and admission history,
and resets current attendance to pending. Seats are retained, visibly marked
`isReservation`, and continue to occupy capacity. Confirmed totals and automatic
seating exclude unconfirmed people. A fresh decline releases the appropriate
seats. History needs `guest:read`, stays scoped to that event/person, and returns
up to 1,000 records newest revision first. Records include policy mode/active
state, venue, status and response/update times; unknown imported response times
remain null rather than being guessed.

`notice.notificationPath` offers the existing `notify-changes` outbox operation
after the transition commits. Sending is a separate deliberate host call; add a
note asking guests to reconfirm. Failure/retry cannot repeat the mode transition
or discard answers. Per-venue RSVP confirmations use dedicated copy that
acknowledges saved answers without claiming the whole event was accepted or
declined. New default copy supports en/ru/fr/hy on email, Telegram and WhatsApp;
rerun the idempotent production seed before enabling it. Translation review
and frontend reconfirmation screens remain acceptance work.

Answered venues cannot be deleted or hidden through role/timeline edits;
these return a field error and roll back the edit, preserving attendance history.

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

`guest.seating.assignments` and each household member's `assignments` are
arrays of `{ arrangementId, venueId, venue, tableId, table, position, isReservation }`.
Guest `venue` labels use the negotiated page language and fall back to the
venue's plain name when no translation exists. Only the household's guest-facing venues and unspecified seats are returned;
preparation/internal-only venue IDs and names never appear. These arrays stay
inside the published seating boundary.

The legacy `table` field is `null` when there are zero or multiple assignments.
Use the array to distinguish “not seated” from “seated at several venues”. A guest sees their own household and never anyone else's. The shared,
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
       "isIndexable": false, "slug": "autumn-jazz-night",
       "heroAssetId": "<event image id>", "ogImageId": null }
POST /api/v1/events/:eventId/listing/publish
POST /api/v1/events/:eventId/listing/unpublish
```

`PUT` creates or edits; omitted fields are left alone. `slug` is optional and
generated from the title when omitted — an Armenian title becomes
`event-<random>`, because it contains nothing URL-safe. A taken slug is `409`.

Publishing is refused for a private event, without a headline in any
language, or once the event has started. Unpublishing does not affect tickets
already sold.

`heroAssetId` and `ogImageId` select existing PHOTO/COVER/LOGO assets belonging
to this event. Omitted leaves the selection unchanged; null clears it. Invalid,
missing, cross-event or non-image IDs reject the entire edit with 400. A selected
image cannot be deleted until its listing references are cleared (409).

Public browse cards and announcement detail include `heroImage`, or null:
`{ id, url, kind, altText, width, height, variants }`. `altText` is resolved in
the negotiated locale; build `srcset` from `variants` and fall back to `url`.
Detail `metadata.image` has the same shape, preferring the share image and then
the hero; `metadata.imageAssetId` identifies that resolved image. Invalid legacy
references are ignored. Image hydration is batched across the browse page.
Private, unpublished, future-published and archived listings return no public
metadata. UNLISTED pages remain noindex and absent from browse.

The frontend must put `metadata.image.url`, title and description into the
actual HTML Open Graph tags served to link crawlers. The API supplies data;
HTML previews still require frontend integration and acceptance.

All of this needs `event:write` (reading, `event:read`).

### Cancelling an order

```http
GET  /api/v1/events/:eventId/ticket-orders?status=PAID
POST /api/v1/events/:eventId/ticket-orders/:orderId/cancel
```

The list needs `operations:read`; **`buyerEmail` is absent unless you also hold
`guest:contact:read`** — door staff and viewers see orders, not addresses.

Cancellation freezes admission before contacting the bank. A definite refund
refusal reopens it; an uncertain bank outcome stays frozen until reconciled.
Successful cancellation declines linked guests in the current attendance
policy and releases all their seats while preserving release history. Later
RSVPs cannot mark a void/refunded ticket holder attending again.

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
  cancelled order rather than an error, and never refunds twice — even two at
  the same moment: the second waits for the first's refund and answers with
  its result. (Until 10 October 2026 that case answered `409`.)
- **Requires `billing:write`** — money leaves the business, so in practice the
  organization owner.

`POST /payments/:orderNumber/refund` now **refuses ticket payments** and
points here, because refunding the money alone left a buyer refunded and still
able to get in. It remains for other payments, is staff-only, and takes a
validated `{ "amountMinor": "15000", "reason": "..." }`. Refunding a
subscription payment **in full** voids its invoice and ends the plan at once
(decided 10 October 2026); a partial refund changes nothing.

### Reviewing and reconciling attendees

```http
GET  /api/v1/events/:eventId/ticket-orders/:orderId
POST /api/v1/events/:eventId/tickets/:ticketId/attendee
POST /api/v1/events/:eventId/tickets/:ticketId/link-guest
```

The order detail requires `guest:read`. It returns the ordered captured roster
and tickets with their attendee and current guest IDs. Only callers with
`guest:contact:read` receive attendee email/phone and ticket codes. No guest
capability, buyer access token or archived personal answer snapshot is exposed.

Both writes require `guest:write` and only reconcile active paid tickets.
To register an unlinked legacy ticket, supply
`{attendee: {ticketTypeId, firstName, ...}, attendanceRevision}` using the same
attendee rules as checkout. This creates its named guest and attaches it to the
existing ticket; it never issues another code or guesses from the buyer name.
The ticket type must match. Already-registered tickets return `409`.

To link an existing invited guest, send
`{guestId, expectedGuestId, keepExistingAnswers: true}`. The expected ID is the
current ticket guest, or explicit `null` for an unlinked legacy ticket; omission
is `400`, a changed link is `409`. The target must belong to this event, be
unerased and have no other ticket. Repeating a completed link is safe.
The invited guest keeps their profile and answers; an automatically created
checkout duplicate is archived under the roster and removed from live totals.
Household allowance is reduced accordingly. Existing invited guests cannot be
silently replaced. A checkout duplicate with seats/release history, admission,
a signature, channels/devices or messages must be resolved first (`409`).
A known legacy admission timestamp is retained when linking; unknown/conflicting
admission timestamps require staff review. Erased attendees cannot be relinked.

Legacy tickets remain valid without invented guest identities until hosts
explicitly register/link them. Their guest-based operational counts are complete
only after reconciliation.

### Buying tickets

```http
POST /api/v1/public/events/:slug/orders
```

```json
{
  "items": [{ "ticketTypeId": "...", "quantity": 2 }],
  "buyerName": "Ani Grigoryan",
  "buyerEmail": "ani@example.com",
  "attendanceRevision": 1,
  "attendees": [
    { "ticketTypeId": "...", "firstName": "Anna", "email": "anna@example.com" },
    { "ticketTypeId": "...", "firstName": "Davit" }
  ],
  "provider": "AMERIABANK",
  "returnUrl": "https://yourapp.am/tickets/return",
  "idempotencyKey": "<uuid you generate>"
}
```

`returnUrl` must be a page of the client app — the same origin as the
backend's `PUBLIC_APP_URL` — or the request is a `400` naming it: the bank
sends the payer wherever it says, so any other origin would be an open
redirect through a real payment page. Omitted, it is `/tickets/return` on the
app. The same rule holds for `returnUrl` on `POST /subscription`, whose
default is `/billing/return`.

**Breaking checkout contract, 15 October 2026:** `attendees` is required,
with exactly one named person for each ticket in `items` (up to 1,000 people).
Each person names their `ticketTypeId`. The buyer is separate; omitted attendee
email/phone never falls back to the buyer's contacts. An omitted buyer locale uses the event's default language. An attendee's
locale falls back to the buyer locale, then the event default. Attendees accept
`firstName`, `lastName`, `email`, `phone`, `locale`, `dietary`, `dietaryNotes`,
`drinkPreference`, custom `answers`, and attendance inputs. The event's locale
list and RSVP question rules apply. `householdKey`, when supplied, explicitly
groups people within this order; otherwise each person gets a separate household.
Matching names or email addresses never merge people.

Load the public event detail first. Its `checkout` object supplies
`attendanceMode`, `attendanceRevision`, `venues: [{id, name}]`, `rsvpFields`
and localized `questions: [{id, type, required, prompt, options}]`. The checkout
built-in fields are `dietary` and `drinkPreference`, the fields accepted per
attendee.
Preparation/internal-only venues are excluded from both checkout and the
public venue list; public venue entries now also include their `id`.
In `EVENT_WIDE`, an attendee's omitted `status` means `ATTENDING`.
In `PER_VENUE`, omit `status` and collect each attendee's own
`venueAttendance: [{venueId, status}]`; at least one choice per person is
required, with unanswered venues left pending. Send the current top-level
`attendanceRevision`; omission only works for the original event-wide revision.
Stale revisions return `409` and invalid choices return `400`, before inventory
or a promo claim is written.

Ticket types with checkout history must be deactivated instead of deleted,
even after an order expires. Questions answered in pending or archived
checkout rosters cannot be deleted or have their answer shape changed.

The reserved order stores the roster atomically. Settlement (including free
checkout) creates guests, answers and linked tickets once. An abandoned order
creates no guest. If the host changes attendance policy before settlement,
checkout answers stay in the roster and the new guest must reconfirm under the
current policy. Buying a ticket never invents venue answers. Responses include
`attendees` (names, IDs, ticket types, positions and captured attendance) and
issued `tickets` with `id`, `attendeeId`, `holderName`, `code`, `status`.
Guest capability tokens are never returned to buyers.

List each ticket type **once**, with its quantity: a basket naming one type
twice is a `400` on `items` (two lines of six used to pass a limit of ten).

**Generate `idempotencyKey` once per checkout attempt and reuse it on retry.**
A double-tapped button with the same key returns the same order rather than
reserving twice — **with its `payment`**, so a retry can still send the buyer
to the bank. Two identical taps arriving at once both get that order. Reusing
the key with
a different event, buyer, basket or roster returns `409`; use a new key for a
changed intent. Legacy keys created before roster fingerprints cannot be
replayed through checkout; their existing access-token URL still works.

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

`headcount` (also in the dashboard) adds `venues`, each with `venueId`, `venue`,
`invited`, `attending`, `declined`, `undecided` and `pending`. Only guest-facing
venues appear. Response rate and its daily trend count people who answered any
venue, including partial replies whose remaining venues are pending.
`catering-sheet` and `bar-sheet` accept optional `?venueId=...`;
without it they count unique people attending anywhere. A foreign or hidden
venue is 404. Personal dietary/drink choices remain one answer per person.

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
organizationId** — it is ignored. Use the organization header. Platform staff
without a header retain the paginated platform list; an explicit header narrows
to that tenant plus their direct event grants.

Optional `?limit=` (1–500) and `?offset=` page the list, soonest event first.
A customer's list is whole unless they ask; **platform staff get 100 at a
time by default**, since theirs is every customer's events — page with
`offset` (added 10 October 2026; the response is still a plain array).

### Setting an event up for a customer (Aveline staff)

```http
POST /api/v1/concierge/organizations                       { "name": "Petrosyan Wedding", "ownerEmail": "anna@example.am" }
POST /api/v1/concierge/organizations/resolve-customer        { "ownerEmail":"anna@example.am", "limit":50 }
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

Concierge setup uses exact 0/1/many customer resolution, including an unexpired
pending OWNER invitation for provisional onboarding. Several choices require
selection with `409 ORGANIZATION_SELECTION_REQUIRED`. Optional `organizationId`
selects an existing customer relationship, never grants one. The staff-only
resolve-customer endpoint returns `{items:[{id,name,kind,createdAt}],nextCursor}`
for current memberships, defaults/maxes at 50 and bounds cursor to 256 characters.
New organization, OWNER invitation and credential Message commit atomically.

**A customer who already has an organization** gets the event built in it
(decided 10 October 2026): the response is that organization with
`invite: null` and `isExisting: true`, and the events staff create appear in
their list with nothing to accept. Otherwise `isExisting` is `false`.

### Archiving and deleting an event

```http
POST   /api/v1/events/:id/archive
POST   /api/v1/events/:id/unarchive
DELETE /api/v1/events/:id
GET    /api/v1/events?archived=true
```

Archiving, unarchiving and deleting need `event:delete`, which owners hold;
listing archived events is open to anyone who can see the events. Decided 9
October 2026:

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
`400` — neither creates an import record. **One import of an event runs at a time**: a
second while the first is running — a double upload, a retry — is a `409`;
send it again once the first has answered.

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

A row whose email or phone belongs to someone **erased from your
organization's events** is refused as a row error — "This person asked for
their data to be erased and cannot be added again" — so re-uploading the
original spreadsheet does not bring them back (decided 10 October 2026).

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
whose decline freed a seat — see the seating section below — and `null` when
there are zero or multiple release records. Guests also carry `seating` as an
array of `{ arrangementId, venueId, venue, tableId, table, position }`, and
`seatReleases` as `{ arrangementId, venueId, table, releasedAt }` records.
The legacy `table` is null when several assignments exist. Host reads include
all arrangements, including internal venues.

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

**A ticket-linked guest cannot be removed** (`400`), including after
cancellation: keep their operational history. Use the explicit ticket linking
flow to reconcile a checkout duplicate.

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
GET    /api/v1/events/:eventId/seating/arrangements
GET    /api/v1/events/:eventId/tables
POST   /api/v1/events/:eventId/tables
POST   /api/v1/events/:eventId/tables/bulk
PATCH  /api/v1/events/:eventId/tables/:tableId
DELETE /api/v1/events/:eventId/tables/:tableId
```

`GET /seating/arrangements` returns a bare array of `{ id, eventId, venueId, revision,
venue: { name, capacity } | null, _count: { tables } }`. Every venue has an
arrangement and every event has an explicit unspecified plan (`venueId: null`).
Treat IDs as opaque. `revision` advances on relevant seating/attendance/guest
changes and protects worker application; it is server-maintained. `GET /tables`
returns all tables or accepts
`?arrangementId=...` to read one plan, with occupancy and names in one request:


```json
[
  {
    "id": "clz...", "name": "Table 1", "capacity": 10, "zone": "Main hall",
    "venueId": "clz...", "venue": "Reception hall", "arrangementId": "clz...", "posX": 120.5, "posY": 40, "shape": "round",
    "seated": 7, "available": 3,
    "guests": [{ "guestId": "clz...", "name": "Armen Petrosyan", "position": null }],
    "released": [{ "guestId": "clz...", "name": "Ani Sargsyan", "releasedAt": "..." }]
  }
]
```

**An event-wide decline frees every seat.** Guest and host RSVP writes release
all of that person's assignments and keep one flag per arrangement in the
tables' `released` arrays. Reseating them clears only the target arrangement's
flag; explicit unassignment dismisses only the selected arrangement's flag.
Answering `ATTENDING` or `UNDECIDED` keeps seats. Per-venue declines release only
the selected venue; policy transitions retain seats as flagged reservations
until fresh attendance is given. See attendance modes above.


`POST /tables` takes `{ name, capacity, zone?, venueId? }`. For a real room,
use `/tables/bulk` with `{ namePrefix, count, capacity, zone?, venueId? }` —
twenty tables of ten is one request, and numbering continues from the highest
number already used with that prefix (`Table 1` … `Table 20`, then `Table 21`
even if `Table 3` was deleted). Names and numbering are scoped to the venue's
arrangement, so both venues can use “Table 1”. Omitting `venueId` creates a table
in the unspecified arrangement. Number allocation and insertion are atomic
within the arrangement; simultaneous batches create all requested tables. It
returns `{ "created": 20 }`.

`PATCH /tables/:tableId` changes any of `name`, `capacity`, `zone`,
`venueId`, `posX`, `posY` and `shape` (`round`, `rectangle`, `square`,
`oval`); omitted fields are unchanged and `null` clears `zone`, `venueId` and
the position. Use it to save a table's place when it is dragged on the plan.
`capacity` cannot go below the guests already seated or their numbered chairs,
a name another table in the same arrangement has is refused, and `venueId`
must be one of this event's venues — each a `400` naming the field.
Changing `venueId` while seats or release flags remain returns `409`; move
people and dismiss the flags before reparenting an empty table. Updating a
venue's capacity below its seated headcount is also refused. The position is in the editor's
own units; the server stores it and does not interpret it.

Deleting a table with guests at it returns `409` naming how many, because the
cascade would silently unseat them. Unseat them first.

```http
POST   /api/v1/events/:eventId/seats          { guestId, tableId, position? }
DELETE /api/v1/events/:eventId/seats/:guestId
```

`POST` seats a guest or moves their existing seat **within the target table's
arrangement**, keeping their assignments at other venues. It returns
`{ guestId, tableId, table, arrangementId }`. A duplicate numbered chair is
`409` naming `position`; a position past table capacity is `400`.

`DELETE` accepts `?arrangementId=...` and removes only that arrangement's seat
or release flag. **Contract cutover, 13 October 2026:** omission is `400` naming
`arrangementId` if more than one arrangement has tables or release history.
Automatic seating below has the same selection rule. Existing one-plan clients
may omit it; new clients must retain the active arrangement ID. A foreign event's
arrangement returns `404`; rejected requests change nothing.

A full table or venue returns `409`. Capacity is
checked inside the transaction, so two coordinators filling the last chair at
once cannot both succeed; handle the `409` as a routine outcome of drag-and-drop
and re-fetch the table.

```http
POST /api/v1/events/:eventId/seats/auto-assign
```

**Breaking cutover, 18 October 2026:** this endpoint now queues a job; it does
not seat guests in the request. Send `{ "idempotencyKey": "<new UUID v4>" }` and
retain `?arrangementId=...` under the selection rule above. Requires
`seating:write`. It returns `201` with `id`, `arrangementId`, `status: "QUEUED"`,
`attempts: 0`, `result: null` and nullable generation/revision metadata. Manual
seat assignments remain immediate.

```http
GET /api/v1/events/:eventId/seating/jobs
GET /api/v1/events/:eventId/seating/jobs/:jobId
```

These reads require `seating:read`. History returns the latest 50 job summaries,
excluding result details. Poll an individual job for `QUEUED` → `RUNNING` →
`COMPLETED`/`FAILED` and its result:

```json
{
  "id": "clz...", "arrangementId": "venue:clz...", "status": "COMPLETED",
  "attempts": 1, "failureReason": null, "snapshotAt": "2026-10-18T12:00:00Z",
  "attendanceRevision": 1, "arrangementRevision": 40, "appliedRevision": 124,
  "result": {
    "seated": 84, "households": 31,
    "unseated": [
      { "householdId": "clz...", "size": 5, "reason": "No table has 5 free seats together" }
    ]
  },
  "createdAt": "2026-10-18T11:59:58Z", "completedAt": "2026-10-18T12:00:01Z"
}
```

The same event/requester/UUID returns its original job. Reusing it with a different
explicit arrangement returns `409`. One active job per arrangement is enforced;
a new UUID while it is queued/running returns `409`. After completion/failure, a
new UUID explicitly starts another additive run. A foreign event's job ID is
`404` to an authorized caller of that event. Job results describe their completed
attempt; refresh tables for the current live room rather than applying the
result in the browser.

The worker captures inputs when an attempt starts, computes outside database
locks, then rechecks current attendance/policy, arrangement revision, capacity
and requester permission before atomically inserting seats and completing the
job. Table edits, manual seats, guest/answer changes, cancellation and erasure
invalidate captured plans. Busy answers/identities or changed inputs queue a
fresh attempt (`failureReason: "STATE_CHANGED"`); households are never partially
applied. Attempts are bounded to three, including crash recovery. A repeated
conflict ends as `FAILED`; the host can refresh and explicitly run again.

Archived events cannot start or apply a job. Permission loss/inactive users stop
it with `ACCESS_REVOKED`; archive uses `EVENT_UNAVAILABLE`. Exhausted crashed
claims use `LEASE_EXHAUSTED`; input bounds use `INPUT_LIMIT_EXCEEDED`. Other
internal failures expose safe codes only. See the
[worker runbook](../backend/docs/SEATING_WORKER.md) for the complete code list.
Event/arrangement deletion removes its jobs. Results contain household IDs and
reasons, never guest credentials/contact details or saved permission grants.

Automatic planning supports at most 5,000 event guests, 500 arrangement tables
and 5,000 arrangement seats. Capture/application transactions are limited to
20 seconds each; bounded computation is limited to 30 seconds before applying.
Manual seating still serializes with answer writes and remains available while
a job is computing.

Three things to know before you wire the button:

1. **It is additive, not a re-plan.** Guests already seated in this arrangement keep their seats,
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
and the venue-labelled `seating` array (same shape as host guest reads). The
legacy `table` is null when several assignments exist. `wasExpected` being
`false` means this guest declined or never responded and
has turned up anyway, which is worth showing the host rather than silently
admitting.

**A guest arrives once.** A second check-in returns `409`. Two people on the
door cannot both record the same arrival, so treat the `409` as "already here"
and show the first arrival time, not as an error. `DELETE` undoes a mis-scan
and a guest can then be checked in again. For a ticket-linked guest, a used,
void/refunded ticket or a cancelled/frozen order instead returns `400` with
the ticket reason; a used ticket means the person was already admitted.

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
registering and logging in, unless the account arrived through
`POST /invites/accept`, which already placed it in one — or through
`POST /event-invites/accept`, which places it on one event and needs no
organization.

```json
{
  "id": "clz...", "name": "Petrosyan Wedding", "kind": "HOST",
  "events": 0, "members": 1, "plan": null, "subscriptionStatus": null
}
```

The caller becomes `OWNER`. `kind` is `HOST`, `PLANNER` or `CORPORATE`, and
only affects presentation today.

Organization selection uses optional `X-Aveline-Organization-Id` on scoped calls.
It is a single 1–64 character ASCII ID (`[A-Za-z0-9_-]`), never a role grant.
Without it, one live membership remains the default; several return localized
`409 ORGANIZATION_SELECTION_REQUIRED` with `SELECT_ORGANIZATION`. Unknown,
foreign, revoked or closed selections return `403 ORGANIZATION_ACCESS_DENIED`.
Event and invitation links derive their actual tenant; an authorized mismatching
selection returns `409 ORGANIZATION_CONTEXT_MISMATCH`. Store selection per tab.
Session-only create, own memberships and invite-token acceptance ignore selection.

`POST /organizations` accepts optional `Idempotency-Key` (1–120 ASCII letters,
digits, `_` or `-`). Same actor/key/body replays the existing organization while
access remains; a different body returns `409 IDEMPOTENCY_KEY_REUSED`.
Additional memberships remain disabled by the shared database compatibility gate
and existing single-membership index until the controlled cutover. No environment
flag enables them. Organization descriptions add `accessRevision`.

```http
GET /api/v1/me/organizations?limit=50&cursor=<opaque>
GET /api/v1/organizations/current/members?limit=50&cursor=<opaque>
PATCH /api/v1/organizations/current/members/:userId { "role":"MANAGER", "expectedRevision":0 }
DELETE /api/v1/organizations/current/members/:userId?expectedRevision=0
POST /api/v1/organizations/current/leave { "expectedRevision":0 }
POST /api/v1/organizations/current/owner-transfers { "successorUserId":"...", "expectedRevision":0 }
POST /api/v1/organizations/current/closure-reviews { "expectedRevision":0 }
GET /api/v1/admin/organization-access-reviews?limit=50
POST /api/v1/admin/organization-access-reviews/:reviewId/resolve { "decision":"HANDOVER", "successorUserId":"...", "expectedRevision":0 }
```

Own memberships return `{items:[{organizationId,name,kind,role,joinedAt}],nextCursor}`;
no contacts, billing or other accounts. Membership lists return user ID, name,
role and joinedAt plus accessRevision; member management needs `member:manage`.
Both lists default to 50, max 100, cursor max 256. Self-leave is available to every
member. Revision mismatches return `409 REVISION_CHANGED`; last active organization
or direct-event owners require a handover (`409 OWNER_HANDOVER_REQUIRED`).
Promotion leaves the caller OWNER. Departure atomically removes every direct role
and pending invite in this tenant and revokes customer-authorized unfinished seating/export jobs;
unrelated organizations, direct event grants and independently authorized active
staff work remain. Every worker still rechecks current operation/contact permission.
Closure reviews remove nothing until an ADMIN resolves HANDOVER, CLOSE or DECLINE.
CLOSE preserves events and financial history, soft-closes the tenant and revokes its
customer memberships/invites/jobs. Authenticated event routes deny closed tenants
for every platform role, including ADMIN/SUPPORT; published guest capability
contracts retain their existing behavior. SUPPORT and customers cannot resolve reviews.

Invite issue and protected Message outbox now commit together. Organization
authority changes record only transactional IDs, roles, revisions and revoked-role
counts; evidence contains no contacts or capability tokens. Correct-password
same-user replay returns the current role without restoring a departed membership;
rotated/revoked/expired tokens keep the existing 400 invalid-invitation contract.

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
POST /api/v1/subscription   { "planKey": "managed-monthly", "provider": "AMERIABANK", "returnUrl"?: "https://aveline.am/billing/return" }
```

A free plan (`priceMinor: "0"`) activates immediately and returns
`invoice: null`. A paid one needs `provider`, issues an invoice, and returns a
bank URL:

```json
{
  "subscription": null,
  "invoice": { "number": "AV-2026-000001", "status": "ISSUED", "totalMinor": "25000" },
  "payment": { "orderNumber": "...", "redirectUrl": "https://bank..." }
}
```

For a paid plan, an unconfigured `provider` returns `404` before issuing or
replacing an invoice, allocating its number or changing the current subscription.
Free plans do not require a provider. `PILOT_MODE=true` still refuses paid plans
with `403` first. Local provider registration does not prove bank readiness.

**Access begins when the payment confirms, not when this call returns.** A
first paid plan has **no subscription until it is paid** — `subscription` is
`null` here and on `GET /subscription` — and a plan change leaves the current
subscription as it is. **Breaking, 10 October 2026:** a first paid plan used to
create a `TRIALING` subscription on the paid plan, which reported its
entitlements before anything was paid. Send the payer to `redirectUrl`, and
on their return call:

```http
POST /api/v1/invoices/:number/confirm
```

which asks the bank server-to-server and activates the subscription. Safe to
call twice; a second call never double-activates or double-counts.

Changing plan is the same call with a different `planKey`. Asking for the
same plan again while its invoice is open — a double click, a retry — returns
that invoice and its payment, never a second one. **Nothing changes
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
`currentPeriodEnd`, not "cancelled". A cancel stands even if a plan change
issued before it is paid afterwards. `resume` undoes it until that date passes,
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

`format` defaults to `CSV`. These legacy routes return `400` for `PDF` and
`XLSX`, directing callers to the snapshot routes below. Those routes support
all three formats and their queued states. Legacy records remain live CSV.

The files are UTF-8 with a BOM and CRLF endings, so Excel opens Armenian text
correctly, and every cell is quoted — including a defensive tab in front of
anything starting with `=`, `+`, `-` or `@`, so a guest's free text cannot
become a formula in whoever's spreadsheet opens it.

The guest list carries a `Dietary notes` column and one column per host
question, headed `Q1: <prompt>` in the event's language, with each answer in
words. The catering sheet lists every dietary note under its counts, with
the guest it belongs to.

Requires `operations:read`.

### Export columns for separate venue seating (13 October 2026)

CSV guest lists retain the legacy `Table` column (empty for multiple assignments)
and add `Seating by venue`. Seating charts add `Venue` and `Arrangement`; place
cards add those columns and produce one row per seated arrangement for each
attending guest, or one blank-seat row if unseated. Import consumers must use
headers rather than fixed column positions. CSV downloads still use current
data on the legacy `/exports` routes. Use `/export-snapshots` for fixed files.

### Private snapshot exports (16 October 2026)

```http
POST /api/v1/events/:eventId/export-snapshots
GET  /api/v1/events/:eventId/export-snapshots
GET  /api/v1/events/:eventId/export-snapshots/:snapshotId
GET  /api/v1/events/:eventId/export-snapshots/:snapshotId/download
```

These additive routes support all seven kinds above in **CSV, PDF and XLSX**.
The frontend can migrate explicitly; `/exports` keeps its existing live behavior.
Old export records now explicitly carry `isSnapshot: false` and
`requiresRegeneration: true`: they cannot recover past data and must be
regenerated through the new route. Their live compatibility download remains
available until the frontend migrates. Snapshot jobs appear only in the new history, newest 50 first.

Create with `{ "kind": "GUEST_LIST", "idempotencyKey": "<new UUID v4>",
"format": "PDF", "locale": "en", "includesContacts": false }`. Format defaults
to `CSV`; accepted values are `CSV`, `PDF`, `XLSX`. Locale defaults to the event language and accepts
`en`, `ru`, `fr`, `hy`. Snapshot titles, standard headings, metadata, status/side
labels and translated question/choice and ticket-type labels use it. Host-authored
names, answers and notes remain literal. `includesContacts` defaults to the caller's
current contact permission. A viewer can request redacted sheets; a contact
holder can also explicitly request them. Manifests always require contact
permission and cannot be redacted. The existing CSV columns and formula
protection apply. Venue and arrangement columns identify separate seating.
Snapshot catering and bar sheets add `Venue` and use each guest-facing venue's
current attendance answers; preparation/internal-only venues are excluded.
Event-wide attendees count at every guest-facing venue. Without any such venue,
these sheets retain the event-wide layout. Legacy live CSV columns are unchanged.

PDF uses embedded fonts for Latin, Cyrillic, Armenian and French accents. Seating
charts group rosters by venue/arrangement/table with capacity and seated counts;
place cards are six **90 × 70 mm flat cut cards on A4**, with cut guides. Wide
lists split into column groups with identifying fields repeated. XLSX uses typed
counts/dates and literal text cells; ticket codes keep leading zeros, and text
never becomes a formula or external link. Catering workbooks separate requirements
and dietary notes. Workbook timestamps are labelled UTC; PDF generation times
use the event timezone.

Create returns `201` with `id`, `kind`, `format`, `locale`, `includesContacts`,
`status: "QUEUED"`, `attempts: 0`, and `downloadPath: null`. The same UUID,
event, requester and intent (kind, format, locale and contact visibility) returns
the same job; changed intent returns `409`.
A regeneration uses a **new UUID**. At most 10 queued/running jobs per event;
further new work returns `409`, while retries of accepted intents still work.

Poll the individual job: `QUEUED` → `RUNNING` → `COMPLETED` or `FAILED`.
Transient failure may return to `QUEUED` with a safe `failureReason`;
`attempts` is bounded to three. The worker takes a consistent read **when an
attempt starts**, not when the host queues it. A recovered attempt may capture
new inputs before publishing. A completed artifact never changes.

Metadata includes nullable `snapshotAt`, event `timezone`, `attendanceRevision`,
opaque Postgres visibility token `dataRevision`, `completedAt`, `expiresAt`,
`revokedAt`, and `failureReason`. The visibility token is provenance, not a
monotonic event edit version. An available artifact has an authenticated
`downloadPath`; it contains no object key or public URL. Files expire after
seven days by default (configurable 1–30); source event data is retained.

All routes require `operations:read`. Downloads recheck active user/event
standing and contact permission **after storage IO too**. A full artifact
returns `403` after contact permission is lost; request a redacted regeneration.
A queued/running/failed job returns `409` on download. Revoked or expired files
return `410`; cross-event snapshot IDs return `404` to an authorized event
caller. A missing/offline object returns `503`. Fetch with authorization and
use the returned blob, as for legacy exports. The body contains the raw artifact
bytes; read it with `blob()` or `arrayBuffer()`. Responses use `Cache-Control:
no-store`. MIME types are `text/csv; charset=utf-8`, `application/pdf`, or
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, with matching
`.csv`/`.pdf`/`.xlsx` filenames in `Content-Disposition`. Do not render a public
anchor or store a permanent file URL.

Subject erasure revokes existing jobs/artifacts for affected events, including
snapshots that retain an earlier email address. In-flight jobs cannot publish
after erasure. Event deletion leaves a private cleanup ledger. Cleanup is
asynchronous and retried during storage outages; future downloads are denied
immediately on revocation/expiry. Hosts regenerate after these transitions.

All formats have a 10 MiB output cap and input caps of 5,000 guests, tickets,
seats, orders, attendees and tables each, 50 venues, 200 custom questions and
100,000 answers. Rendered sheets are limited to 20,000 rows, 256 columns,
32,767 characters per cell and 2 million text characters; PDF also has a
500-page/45-second rendering limit. Oversized jobs fail with bounded retries
and safe failure codes. Automatic seating also runs in its own worker; frontend
job adoption and production worker acceptance remain F27 release gates.

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

`reason: "ERASED"` marks someone whose data was erased at their request. It
is `ORGANIZATION`-scoped, cannot be lifted (`DELETE` returns `409`), and its
`address` reads `"[erased]"` unless it matches one of your current guests:
after an erasure an address is kept only as a one-way hash, which can confirm
an address you already have but never show one. **New value, 10 October
2026** — handle an unknown `reason` gracefully.

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
bounce naming their address (SMTP `5.1.x`, a disabled mailbox `5.2.1`, or a
bare `550`/`551`/`553`), a complaint, blocking the bot. Our own quota, size or
policy rejections (`5.4.5`, `5.3.4`, `5.7.x`, a bare `554`) never are. A rejection caused by our own message
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
  "kind": "EXPORT", "status": "RECEIVED",
  "dueAt": "2026-11-04T...",
  "message": "Your request has been recorded. We will verify your identity and respond within one month."
}
```

The response is **identical whether or not anything is held about that
address** — "we hold nothing about you" is itself information, and anyone can
type any address into this form. Do not build a UI that implies otherwise.

`kind` is `EXPORT` (Article 15), `ERASURE` (Article 17) or `RECTIFICATION`
(Article 16). `dueAt` is one month out, per Article 12. Submitting the same
kind for the same address while one is open adds to it rather than opening a
second — but the answer is the same fresh receipt either way, so it never
says that someone else already asked. **Breaking, 10 October 2026:** the
answer carried a `reference`, and for an open request its own status and
deadline; `reference` is gone. Staff find a request in the list.

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
ticket orders, subject-specific ticket attendee records (including archived
checkout answers), messages sent and suppressions. A buyer-only export does
not include unrelated attendee records. Erasure clears attendee snapshots and
reserved rosters independently of the buyer; later settlement cannot restore
the erased names or answers. Erasure also invalidates checkout-key replay;
the buyer access-token URL continues to show the retained order. Financial
amounts and operational history remain. It is assembled on demand and
never stored, because a copy waiting to be collected is a second place it can
leak from.

An `ERASURE` anonymises in place and reports what it touched:

```json
{ "reference": "clz...", "kind": "ERASURE", "guestsAnonymised": 1,
  "householdsRenamed": 1, "ticketOrdersAnonymised": 1, "ticketAttendeesAnonymised": 2,
  "messagesRedacted": 4,
  "suppressionsHashed": 1, "invitesWithdrawn": 0, "accountsClosed": 1 }
```

**Breaking (staff screen only), 10 October 2026:** `suppressionsRemoved`
became `suppressionsHashed`, and `invitesWithdrawn` was added.

Addresses are matched regardless of capitals. What goes: names, emails, phone
numbers, the guest's own free text (guest-book message, dietary note, song
request, drink preference), their dietary tags and every answer to the host's
questions — special-category data that could point at them (decided 9
October 2026) — their
Telegram and push connections, every message sent to them on any channel —
body and address — with anything still queued stopped, and the invitation
token, which is itself identifying and would otherwise still open their RSVP
from a group chat. An account with that address is closed: it can no longer
sign in, its sessions are revoked and stripped of IP address and browser, and
its name and email are replaced. Pending team invitations to the address are
withdrawn. Private drawings/gallery files are revoked and queued for durable physical cleanup; legacy signature files are deleted after commit. The address is
dropped from the staff audit trail, and the guest's invitation views are
unlinked from them — these three after the database has committed.

**Do-not-contact records are kept, as a hash** (decided 10 October 2026): a
bounce or complaint still blocks the address if a host re-adds it, but the
record no longer holds it. Every organization whose events held the person
also gets an `ERASED` record, which stops that host importing or messaging
them again; other hosts are unaffected.

A household whose name still names them becomes `Household` and a number —
`Household 3` — as does one whose every member is erased (its notes are then
cleared too). "Anna & Davit" is renamed when Anna is erased; "Hakobyan
family" keeps its name while a remaining guest could be a Hakobyan.

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
event, its draft invitation and the caller's event role in one request, because
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
`sideALabel` / `sideBLabel`, `visibility`, `templateKey`, and optional
`templateVersionId`. Selection is limited to active shared or same-organization
private templates and uses that exact immutable version's defaults and block
order. A supplied version must still be active. Unknown, foreign, retired or
stale selections return `404`.

**The slug is generated, not chosen.** It reads as the hosts' names where they
are URL-safe and falls back to `event-<random>` otherwise — an Armenian title
contains nothing URL-safe, so that is the normal case, not the edge one. Two
events with the same hosts get different slugs. There is no endpoint to choose
a custom slug yet.

**`403` means the account has no organization, or its role there cannot
write events** — an organization `MEMBER` or `VIEWER` is read-only.

Event creator ownership uses the membership in the event's organization only;
roles elsewhere never grant ownership here.

Additional organization create/join writes remain disabled until the controlled
compatibility cutover. Explicit selection is already supported; see organization
selection above.

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
back `null` and `POST /events/:id/invitation` adds one later, accepting the same
optional template key/version. Both paths keep their `201` response and return
additive `templateSetup:{state:"PROCESSING",materializationId}` when private
artwork needs preparation. They reserve durable jobs in the same transaction;
no file copy occurs inside it. The invitation stays DRAFT and publishing returns
`409 TEMPLATE_ASSET_NOT_READY` until the worker binds every exact-version copy.
A retry of invitation recovery cannot create a second invitation or preparation.

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
§Rendering blocks. The guest page's `VENUE` and `MAP` data leave out `PREPARATION` venues and
venues only internal timeline entries use (decided 10 October 2026); timeline
entries at the same minute follow `sortOrder`. On this call `variant: null`
resets the layout to the template's default.

### Previewing a template

```http
GET /api/v1/events/:eventId/design-templates/:templateKey/preview?locale=fr
GET /api/v1/invitations/:slug/template-preview?templateKey=classic&locale=fr
```

Both require `invitation:read` for the event and return `Cache-Control: private,
no-store`. Render these with the same frontend invitation renderer used for a
live page. The response has the live page's content shape plus `isPreview: true`
and `previewSource: "SYNTHETIC" | "EVENT"`; `guest` is null and
`isAcceptingResponses` is always false. Disable response submission and guest
tracking in the preview UI.

The catalogue route uses only synthetic en/ru/fr/hy content, including sample
venue/timeline data. It never copies customer data. The event route accepts
drafts and defaults to the selected template when `templateKey` is omitted.
Locale negotiation and fallbacks match a live page. Previewing the selected
template retains the host's theme; another template starts from its defaults,
matching a real template switch. Unsupported/disabled blocks are omitted and
unoffered variants fall back to null. Only guest-facing venues/timeline and
same-event public media are hydrated. Guest contacts, personal links,
attendance, seating, answers and private signature assets are excluded.

Preview reads never change the template, blocks, theme, publication or RSVP
state, never use the public page cache, and do not record invitation views.
Unknown/inactive templates return 404. Actual visual rendering and all-language
browser acceptance remain frontend work.

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

### Invitation lifetime and expired access

First publication captures a lifetime policy. Without an ACTIVE
subscription whose period end is still in the future, the free fallback is
**90 elapsed UTC days after `endsAt`, or `startsAt` when no end is set**. An
eligible subscription captures its plan's duration (`null` means indefinite).
This does not activate paid billing. Later plan/catalogue changes and
close/reopen preserve the captured policy; event-date corrections recompute a
finite deadline from that policy.

Publish/close/reopen results, the host event's `invitation`, and the authorized
draft response's invitation metadata include:

```json
{
  "expiresAt": "2027-01-23T16:00:00.000Z",
  "firstPublishedAt": "2026-10-19T09:00:00.000Z",
  "lifetimeDays": 90,
  "lifetimeSource": "FREE_DEFAULT",
  "lifetimePlanKey": null,
  "isExpired": false
}
```

All capture fields may be null before publication. `PLAN` records the captured
plan key; `LEGACY` preserves a previously published invitation's existing expiry,
including indefinite access, without inventing a first-publication date. Such
rows require operator review. A null deadline means no scheduled expiry.

At `now >= expiresAt`, generic/personal invitation pages, guest RSVP reads,
name editing, gallery, acknowledgement and private guest file access return 404;
RSVP submission returns 400. Telegram opt-in cannot reactivate an expired link.
Sending or manually reminding an expired invitation returns 400; automatic
reminders skip it, and queued invitations/reminders recheck availability before
dispatch. Host event/draft access and retained RSVP, seating, signatures and
photos remain authorized normally. Expiry neither deletes data nor archives the
event. Reopening an expired invitation preserves the expired deadline.

Both invitation GET routes return `Cache-Control: private, no-store`, including
expired responses, so browser/proxy caching cannot bypass availability checks.
Personalized pages cache their guest/household/attendance/seating projection
separately from shared content on the server. Live Postgres checks before and after loading
still enforce token validity, visibility, erasure, expiry and committed revisions.
A concurrent edit triggers a retry; sustained changes may return 409 with
`Invitation changed while loading; please retry`. Retry the read. Redis outage
falls back to Postgres. Raw capabilities and generated token-bearing links are
excluded from cache keys and projections. No frontend cache may bypass guest
availability checks.

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

**A draft or expired invitation is refused** with a `400` (drafts must publish first): the link resolves
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

**Telegram can never be first contact** — a bot cannot message anyone who
has not started a conversation with it. So the invitation goes by the best
channel the guest already has (email for most; SMS for a guest with only a
phone, once a provider exists), and the sequence is: invitation → guest taps
the Telegram link → reminders, confirmations and updates go to Telegram.

**The link is already in place.** When a bot is configured, Aveline's
invitation email ends with a "Prefer Telegram?" line carrying the guest's own
`https://t.me/<bot>?start=<guestToken>`, and the personalised invitation
carries it as `guest.telegramLink` (`null` without a bot) — show it as "get
updates on Telegram". Telegram copy exists for invitations, reminders,
confirmations, detail changes and thank-yous (decided 10 October 2026).
WhatsApp is not chosen until Meta-approved templates exist for it.

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

**No reminder until a household has had its invitation for 3 days** — 1 day
if the event is under a week away (decided 10 October 2026). `recentlyInvited`
counts those skipped for that reason. **At most one reminder per household per
day**, counting the scheduled ones too. Pressing twice is safe, and following up again tomorrow still works. `alreadyRemindedToday` is how many
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
    "sentAt": "2026-10-05T18:02:11.000Z",
    "deliveredAt": null, "readAt": null, "deliveryFailedAt": null,
    "deliveryErrorCode": null, "deliveryFailureKind": null
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

**Additive receipt fields (19 October 2026):** `deliveredAt`, `readAt`,
`deliveryFailedAt`, `deliveryErrorCode` and `deliveryFailureKind` are nullable.
WhatsApp reads keep `status: DELIVERED` and populate `readAt`; an absent read
receipt is not proof the message was unread. Receipt failure classes are
`CONFIGURATION`, `TRANSIENT`, `AMBIGUOUS`, `UNKNOWN`. Display localized labels
for these classes; raw provider descriptions are never exposed. Delivery/read
proof wins over late sent/failed callbacks. An asynchronous failure becomes
`FAILED` and does not automatically resend or globally suppress the guest.

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

`type` is `TEXT`, `LONG_TEXT`, `SINGLE_CHOICE`, `MULTI_CHOICE`, `BOOLEAN` or `SIGNATURE`. SIGNATURE creates a current `statementVersionId` for private typed/drawn acknowledgements. `prompt` is translated (`{ "hy": "...", "en": "..." }`) and must
carry at least one language. `options` is translated too
(`{ "hy": ["Միս", "Ձուկ"] }`) and is **required for the choice types** — a
choice question with no choices cannot be answered, so it is a `400`. Every
language must offer the **same number of choices**, since an answer is a
position.

New questions go last; `sortOrder` comes back on each. At most 1000 questions
are supported per invitation. To reorder them in one atomic call:

```http
PATCH /api/v1/invitations/:slug/question-order
      { "questionIds": ["second-id", "first-id"],
        "expectedOrder": ["first-id", "second-id"] }
```

Needs `invitation:design`. Send every current ID exactly once in `questionIds`,
in display order; `expectedOrder` is the ID order originally read from the
questions or design response. Duplicate, missing or foreign IDs return 400.
If a question was added/removed or another organizer changed its order, return
409 and reload before retrying. Rejection changes nothing. The response is the
ordered question array with zero-based `sortOrder`. Answers retain their stable
question IDs; option positions, required flags and copy are untouched.


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
`longitude?`, `capacity?`, `notes?`, `vendorId?`), and `PATCH /venue-profiles/:profileId`
corrects one or retires it with `isActive: false` — it disappears from the
list hosts see, and venues already copied from it keep their copy. Hosts
cannot write to it: every customer reads the same directory.

A directory hall may link to one active **curated VENUE** vendor using
`vendorId`; one vendor may operate several halls. `PATCH { "vendorId": null }`
unlinks just that hall. Private organization vendors, inactive/wrong-category
vendors and unknown IDs return 400. Event venue copies retain their data.
Host directory reads include `vendorId` and `vendor: { id, name }` (both null
when the linked operator is no longer eligible); private contacts/notes never
appear there. Vendor directory entries add `venueProfiles: [{ id, name, city,
capacity }]` for active halls. The former `venueProfile: { city, capacity }`
remains as a compatibility summary of the first hall by name/id; new clients
should use the collection.


`DELETE` is refused with a `400` while timeline entries or tables still point
at the venue, naming how many — the cascade would otherwise detach a running
order from where it happens.

Reading needs `event:read`; writing needs `event:write`. Design calls need
`invitation:design`, which a `DESIGNER` has.

### Uploading a file

```http
POST /api/v1/events/:eventId/media        # multipart/form-data, field "file"
```

Optional multipart field `kind` is PHOTO, COVER, LOGO or AUDIO. Without it,
images default to PHOTO and audio to AUDIO. Explicit kind is honored: LOGO and
COVER are images; AUDIO must be audio. Type/kind mismatch, unknown kinds,
DOCUMENT and SIGNATURE return 400 before storage. Attachment rules still apply:
MUSIC accepts audio only; other blocks accept PHOTO/COVER/LOGO images only.

JPEG, PNG, WebP, AVIF, MP3, M4A. Max 10 MB. Wrong type → `415` — SVG
included, since it can carry script (decided 10 October 2026) — too
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
`["HERO"]`. `listingUses` lists `"HERO"` and/or `"SHARE"` when selected on the
announcement (empty otherwise). Generated exports are not in it; they are under `/exports`.

`PATCH` (needs `invitation:design`) sets alt text one language at a time: a
language sent replaces that one, `null` removes it, the rest are kept. Each
value is text up to 300 characters — a `400` starting `altText:` otherwise.
Guests receive it already resolved to their language, as `media[].altText`.

`DELETE` (needs `invitation:design`) removes the upload and its file. It is
refused with `409` while a block shows it, naming the block — take it off
there first, with `PATCH /invitations/:slug/blocks/:type`. Listing hero/share
references also prevent deletion; clear them through the listing edit first.

**Photos are resized after upload, in the background.** Within about a minute
each JPEG, PNG, WebP or AVIF photo gains smaller WebP copies at 480, 960 and
1600 pixels wide — only those narrower than the original — turned upright from
the phone's orientation tag. Media on the guest page, in the editor and in the
library then carry `width`, `height` and `variants`
(`[{ width, height, url, sizeBytes }]`). **Build `srcset` from `variants` and
fall back to `url`**: until the copies exist, `variants` is `[]`.
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
For a linked ticket, either the ticket scanner or guest-list check-in writes
one `CheckIn` and marks the ticket `USED` with the same timestamp, atomically.
The ticket response also includes `guestId` (null for an unlinked legacy ticket).
Guest-list check-in refuses void/refunded tickets and orders frozen for
cancellation. Explicit guest check-in undo restores an active paid ticket to
`VALID`; attendance-policy changes never undo admission.

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
POST /api/v1/payments/:orderNumber/refund    # Aveline staff (platform ADMIN); not for tickets
# a refund the bank does not answer is a 502 "outcome unknown"; it is never retried automatically
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

### Not for the browser: Meta WhatsApp receipts

```http
GET  /api/v1/communications/whatsapp-webhook
POST /api/v1/communications/whatsapp-webhook
```

These public routes authenticate Meta, not a host session. Never expose their
secrets in the frontend. GET requires `hub.mode=subscribe`, a matching
`hub.verify_token`, and bounded `hub.challenge`; it echoes the challenge as
plain text with `200` and `Cache-Control: no-store`. A wrong token is `401`;
unconfigured verification is `503`.

POST requires `X-Hub-Signature-256: sha256=<hex HMAC-SHA256>` of the exact raw
request bytes keyed by the Meta app secret. It accepts native
`whatsapp_business_account` JSON, scoped by `entry[].id` and
`changes[].value.metadata.phone_number_id`, for `messages` statuses only.
Supported outcomes: `sent`, `delivered`, `read`, `failed`. Inbound messages,
other accounts/senders/fields and unknown future statuses are ignored. Limits
are 3 MiB, 1,000 entries/total changes/total applicable statuses, and a 512
character provider reference. Timestamps are Unix seconds; invalid or more
than five minutes future times are rejected, but old retries remain valid.

`200 { "accepted": true }` means normalized receipts committed to Postgres,
not that application has finished. Forged signatures are `401`, malformed
payloads/fields are `400`, oversized bodies are `413`, compressed bodies are
`415`, absent signing/scope configuration is `503`, and database failures are
non-200 so Meta can retry. Standard public throttling still applies. The
route-specific larger body limit does not change other APIs.

Normalized receipts contain only account/sender/provider IDs, status, clocks
and numeric error code. Duplicate identities are idempotent. A minute sweep
processes at most 200, five transactions at once; unknown references rotate
fairly, waiting up to seven days for acknowledgement/correlation. Processed
metadata expires after thirty days. Matching requires WHATSAPP, the recorded
account, sender and provider reference; old unscoped messages stay unmatched.
Late callbacks do not mutate erased contacts. No WhatsApp receipt creates a
global suppression; account/template errors and ambiguous delivery are not
proof of an address hard bounce or unsubscribe.

All six WhatsApp settings are required together once any is enabled in
production, including an explicitly selected API version. See
[WHATSAPP_SETUP.md](../backend/docs/WHATSAPP_SETUP.md) for configuration,
external approval and real provider acceptance gates. No Meta account/test
number is available yet; local payload tests do not close the launch gate.

### Not for the browser: normalized email feedback

```http
POST /api/v1/communications/email-feedback
```

This is a provider-neutral boundary for a **trusted server-side adapter**, not
a native provider webhook and not a host/guest API. No provider adapter has been
selected. Never put its signing secret in the client. When
`EMAIL_FEEDBACK_SECRET` is unset, ingestion answers `503`.

Send a JSON object with `receiptKey` (unique opaque key, 1–120 ASCII letters,
digits, dot, underscore, colon or hyphen), `messageId` (internal Message id,
1–80 letters/digits/underscore/hyphen), `outcome` (`DELIVERED`, `HARD_BOUNCE`,
`SOFT_BOUNCE`, `COMPLAINT`) and `occurredAt` (ISO 8601 UTC ending in `Z`).
Do not include recipient addresses, message bodies or native provider payloads.
SMTP carries the internal id in `X-Aveline-Message-Id`; the eventual adapter
must verify its provider's own authentication and preserve/correlate that id.

Headers: `x-aveline-feedback-timestamp` is current Unix seconds, and
`x-aveline-feedback-signature` is the hex HMAC-SHA256 of
`timestamp + "." + exact raw JSON bytes`, keyed by the secret. The timestamp
must be within five minutes of the server. Invalid authentication is `401`,
invalid fields/body size (maximum 16 KiB) are `400`, and accepted input returns
`202 { "accepted": true }`. Standard public throttling still applies; retry
with backoff and a newly signed current timestamp.

Repeated receipt keys are idempotent. Delivery never overrides a permanent
bounce/complaint. Soft bounces record the outcome without suppressing the guest
or re-sending a provider-accepted message. Hard bounces/complaints suppress
future sends globally; a later weaker report cannot downgrade the reason.
Late feedback never reconstructs erased addresses. Early/unmatched receipts
are reconciled every minute, least-recently checked first, for at most seven
days. Processed receipts expire after thirty days.

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

`ready` returns `"status": "ok"`, or `"degraded"` when Redis, Mongo or storage is down
— **degraded is still serving**: those outages cost latency and analytics,
not correctness. With Postgres down nothing is served, so it answers `503`
(`"status": "unavailable"`), which the container healthcheck acts on.

The response names `required.postgres` and `optional.redis`, `optional.mongo`,
`optional.storage`; each has `isUp`, `latencyMs`, and an error when unreachable.
Storage failure affects media operations even though domain reads remain ready.

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
  it is never chosen until one is. Email and Telegram are delivered; WhatsApp
  is built but has no approved templates yet, so it is never chosen.
- **WhatsApp live acceptance.** Signed, scoped delivery/read/failure ingestion is
  built. Account/app/test number, template approval, real callback/subscription
  proof and frontend acceptance remain; see the
  [setup checklist](../backend/docs/WHATSAPP_SETUP.md).
- **Nothing enforces plan entitlements.** They are published on `/plans` and on
  the subscription, but the server will not refuse a fourth event on a
  three-event plan.
- **No tax on invoices.** `taxMinor` is always `"0"`.
- **No renewal or dunning.** A subscription's period lapses and nothing
  charges again or moves it to `PAST_DUE`.
- Additional memberships require the controlled schema/runtime cutover and shared write gate. See organization selection.
- **No block creation outside the arrangement call.** Custom RSVP questions can be reordered atomically through the question-order route.
- **Worker/frontend acceptance.** Automatic seating and all export formats run
  in dedicated workers. Frontend job integration, standard heading/reason
  translations and production rehearsal remain.
- **A native email feedback adapter.** Normalized signed delivery/bounce/complaint
  ingestion is built; no provider has been selected or connected. Ordinary
  bounce emails arriving in a mailbox are still not parsed.

The authoritative list is [GAPS.md](../backend/docs/GAPS.md), and
[GOING_LIVE.md](GOING_LIVE.md) is what blocks production.

## 11. Private acknowledgements and guest gallery

Guest routes require a personal invitation capability. Generic invitation,
preview, buyer order and ticket-code links do not authorize them. Draft, erased,
unknown and expired links return 404; CLOSED invitations remain readable.
Keep capability URLs out of analytics and set `Referrer-Policy: no-referrer` on
the frontend. File responses use `private, no-store` and `nosniff`. Processed image reads share the guest-page read allowance (50/second, 3,000/minute per caller/address), so a gallery page can load its thumbnails; handle 429 with a delayed retry. Uploads and other actions keep the normal mutation limits.

```http
GET  /api/v1/invitations/:slug/g/:guestToken/acknowledgements?limit=30&after=recordId
POST /api/v1/invitations/:slug/g/:guestToken/acknowledgements
```

GET returns `{ statements, records, signatureUploads, nextCursor }`; `signatureUploads` contains up to 20 of your active signature uploads with processing status and fixed failure codes. Each current SIGNATURE statement
contains `questionId`, `statementVersionId`, `required`, resolved `prompt` and
`locale` (published language to send when signing), and `statementLocale` (the actual fallback text language); records contain the subject and actual signer IDs, `signerName`, method,
representative declaration, exact rendered statement/locale, mediaId or null,
version and server timestamp. History is limited to the guest's own signed records
and subjects currently in their household. Each record is immutable; a retry of
identical intent returns the same ID. Pagination is newest first, default 30,
1–100; a cursor outside this visible collection returns 404.

```json
{ "statementVersionId": "current-version", "subjectGuestIds": ["self-id", "household-member-id"],
  "method": "TYPED", "signerName": "Anna Example", "isAcknowledged": true,
  "isRepresentative": true, "locale": "en" }
```

POST returns `{ records }` with status 201 and does not change attendance. Supply
1–21 unique subjects from the signer's current household. A representative must
explicitly set `isRepresentative: true` for other subjects; their names are never
recorded as the actual signer. `signerName` is trimmed, 1–200 characters; locale
must be an event language. No implied acknowledgement from a purchase or host
RSVP entry. TYPED takes no image; DRAWN requires `assetId` from the signer's own
READY signature upload on this event. Forged/unready assets or subjects return
400. Old statement versions return 409: reread, display the current text and
ask for a new acknowledgement. Prompt changes, including translations, create
an immutable new version; old records keep the text and language actually used.

The same object **without `subjectGuestIds`** can be a SIGNATURE custom answer in
guest RSVP `answers`, `members[].answers` or `party[].answers`. The response stores
an acknowledgement reference, rather than an image URL. Required statements must
have current acknowledgements for every affected attending guest, including new
plus-ones; an incomplete submission rolls back attendance and all its writes.
Existing standalone acknowledgements count. Required current acknowledgements
also gate both guest check-in and ticket admission, including legacy reconciliation.

```http
POST   /api/v1/invitations/:slug/g/:guestToken/signature-uploads
GET    /api/v1/invitations/:slug/g/:guestToken/signature-uploads/:mediaId/file
DELETE /api/v1/invitations/:slug/g/:guestToken/signature-uploads/:mediaId
GET    /api/v1/invitations/:slug/g/:guestToken/acknowledgements/:acknowledgementId/file
```

Upload one multipart `file` (PNG/JPEG/WebP/AVIF, at most 1 MiB) and receive private
media metadata in QUEUED state. Poll `acknowledgements.signatureUploads` for READY/FAILED, then fetch the preview; pending/failed/unavailable files return 404. The worker validates raster
bytes, rejects animation/over 4 million pixels, strips metadata and emits PNG at
most 2048px per side and 1 MiB. Preview is owner-only; acknowledgement file reads
also permit the record's authorized household subjects. DELETE removes an unclaimed
upload; a drawing used by an acknowledgement returns 409 and requires the privacy
request process. Unclaimed drawings are reclaimed after 24 hours. Technical
signature limits: 20 active uploads per guest, 5,000 per event and 2 GiB reserved
storage per event, separate from gallery storage.

Ticket checkout excludes SIGNATURE from the buyer's questions and returns
`acknowledgementsRequiredBeforeCheckIn: [{ questionId, prompt }]` in checkout
metadata. Checkout still collects every attendee and completes before signing.
A minute sweep queues a personal-link email to each valid, paid ticket guest with
an email address (four-language `ticket.acknowledgement` copy). It recovers missing
outbox entries and deduplicates per ticket/person. It rechecks the recipient,
paid/valid ticket and invitation availability immediately before dispatch. The
buyer response never reveals attendee guest tokens. For attendees without email,
failed/suppressed delivery or later statement/contact changes, the host must use
the existing personal invitation send/share workflow; the door gate still applies.

```http
GET    /api/v1/invitations/:slug/g/:guestToken/gallery?limit=30&after=mediaId
POST   /api/v1/invitations/:slug/g/:guestToken/gallery
GET    /api/v1/invitations/:slug/g/:guestToken/gallery/:mediaId/file?variant=thumbnail
DELETE /api/v1/invitations/:slug/g/:guestToken/gallery/:mediaId
```

Gallery POST accepts one multipart `file` and optional `caption` (trimmed, at most
500 characters). Allowlisted PNG/JPEG/WebP/AVIF, maximum 10 MiB; SVG is refused
and spoofed raster content fails in the worker. Limits: 20 active photos per guest,
1,000 per event and 2 GiB per event, including originals and derived files.
Reservations include worst-case derivative bytes (2.5 MiB per queued photo), so
available capacity may be lower during processing. Count/storage contention returns
409; oversized uploads return 413; unsupported MIME returns 415; storage outage
returns 503. Removed bytes remain reserved until cleanup succeeds.

GET returns `{ items, nextCursor, limits }`. Items contain `id`, kind,
processing/moderation status, caption, dimensions, timestamps, fixed failure code
or null, and `isOwn`. No storage keys, original filename, public URL or other
guest's contacts/IDs. Guests see their own pending/rejected items and other
READY+APPROVED photos only. JPEG orientation is applied; EXIF/other metadata is
stripped. Maximum 40 million input pixels, static images only. The separate worker
emits WebP display (2048px, at most 2 MiB) and thumbnail (480px, at most 512 KiB).
`variant` is display (default) or thumbnail. Ordinary reads never return originals.
A guest can DELETE only their own gallery photo, including after approval.
Removal revokes access immediately; durable cleanup deletes physical files later.

```http
GET    /api/v1/events/:eventId/acknowledgements?limit=30&after=recordId
GET    /api/v1/events/:eventId/acknowledgements/:acknowledgementId/file
GET    /api/v1/events/:eventId/gallery?limit=30&after=mediaId
PATCH  /api/v1/events/:eventId/gallery/:mediaId
GET    /api/v1/events/:eventId/gallery/:mediaId/file?variant=display
DELETE /api/v1/events/:eventId/gallery/:mediaId
```

Host acknowledgement history/files require `guest:contact:read`; gallery moderation,
files/removal require `guest:write`. Designers have neither. Lists return
`{ items, nextCursor }`; pagination is the same as guest lists. PATCH accepts
`{ "moderationStatus": "APPROVED" }` or `REJECTED`; a photo must be READY and
still present, otherwise 409. Approval is required before other guests can see it.
Host data remains after guest expiry. Ordinary guest deletion refuses guests with
acknowledgement evidence; use a verified privacy request to erase it.

```http
GET /api/v1/privacy/requests/:requestId/guest-media/:mediaId/file
```

Staff `privacy:manage` only, for an identity-verified EXPORT request in IN_PROGRESS
or COMPLETED state and a file belonging to that subject (uploader, signer or
acknowledged subject). Returns the original as an octet-stream attachment; callers
must treat it as untrusted. Privacy JSON exports add `contributions` with records
and media metadata plus protected `fileDownloadPath` values. Erasure removes records
where the subject was signer or represented person, removes RSVP pointers, and
revokes uploader media immediately. `acknowledgementsErased` and
`privateMediaQueuedForDeletion` report the result; the durable media worker removes
originals and variants asynchronously. Event deletion leaves cleanup tombstones,
so interrupted workers cannot orphan private files. Pending frontend work includes
the four-language capture, moderation, pending/error states and ticket pre-check-in
flow; these backend endpoints alone do not satisfy pilot acceptance.

### Staff enquiry privacy substrate

Privacy request list entries may now have `subjectEmail:null` for a staff-recorded,
manually verified phone-only prospect; this is an intentional internal-console
contract change. Public request submission still requires a valid email and
remains non-enumerating. A verified privacy export adds `enquiries`; legacy
sections are empty for an email-less subject rather than querying a fabricated
address. Historical contact-address matches require staff-reviewed contact ID
binding before fulfilment. Erasure adds `enquiriesCleared` and
`enquiryNotesRedacted`; `recoveryPending:true` means redaction has committed but
protected journal acknowledgement remains pending and the request stays
IN_PROGRESS. Retrying fulfilment resumes the recorded checkpoint safely.

### Immutable invitation templates and controlled authoring

`GET /events/:eventId/design-templates` retains its array shape and legacy fields,
scoped to active shared and same-organization private versions. Entries add
`versionId`, `versionNumber`, `rendererKey`, `capabilityVersion`, `contentHash` and
`scope`. Existing event-only DESIGNER permissions remain valid. Current selected
retired versions remain readable through the design/current-preview routes.
`GET /invitations/:slug/design` adds `designRevision` as a decimal string and its
template contains the exact immutable `versionId`/`versionNumber`. Public legacy
invitation fields/values remain unchanged; no template catalogue edit upgrades an
event or changes its captured lifetime, attendance or acknowledgement history.

`POST /invitations/:slug/template-upgrade-preview` accepts
`{targetVersionId,expectedDesignRevision}` (revision is a decimal string), and
returns an expiring requester-bound `previewId`, source/target version/hash,
`changes` and synthetic-guest event `payloads` for event locales. It performs no
invitation mutation. Confirmation uses the existing `POST /invitations/:slug/template`
with `{templateKey,templateVersionId,previewId,expectedTemplateVersionId,
expectedDesignRevision,idempotencyKey}`; idempotency keys are UUIDs. Stale design,
expired preview, wrong requester or changed source pin returns 409. Confirmation
applies exactly the previewed version and transforms blocks atomically: unsupported
blocks are disabled with content retained; invalid variants reset to null; theme
resets only for a different immutable version. Event uploads are retained.
Legacy key-only selection remains available only for legacy baselines; repeating
the current key preserves its pin and never upgrades it. Authored selection needs
explicit preview/confirmation. Artwork-dependent adoption refuses unprepared
private artwork instead of returning broken or public source URLs.

Platform author API (`private, no-store`; no event membership is granted):

| Method | Endpoint | Request/result |
|---|---|---|
| POST | `/design-templates` | ADMIN: `{organizationId?,key?,definition}`; shared requires key, private forbids it and generates opaque key; inactive identity+first draft |
| GET | `/design-templates/:templateId` | ADMIN or assigned active SUPPORT: versions/open draft/asset status |
| POST | `/design-templates/:templateId/drafts` | `{expectedRevision}` opens one draft |
| PATCH | `/design-templates/:templateId/drafts/:draftId` | `{expectedRevision,definition}` merges only supplied definition fields |
| POST | `/design-templates/:templateId/drafts/:draftId/validate` | Field errors and `canPublish`/renderer acceptance status |
| POST | `/design-templates/:templateId/drafts/:draftId/preview` | Four-locale en/ru/fr/hy payload-only synthetic fixture and 15-minute receipt |
| POST | `/design-templates/:templateId/drafts/:draftId/publish` | ADMIN: `{expectedRevision,previewId,contentHash,idempotencyKey}` atomically allocates immutable version+receipt+active pointer |
| POST | `/design-templates/:templateId/retire` | ADMIN: `{expectedRevision}` disables future selection |
| POST | `/design-templates/:templateId/assignments` | ADMIN: `{expectedRevision,userId}` assigns active SUPPORT |
| POST | `/design-templates/:templateId/assignments/revoke` | ADMIN: `{expectedRevision,userId}` revokes assignment |
| POST | `/design-templates/:templateId/drafts/:draftId/assets` | Multipart: one raster file≤5MiB, PHOTO/COVER kind, expectedRevision, UUID idempotencyKey; 202 processing |
| GET | `/design-templates/:templateId/assets/:assetId/file` | Current authorized sanitized bytes; no redirects or storage URLs |
| DELETE | `/design-templates/:templateId/drafts/:draftId/assets/:assetId` | `{expectedRevision}` retires unreferenced artwork |

`definition` contains only `name`, `allowedFonts`, `palettes`, `supportedBlocks`,
`blockVariants`, `defaultTheme`, `rendererKey`. Arrays, strings, palettes and
nested keys are bounded; aggregate ≤64KiB. Unknown fields, remote fonts/URLs,
CSS/HTML/script/layout code are rejected. Published versions and frozen drafts
cannot be mutated. The backend seed ceiling is not renderer evidence. No
production manifest is approved yet, so publication fails closed with 503 even
when the publication flag is enabled. Renderer integration, named palette roles,
bundled fonts, all four languages, inert preview and mobile/desktop visual
acceptance remain a frontend release gate. See the
[capability contract](contracts/invitation-renderer-capabilities/README.md).

Staff intake routes are implemented under disabled rollout gates. Conversion
remains separately gated. All intake responses use `Cache-Control: private,
no-store`; command headers are redacted from request logging.


### Staff enquiries and consultation appointments

`POST /sales/enquiries` takes `{contact:{name,email?,phone?},requirements?:{
eventType?,approximateLocalDate?,approximateTimezone?,estimatedGuestCount?},
preferredLocale?,source?,assignedUserId?}`. Name and at least one email/explicit
E.164 phone are required. SUPPORT must omit assignment and becomes assignee;
ADMIN may supply an active staff ID or null. Phone-only contact is valid.

All writes require an 8–128 printable-ASCII `Idempotency-Key`. Existing-case
writes include positive `expectedRevision`. A successful command returns
`{commandId,appliedRevision,resultId?,enquiry}` with the *current authorized*
projection; replay never returns a stored old response. Same key with changed
intent gives `IDEMPOTENCY_CONFLICT`; stale revision gives `ENQUIRY_CHANGED`.
Current assignment is checked before replay, so former assignees receive 404.
Cleared command intents stay spent with `SUBJECT_ERASED`.

`GET /sales/enquiries` supports stage, search (exact normalized email/phone or
case-insensitive name prefix), limit 1–100 (default 50) and opaque cursor bound
to filters and actor. It returns `{items,nextCursor}`. Detail
`GET /sales/enquiries/:enquiryId` includes contact, linkage, latest 20 notes,
activities and consultations with each section's continuation cursor, recovery
states and permissions. Section GET suffixes `/notes`, `/activities`,
`/consultations` accept the same bounded limit/cursor convention. All reads are
staff-only; customer membership in a linked organization grants no case access.

`PATCH /sales/enquiries/:enquiryId` accepts contact/requirements/preferredLocale/
source plus expectedRevision; omitted fields remain unchanged and explicit null
clears optional fields only. `POST .../assignment` is ADMIN-only with
`{expectedRevision,assignedUserId:null|staffId}`. Existing consultation operators
remain booked after reassignment; the activity records appointments needing
review. `POST .../stage` takes `{expectedRevision,stage,closureReason?,closureNote?}`;
any stage may be skipped, CLOSED requires a reason, and same stage yields
`NO_CHANGE`. Reopening pauses six-calendar-month cleanup; it never restores
cleared data. `POST .../notes` takes `{expectedRevision,body,consultationId?}` and
appends a note (1–10000 characters); corrections are new notes. All such commands
return 200; create returns 201.

`POST /sales/enquiries/:enquiryId/consultations` takes expectedRevision,
operatorUserId, startsAt, endsAt and timezone. UTC timestamps require an offset;
duration is 5 minutes–8 hours. SUPPORT schedules only themselves, ADMIN any
active staff operator. PATCH at `.../consultations/:consultationId` additionally
requires expectedConsultationRevision and accepts omitted unchanged scheduling
fields or status COMPLETED/CANCELLED; terminal appointments require a new row.
Atomic same-operator overlap gives safe `CONSULTATION_CONFLICT` (409), without
another case's identity. Adjacent intervals are allowed. `GET
/sales/consultation-availability?operatorUserId=...&from=...&to=...` allows <=31
days and returns `{operatorUserId,busy:[{startsAt,endsAt}]}` with no enquiry IDs.
It is advisory; writes enforce PostgreSQL exclusion. Consultation transitions
send no automatic messages.

`POST /privacy/enquiry-requests` is ADMIN-only and records `{kind,contactIds,
notes?}` (1–100 distinct IDs) with null email and unverified candidate subjects.
After the existing identity verification status workflow, `PUT
/privacy/requests/:requestId/enquiry-subjects` takes reviewed contactIds and a
verificationNote (evidence reference, no copied phone). Exact candidates are
obtained by ADMIN-only `POST /privacy/enquiry-subject-candidates` with email or
E.164 phone in the body. Binding requires verified IN_PROGRESS and cannot change
a request once erasure is applied. No public phone search exists.

`POST /sales/enquiries/:enquiryId/conversion` requires expectedRevision, an
explicit `organization:{existingId}` or `organization:{create:{name,kind?,
ownerEmail,ownerEmailSource?}}`, and optional `event:{existingId}` or
`event:{create:<CreateEventDto>}`. Exactly one target form is accepted for each.
Owner email is explicitly supplied; `ownerEmailSource:PRIMARY_CONTACT` additionally
requires it to match the current primary contact and records erasure provenance.
Omitted source means independent owner data. Phone-only enquiries need no
fabricated event time or owner email until staff explicitly request new setup.
Existing events must be DRAFT and belong to the selected organization; their
fields are unchanged. A selected organization header must agree with the body.

Conversion creates no payment, booking confirmation or staff membership. It
returns the normal command envelope plus `conversion` linkage IDs. First setup
returns 201; an existing-link replay or explicit later add-event returns 200.
An organization-only link may gain one event later; an existing event link
cannot be replaced. Concurrent retries produce one setup and one owner
invitation. Existing memberships and valid pending owner invitations are reused;
ambiguous or expired pending setup requires explicit organization selection and
staff review. An expired/lost invitation is never silently rotated by replay.
Account invitation hash and rendered Message commit together; missing message
template rolls the complete setup back. Detail recovery states distinguish
QUEUED/NEEDS_REVIEW/CANCELLED without exposing invitation credentials. The
organization-invitation pre-send check rejects withdrawn, expired, accepted or
privacy-invalid source invitations. Consultation messages remain manual.
F44 inventory/artwork additions:

| Method | Endpoint | Request/result |
|---|---|---|
| GET | `/design-templates` | `{items,nextCursor}`; cursor query; 50 rows, assigned SUPPORT inventory only |
| POST | `/design-templates/:templateId/drafts/:draftId/discard` | `{expectedRevision}` freezes the discarded draft and queues unreferenced transient cleanup |
| PATCH | `/design-templates/:templateId/drafts/:draftId/artwork` | `{expectedRevision,artwork:[{slot:'HERO'|'GALLERY',assetId}]}` replaces ordered defaults; max20, one HERO, same-template AVAILABLE assets and tested slots only |
| GET | `/invitations/:slug/template-upgrade-previews/:previewId` | Requester-bound ready preview or processing state; expired/stale context409 |
| GET | `/invitations/:slug/design-assets/:assetId/file` | Live PUBLIC/UNLISTED invitation/pin-authorized private bytes |
| GET | `/invitations/:slug/g/:guestToken/design-assets/:assetId/file` | Live guest capability and current pin required |
| GET | `/events/:eventId/design-assets/:assetId/file` | Authenticated invitation:read, bound or ready-preview event copy |
| GET | `/events/:eventId/design-templates/:templateKey/assets/:assetId/file` | Authenticated event catalogue sample, shared/same-org published source only |

A preview needing artwork returns202 `{previewId,state:'PROCESSING',expiresAt,
pollUrl}`; polling supplies the normal complete ready preview after the separate
worker prepares event-owned private copies. The final confirm is still one atomic
intent; no network/storage work occurs under its database locks. Initial event
creation retains its201 event response and may add setup state; its DRAFT cannot
publish until required default artwork is BOUND. Publication/retirement never
rewrites existing invitations. Removing an event override reveals its immutable
version default; disabling its block hides both. No source storage URLs/redirects
are issued. Guest-specific file paths are projected only after shared-cache reads.

New AUTHORED payloads add `templateVersion:{id,rendererKey,capabilityVersion,
capabilityDigest,contentHash}` and `resolvedTheme:{headingFont,bodyFont,
palette:{name,roles}}` from the immutable reviewed manifest. Legacy fields/values
are unchanged and no positional roles are invented for old palettes. Theme edits
cannot name unmanifested fields or provide fewer custom colors than required roles.
Verified DSAR export adds `templateAuthorship` with only the subject's factual
identity links; account closure revokes assignments/previews/unbound worker access,
retaining immutable design/version history and other events' artwork.

Accepted owner accounts require additional identity review for a staff enquiry
ERASURE request. Contact binding alone, including a shared contact email, does
not authorize account closure. The binding response adds
`ownerAccountCandidates:[{id,email}]`, limited to accepted owner IDs reached
through the bound contacts' explicit PRIMARY_CONTACT invitation provenance.
A separate owner remains outside that scope. To include an accepted account,
ADMIN supplies `verifiedOwnerUserId` and `ownerVerificationNote` with distinct
identity evidence. The ID must match the exact accepted owner. The request then
stores that account's real verified email and uses the existing verified email
erasure path; no address is fabricated from a phone number. Missing or changed
owner proof keeps the request IN_PROGRESS. Distinct candidate accounts require
separate explicitly reviewed subject scopes.

`POST /privacy/enquiry-subject-candidates` takes exactly one email or E.164 phone,
plus optional `limit` (1–100, default 50) and opaque `cursor`, and returns
`{items,nextCursor}`. Review every relevant page; shared addresses remain
candidates and do not merge people. Binding calls accept at most 100 contact IDs.
After the first verified replacement binding, `append:true` adds another reviewed
batch without dropping earlier subjects; the request can therefore include more
than 100 reviewed cases. Rebinding replaces account verification unless it is
explicitly restated, and every batch needs its verification evidence reference.
Erasure and export act on the complete bound scope, never only the latest page.

A successful conversion key replays its current authorized case projection even
after the selected template retires or the linked event becomes published.
Receipt lookup is followed by live case/staff authorization before any setup
preparation. Erased receipts remain spent with SUBJECT_ERASED, and reassignment
immediately removes the former operator's replay access. New conversion intents
still validate current organization, template and draft-event targets.
Private template author requests also validate `X-Aveline-Organization-Id` against
the explicit body/resource owner using the shared organization resolver; a stale
selector returns `ORGANIZATION_CONTEXT_MISMATCH` before any write. Assignment and
current staff authority remain separate checks. Matching adoption receipt retries
return the original successful result even if the target has since been retired;
current event authority and tenant scope are still required. A frozen existing
draft returns409 state change; an unknown draft returns404.

Matching raster-upload retries reuse the original ledger/object and do not advance
the draft revision; matching receipt replay is also valid after that draft freezes.
Concurrent event-copy completions serialize on the materialization row before
asset locks so a ready set cannot remain stuck in processing.

An unrecoverable event-copy failure polls as `{state:'FAILED',
code:'TEMPLATE_ASSET_INVALID',action:'REGENERATE'}`. It never selects the target
pin or exposes partial files; transient event copies are retired for cleanup.

New authored defaults must explicitly resolve a bundled font and named palette or
complete custom colors. Publication/adoption retry only PostgreSQL serialization
or deadlock rollbacks, at most three attempts with the original dedupe intent;
retry exhaustion returns a recoverable409. Explicit legacy switching retires prior
private artwork bindings atomically while retaining reusable immutable source art.
