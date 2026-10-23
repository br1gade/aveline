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
> FR-7 partly; FR-21 and BQ-11 are new.

## 1. API and schema

| ID | Request | Screen it blocks | Meanwhile | Priority |
|---|---|---|---|---|
| FR-1 | **Response schemas for every operation in `openapi.json`.** None declares a success response today | Every screen: response types are hand-written and can drift | Interim `types.ts` per feature, marked "interim until FR-1"; end-to-end tests against the real backend | **Blocking** for typed responses |
| FR-2 | Declare security per operation: bearer, or public with `security: []` | The generated client cannot tell public calls from authenticated ones | `publicApi` and `appApi` chosen by hand | High |
| FR-3 | Stop declaring `user-agent` as a **required** header on register, login and refresh | Sign-in: a browser cannot set it | Not yet needed; the guest page does not call these | High, small |
| FR-4 | Type translated fields (`name`, `prompt`, `label`, `content`) as locale-to-string maps | The designer and the editor | Interim types | High |
| FR-5 | `GET /me` | The app shell, onboarding, a "verify your email" banner | Not yet needed | High |
| FR-6 | Effective permissions per event | Every organizer screen | Not yet needed | High |
| FR-7 | **Rate limits that fit the client.** *Partly done 23 October 2026 (B81):* staff are counted per account, and a guest's own invitation page allows 3,000 requests a minute per address. **Still needed:** `GET …/rsvp` keeps the tight limit (100 a minute per address), and the guest page's server reads it for every personal page view, from one address. Give it the guest-page limit, or trust a forwarded client address from our renderer | The guest page at a real event: every guest's view counts against the renderer's one address | Development only; must be solved before any deployment | High, before the pilot |
| FR-8 | Write the route contract (`/invitations/:slug/g/:guestToken` and the others the backend emails) into `docs/API.md`; add `PUBLIC_APP_URL` to `backend/.env.example` | Every emailed link | `ROUTE_PATHS` in `src/routes.ts`, pinned by a test | Medium |
| FR-9 | Decide how template fonts reach the browser | The invitation renderer | A font registry in the renderer, Noto only | Medium |
| FR-10 | CORS: expose `x-request-id` and set a preflight `maxAge`. Not needed if same-origin (FR-11) | Error reports with a reference | The client sends its own `x-request-id` | Medium |
| FR-11 | Agree the deployment topology: one origin through Caddy, a web service, `CORS_ORIGINS`, `PUBLIC_APP_URL`, proxy trust | Deployment | The Vite proxy in development | Medium, before the pilot |
| FR-12 | Optional: the refresh token as an httpOnly cookie | Session hardening | `tokenStore` in `localStorage` (A3) | Low |
| FR-13 | Derive default return URLs from `PUBLIC_APP_URL`; let the fake gateway keep an existing query string | Checkout | Not yet needed | Low |
| FR-14 | A seeded login for manual testing | Manual checks of organizer screens | End-to-end tests register their own users | Low |
| FR-15 | Optional: a `metadata` object on the public invitation | Link previews | Previews derived from the event and `coverUrl` | Low |
| FR-16 | Optional: the template's API rules as an importable file | `frontend/CLAUDE.md` copies them today | Copied, with the source named | Low |
| FR-17 | Mark `?locale=` **optional** on `GET /invitations/:slug` and, since 23 October 2026, on `…/g/:guestToken` too. The controllers treat it as optional and `docs/API.md` §4 documents it so, but `openapi.json` declares it required, so the generated client demands it. Found 22 October 2026 | Both guest pages | The loader sends `locale=` empty when the guest chose none, which `negotiateLocale` reads as "none" | Low, small |
| FR-18 | Type `CustomAnswerDto.value` as what it is: a string, a boolean, a number or a list of numbers. `openapi.json` declares it `Record<string, never>`, an empty object, in the respondent's, each member's and each added guest's `answers`, so a generated client cannot send a real answer without a cast. Found 22 October 2026 | The reply form's host questions | `guest-reply/types.ts` types every `answers` list correctly and converts once, at the call, naming FR-18 | Low, small |
| FR-19 | Return the respondent's `attribution` from `GET …/rsvp`. It is stored on the guest and accepted on submit (only where the host left the side unknown), but never read back. Found 22 October 2026 | The reply form on an edit: "Who invited you?" cannot show the saved answer | Starts unanswered; left out of the submission unless the guest chooses again, so the saved value is kept | Low |
| FR-20 | Prefix class-validator messages with their field, as the service's own messages do (`party.0.firstName: …`). Today they read "party.0.firstName must be shorter…", which no client can map to a field reliably. Found 22 October 2026 | The reply form's field errors | The form checks the same limits first; anything unmapped shows as one general message | Low |
| FR-21 | Return each member's own `answers` to the host's questions from `GET …/rsvp`, as the respondent's are. Since 23 October 2026 each person answers for themselves (their meal, for one), but an edit cannot show what a member chose. Found 23 October 2026 | The reply form on an edit | Members' questions start empty; an earlier answer still counts on the server, so leaving one empty changes nothing. The guest cannot see it, though | Medium |

## 2. From the guest invitation design

The full wording, and the working defaults, are in
[DESIGN_DECISIONS.md](design/DESIGN_DECISIONS.md) §5 and §6.

| ID | Request | Screen it blocks | Meanwhile |
|---|---|---|---|
| BQ-1, BQ-2 | The guest payload carries a palette's **name** only. Send its colours, with named roles | The invitation renderer | **Temporary stand-in PD-21:** one renderer module knows "bordeaux" only; other names fall back. Deleted when this is answered |
| BQ-3 | A host's own `colors` have the same problem | Host-tuned palettes | Ignored (PD-21) |
| BQ-4 | Say which well-known RSVP questions an invitation asks | The reply form | **Answered 23 October 2026:** `rsvpFields` switches each on or off. The form follows it; PD-16 is closed |
| BQ-5 | A required SIGNATURE question blocks every attending guest | The reply form | Never shown; a refusal shows the validation state (PD-23). A launch gate |
| BQ-6 | API.md §6 says public blocks omit `settings`; the code returns them | Dress-code swatches | Used when present (PD-24) |
| BQ-7 | No reply-by date in the payload. `expiresAt` is the retention limit (C-22), not a deadline | The reply section's copy | Only the host's own words (PD-25) |
| BQ-8 | The seeds name theme and palette fields differently | Theme parsing | Parse what API.md documents; fall back (PD-22) |
| BQ-9 | If dietary and drink options become fixed, let each invitation define its own | The reply form | **Answered 23 October 2026:** `rsvpFields` gives each invitation its own choices, a key with a label per language. The form shows them and sends the keys; PD-15 is closed |
| BQ-10 | Optional names for dress-code colours | Swatches for screen readers | Unnamed, labelled "Suggested colours" (PD-26) |
| BQ-11 | `guest.telegramLink` opens the event's Telegram bot with the guest's own token in it (`?start=<token>`). The token is the guest's credential, so Telegram receives it, and so does anyone the link is forwarded to. Could the bot link carry a separate, single-purpose code? | A "reminders on Telegram" button | Not shown until this is settled |

## 3. Contradictions found in the shared docs

- API.md §1, "Money is a string", converts through a float in its own example.
- API.md §1 reads `x-request-id` from the response, which is `null` cross-origin unless CORS
  exposes it (FR-10).
- `backend/.env.example` documents `PUBLIC_BASE_URL`, which nothing reads, and omits
  `PUBLIC_APP_URL` (FR-8).
- API.md §1 "Rate limits" still says 10 requests a second and 100 a minute per address for
  everything. Since 23 October 2026 (B81) staff are counted per account and a guest's own page
  allows far more. Found 23 October 2026.
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
