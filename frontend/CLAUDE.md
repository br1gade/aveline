# Aveline frontend — rules

These rules bind inside `frontend/`, alongside the root [`../CLAUDE.md`](../CLAUDE.md). Start
Claude Code here (`cd frontend && claude`) so this file, `.claude/settings.json` and the hooks
apply. The API rules in §4 come from [`../docs/CLIENT_CLAUDE.template.md`](../docs/CLIENT_CLAUDE.template.md),
which the backend team maintains; when that template changes, copy the change here.

## 1. Scope

- `docs/` at the repository root is the contract between the two teams. `docs/API.md` describes
  the API; `backend/openapi.json` is generated from it.
- `frontend/docs/` is this team's reasoning: [ARCHITECTURE.md](docs/ARCHITECTURE.md),
  [WORKFLOW.md](docs/WORKFLOW.md), [BACKEND_REQUESTS.md](docs/BACKEND_REQUESTS.md) and the design
  folder, [docs/design/](docs/design/README.md).

## 2. Boundaries

- **Edit only `frontend/**`.** Never touch `backend/**`, `docs/**` or root files. The path guard
  refuses them.
- **Shared files** change only on the user's explicit instruction, in a session started at the
  repository root.
- **A missing or wrong API** becomes an entry in [BACKEND_REQUESTS.md](docs/BACKEND_REQUESTS.md),
  never a workaround. A temporary stand-in is allowed only when it is recorded there and in
  `docs/design/DESIGN_DECISIONS.md` §6 with its exit (PD-21 is the example).
- **When a document and the code disagree, stop and say so.** Do not pick one silently.

## 3. Before writing code against the API

1. Read `../docs/API.md` §1 (conventions) and §8 (things that bite), then the feature's section.
2. Run `npm run api:generate`. Request types come from `backend/openapi.json`. Response types are
   hand-written per feature in `types.ts`, marked "interim until FR-1", because the schema has
   none yet.
3. Check [BACKEND_REQUESTS.md](docs/BACKEND_REQUESTS.md) and the BACKLOG items it names.

## 4. Non-negotiable client behaviours

From the template; getting them wrong breaks users.

- **Serialise token refresh.** The refresh token rotates. One in-flight refresh per tab, and a Web
  Lock across tabs (`src/api/session/`).
- **Never `parseFloat` or `Number()` money.** Minor units arrive as strings. Use `src/lib/money`.
- **Retry on 401, never on 403.**
- **Render the `locale` the response names**, not the one requested.
- **Render `blocks` in array order.** Never sort. Unknown block types render nothing.
- **After a payment redirect, call confirm.** The return URL proves nothing.
- **Format times in the event's time zone** (`src/lib/time`), never the device's.
- **Capability links are credentials.** Guest, ticket and brief tokens never reach logs, analytics,
  error reports or screenshots (`src/lib/capability-links`). A link preview never names a guest.
- **Never use `devLink`.** Read `?token=` links, then remove the token with `history.replaceState`.

## 5. Design

- The written source of truth is [docs/design/](docs/design/README.md). Read its README first.
- **Confirmed decisions (C-) bind; provisional defaults (PD-) are what we build on while a
  question is open.** Follow `DESIGN_DECISIONS.md` §1.1. Never present a PD as decided.
- **Tokens:** `src/styles/tokens.css` and `theme.css` are generated from `src/styles/tokens.json`
  by `npm run tokens`; never edit the CSS by hand. Components use semantic tokens, never raw hex.
- **Fonts** are the four Noto families, self-hosted. `font-synthesis: none`. No meaning carried by
  italic.
- **Accessible by default:** WCAG 2.2 AA, targets at least 44 px, visible focus, errors with an
  icon and words.

## 6. Stack rules (binding)

- **TypeScript strict,** no `any`, no non-null assertions to silence the compiler.
- **React Router 8, framework mode, server rendering.** Routes are listed in `src/routes.ts`;
  route modules stay thin: loader or clientLoader, meta, headers, layout.
- **Features own their UI and data:** `src/features/<capability>/` with `api.ts`, `components/`,
  `types.ts`, `schemas.ts` and an `index.ts` public surface, plus `index.server.ts` for server-only
  loaders. A feature imports another only through those two; `api/`, `lib/` and `ui/` never import
  from `features/`. The invitation's form controls are in `src/ui/form/`; the app's shadcn/ui kit
  is in `src/ui/kit/`, mapped onto the tokens in `src/styles/app-kit.css`, never the CLI's palette.
- **A form that submits from JavaScript** has `method="post"` and a submit button disabled until
  hydration (`useIsHydrated`), so nothing typed reaches the address bar before React runs.
- **Server state** through route loaders now, TanStack Query when the app needs caching; filters
  and tabs in the URL.
- **Forms:** React Hook Form with Zod. The server stays the authority; a `400` maps onto fields.
- **No hard-coded user-facing strings.** i18next namespaces in `src/locales/<hy|ru|en|fr>/`.
  Armenian and Russian strings are drafts until a native reader checks them (PD-9); French ships
  as translated, without a native reading (C-23).
- **No browser globals at module scope**; every module must be safe to render on the server.
- **Lint limits** match the backend: complexity 10, depth 3, 60 lines per function, 4 parameters,
  zero warnings. Extract rather than disable.
- **No new dependency without asking.** Justify size, maintenance and server-rendering safety.

## 7. Verification

- `npm run verify` must pass: generate, tokens check, format check, typecheck, lint, tests, build.
- Touched journeys pass `npm run test:e2e` against the local backend.
- Review the diff against the plan; remove or explain anything unplanned.
- `npm run check:boundaries` must list nothing outside `frontend/`.

## 8. Git

- Conventional commits with the `frontend` scope; the body says why. Add **"For the backend
  team:"** when a change depends on or asks for backend work.
- **Never commit or push unless the user asks.** Never `--no-verify`. Never force-push to `main`.
- **The frontend stays off `main` for now** (setup proposal A6): never push to `main` or open a
  pull request against it.

## 9. Documentation

- Update the governing doc in the same change as the behaviour. Keep every "Not yet built"
  section honest.
- `ARCHITECTURE.md` keeps a dated decision log; a provisional deviation from the setup proposal is
  logged there.

## 10. Never

- Edit outside `frontend/`, or hand-edit `src/api/schema.ts`, `src/styles/tokens.css` or
  `src/styles/theme.css`.
- Work around a missing API without a BACKEND_REQUESTS entry.
- Put a capability token in a log, a test fixture committed to git, or a screenshot.
- Parse money with floats, sort blocks, or format an event time in the device's zone.
- Commit, push or add a dependency without being asked.
