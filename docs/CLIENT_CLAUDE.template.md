# <Client> — Rules

> Copy this to `CLAUDE.md` at the root of the client project (or into
> `<client>/CLAUDE.md` if it lives in this repository) and adapt the stack
> sections. The backend team maintains the parts about the API.

Repo-wide conventions: [`../CLAUDE.md`](../CLAUDE.md) if you are in this
repository, otherwise read it once and keep it nearby.

## Before writing a line against the API

1. Read [`docs/API.md`](API.md) — conventions first, endpoints second. The
   conventions section is short and will save more time than it costs.
2. Generate types rather than hand-writing them:
   ```bash
   cd backend && npm run openapi      # writes openapi.json
   npx openapi-typescript backend/openapi.json -o src/api/schema.ts
   ```
   Hand-written types drift from the server silently. Generated ones fail to
   compile, which is what you want.
3. Skim §8 "Things that will bite you". Every item there has already cost
   someone an afternoon.

## Non-negotiable client behaviours

These are not style preferences — getting them wrong breaks users.

- **Serialise token refresh.** The refresh token rotates: the one you present
  is revoked. Two concurrent refreshes sign the user out. Queue them behind a
  single in-flight promise.
- **Never `parseFloat` money.** Minor units arrive as strings and can exceed
  what a JavaScript number holds. Use `BigInt`.
- **Retry on 401, never on 403.** 401 means refresh and try again. 403 means
  the account lacks the permission and retrying will loop.
- **Render `locale` from the response**, not the one you requested.
- **Render `blocks` in array order.** Do not sort. Render unknown block types
  as nothing — new types ship without a client release.
- **After a payment redirect, call confirm.** The return URL proves nothing;
  only the server-to-server check does.
- **Format dates in the event's timezone**, not the device's.

## Asking for backend changes

If the API does not do what the screen needs, say so. A workaround in the
client becomes permanent; a backend change usually takes an afternoon. Useful
things to include: the screen, the call you wish existed, and what you are
doing instead.

## Documentation

Same rule as the backend: update the doc in the same commit as the behaviour,
and keep "not yet built" sections honest.

## Stack rules

<!-- Fill in: framework, state management, styling, testing, lint limits.
     Keep it short and binding, the way backend/CLAUDE.md is. -->
