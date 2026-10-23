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
> template bears on FR-10 and FR-11. FR-22 is new.

## 1. API and schema

| ID | Request | Screen it blocks | Meanwhile | Priority |
|---|---|---|---|---|
| FR-1 | **Response schemas for every operation in `openapi.json`.** None declares a success response today | Every screen: response types are hand-written and can drift | Interim `types.ts` per feature, marked "interim until FR-1"; end-to-end tests against the real backend | **Blocking** for typed responses |
| FR-2 | Declare security per operation: bearer, or public with `security: []` | The generated client cannot tell public calls from authenticated ones | `publicApi` and `appApi` chosen by hand | High |
| FR-3 | Stop declaring `user-agent` as a **required** header on login and refresh. *Register no longer declares it (23 October 2026), since it stopped signing in (D16)* | Sign-in: a browser cannot set it | Not yet needed; the guest page does not call these | High, small |
| FR-4 | Type translated fields (`name`, `prompt`, `label`, `content`) as locale-to-string maps | The designer and the editor | Interim types | High |
| FR-5 | `GET /me` | The app shell, onboarding, a "verify your email" banner | Not yet needed | High |
| FR-6 | Effective permissions per event | Every organizer screen | Not yet needed | High |
| FR-7 | **Rate limits that fit the client.** *Partly done 23 October 2026 (B81):* staff are counted per account, and a guest's own invitation page allows 3,000 requests a minute per address. **Still needed:** `GET …/rsvp` keeps the tight limit (100 a minute per address), and the guest page's server reads it for every personal page view, from one address. Give it the guest-page limit, or trust a forwarded client address from our renderer | The guest page at a real event: every guest's view counts against the renderer's one address | Development only; must be solved before any deployment | High, before the pilot |
| FR-8 | Write the route contract (`/invitations/:slug/g/:guestToken` and the others the backend emails) into `docs/API.md`; add `PUBLIC_APP_URL` to `backend/.env.example`. *Partly done 23 October 2026:* `PUBLIC_APP_URL` is required in production and is in `.env.production.example`, DEPLOYMENT.md and GOING_LIVE.md (9b); the development template still lacks it. **The contract grew:** the backend now also builds `/sign-in` (the email to an address that already has an account, D16), `/accept-event-invite?token=` (team invitations, F5), and the bank's default return pages `/tickets/return` and `/billing/return`. API.md names the last three in passing, never `/sign-in`, and still has no table | Every emailed link and every bank return | `ROUTE_PATHS` in `src/route-paths.ts`, pinned by a test that reads the backend's sources. The four new paths are not in it yet | Medium |
| FR-9 | Decide how template fonts reach the browser | The invitation renderer | A font registry in the renderer, Noto only | Medium |
| FR-10 | CORS: expose `x-request-id` and set a preflight `maxAge`. Not needed if same-origin (FR-11), **but the backend's production template plans separate origins** (23 October 2026, see FR-11). `main.ts` still exposes no header and sets no `maxAge` | Error reports with a reference | The client sends its own `x-request-id` | Medium |
| FR-11 | Agree the deployment topology: one origin through Caddy, a web service, `CORS_ORIGINS`, `PUBLIC_APP_URL`, proxy trust. *New facts, 23 October 2026:* `backend/.env.production.example` puts the API on its own origin (`api.aveline.am`, the only domain Caddy serves), the client at `aveline.am` and media at `media.aveline.am`; `docker-compose.prod.yml` has no web service. Our setup assumes one origin, so this needs agreeing. `CORS_ORIGINS` also lists `www.aveline.am`, but a payment `returnUrl` must share `PUBLIC_APP_URL`'s origin (GOING_LIVE 9b), so a client served from `www` cannot send its own origin as a return URL, and the default sends the payer back to `aveline.am`, another origin | Deployment | The Vite proxy in development. `VITE_PUBLIC_ORIGIN` must be the origin of the backend's `PUBLIC_APP_URL`, or a checkout that sends it as a return URL is a `400` | Medium, before the pilot |
| FR-12 | Optional: the refresh token as an httpOnly cookie | Session hardening | `tokenStore` in `localStorage` (A3) | Low |
| FR-13 | Derive default return URLs from `PUBLIC_APP_URL`; let the fake gateway keep an existing query string. *Partly done 23 October 2026:* return URLs default to the app's `/tickets/return` and `/billing/return`, and one on any other origin is refused. **Still needed:** the fake gateway appends `?fakePayment=` after a literal `?` (`fake.gateway.ts`), so a return URL with its own query string breaks in development | Checkout | Not yet needed | Low |
| FR-14 | A seeded login for manual testing | Manual checks of organizer screens | End-to-end tests register their own users | Low |
| FR-15 | Optional: a `metadata` object on the public invitation | Link previews | Previews derived from the event and `coverUrl` | Low |
| FR-16 | Optional: the template's API rules as an importable file | `frontend/CLAUDE.md` copies them today | Copied, with the source named | Low |
| FR-17 | Mark `?locale=` **optional** on `GET /invitations/:slug` and, since 23 October 2026, on `…/g/:guestToken` too. The controllers treat it as optional and `docs/API.md` §4 documents it so, but `openapi.json` declares it required, so the generated client demands it. Found 22 October 2026 | Both guest pages | The loader sends `locale=` empty when the guest chose none, which `negotiateLocale` reads as "none" | Low, small |
| FR-18 | Type `CustomAnswerDto.value` as what it is: a string, a boolean, a number or a list of numbers. `openapi.json` declares it `Record<string, never>`, an empty object, in the respondent's, each member's and each added guest's `answers`, so a generated client cannot send a real answer without a cast. Found 22 October 2026 | The reply form's host questions | `guest-reply/types.ts` types every `answers` list correctly and converts once, at the call, naming FR-18 | Low, small |
| FR-19 | Return the respondent's `attribution` from `GET …/rsvp`. It is stored on the guest and accepted on submit (only where the host left the side unknown), but never read back. Found 22 October 2026 | The reply form on an edit: "Who invited you?" cannot show the saved answer | Starts unanswered; left out of the submission unless the guest chooses again, so the saved value is kept | Low |
| FR-20 | Prefix class-validator messages with their field, as the service's own messages do (`party.0.firstName: …`). Today they read "party.0.firstName must be shorter…", which no client can map to a field reliably. Found 22 October 2026 | The reply form's field errors | The form checks the same limits first; anything unmapped shows as one general message | Low |
| FR-21 | Return each member's own `answers` to the host's questions from `GET …/rsvp`, as the respondent's are. Since 23 October 2026 each person answers for themselves (their meal, for one), but an edit cannot show what a member chose. Found 23 October 2026 | The reply form on an edit | Members' questions start empty; an earlier answer still counts on the server, so leaving one empty changes nothing. The guest cannot see it, though | Medium |
| FR-22 | **Treat only a rotated refresh token as theft.** Since B75 a refresh token presented more than a minute after it was revoked ends every session of the account. The check covers any revoked token, not only a replaced one: one revoked by a password reset or "sign out everywhere" counts too (`auth.service.ts`, `refresh`). So after a reset, the first old device that wakes and refreshes signs the user out of the sessions they opened since, and logs a false theft warning. `docs/ACCESS_CONTROL.md` §5 says "a replaced token", and the end-to-end test covers only that case. Found 23 October 2026 | The sign-in screens: "reset your password, then sign in again" ends in a second sign-out | Nothing the client can do: a device cannot know its token was revoked elsewhere | Medium, before the sign-in screens |

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
- API.md §4's guest payload example leaves out fields the code returns and the page relies on:
  `isAcceptingResponses`, each block's `settings` (see BQ-6), `event.title` and `event.endsAt`,
  and `guest.id` and `guest.locale`. Household members arrive as `{ id, name }`. Found 22 October
  2026.
- API.md §4 shows `rsvp` from `GET …/rsvp` with a few fields; the code returns the whole stored
  row (with `id`, `guestId`, `signatureAssetId` and timestamps). The client reads only the
  documented ones.

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
