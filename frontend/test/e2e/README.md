# End-to-end and accessibility tests

Playwright drives the real client against a real, running backend. Nothing is mocked. Every test
makes its own data through the API as a host would (setup proposal §12): a fresh account at
`…@demo.test`, its organization, its events. Nothing depends on the seed.

## What the suite covers

| File | Journey |
|---|---|
| `account.spec.ts` | Registering and setting up the organization; signing out and back in; a new password from the emailed link; two tabs refreshing one rotating session at once |
| `event-setup.spec.ts` | Creating an event, correcting it with a second language and its own side names (FR-96), a venue, publishing; a CSV import that names its refused rows |
| `guest-reply.spec.ts` | A guest's personal link: replying for the household with a side, a meal and the hosts' statement, changing it, replies closed, the token kept to its own page; the generic link's HTML names no guest |
| `sending.spec.ts` | The invitation by email, its link opening the guest's page, the delivery on the guest list; a reminder held back for three days after an invitation |
| `seating.spec.ts` | Tables and seating by hand; a table filled meanwhile from a second page (409); automatic seating by the worker |
| `exports.spec.ts` | The guest list as PDF, XLSX and CSV, made by the worker and downloaded |
| `tickets.spec.ts` | A listing card's date in the event's zone (FR-92); a free ticket to its order and door code; a paid one waiting at the bank, then answered paid (its tickets) and declined at the FAKE bank (FR-151) |
| `billing.spec.ts` | A paid plan chosen, then paid and declined at the FAKE bank (FR-151), each read by the return page; skipped where the stack offers no paid plan (FR-154) |
| `door.spec.ts` | Checking in by name and undoing it; a ticket code admitted once; a walk-in |
| `vendors.spec.ts` | A vendor's brief in the vendor's language with the event's words marked in the event's (FR-104), and closed when paused |
| `suppressions.spec.ts` | A spaced phone stored compact, and the same number typed another way known as listed (FR-99) |
| `a11y.spec.ts` | Twenty guest, public and app pages in hy, ru, en and fr: axe (WCAG 2.2 AA; serious and critical fail), 44 px targets on a phone, no sideways scroll, `<html lang>`, no raw translation key |
| `ssr.spec.ts` | An event page's title, Open Graph and robots rule in its server HTML; the capability links' `no-referrer`, `private, no-store` and `noindex` headers, and no token in their HTML |

Each test runs twice: on a 360 px touch phone and at 1280 px. A test also fails on any console
error, apart from the browser's own line for a request the test expects to be refused.

## The stack it needs

The backend in development mode, as its README sets it up:
- `NODE_ENV=development`, for the FAKE bank;
- `npm run start:dev`;
- `start:export-worker` and `start:seating-worker`, after a build;
- the stores from `npm run db:up`, Mailpit included;
- `seed:production`, for the templates and plans;
- for `billing.spec.ts`, one paid plan switched on, as the seed leaves them all off (FR-154). In the local
  database: `docker exec aveline-postgres psql -U aveline -d aveline -c "update plans set \"isActive\" = true, \"priceMinor\" = 25000 where key = 'planner-monthly'"`.

The client is either:
- the dev server, which the config starts itself on 5173 when `E2E_BASE_URL` is unset; or
- any client already running, named by `E2E_BASE_URL`.

The backend's `PUBLIC_APP_URL` must name the same client, as it builds every emailed link and the
bank's return address from it.

| Variable | Default | Is |
|---|---|---|
| `E2E_BASE_URL` | `http://localhost:5173`, started by the config | The client |
| `E2E_API_ORIGIN` | the client's own origin | Where `/api/v1` answers; the client proxies it in development, Caddy in production |
| `E2E_MAILPIT_URL` | `http://localhost:8025` | Mailpit, for the tests that read mail |
| `E2E_TRACE` | unset | `1` keeps a trace and a screenshot of a failure (see below) |

```bash
E2E_BASE_URL=http://localhost:5199 npm run test:e2e          # everything, both widths
npx playwright test door.spec.ts --project=phone              # one file, one width
```

## What is skipped, and why

- **No Mailpit:** the tests that read mail say so and skip.
- **The worker isn't running:** automatic seating and exports wait 60 s and fail, rather than pass without it.
- **A paid ticket:**
  - under `PILOT_MODE`, the pilot's refusal is checked, and the tests that pay at the bank skip;
  - otherwise, the FAKE bank's return waits, then the backend's development-only `fake-bank` route answers for the payer, paid or declined (FR-151). It is a 404 wherever the FAKE bank isn't registered.
- **No paid plan on offer:** the paid-plan tests skip and say so (FR-154).
- **Slow mail:** the backend sends mail once a minute (FR-152), so a test that reads mail can take that long.

## Tokens

The journeys handle real capability tokens: guests', buyers' and vendors'. None may reach a log, a
committed file or a screenshot (frontend/CLAUDE.md §4). So:
- no trace or screenshot is kept unless `E2E_TRACE=1`, and what it keeps stays in the ignored `test-results/`;
- a test's name never holds a token;
- the suite's own checks name a page with its token redacted (`src/lib/capability-links`).

Playwright's own message for a failed navigation or address check can still print a page's full
address. Those tokens belong to throwaway test data on the local stack, but treat a failed run's
output and `test-results/` as private all the same: don't paste them into an issue or a chat.
