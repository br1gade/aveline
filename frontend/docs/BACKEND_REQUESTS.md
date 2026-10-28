# Backend requests

> **Status: open register, not yet triaged.** Created on 18 October 2026 from the setup proposal
> §16 and the design questions in [design/DESIGN_DECISIONS.md](design/DESIGN_DECISIONS.md) §5.
>
> How it works (setup proposal §3.6): the frontend records a need here. The backend developer
> triages it into `docs/BACKLOG.md`, where it gets a B or F number, and the entry here is replaced
> by that link. The client never works around a missing endpoint permanently (root `CLAUDE.md`
> §2). A temporary stand-in is listed here with its exit.
>
> The backend developer could not answer when this file was created. Every entry is therefore
> **not triaged**, and the frontend proceeds on the provisional defaults named in each row.
>
> **Re-checked on 23 October 2026** against the backend's audit fixes: BQ-4 and BQ-9 are answered,
> FR-7 partly; FR-21 and BQ-11 are new. The rest of that pull (to `d23ff2d`) was checked the same
> day: BQ-5 and BQ-8 are answered, FR-3, FR-8 and FR-13 partly, and the backend's new production
> template bears on FR-10 and FR-11. FR-22 is new, and FR-23 came with the account pages the same
> day. The event screens, also that day, found FR-24 and FR-25, extended FR-20 to the event DTOs,
> and made FR-6 needed. The guest list, on 24 October 2026, found FR-26 to FR-31 and extended FR-6
> and FR-20 to the guest screens, against the backend at `d23ff2d`. The venue, publishing and
> sending screens, on 25 October 2026, found FR-32 to FR-36 and extended FR-6, FR-20 and FR-28,
> still against `d23ff2d`. origin/main had reached `eb77cd4` by then; §5 lists what it changes for
> the frontend, not yet pulled.

## 1. API and schema

| ID | Request | Screen it blocks | Meanwhile | Priority |
|---|---|---|---|---|
| FR-1 | **Response schemas for every operation in `openapi.json`.** None declares a success response today | Every screen: response types are hand-written and can drift | Interim `types.ts` per feature, marked "interim until FR-1"; end-to-end tests against the real backend | **Blocking** for typed responses |
| FR-2 | Declare security per operation: bearer, or public with `security: []` | The generated client cannot tell public calls from authenticated ones | `publicApi` and `appApi` chosen by hand | High |
| FR-3 | Stop declaring `user-agent` as a **required** header on login and refresh. *Register no longer declares it (23 October 2026), since it stopped signing in (D16)* | Sign-in: a browser cannot set it | Login and refresh send no `user-agent`, through one cast in `src/api/session/auth-calls.ts` that names FR-3 | High, small |
| FR-4 | Type translated fields (`name`, `prompt`, `label`, `content`) as locale-to-string maps | The designer and the editor | Interim types | High |
| FR-5 | `GET /me` | The app shell, onboarding, a "verify your email" banner | The `/app` home reads `GET /organizations/current` (403 means none) beside `GET /events`: no organization and no event sends a new account to create its organization. No banner: nothing says whether the email is verified | High |
| FR-6 | Effective permissions per event, and whether the account may create events in its organization | Every organizer screen; since 23 October 2026, creating, opening and correcting an event; since 24 October, the guest list and its import; since 25 October, venues, publishing, sending and the delivery report | Every action is offered to every role, and a 403 is explained when it happens. An organization `MEMBER` or `VIEWER` holds no `event:write`: they cannot create events, nor correct one unless their role on that event allows it. An event `DESIGNER` can open an event but not its dashboard (`operations:read`), so the overview says the guest numbers are not available to that role. On the guest list, a read-only role (organization `MEMBER` or `VIEWER`, event `VIEWER`) reads the guests without contact details and is refused every change; a `DESIGNER` cannot read them at all (`guest:read`), and the page says so. Venue writes need `event:write`; publishing, closing, reopening and sending need `invitation:publish` (every role that holds it also holds `guest:contact:read`); the delivery report needs `guest:read`, so a designer's is refused and the invitation page says so, without the addresses for a read-only role | High: the event and guest screens exist |
| FR-7 | **Rate limits that fit the client.** *Partly done 23 October 2026 (B81):* staff are counted per account, and a guest's own invitation page allows 3,000 requests a minute per address. **Still needed:** `GET …/rsvp` keeps the tight limit (100 a minute per address), and the guest page's server reads it for every personal page view, from one address. Give it the guest-page limit, or trust a forwarded client address from our renderer | The guest page at a real event: every guest's view counts against the renderer's one address | Development only; must be solved before any deployment | High, before the pilot |
| FR-8 | Write the route contract (`/invitations/:slug/g/:guestToken` and the others the backend emails) into `docs/API.md`; add `PUBLIC_APP_URL` to `backend/.env.example`. *Partly done 23 October 2026:* `PUBLIC_APP_URL` is required in production and is in `.env.production.example`, DEPLOYMENT.md and GOING_LIVE.md (9b); the development template still lacks it. **The contract grew:** the backend now also builds `/sign-in` (the email to an address that already has an account, D16), `/accept-event-invite?token=` (team invitations, F5), and the bank's default return pages `/tickets/return` and `/billing/return`. API.md names the last three in passing, never `/sign-in`, and still has no table | Every emailed link and every bank return | `ROUTE_PATHS` in `src/route-paths.ts`, pinned by a test that reads the backend's sources, the four new paths included | Medium |
| FR-9 | Decide how template fonts reach the browser | The invitation renderer | A font registry in the renderer, Noto only | Medium |
| FR-10 | CORS: expose `x-request-id` and set a preflight `maxAge`. Not needed if same-origin (FR-11), **but the backend's production template plans separate origins** (23 October 2026, see FR-11). `main.ts` still exposes no header and sets no `maxAge` | Error reports with a reference | The client sends its own `x-request-id` | Medium |
| FR-11 | Agree the deployment topology: one origin through Caddy, a web service, `CORS_ORIGINS`, `PUBLIC_APP_URL`, proxy trust. *New facts, 23 October 2026:* `backend/.env.production.example` puts the API on its own origin (`api.aveline.am`, the only domain Caddy serves), the client at `aveline.am` and media at `media.aveline.am`; `docker-compose.prod.yml` has no web service. Our setup assumes one origin, so this needs agreeing. `CORS_ORIGINS` also lists `www.aveline.am`, but a payment `returnUrl` must share `PUBLIC_APP_URL`'s origin (GOING_LIVE 9b), so a client served from `www` cannot send its own origin as a return URL, and the default sends the payer back to `aveline.am`, another origin | Deployment | The Vite proxy in development. `VITE_PUBLIC_ORIGIN` must be the origin of the backend's `PUBLIC_APP_URL`, or a checkout that sends it as a return URL is a `400` | Medium, before the pilot |
| FR-12 | Optional: the refresh token as an httpOnly cookie | Session hardening | `tokenStore` in `localStorage` (A3) | Low |
| FR-13 | Derive default return URLs from `PUBLIC_APP_URL`; let the fake gateway keep an existing query string. *Partly done 23 October 2026:* return URLs default to the app's `/tickets/return` and `/billing/return`, and one on any other origin is refused. **Still needed:** the fake gateway appends `?fakePayment=` after a literal `?` (`fake.gateway.ts`), so a return URL with its own query string breaks in development | Checkout | Not yet needed | Low |
| FR-14 | A seeded login for manual testing | Manual checks of organizer screens | End-to-end tests register their own users | Low |
| FR-15 | Optional: a `metadata` object on the public invitation | Link previews | Previews derived from the event and `coverUrl` | Low |
| FR-16 | Optional: the template's API rules as an importable file | `frontend/CLAUDE.md` copies them today | Copied, with the source named | Low |
| FR-17 | Mark `?locale=` **optional** on `GET /invitations/:slug` and, since 23 October 2026, on `…/g/:guestToken` too. The controllers treat it as optional and `docs/API.md` §4 documents it so, but `openapi.json` declares it required, so the generated client demands it. Found 22 October 2026. **The same on `GET /events`:** `archived`, `limit` and `offset` are declared required, and an empty `limit` is a `400`. Found 23 October 2026 | Both guest pages; the `/app` home | The loader sends `locale=` empty when the guest chose none, which `negotiateLocale` reads as "none". `GET /events` sends none of its three, through one cast in `features/events/api.ts` | Low, small |
| FR-18 | Type `CustomAnswerDto.value` as what it is: a string, a boolean, a number or a list of numbers. `openapi.json` declares it `Record<string, never>`, an empty object, in the respondent's, each member's and each added guest's `answers`, so a generated client cannot send a real answer without a cast. Found 22 October 2026 | The reply form's host questions | `guest-reply/types.ts` types every `answers` list correctly and converts once, at the call, naming FR-18 | Low, small |
| FR-19 | Return the respondent's `attribution` from `GET …/rsvp`. It is stored on the guest and accepted on submit (only where the host left the side unknown), but never read back. Found 22 October 2026 | The reply form on an edit: "Who invited you?" cannot show the saved answer | Starts unanswered; left out of the submission unless the guest chooses again, so the saved value is kept | Low |
| FR-20 | Prefix class-validator messages with their field, as the service's own messages do (`party.0.firstName: …`). Today they read "party.0.firstName must be shorter…", which no client can map to a field reliably. Found 22 October 2026. *The event DTOs do the same (23 October 2026):* "title must be longer than or equal to 2 characters", "startsAt must be a date-time such as 2027-06-12T15:00:00Z". *So do the guest DTOs (24 October 2026):* "firstName must be longer than or equal to 1 characters", "seatsAllotted must not be greater than 20", while the guest service's own messages are prefixed (`householdId:`, `email:`, `phone:`, `seatsAllotted:`). *So do the venue DTOs (25 October 2026):* "name must be shorter than or equal to 160 characters", while the venue service prefixes its coordinate check (`latitude:`) but not its role check ("role must be one of …") | The reply form's field errors; the event form's; the guest dialogs'; the venue form's | The forms check the same limits first; anything unmapped shows as one general message. The event form, the guest dialogs and the venue form read the property name a message starts with, which their flat field names make dependable, and word each field themselves | Low |
| FR-21 | Return each member's own `answers` to the host's questions from `GET …/rsvp`, as the respondent's are. Since 23 October 2026 each person answers for themselves (their meal, for one), but an edit cannot show what a member chose. Found 23 October 2026 | The reply form on an edit | Members' questions start empty; an earlier answer still counts on the server, so leaving one empty changes nothing. The guest cannot see it, though | Medium |
| FR-22 | **Treat only a rotated refresh token as theft.** Since B75 a refresh token presented more than a minute after it was revoked ends every session of the account. The check covers any revoked token, not only a replaced one: one revoked by a password reset or "sign out everywhere" counts too (`auth.service.ts`, `refresh`). So after a reset, the first old device that wakes and refreshes signs the user out of the sessions they opened since, and logs a false theft warning. `docs/ACCESS_CONTROL.md` §5 says "a replaced token", and the end-to-end test covers only that case. Found 23 October 2026 | The sign-in screens: "reset your password, then sign in again" ends in a second sign-out | Nothing the client can do: a device cannot know its token was revoked elsewhere | Medium: the sign-in screens exist since 23 October 2026 |
| FR-23 | **Let an accepted invitation lead somewhere.** `POST /invites/accept` and `/event-invites/accept` return neither a session nor the invitee's address, so the person must type the address they were invited at to sign in, though the link already identified it. Return the address, or a token pair as login does. Also, `name` is validated as required even when the address already has an account, which ignores it. Found 23 October 2026 | Accepting an invitation | The page says the invitation is accepted and links to sign in; the form always asks for a name | Medium |
| FR-24 | **Type `UpdateEventDto`'s clearable fields as what they are.** `openapi.json` declares `endsAt`, `sideALabel` and `sideBLabel` as `type: object, nullable`, so the generated client types them `Record<string, never> \| null`, where the DTO takes an ISO string or a label, or `null` to clear it. `translations` has no shape at all. A client cannot send an end time, a side label or a translated title without a cast. Found 23 October 2026 | Correcting an event's end time, side labels, and per-language title and hosts | Not built: the event screens edit none of them ([ARCHITECTURE §12](ARCHITECTURE.md#12-not-yet-built)) | Low, small |
| FR-25 | **Refuse a blank `hostsLabel`, and a title of spaces, on `POST /events`.** `hostsLabel: ""` passes `@IsOptional()` and `@MaxLength(200)`, and `dto.hostsLabel ?? dto.title` keeps the empty string: the invitation names no hosts, and the slug falls back to `event-<random>`. `PATCH /events/:id` refuses the same value (`@MinLength(1)`). A title of spaces passes `@MinLength(2)` on both. The backend's own `@Trimmed()` (`common/trimmed.ts`) is made for this and is used on the RSVP and guest DTOs, not the event ones. Found 23 October 2026 | Creating an event | The form trims both, and leaves a blank hosts label out so the title stands in | Low, small |
| FR-26 | **Give each import row error a stable `reason` code**, beside its English `message`: no name, seats, email, phone, too long (with the field), erased, household full, not saved, unreadable file, no rows. Document `row: 0`, which stands for the file itself. The messages are English sentences only, and `docs/API.md` §6's examples differ from the code's ("A guest needs at least a first name" against "No name in this row"; "seats must be a positive whole number" against "Seats must be a whole number between 1 and 20"). Found 24 October 2026 | The import's result and history, in Armenian and Russian | Shown in English, marked as English for screen readers, with a line saying so on a page in another language. Row 0 reads "The file" | Medium |
| FR-27 | **Read the CSV files Armenian and Russian Excel writes.** `parseGuestCsv` reads UTF-8 with a comma delimiter only (`csv-guests.ts`). Excel set to Russian or Armenian saves "CSV" with `;` between columns and, unless "CSV UTF-8" is chosen, in a Windows code page (1251 for Russian). Such a file reads as one column, so every row is refused "No name in this row", or its Cyrillic names arrive garbled. Detect the delimiter (`;`, tab) and refuse a file that is not UTF-8, or at least report once, as a file-level error, that no first-name column was found and which headings were. Found 24 October 2026 | Importing a guest list, for the hosts of the target market | The import page asks for "CSV UTF-8 (comma delimited)" | High, before the pilot |
| FR-28 | **Machine-readable codes for refusals that name no field.** An erased guest's `PATCH` (400, "This guest's details were erased at their request"), a checked-in guest's `DELETE` (400), and a `PATCH` or `DELETE` made while the guest was being moved (409, "moved to another household just now"; both lock the household first) are English sentences with no field and no code, so a client can tell them apart only by status and action. Found 24 October 2026 *The same on the venue and invitation screens (25 October 2026):* a venue's `DELETE` refused while timeline entries or tables use it ("2 timeline entr(ies) and 0 table(s) still point at this venue; move them first"); publishing, closing or reopening refused for a state that changed ("This invitation is already published", an archived event); and a send refused for a draft or closed invitation, an event with no guests, or an unknown guest id | The guest dialogs; removing a venue; publishing and sending | A `DELETE` 400 is worded as a check-in, the only 400 a removal gives; a `PATCH` 400 naming no field as an erased guest; a 409 on either as a move. Each reloads the list. `isAnonymized` and `isCheckedIn` from the list say it beforehand, so the dialogs mostly avoid them. The venue and invitation screens word each refusal by status and action, and show the backend's sentence in English under it | Low |
| FR-29 | **Gate `token`, `email` and `phone` in the answers to `POST` and `PATCH /events/:eventId/guests` on `guest:contact:read`, as the reads are, or leave `token` out of them.** `guestView` in `guest-management.service.ts` returns all three whatever the caller holds. Nothing leaks today, since every role with `guest:write` also has `guest:contact:read` (`RUN_EVENT` in `access-policy.ts`), but a role with one and not the other would receive every new guest's personal link. Found 24 October 2026 | None today | The client reads neither answer: the calls resolve to nothing and the list reloads | Low |
| FR-30 | **Move a guest into a household of their own.** `PATCH …/guests/:guestId` moves a guest only into an existing household. To give a plus-one their own invitation, a host must remove them and add them again, which loses their answer. Accept, say, `householdId: null` with optional seats. Found 24 October 2026 | Correcting a household | Not offered | Low |
| FR-31 | **`UpdateGuestDto.locale`: let a language be cleared, and only to one the event publishes.** An empty string is stored as it is (`locale: dto.locale`), not as `null`, so "not set" cannot come back; any string up to 10 characters is accepted, the event's languages or not. Found 24 October 2026 | Correcting a guest's language | The form offers only the event's languages, and the guest's own; "Not set" only while none is set, and an empty language is never sent | Low |

| FR-32 | **Stable codes for the publish blockers**, in `publishBlockers` (`GET /invitations/:slug/design`) and in the publish 400. Today both are English sentences ("Add a venue with an address, so guests know where to go"), so a client can word them in the page's language, or link each to its fix, only by matching the text. Found 25 October 2026 | Publishing, in Armenian and Russian | **Temporary stand-in, design PD-49:** the three sentences the backend has are recognised by their exact text in `features/sending/blockers.ts`, worded in the page's language and linked to their fix; anything else is shown in English, marked. Deleted when this is answered | Medium |
| FR-33 | **Codes for a send's outcomes:** each `unreachable` household's `reason` (no guests, erased, malformed address, no address, Telegram not opted in), and why each `suppressed` household was suppressed: it asked not to be contacted, or an earlier message bounced, which need different actions from the host. Today the reasons are English sentences and a suppressed entry says neither. Found 25 October 2026 | The send's outcome, the guest list's invitation line | Reasons shown in English, marked, with a line saying so on a page in another language. A suppressed household is worded for both cases | Medium |
| FR-34 | **Gate `toAddress` in the answers to send, remind, notify-changes and thank-you on `guest:contact:read`,** as the delivery report does (`invitation-sender.service.ts`, `SendOutcome.record`, includes it whatever the caller holds). Nothing leaks today: every role with `invitation:publish` also holds `guest:contact:read` (`RUN_EVENT` in `access-policy.ts`). Found 25 October 2026 | None today | An address is shown only when it arrived, and never logged | Low |
| FR-35 | **The delivery report's `failureReason` reaches roles refused the address.** It is the mail server's own reply (`delivery-outcome.ts`, `describe`), such as "550 5.1.1 <ani@example.am>: Recipient address rejected", which often quotes the recipient's address. `toAddress` is withheld without `guest:contact:read`, but `failureReason` is not, so an organization `MEMBER` or `VIEWER`, or an event `VIEWER`, reads the address in it. Withhold it with `toAddress`, or replace it with a code and a host-facing sentence. Found 25 October 2026 | The guest list's invitation line | The text is shown only when `toAddress` arrived too. It still reaches the browser in the response | Medium: a read-only role receives guests' addresses today |
| FR-36 | **Venue DTOs:** refuse a blank `name` or `address` (`CreateVenueDto` has no minimum, so `""` is stored; a blank address then fails the publish check, which trims), and accept only an http or https `mapUrl` (any string up to 500 characters is stored, and the guest page drops it silently). Also declare `mapUrl`, `arriveAt`, the coordinates and `capacity` nullable on `UpdateVenueDto` in `openapi.json`: API.md says `null` clears them, but the generated type refuses `null`. Found 25 October 2026 | Adding and correcting a venue | The form trims and requires both, and refuses a map link the guest page would not show. Clearing goes through one cast in `features/venues/api.ts` that names FR-36 | Low |

## 2. From the guest invitation design

The full wording, and the working defaults, are in
[DESIGN_DECISIONS.md](design/DESIGN_DECISIONS.md) §5 and §6.

| ID | Request | Screen it blocks | Meanwhile |
|---|---|---|---|
| BQ-1, BQ-2 | The guest payload carries a palette's **name** only. Send its colours, with named roles | The invitation renderer | **Temporary stand-in PD-21:** one renderer module knows "bordeaux" only; other names fall back. Deleted when this is answered |
| BQ-3 | A host's own `colors` have the same problem | Host-tuned palettes | Ignored (PD-21) |
| BQ-4 | Say which well-known RSVP questions an invitation asks | The reply form | **Answered 23 October 2026:** `rsvpFields` switches each on or off. The form follows it; PD-16 is closed |
| BQ-5 | A required SIGNATURE question blocks every attending guest | The reply form | **Answered 23 October 2026 (B69):** creating a SIGNATURE question, or changing one into it, is refused until signatures can be captured (F25). The form still leaves the type out; PD-23 is closed and its launch gate met |
| BQ-6 | API.md §6 says public blocks omit `settings`; the code returns them | Dress-code swatches | Used when present (PD-24) |
| BQ-7 | No reply-by date in the payload. `expiresAt` is the retention limit (C-22), not a deadline | The reply section's copy | Only the host's own words (PD-25) |
| BQ-8 | The seeds name theme and palette fields differently | Theme parsing | **Answered 23 October 2026 (B84):** the development seed now uses the names the code reads, palette `name` and the theme's `headingFont` and `bodyFont`; the production seed already used `name` and `bodyFont`. The renderer reads only `theme.palette`, so nothing changes; PD-22 is closed. API.md §4's example still says `font` (BACKLOG §4 records it) |
| BQ-9 | If dietary and drink options become fixed, let each invitation define its own | The reply form | **Answered 23 October 2026:** `rsvpFields` gives each invitation its own choices, a key with a label per language. The form shows them and sends the keys; PD-15 is closed |
| BQ-10 | Optional names for dress-code colours | Swatches for screen readers | Unnamed, labelled "Suggested colours" (PD-26) |
| BQ-11 | `guest.telegramLink` opens the event's Telegram bot with the guest's own token in it (`?start=<token>`). The token is the guest's credential, so Telegram receives it, and so does anyone the link is forwarded to. Could the bot link carry a separate, single-purpose code? Since the same pull, Aveline's invitation email also ends with this link whenever a bot is configured, so the token reaches Telegram from the email too, not only from the page | A "reminders on Telegram" button | Not shown until this is settled |

## 3. Contradictions found in the shared docs

- API.md §1, "Money is a string", converts through a float in its own example.
- API.md §1 reads `x-request-id` from the response, which is `null` cross-origin unless CORS
  exposes it (FR-10).
- `backend/.env.example` documents `PUBLIC_BASE_URL`, which nothing reads, and omits
  `PUBLIC_APP_URL` (FR-8). Still true of the development template on 23 October 2026; the
  production one, `.env.production.example`, has `PUBLIC_APP_URL`.
- API.md §1 "Rate limits" still says 10 requests a second and 100 a minute per address for
  everything. Since 23 October 2026 (B81) staff are counted per account and a guest's own page
  allows far more. `docs/ACCESS_CONTROL.md` §6 now states the real limits; API.md does not. Found
  23 October 2026.
- `docs/BACKLOG.md` §4 lists further API.md statements that the code contradicts. Two will
  matter to organizer screens: lists are bare arrays except `/public/events`, though API.md §1
  promises an envelope; and a resource you cannot see answers `403`, not `404`. Found 23 October
  2026.
- `docs/ACCESS_CONTROL.md` §5 says a *replaced* refresh token used again ends every session; the
  code does it for any revoked one, including those a password reset or "sign out everywhere"
  revoked (FR-22). Found 23 October 2026.
- API.md §6 ("Becoming a tenant") says an organization's `kind` is `HOST` or `AGENCY`, and so
  does `CreateOrganizationDto`'s description; the enum is `HOST`, `PLANNER` and `CORPORATE`, and
  `AGENCY` is a `400`. The client offers the three the enum has. Found 23 October 2026.
- API.md §4's guest payload example leaves out fields the code returns and the page relies on:
  `isAcceptingResponses`, each block's `settings` (see BQ-6), `event.title` and `event.endsAt`,
  and `guest.id` and `guest.locale`. Household members arrive as `{ id, name }`. Found 22 October
  2026.
- API.md §4 shows `rsvp` from `GET …/rsvp` with a few fields; the code returns the whole stored
  row (with `id`, `guestId`, `signatureAssetId` and timestamps). The client reads only the
  documented ones.
- API.md §6 ("Importing a guest list") says the import history gives `filename`, `rowsImported`,
  `rowsFailed`, `status` and `errors`; the code returns each stored record whole (`id`,
  `eventId`, `rowsTotal`, `uploadedBy`, `createdAt`, `finishedAt` too), and `status` may be
  `PROCESSING`: a running import, or one interrupted, which stays so until the next import closes
  it after ten minutes. A row error of `row: 0`, for the file itself, is not documented, and the
  example messages are not the code's (FR-26). The client reads only `filename`, the counts,
  `status`, `errors` and `createdAt`. Found 24 October 2026.

- API.md §6 ("Sending the invitation") says a **draft** is refused; the code refuses every status
  but `PUBLISHED` (`invitation-sender.service.ts`, `loadSendable`), so a closed invitation is
  refused too, on `d23ff2d` and on main. The client offers sending only while the invitation is
  published, and says why when replies are stopped. Found 25 October 2026.

## 4. Shared changes the frontend proposes, not made

Each needs the backend developer, or a root session on the user's instruction.

| Change | Why | Proposal reference |
|---|---|---|
| Create and protect `frontend/integration` (BA-1 to BA-6) | Where frontend branches integrate while they stay off `main` | §3.8, A6b |
| A shared root `.nvmrc` | One Node for both teams. The frontend has its own `frontend/.nvmrc` meanwhile | A4, B-8 |
| `.github/workflows/frontend.yml` and the boundary check | CI for frontend pull requests | §13, BA-3 |
| Frontend rows in the root `README.md`, `CLAUDE.md` §1 and §6, and `AGENTS.md` | They still say the frontend is empty | §8 |
| The launch gates in `docs/GOING_LIVE.md` | Listed in [design/README.md](design/README.md) §6 | §8, B-7 |
| The route contract in `docs/API.md` | FR-8 | §5.3 |

## 5. origin/main past `d23ff2d`, not yet pulled

Checked on 25 October 2026, at `eb77cd4` (15 commits). Nothing under `frontend/` changed;
`docs/API.md`, `docs/ACCESS_CONTROL.md`, `docs/VENUES_AND_SEATING.md`, `docs/PRODUCT_SPEC.md`,
`docs/INVITATION_DESIGN.md`, `docs/GOING_LIVE.md`, `docs/PAYMENTS.md`, `docs/BACKLOG.md`, the new
`docs/PILOT_IMPLEMENTATION_PLAN.md` and `docs/TODO.md`, and `backend/openapi.json` did. The venue, publishing and
sending screens were built on `d23ff2d` (ARCHITECTURE §11); this is the pull still to do.

| Change on main | What it means for the frontend |
|---|---|
| Error bodies add `code`, `locale`, `userMessage`, `action` and `details[{field, code, userMessage}]`, translated by `Accept-Language` (en, ru, fr, hy); `message` may be an object | `messagesFrom` reads an object as no messages, so nothing breaks. `details[].field` answers part of FR-20; `userMessage` is generic per code, so FR-26, FR-28, FR-32 and FR-33 stay open |
| Attendance modes (`EVENT_WIDE`, `PER_VENUE`) with a revision; guest and host RSVP writes need `attendanceRevision` once the mode changes (409 `ATTENDANCE_CHANGED`), and per-venue events take `venueAttendance` per person | The guest reply form sends neither: it breaks for an event whose mode changed. Reconfirmation screens are pilot acceptance work |
| `SIGNATURE` questions can be created again (typed or drawn acknowledgements); a required one binds attending guests | The reply form leaves the type out (PD-23), so a required one blocks attending guests again: the launch gate met on 23 October (design README §6, BQ-5) opens again |
| Invitation lifetime: publish, close and reopen, and the event's `invitation`, carry `expiresAt`, `isExpired` and the captured policy; an expired invitation's guest pages are 404 and sending it is a 400 | The invitation page could say until when guests can open it; the guest page's 404 already covers expiry. A personal page read can also answer 409 "Invitation changed while loading; please retry" |
| Delivery rows add `deliveredAt`, `readAt`, `deliveryFailedAt`, `deliveryErrorCode` and `deliveryFailureKind` | Additive; the guest list's invitation line could show them, with labels for the four failure kinds |
| Removing a venue is also refused while guests' attendance answers or seat-release markers point at it; a venue's capacity cannot go below its seated guests | Still a 400 naming no field; the removal's words ("still uses it") would need to cover answers |
| A guest list `DELETE` is also refused for a ticket-linked guest and for one with acknowledgement evidence | The guest dialog words every removal 400 as a check-in (FR-28): wrong for these |
| Guests carry `seating` per venue; `table` is `null` when a guest has several seats | The guest list shows no table for a guest seated at two venues |
| Guests can correct their own name through their link (`PATCH …/g/:guestToken/name`); template previews; question order; gallery and acknowledgements; snapshot exports; seating jobs; ticket attendees | New surfaces, none built |
| The pilot plan asks for **four languages, en, ru, fr and hy,** in the host and guest interfaces | The frontend has three (A2). A decision for the frontend lead |
| `docs/GOING_LIVE.md` makes the whole pilot plan a release gate, with a host and guest walkthrough in all four languages after the frontend is integrated, and lists the frontend's expiry states as still to verify | The frontend's scope before launch is set there, not only by this register and the design launch gates |
| FR-1: three operations declare a response (`InvitationLifecycleDto` for publish, close and reopen), plus `HttpErrorDto` | FR-1 stays open |

