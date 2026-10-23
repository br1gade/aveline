# Frontend setup proposal

> **Status: under review.** Decisions taken on 9 October 2026 are in the
> [decision record](#decision-record), which wins wherever the body differs. Everything else is
> still a proposal.
> Branch `frontend/setup` · 9 October 2026 · based on `main` at `521d4fc`. Backend facts re-checked
> against `origin/main` at `2040a17`.
>
> *23 October 2026:* the backend's fixes up to `d23ff2d` fixed or built every item §16.1 lists,
> except F24 and F26; F28 is now only the template preview, since B46 built its variants. The
> passages that depended on them carry a dated note. The live register of
> requests is [BACKEND_REQUESTS.md](BACKEND_REQUESTS.md), not §16.2.
>
> **Readers.** The frontend lead owns the decision record. The backend developer is asked to read
> §3, §4, §13, §16 and §17.3, which change shared process or need backend work.
>
> This branch adds this one file. No backend code, shared document or root file is changed.

---

## Decision record

Taken with the frontend lead on 9 October 2026. This table is the single source for decisions:
the sections it names have been updated to match it.

| # | Topic | Outcome | Consequence |
|---|---|---|---|
| A1 | Framework and rendering | **React Router 8 framework mode, server rendering from day one**, as recommended | §5.2 stands |
| A2 | UI translations | **i18next with react-i18next**, as recommended | §5.9 stands |
| A3 | Refresh-token storage until FR-12 | **`localStorage` behind `tokenStore`, with cross-tab Web Locks**, as recommended | §5.5 stands. The httpOnly cookie (FR-12) stays a later hardening |
| A4 | Node version | **Node 26, through a shared root `.nvmrc`**, as recommended | Needs the backend developer's agreement (B-8). Locally: `nvm install 26 && nvm alias default 26` |
| A5 | Review rule | **The frontend fast lane.** This differs from the recommendation | A pull request touching only `frontend/**` merges after CI, the self-review checklist and an AI review. Anything touching backend, `docs/` or root files needs the other developer (§3.5, §13) |
| A6 | Merging into `main` | **The frontend does not push or merge into the shared `main` for now, possibly until launch.** The merge method is decided later | Frontend work collects on `frontend/integration` (A6b). Squash into `main` (§3.5) is on hold |
| A6b | Where frontend branches integrate meanwhile | **Recommended, awaiting review: a temporary `frontend/integration` branch made from `main`** ([§3.8](#38-temporary-integration-workflow-a6b)). `frontend/setup` and every feature branch merge into it by pull request; it takes in `main` by weekly merge commits; it is replayed onto `main` and deleted when the frontend joins | Items marked **[Backend agreement]** in §3.8 (BA-1 to BA-6) need the backend developer before anything is created |
| A7 | Deployment layout | **Open — decide with the backend developer.** Options: one domain through Caddy (§5.13's recommendation) or `app.` and `api.` subdomains | Part of FR-11 and B-5 |
| A8 | A `frontend/AGENTS.md` pointer for Codex | **Open** | — |
| A9 | Claude Code's sandbox | **Open — decide later.** Options: a trial after the scaffold, from day one, or never (§10.4) | Rules, hooks and CI apply meanwhile |
| A10 | When to add Storybook | **Open.** Options: during setup, or together with the invitation renderer | — |
| A11 | This proposal | **Delete it once ARCHITECTURE.md and WORKFLOW.md absorb these decisions**, as recommended | Git history keeps it |
| A12 | Design first, or features first? | **Recommendation, at the frontend lead's request:** design the invitation and a small set of tokens first, with Claude Design; build the organizer app's features first. Confirm or change | Below. The invitation design and tokens are in [design/](design/BRAND_BRIEF.md) (12 October 2026) |

### A12 — design first, or features first?

**Split it by surface, and don't make the whole client wait for design.**

- **The guest invitation: design first.** It is the front door, and its look is what hosts compare
  with the single-page vendors. Its design also fixes the renderer's architecture: which variants
  exist and how palettes and fonts become tokens. Building it before designing it means building it
  twice. Design against the real contract:
  - the 14 block types, `variant`, and each template's `palettes` and `allowedFonts`;
  - the household RSVP form;
  - mobile first;
  - Armenian and English text side by side.
- **A small design system: first, alongside the setup.** Colours, a type scale with
  Armenian-capable fonts, spacing and radius. They become the Tailwind tokens, so every later screen
  inherits them, and a restyle is a token change rather than a rewrite.
- **The organizer app: features first**, on shadcn/ui with those tokens. Its screens are forms,
  lists and tables whose shape comes from the API and from real use. Polished mockups made now
  would be redrawn once the flows exist. Restyle once the core loop works.
- **Order:**
  1. Finish the setup.
  2. Spend a time-boxed Claude Design session on the tokens and one or two invitation templates
     across the key blocks, while the sign-in and organization screens are built.
  3. Build the invitation renderer from those designs.

**Why not either extreme.** Designing everything first delays a pilot that is blocked only on the
client (BACKLOG F1), and produces mockups of screens the API cannot support yet — team management,
F5, for one (*built by 23 October 2026*). Building everything first and designing afterwards turns the invitation, the one
screen where looks are the product, into rework.

---

## 0. Summary

**Recommendation in ten lines**

1. **Git:** short-lived `frontend/<topic>` and `backend/<topic>` branches, a pull request for every
   change, no permanent `frontend/main`. The frontend does not merge into `main` for now (A6); it
   collects on a temporary `frontend/integration` branch (§3.8, awaiting review).
2. **Ownership:** frontend agents edit `frontend/**`. A short, named list of shared files may
   change by pull request with the backend developer's review. `backend/**` is never edited.
3. **Stack:** React 19 with React Router 8 in framework mode on Vite 8. Public pages (the guest
   invitation, public events) are rendered on the server so link previews work in chat apps;
   the signed-in app renders in the browser, where the session lives.
4. **API:** request types generated from `backend/openapi.json`, calls through `openapi-fetch`,
   TanStack Query for server state, React Hook Form with Zod for forms.
5. **Session:** access token in memory, refresh token in `localStorage`, refreshes serialised
   across browser tabs, never retried on 403.
6. **Contract rules live in code,** not only in prose: one money module, one time module, a block
   registry, a route table and capability-link scrubbing, each with tests.
7. **Docs:** four frontend documents plus the agent files. No copy of the API description.
8. **Claude Code:** frontend sessions start in `frontend/`. Frontend-owned settings and a
   path-guard hook enforce the boundary; CI and code owners are the final authority.
9. **Tests:** Vitest for logic and components; Playwright end-to-end against the real local
   backend, as the scaffold's own note asks.
10. **CI:** GitHub Actions per area plus a boundary check; `main` protected, and
    `frontend/integration` too while it exists (§3.8).

**Why speed matters.** [`docs/BACKLOG.md`](../../docs/BACKLOG.md) (8 October) says the client,
F1, is the only P0 still blocking the free pilot. So this proposal keeps the setup small: gates
such as bundle budgets and Lighthouse arrive with the screens they guard, not before. When
Storybook arrives is open (A10).

**What the frontend needs from the backend first** (§16): response schemas in the OpenAPI
document (0 of 139 operations have one today); `GET /me` and per-event permissions; rate limits
that a dashboard and a venue door can live with; an agreed deployment topology; and pull
requests into a protected `main` for both teams.

**Decided on 9 October** (decision record): React Router 8 with server rendering from day one,
i18next, `localStorage` with cross-tab locks, Node 26, the frontend fast lane, and no frontend
merges into `main` for now. **Awaiting review:** the temporary integration workflow (§3.8).
**Still open:** the merge method into `main`, the deployment layout, the sandbox, the AGENTS.md
pointer, and when to add Storybook.

---

## 1. What this is based on

| Source | What it settled |
|---|---|
| Root [`CLAUDE.md`](../../CLAUDE.md), [`AGENTS.md`](../../AGENTS.md), [`README.md`](../../README.md) | Shared conventions, the `docs/` vs `backend/docs/` split, "say so rather than work around it" |
| [`docs/API.md`](../../docs/API.md) and the domain docs in [`docs/`](../../docs/) | The contract, its gotchas (§8), the guest, ticket and vendor flows |
| [`docs/BACKLOG.md`](../../docs/BACKLOG.md), [`docs/GOING_LIVE.md`](../../docs/GOING_LIVE.md) | What is broken or unbuilt, with IDs this proposal refers to (B…, F…, D…) |
| [`docs/CLIENT_CLAUDE.template.md`](../../docs/CLIENT_CLAUDE.template.md) | The backend team's non-negotiable client rules, meant to seed `frontend/CLAUDE.md` |
| [`backend/CLAUDE.md`](../../backend/CLAUDE.md), [`backend/README.md`](../../backend/README.md), `backend/docs/` | Backend rules, lint limits, deployment (Caddy in front of the API only) |
| [`backend/openapi.json`](../../backend/openapi.json) | 111 paths, 139 operations, 55 schemas at `2040a17`. Analysed mechanically (§16) |
| Backend source, spot checks | The links the backend emails, session rotation, CORS, URL redaction, the seed |
| The existing scaffold: [`../.env.example`](../.env.example), [`../.gitignore`](../.gitignore), [`../eslint.config.mjs`](../eslint.config.mjs), the notes in `docs/.gitkeep` and `test/.gitkeep` | Decisions already taken for the frontend, adopted here |
| geaclient, a separate frontend project, read locally and not modified | The reference project, compared in §14 |
| Claude Code documentation (references at the end) | How settings, permissions, hooks, sandboxing and CLAUDE.md loading actually work |
| The npm registry, 9 October 2026 | Current versions and peer ranges (§6) |

---

## 2. Requirements that drive the frontend

Each row is a fact from the contract or the product, and what it forces on the client.

| # | Fact | Consequence |
|---|---|---|
| R1 | Invitation and event links are shared in messaging apps, and "preview metadata matters more than search ranking" (PRODUCT_SPEC §13.2, API.md §5) | Chat-app crawlers do not run JavaScript. Public pages must send their title and Open Graph tags in the server's HTML |
| R2 | The invitation is "the front door", opened on phones minutes after sending (PRODUCT_SPEC §12) | Minimal JavaScript on guest routes, fast first paint, Armenian-capable fonts |
| R3 | 15-minute access token; refresh token returned in the JSON body and rotated on every use; two concurrent refreshes sign the user out (API.md §2, §8.1) | A session module that serialises refreshes across tabs, not only within one |
| R4 | Roles are not in the token: "ask the API and handle 403" (API.md §2) | No JWT decoding for UI. But no endpoint answers "what may I do here" (FR-5, FR-6) |
| R5 | A fresh account has no organization, and every organization route answers 403 until `POST /organizations` (API.md §6) | An onboarding gate in the app shell |
| R6 | Capability links are credentials (root CLAUDE.md §3, API.md §3) | Route parameters are secrets: referrer policy, no analytics, scrubbed errors and logs. Mirror `backend/src/common/redact-url.ts` |
| R7 | The backend already emails links to client paths (§5.3) | Those paths are a contract. One route table owns them, and a test pins them |
| R8 | Money is integer minor units as strings; AMD has no subunit (API.md §1) | One money module. Strings and BigInt only; `parseFloat` banned by lint |
| R9 | The locale is negotiated; render `locale` from the response (API.md §1) | Guest-page chrome follows the response's language, not the one requested |
| R10 | Times are formatted in the event's IANA time zone (API.md §1) | One time module. Host inputs are converted from the event's wall time to UTC |
| R11 | Blocks arrive in display order; unknown types render as nothing; `variant: null` means default; the cover is the HERO's first photo (API.md §4) | A block registry lookup with a null fallback. Never sort |
| R12 | The payment return proves nothing — call confirm; one idempotency key per checkout attempt; `reservesUntil` is a real deadline (API.md §5) | A checkout state machine, a key that survives reloads, a countdown |
| R13 | One error shape; `message` is a string or an array; refusals start with the field name (API.md §1, §6) | One `ApiError` type. Field prefixes map onto form inputs |
| R14 | Lists use an envelope, `limit` is 1–100 or a 400; some endpoints return bare arrays | Pagination per endpoint; never assume an envelope |
| R15 | 10 requests a second and 100 a minute, per IP (API.md §1) | Deduplicated, cached requests and gentle polling. A real risk at venues where staff share one IP (FR-7) |
| R16 | Polling, no push (arrivals) | Query polling that pauses in background tabs |
| R17 | Uploads up to 10 MB; no server-side resizing (API.md §6) | Downscale images in the browser before upload until F18. *F18 was built by 23 October 2026: the backend makes smaller copies* |
| R18 | Templates are data; "adding a template is an INSERT" (INVITATION_DESIGN §1) | The renderer is driven by tokens and variants, with no per-template code. Fonts need a delivery answer (FR-9) |
| R19 | The editor loads from `GET /invitations/:slug/design`, never the public page; each language is edited on its own (API.md §6) | The designer and the guest page share the renderer but not the data source |
| R20 | Mail is real in development (Mailpit on `:8025`); `devLink` exists only in development (API.md §9) | Flows read tokens from the URL; end-to-end tests read mail from Mailpit |
| R21 | Scaffold notes: no API description in frontend docs; test the contract against the real backend; generated types are not committed | Adopted as they stand (§8, §12, §5.4) |

---

## 3. Git and branch strategy

*Backend developer: please read. It changes how both teams reach `main`.*

> **Decided 9 October (A5, A6):** the frontend does not push or merge into `main` for now,
> possibly until launch, and the review rule is the frontend fast lane. The merge method into
> `main` is open. Until the frontend joins `main`, its branches integrate as recommended in
> **§3.8** (awaiting review). §3.1–§3.7 describe the flow from then on.

### 3.1 Branches

| Branch | Purpose | Lifetime |
|---|---|---|
| `main` | Integration. Always builds, always runs locally | Permanent, protected |
| `frontend/<topic>` | One frontend change: `frontend/setup`, `frontend/auth`, `frontend/invitations`, `frontend/guests` | Days; deleted after merge |
| `frontend/integration` | **Temporary**: collects frontend work while it stays off `main` (§3.8, awaiting review) | Until the frontend joins `main`; then deleted |
| `backend/<topic>` | One backend change | The same |

- `<topic>` is kebab-case and names the capability, not a person.
- There is **no** permanent `frontend/main` or `develop`. Integration happens on `main` — and, until
  the frontend joins it, on the temporary `frontend/integration` (§3.8).
- **Never create a branch named exactly `frontend` or `backend`.** Git stores refs as paths, so a
  branch called `frontend` makes every `frontend/*` branch impossible to create, and the reverse.
- A branch belongs to its author. Nobody else pushes to it without asking.

### 3.2 Creating and updating a branch

```bash
git switch main && git pull --ff-only      # until the frontend joins main: see §3.8.3
git switch -c frontend/<topic>

# while working
git fetch origin && git rebase origin/main
npm run api:generate             # after any rebase that changed backend/openapi.json
git push -u origin frontend/<topic>
git push --force-with-lease      # only after rebasing, and only on your own branch
```

### 3.3 Commits

- **Conventional Commits with the area as scope**, as the history already does:
  `feat(frontend): …`, `fix(frontend): …`, `test(frontend): …`, `docs(frontend): …`,
  `refactor(frontend): …`, `chore(frontend): …`.
- The subject says what changed; the body says why (root CLAUDE.md §5).
- When a change depends on, works around, or asks for backend work, add a paragraph headed
  **"For the backend team:"**. It mirrors the backend's existing "For the client team:" paragraphs.
- Say plainly when a change breaks something for the other team. From the frontend that is rare:
  renaming a client path the backend emails is one case (§5.3).
- AI-assisted commits keep the `Co-Authored-By` trailer the history already uses.
- One logical change per commit. Never commit generated files, `.env`, competitor material, or
  screenshots that show a capability token.

### 3.4 Pull requests

- One feature or fix per pull request, small enough to review in one sitting.
- The title is a conventional-commit subject, so it can become the commit message if pull requests
  are squashed (the merge method is open, A6).
- The description follows a template (a shared file, §4):
  - **Why**
  - **What changed** (screens, routes)
  - **API endpoints used**, and backend gaps hit, with request IDs
  - **Docs updated**
  - **Verification**: commands run and results
  - **Boundary check** output (§10)
  - **Screenshots** with tokens redacted
- Open a draft early so the other team sees work in progress.

### 3.5 Review and merge

- **Decided (A5): the frontend fast lane.** A pull request touching only `frontend/**` merges after
  green CI, the self-review checklist (§11) and an AI review. Anything touching backend, `docs/` or
  root files needs the other developer's approval. With two people an author cannot approve their
  own pull request, so this is what lets frontend-only work flow without waiting on the backend.
- The alternative considered was one approval from the other developer on every pull request.
  Whether the backend wants the same fast lane for backend-only work is theirs to decide (B-2).
- **Merge method: open (A6).** The recommendation was squash: one revertable commit per pull
  request and a linear `main`, with rebase merge allowed when individual commits are meaningful.
- Do not merge `main` into a feature branch; rebase instead. Delete the branch after merging.

### 3.6 How the two teams' work coexists

- **Contract changes.** The backend changes code, regenerates `backend/openapi.json` and updates
  `docs/API.md` in one commit, which is already its rule. After that merges, the frontend rebases,
  regenerates types, and the typecheck shows exactly what broke.
- **Requests.** The frontend records a need in `frontend/docs/BACKEND_REQUESTS.md` through a
  frontend pull request. The backend developer triages it into `docs/BACKLOG.md`, where it gets a
  B or F number, and the frontend entry is replaced by a link. The client never works around a
  missing endpoint permanently (root CLAUDE.md §2).
- **Depending on unmerged backend work.** Run that backend branch in a second worktree
  (`git worktree add ../aveline-backend backend/<topic>`) and develop against it. Do not merge the
  frontend pull request until the backend one is on `main`. Feature branches are never merged into
  each other.
- **Early warning.** A backend pull request that changes `backend/openapi.json` also runs the
  frontend typecheck, so a breaking change is seen before it merges (§13). This only works once
  frontend code is on `main`. Until then (A6), the frontend line catches breakage when it takes in
  `main`, which is one more reason to do that weekly.
- **Local development** runs against the backend from `main`: the Docker services plus
  `npm run start:dev`. During the integration period it runs from the frontend branch's own
  `backend/`, which is `main` as of the last sync (§3.8.4).

### 3.7 Conflicts in shared and generated files

| File | Rule |
|---|---|
| `backend/openapi.json` | Generated and backend-owned. Never resolve by hand: take either side, then `cd backend && npm run openapi` |
| `frontend/src/api/schema.ts` | Gitignored, so it cannot conflict. Regenerate it |
| `frontend/package-lock.json` | Take `main`'s version, run `npm install`, commit the result. Never hand-merge a lockfile |
| `docs/**`, root `*.md` | The pull request's author resolves after rebasing, keeping both intents. If the other team's text changed meaning, ask before merging |
| Root `.gitignore` | Append-only, in the section for your area |
| `.github/**` | Each area edits its own workflow file. `CODEOWNERS` and the pull request template change only by agreement |

### 3.8 Temporary integration workflow (A6b)

> **Recommendation, awaiting review.** Items marked **[Backend agreement]** need the backend
> developer's agreement before they are set up. Nothing in this section exists yet: no branch,
> setting or workflow has been created.

While the frontend stays off `main` (A6), its work collects on one temporary branch,
`frontend/integration`:

- feature branches start from it and merge back into it;
- backend changes reach it from `main` through regular merges;
- when the frontend joins `main`, its commits are replayed onto `main` and the branch is deleted.

```
main                 ──●───────────●──────────────●──────────────●──▶  backend work
                        \           \ sync         \ sync         \ final sync
frontend/integration     ●───S───────M─────A────────M─────E────────M──▶  replayed onto main, deleted
                             ▲             ▲              ▲
                      frontend/setup  frontend/auth  frontend/events      feature PRs, squashed

  S, A, E   one squashed commit per feature pull request
  M         a merge commit that brings main in (a "sync")
```

#### 3.8.1 The branch

- **Name:** `frontend/integration`. It is the one exception to "short-lived": it lasts only until
  the frontend joins `main`, then it is deleted. It is not a permanent `frontend/main`.
- **Created** from `main` when the setup is ready for review, so the setup arrives through a
  reviewed pull request like everything after it.
- **Protected [Backend agreement — repository settings, admin rights]:**
  - pull requests required, and status checks once CI exists;
  - no force-push and no deletion;
  - merge commits allowed, because syncs need them; squash allowed, because features use it;
  - no linear-history rule on this branch.
- **Never rebased or force-pushed** while it is in use.

#### 3.8.2 Where `frontend/setup` merges

Into `frontend/integration`, by pull request, once the setup commits in §18 are done.

1. Before opening the pull request, rebase `frontend/setup` onto `origin/frontend/integration`.
   Both start from `main`, so this changes nothing unless `main` has moved.
2. Review in the fast lane (A5). Until CI exists, the pull request shows `npm run verify` output.
3. Squash merge, or rebase merge if its commits are kept separate on purpose.
4. Delete `frontend/setup`.

#### 3.8.3 Feature branches: `frontend/auth` and after

```bash
git fetch origin
git switch -c frontend/auth origin/frontend/integration
# … work …
git fetch origin && git rebase origin/frontend/integration    # before opening or updating the PR
npm run api:generate && npm run verify
git push --force-with-lease                                     # your own branch only
```

- **Based on and merged into `frontend/integration`.** Squash merge, one commit per feature; review
  in the fast lane (A5); delete the branch afterwards.
- **Check the base of every pull request.** GitHub proposes `main` by default. Under the fast lane, a
  frontend-only pull request into `main` would pass every rule and land there by mistake. So the
  pull request template says to pick `frontend/integration`, and the boundary check refuses
  `frontend/*` into `main` during this period **[Backend agreement — shared CI]**.
- **Never merge `main` or a `backend/*` branch into a feature branch.** Backend changes reach
  features only through `frontend/integration`, so there is one path and one place to resolve
  conflicts. To try unmerged backend work, run it from a second worktree (§3.6).

#### 3.8.4 Receiving backend changes from `main`

A **sync** merges `main` into `frontend/integration`. It runs weekly, and also whenever a backend
change the frontend needs lands: a new endpoint, a BACKLOG fix, or an `openapi.json` change
announced "For the client team".

```bash
git fetch origin
git switch -c frontend/sync-main-2026-10-16 origin/frontend/integration
git merge origin/main                     # rare conflicts: the frontend changes only frontend/
npm run api:generate && npm run verify    # the typecheck shows any contract break
git push -u origin frontend/sync-main-2026-10-16
```

- **Merge the sync's pull request with "Create a merge commit". Never squash or rebase a sync.** A
  squashed sync copies `main`'s changes without recording where they came from, and the next sync
  applies them again. When there is nothing to resolve, a pull request with `main` itself as the
  head does the same job without the extra branch.
- **Sync pull requests are exempt from the boundary check.** Their changes outside `frontend/` come
  from `main`, already reviewed there **[Backend agreement — shared CI]**.
- **Feature branches catch up afterwards.** Each rebases onto `origin/frontend/integration` and
  regenerates its types.
- **Run the backend from the same checkout.** On any frontend branch, `backend/` is `main` as of the
  last sync, so the running API, `backend/openapi.json` and the generated types agree. For a newer
  backend, sync first.
- **Contract breaks are fixed where they are found.** The frontend fixes them in the sync's pull
  request or right after it. Anything that needs backend work goes to `BACKEND_REQUESTS.md`.

#### 3.8.5 Joining `main`

**When** is decided later (A6), together with the backend developer **[Backend agreement]**.
The recommended triggers, whichever comes first:

1. **Before anything is deployed**, for the pilot or a staging server. Deployments come from
   `main`, never from an integration branch **[Backend agreement]**.
2. When the core loop works end to end: a host creates an event and designs and sends the
   invitation, and a guest answers it.
3. When syncs start costing real time.
4. At launch, at the latest.

Every four weeks, review whether to join sooner, so the temporary branch cannot become permanent
by inertia.

**How:**

1. Agree the date with the backend developer. Freeze merges into `frontend/integration`; open
   feature pull requests finish first or wait.
2. Run a final sync, then `npm run verify` and the end-to-end suite against the backend at `main`.
3. Replay the frontend's own commits onto `main`:
   ```bash
   git switch -c frontend/join-main origin/frontend/integration
   git rebase origin/main      # drops the sync merges; replays one commit per feature
   npm run api:generate && npm run verify
   git push -u origin frontend/join-main
   ```
   The frontend changed only `frontend/`, so the replay should be free of conflicts.
4. Open a pull request into `main`, **approved by the backend developer**. It is the one frontend
   pull request that does not go through the fast lane, and the only `frontend/*` pull request the
   boundary check lets into `main` during this period **[Backend agreement]**. Merge it with
   "Rebase and merge", so `main` keeps a linear history with one commit per frontend feature. If
   `main` allows merge commits by then (A6), a single merge commit is the simpler alternative.
5. Move any branch still open with
   `git rebase --onto origin/main <last integration commit> <branch>`, then delete
   `frontend/integration` and `frontend/join-main`.
6. Switch to the normal flow of §3.1–§3.6: `frontend/*` from `main`, pull requests into `main`.
   In the same step, update the root documents that still describe `frontend/` as empty (§8), by
   pull request with the backend developer's review.

#### 3.8.6 Risks of a long-lived integration branch

| Risk | Mitigation |
|---|---|
| Drift, then one large merge at the end | Weekly syncs. The frontend changes only `frontend/`, so the final step is a mechanical replay of frontend-only commits |
| Contract breaks are found late, because the frontend sees a backend change only when it syncs | Sync weekly and on demand; read the backend's "For the client team" notes. Optionally, a nightly CI job merges `main` into a copy of the integration branch and typechecks the frontend. Scheduled workflows run only from the default branch, so that job's file would live on `main` **[Backend agreement]** |
| A sync squashed or rebased by mistake duplicates backend changes | Syncs always by merge commit; the integration branch is never rebased or force-pushed; its protection allows merge commits |
| The temporary branch becomes a permanent `frontend/main` | Written triggers for joining `main`, a four-weekly review, deletion at the end |
| A frontend pull request merges into `main` by mistake, through GitHub's default base and the fast lane | Pick the base explicitly; the boundary check refuses `frontend/*` into `main` during this period **[Backend agreement]** |
| Something is deployed from a branch other than `main` | Join `main` before the first deployment |
| Shared-file edits on the frontend line collide with `main` | None on `frontend/integration`. The backend developer makes them on `main`, or they wait for the joining pull request **[Backend agreement]** |
| CI and protection exist only on `main` | Protect `frontend/integration` too; the frontend workflow file lives on it until the join **[Backend agreement — `.github/` is shared]** |
| Feature branches are built on a stale base | Rebase after every sync; keep features short |
| The backend developer sees less of the frontend | The branch and its pull requests are on GitHub. A demo is `frontend/integration` with the backend at `main` |
| Root documents on `main` still describe `frontend/` as empty | Updated as part of joining `main` |

#### 3.8.7 What needs the backend developer's agreement

| # | Item |
|---|---|
| BA-1 | Creating `frontend/integration` on the shared remote, and protecting it as in §3.8.1. Needs repository admin rights |
| BA-2 | The boundary check: refuse `frontend/*` into `main` during this period, except the joining pull request; exempt sync pull requests (§3.8.3–§3.8.5) |
| BA-3 | The frontend workflow file living on `frontend/integration` until the join; optionally the nightly contract check on `main` (§3.8.6) |
| BA-4 | Shared-file changes during this period: made by the backend developer on `main`, or held for the join (§3.8.6) |
| BA-5 | When and how the frontend joins `main`: the triggers, their approval of that one pull request, and its merge method (§3.8.5, A6) |
| BA-6 | Deploying only from `main`, so the frontend joins before the first deployment (§3.8.5) |

---

## 4. Ownership boundaries

*Backend developer: please read. It names which shared files the frontend may propose changes to.*

**Frontend-owned** means the frontend decides and changes it without coordination, though still
by reviewed pull request. **Shared** means either team may propose a change by pull request, the
other team reviews it, and an agent touches the file only when the user explicitly asks in that
session.

| Path | Owner | May a frontend agent edit it? | Coordination |
|---|---|---|---|
| `frontend/**`: source, tests, docs, `.claude/`, `package*.json`, configs, `.env.example`, `.gitignore`, `eslint.config.mjs` | Frontend | **Yes** | Normal pull request |
| `backend/**`, including `backend/docs/**`, `backend/CLAUDE.md`, `backend/package*.json`, `backend/.env.example` | Backend | **Never.** Read only | Request through `BACKEND_REQUESTS.md` |
| `backend/openapi.json` | Backend, generated | Never, and nobody edits it by hand | Regenerated by the backend |
| `docs/API.md` and the domain docs (`ACCESS_CONTROL`, `INVITATION_DESIGN`, `VENUES_AND_SEATING`, `PAYMENTS`) | Shared contract, maintained by the backend alongside its code | Only on explicit instruction | Pull request with the backend developer's review |
| `docs/PRODUCT_SPEC.md` | Shared, product | Only on explicit instruction | Both review |
| `docs/BACKLOG.md` | The backend developer's register | No. Propose items in `BACKEND_REQUESTS.md` | The backend developer triages |
| `docs/GOING_LIVE.md` | Shared | Yes, to append frontend go-live items, on instruction. Root CLAUDE.md asks everyone to "add to it when you find something" | Backend developer reviews |
| `docs/CLIENT_CLAUDE.template.md` | Backend (its API rules) | No | Changes reach `frontend/CLAUDE.md` by pull request |
| Root `CLAUDE.md`, `AGENTS.md`, `README.md` | Shared | Only their frontend rows and sections, on instruction | Backend developer reviews |
| Root `.gitignore` | Shared | Appending to a frontend section, on instruction. Prefer `frontend/.gitignore` | Backend developer reviews |
| Root `.claude/` (settings, hooks, the `feature` skill), `.codex/`, `.agents/` | Shared location, backend-specific content | No. Frontend agent config lives in `frontend/.claude/` | Any root change by agreement |
| `.github/**` (does not exist yet) | Shared; each workflow file owned by its area | Its own workflow file, once agreed | `CODEOWNERS`, pull request template and rulesets by agreement |
| Root `package.json` / `package-lock.json` | Do not exist. Proposed to stay absent | — | Each area installs on its own; no workspace |
| Root `.nvmrc`, `.editorconfig`, `.vscode/` | Do not exist | — | A shared root `.nvmrc` is proposed in §17.3 |

How these boundaries are enforced is §10.

---

## 5. Frontend architecture

### 5.1 Decisions at a glance

| Concern | Recommendation | Main reason | Also considered |
|---|---|---|---|
| Language | TypeScript 6.0, strict | Same major as the backend. `typescript-eslint` supports `<6.1` | TypeScript 7: no type-aware lint yet |
| UI library | React 19 | — | — |
| Framework and build | **React Router 8, framework mode, on Vite 8** | Server-renders where link previews need it and renders in the browser where the session lives; Vite-native; one boring major a year | Next.js 16, plain Vite SPA, TanStack Start |
| Routing | Config-based `src/routes.ts` | The route contract (§5.3) sits in one greppable file | File-system routes |
| API client | `openapi-fetch` over `openapi-typescript` types | Generated request types (README already names this generator), tiny runtime | Kubb, orval, hand-written |
| Server state | TanStack Query 5 | Caching, deduplication, polling, invalidation | Router loaders alone, SWR |
| Client state | Component state and URL search params; Zustand only if needed | Little genuinely global client state | Redux; Zustand by default |
| Forms | React Hook Form with Zod 4 | — | Conform, TanStack Form |
| UI kit | Tailwind CSS 4, shadcn/ui on Radix, lucide icons | Components we own; accessible primitives | MUI, Mantine |
| Invitation rendering | A separate renderer driven by tokens and variants | Templates are data | One component per template |
| UI language | i18next with react-i18next | No build step; `Intl` plural rules cover Russian; SSR-friendly | Lingui, react-intl |
| Dates | `Intl` with `@date-fns/tz` | Conversions in the event's time zone | Luxon, a Temporal polyfill |
| Money | Our own `lib/money` | Exact, and small | dinero.js |
| Errors | `ApiError`, route error boundaries, Sentry off without a DSN | Mirrors the backend | — |
| Tests | Vitest 5, Testing Library, MSW 3, Playwright | The backend's advice on real-backend testing | Cypress, Jest |
| Lint and format | ESLint 10, `typescript-eslint`, Prettier | Matches the backend | Biome |
| Package manager | npm with exact pins | Same as the backend; no workspace | pnpm (geaclient) |

### 5.2 Rendering

**Why not a plain single-page app.** A chat crawler fetching `/invitations/anna-davit/g/…` gets
an empty shell and shows a bare link. Fixing that needs a server that writes the preview tags,
and once there is a server, rendering the page on it costs little more.

**Why not Next.js.** The App Router is server-first and built around cookies. Aveline's session
is a bearer token the browser holds — that is the backend's design, with the refresh token in the
response body and CORS for browser calls — so almost every dashboard route would be a client
component. We would pay Next's server and caching complexity to benefit only the public pages;
geaclient needed decision records just to police `"use client"`, cache directives and chunking. React
Router 8 gives the same per-route `meta` and server rendering with a smaller surface, and its
yearly majors are deliberately boring. Next was the credible alternative; the decision went to
React Router (A1).

| Route group | Paths (illustrative) | Rendering | Data |
|---|---|---|---|
| Public | `/`, `/pricing`, `/events`, `/events/:slug`, `/invitations/:slug`, `/invitations/:slug/g/:guestToken` | Server | Server `loader` against the public API; `meta` from the response |
| Capability | `/tickets/:accessToken`, `/briefs/:briefToken` | Server shell | Fetched in the browser (`clientLoader`); `noindex`; `no-referrer` |
| Auth | `/login`, `/register`, `/reset-password`, `/verify-email`, `/accept-invite` | Server shell | Browser actions |
| App | `/app/**`: events, guests, design, seating, door, billing, settings | Browser only | `clientLoader` with TanStack Query; the server renders `HydrateFallback` |

Rules that keep this safe:

- **Share previews never name a guest.** A personalised link's preview is built from the event and
  `coverUrl`, so a forwarded link does not put a guest's name into a group chat.
- **Invitations are always `noindex`** (PRODUCT_SPEC §13.1). Public events use `metadata` verbatim.
- **Time-dependent UI renders after hydration**: countdowns, "five minutes ago", `reservesUntil`.
- **No browser globals at module scope**, so every module stays safe to render on the server.

React Router's SPA mode (`ssr: false`), switched to server rendering later, was the alternative.
A1 chose server rendering from day one, because the guest page is on the pilot's critical path.

### 5.3 The route contract

The backend already builds links to client paths from `PUBLIC_APP_URL` (default
`http://localhost:5173`):

| Client path | Built in |
|---|---|
| `/reset-password?token=…`, `/verify-email?token=…`, `/accept-invite?token=…` | `backend/src/infra/auth/account.service.ts` |
| `/invitations/:slug/g/:guestToken` | Invitation, reminder, RSVP-confirmation and change-notice senders under `backend/src/modules/invitations/sending/` |
| `/tickets/:accessToken` | `backend/src/modules/ticketing/ticket-notifier.service.ts` |

The client also constructs `/briefs/:briefToken` (API.md §6) and the return URLs it passes to
payments.

- All of them are defined once in `src/routes.ts` and pinned by a test. Renaming one is a breaking
  change that needs a backend change too.
- **Return URLs carry no query string**, because the fake gateway appends `?fakePayment=…`. A
  ticket checkout returns to `/tickets/:accessToken`, a page that calls confirm whenever the order
  is not settled (confirm is safe to repeat). A subscription returns to the invoice page, which
  calls `POST /invoices/:number/confirm` the same way.
- The development server stays on port 5173, the backend's default `PUBLIC_APP_URL`.
- FR-8 asks for this table to be written into `docs/API.md`, so neither side renames a path
  without the other knowing.

### 5.4 The API layer

- `npm run api:generate` runs `openapi-typescript ../backend/openapi.json -o src/api/schema.ts`.
  The output stays gitignored, as the scaffold already decided, and is regenerated before `dev`,
  `typecheck` and in CI.
- **Two clients.** `publicApi` has no credentials and serves guest, ticket, brief and public-event
  calls. `appApi` adds the bearer token and refresh. The base URL is the API origin, because the
  generated paths already start with `/api/v1`.
- **A custom `fetch` underneath both:**
  - It sends its own `x-request-id` (`crypto.randomUUID()`), so the id is known even though a
    browser cannot read that header cross-origin (FR-10).
  - On 401 it refreshes once (§5.5) and retries; on 403 it never retries.
  - It turns every failure into one `ApiError { status, messages, fieldErrors, requestId, path }`.
- **Response types are interim and hand-written** for now. Each feature keeps them in its own
  `types.ts`, written from the API.md examples and marked "interim until FR-1". There is no runtime
  validation by default; the end-to-end tests against the real backend catch drift. When FR-1
  lands, those types are deleted, and Kubb (Zod, fakers, MSW handlers generated from the same
  schema) becomes worth reconsidering.
- **Request bodies use generated types.** Form schemas are declared with `satisfies` against
  `components['schemas'][…]`, so a renamed request field fails the build.
- A pagination helper handles the list envelope. Endpoints that return bare arrays are typed as
  bare arrays.
- Uploads use `FormData`. Images are downscaled in the browser before upload until F18 lands.
  *F18 landed by 23 October 2026.*

### 5.5 Session and authentication

- **Where the tokens live.** The access token is held in memory only. The refresh token is in
  `localStorage`, behind a single `tokenStore` module, so moving it to an httpOnly cookie later
  (FR-12) changes one file.
- **Refresh is single-flight across tabs:**
  1. Take a Web Lock: `navigator.locks.request('aveline-session-refresh', …)`.
  2. Inside it, read the stored refresh token again. If another tab has already rotated it, use
     the new pair.
  3. Otherwise call `POST /auth/refresh` and store the new pair.

  Within a tab, the in-flight promise from API.md §2 still applies, and a proactive refresh runs
  shortly before `expiresIn` elapses. Without this, two tabs sharing one refresh token present it
  together: one gets a 401 and signs the user out, and B53 means the backend may even issue two
  live sessions. *23 October 2026: B53 is fixed. Instead, a refresh token presented more than a
  minute after it was replaced or revoked is treated as theft and ends every session of the
  account (`docs/ACCESS_CONTROL.md` §5, FR-22), so the lock matters more.*
- **Logout** calls `POST /auth/logout`, clears storage, and broadcasts on a `BroadcastChannel` so
  every tab signs out. "Sign out everywhere" calls `logout-everywhere`.
- **Onboarding.** Register, then create the organization, then enter the app. *23 October 2026:
  register no longer signs in (D16), so the client logs in after registering.* Until `GET /me` exists
  (FR-5), "no organization" is detected from `GET /organizations/current` answering 403, which
  API.md documents. This interim is flagged.
- **Permission-aware UI** waits for FR-6. Until then actions are shown and a 403 gets a clear
  message. Hiding a button is never treated as security: B11 shows the API itself must refuse.
- The JWT is never decoded to decide what UI to show (API.md §2).
- **Token links.** Pages opened from `?token=` links read the token, then remove it from the
  address bar with `history.replaceState`. The token is never logged, and `devLink` is not used.

### 5.6 Server and client state

- **One `queryOptions` factory per endpoint**, in `features/<x>/api.ts`. App routes' `clientLoader`s
  call `queryClient.ensureQueryData`, so navigating back shows cached data immediately.
- **Defaults:**
  - no retry on 4xx;
  - retry GETs with backoff on network errors, 5xx and 429;
  - arrivals poll about every ten seconds and pause when the tab is hidden;
  - requests are deduplicated by key, which also keeps us under the rate limit.
- **Mutations invalidate what they change.** After a guest moves household, `GET /guests` is
  refetched, as API.md asks.
- **Optimistic updates only where the API is atomic and cheap to roll back**, such as block
  arrangement. Never for capacity, money, seating or check-in: there a 409 is a routine outcome to
  show, followed by a refetch.
- **Client state:**
  - component state first;
  - URL search params for filters, tabs and pagination, so they are shareable and the back button
    works;
  - context for the session and the locale;
  - Zustand only for a store that genuinely spans routes, if one appears — the seating editor and
    the designer are the likely candidates.

### 5.7 Forms and validation

- React Hook Form with Zod 4 through `@hookform/resolvers`. Zod gives fast feedback; the server
  stays the authority.
- **A 400 maps onto fields.** Each `message` entry that starts `field: …` goes to that input, and
  the rest show at form level. The backend uses that prefix deliberately (API.md §6).
- **Money inputs** become minor-unit strings through `lib/money`.
- **Date-time inputs** are read as the event's wall time and converted to UTC through `lib/time`.
- **Translated fields are edited one language at a time**, matching `PATCH /blocks/:type`.
- **Choice answers send the option's position**, not its text (API.md, RSVP).

### 5.8 UI, styling and the invitation renderer

There are two visual systems.

1. **The app** (organizers, sign-in, the door): Tailwind 4 tokens and shadcn/ui components copied
   into `src/ui/`. That is code we own, built on Radix primitives that handle focus, dialogs and
   menus correctly. Icons from lucide. Door screens are designed mobile-first.
2. **The invitation renderer** (`features/invitation-renderer`): pure, safe to render on the server,
   and light on JavaScript.
   - **Blocks:** `blockRegistry: Record<BlockType, Component>`, where an unknown type renders
     nothing.
   - **Variants:** `variant` picks the layout; `null` or an unknown variant falls back to the default.
   - **Theme:** `effectiveTheme`, palettes and colours become CSS custom properties.
   - **Fonts:** come from a registry keyed by family name, with an Armenian-capable fallback stack.
   - **Media:** comes from `block.media`; `musicUrl` drives one player with an explicit on/off
     control.
   - **Used by both pages:** the guest page, and the designer preview, which is fed from
     `GET /invitations/:slug/design` resolved to one language in the browser.

- **Accessibility is a requirement, not polish.** As the scaffold's lint note says, "an invitation
  that a screen reader cannot read is a broken invitation". Axe checks run end-to-end (§12).
- **Fonts are self-hosted WOFF2.** Licences need confirming (§15), and new template fonts need a
  delivery answer (FR-9). Two fonts in the API.md example, Inter and Cormorant Garamond, have no
  Armenian glyphs, so fallback stacks matter.
- **When to add Storybook is open (A10).** It pays for itself most with blocks × variants ×
  languages × palettes, which is why the recommendation was to add it with the renderer.

### 5.9 Language, time and money

- **UI languages** are hy, ru and en, served by i18next.
  - Each feature has a JSON namespace under `src/locales/<language>/`, and keys are typed.
  - Plurals use `Intl.PluralRules`, which covers Russian's one/few/many/other.
  - There are no hard-coded user-facing strings.
- **Which language:**
  - Guest and public pages use the response's `locale`, so content and chrome always agree.
  - The app uses the user's choice, stored locally until `GET /me` carries a preference.
  - Public alternates use `?locale=`. There is no locale path prefix, because the backend's URLs
    and `canonicalPath` have none.
- **Time** (`lib/time`) formats with `Intl.DateTimeFormat(locale, { timeZone: event.timezone })` and
  converts inputs with `@date-fns/tz`. Event times are never shown in the device's zone.
- **Money** (`lib/money`):
  - `formatMinor(amountMinor, currency, locale)` works from the string, with exponents AMD 0 and
    USD/EUR/RUB 2. An unknown currency is treated as 2, as the backend does.
  - `toMinor(input, currency)` parses strictly.
  - There are no floats anywhere, and `parseFloat` or `Number()` on money fails lint.
  - BigInt arithmetic is used only where unavoidable; the API returns totals.
  - The vendor `feeAmount` is a decimal string (B51) and is handled as an exception until fixed.
    *23 October 2026: B51 is fixed. The field is `feeMinor`, in minor units like every other
    amount, so there is no exception.*

### 5.10 Errors and observability

| Status | Handling |
|---|---|
| 400 | Field and form errors; no retry |
| 401 | Refresh and retry once, then the sign-in page |
| 403 | "You don't have access to this"; no retry. During onboarding it means "no organization yet" |
| 404 | Not found, or not visible to you |
| 409 | A routine outcome, handled where it happens: sold out, already checked in, table full, the code just ran out. Never a generic toast |
| 413 / 415 | Upload size and type messages |
| 429 | Back off and tell the user |
| 5xx, network | Retry GETs; otherwise the route's error boundary |

- **Error boundaries.** Each route group has its own. The root boundary shows the `requestId`
  with "report a problem" copy (API.md §1).
- **Sentry**, in the browser and on the server, is on only when a DSN is set, as on the backend.
  - Event and breadcrumb URLs are scrubbed with the same patterns as
    `backend/src/common/redact-url.ts`: the guest segment of invitations, ticket orders, tickets,
    briefs and devices, plus query values except harmless keys.
  - No tracing at first, and never session replay on capability routes.
- **No product analytics in the setup.** If added later, capability routes are excluded entirely.

### 5.11 Security headers and capability links

- **Capability routes** send `Referrer-Policy: no-referrer` and `noindex`. They have no third-party
  embeds that would receive the full URL (maps open in a new tab with `rel="noreferrer"`), and no
  analytics.
- **Every page** sends:
  - a nonce-based Content Security Policy:
    - `script-src 'self' 'nonce-…'`;
    - images from self, the media origin, `data:` and `blob:`;
    - connections to self, the API and Sentry;
    - fonts from self;
    - `frame-ancestors 'none'`;
  - `X-Content-Type-Options: nosniff`.

  HSTS stays with Caddy. A test asserts the headers (an idea taken from geaclient).
- **Uploaded SVGs stay on the media origin**, never the app origin, because an SVG can carry script.
  *23 October 2026: the backend now refuses SVG uploads (D18).*

### 5.12 Environment configuration

- `src/config/env.ts` validates configuration with Zod at startup and fails fast, as the backend's
  `env.validation.ts` does.
- **Public variables** (`VITE_*`) are compiled into the bundle, so never secrets: the API base URL,
  the public origin used for return URLs, the media origin, the browser Sentry DSN.
- **Server-only variables** belong to the rendering process: the internal API URL, server Sentry
  settings.
- **In development**, the Vite proxy sends `/api` to `http://localhost:3000`, so the browser works
  same-origin, as recommended for production.
- The existing [`../.env.example`](../.env.example) is kept and extended when the app is scaffolded.

### 5.13 Build and deployment

- `react-router build` produces `build/client` (hashed static assets) and `build/server`.
  Production runs React Router's request handler inside a small Node server we control, so we own
  headers, log redaction and the health check. It runs in its own container.
- **Recommended topology (open, A7 — to decide with the backend developer): one origin behind the
  existing Caddy**, with `/` going to the web container and `/api/*` to the API. This:
  - removes a CORS preflight from every authenticated call — today there is no
    `Access-Control-Max-Age`, so browsers re-check after a few seconds;
  - makes `x-request-id` readable;
  - simplifies the Content Security Policy and any future cookie.

  It needs changes to `backend/Caddyfile`, `backend/docker-compose.prod.yml`, `CORS_ORIGINS` and
  `PUBLIC_APP_URL`, all backend-owned (§17.3). Separate `app.` and `api.` subdomains are the
  alternative.
- **Server-rendered pages call the API on the internal network.** They must forward the guest's IP
  and be counted per client, or every guest lands in one rate-limit bucket (FR-7).
- **Caching:** hashed assets are immutable; generic invitation HTML can be cached briefly and
  publicly; personalised pages are `private, no-store`.
- **Nothing is deployed yet.** Frontend go-live items will be appended to `docs/GOING_LIVE.md` by
  pull request.

---

## 6. Tooling

Versions are from the npm registry on 9 October 2026; exact pins are chosen when the app is
scaffolded.

| Tool | Choice | Notes |
|---|---|---|
| Node | **Node 26 (A4)** through a shared root `.nvmrc`, once the backend developer agrees (B-8); `engines: ">=24"` like the backend | Backend docs name Node 26 LTS. On the frontend lead's machine, nvm has 24.19 but **the default shell Node is 16.20**, too old for every tool here, and Volta is also installed. `engine-strict=true` in `frontend/.npmrc` makes a wrong Node fail at install rather than mysteriously later |
| Package manager | npm, `frontend/package-lock.json`, `save-exact=true` | Same as the backend. No workspace, no root `package.json` |
| TypeScript | 6.0, with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` and an `@/` alias for `src/` | TypeScript 7.0 exists, but `typescript-eslint` 8.71 declares `typescript <6.1`. Revisit when it supports 7 |
| Framework | React 19.3, React Router 8.4 (`@react-router/dev`), Vite 8.3 | React Router 8 requires Node 22.22 or later |
| Lint | ESLint 10 flat config with type-checked `typescript-eslint`. Carries the backend's judgement rules: complexity 10, depth 3, 60 lines per function, 4 parameters, booleans named as assertions, no floating or misused promises, no `any`. Adds `react-hooks`, `react-refresh`, an accessibility plugin, `no-restricted-globals` for `parseFloat`, and `no-restricted-imports` for feature boundaries. Zero warnings | As [`../eslint.config.mjs`](../eslint.config.mjs) already anticipates. **Verify at scaffold:** `eslint-plugin-jsx-a11y` declares ESLint ≤9, so either its ESLint 10 fork (`eslint-plugin-jsx-a11y-x`) or ESLint 9 for the frontend |
| Format | Prettier 3 with the backend's settings (`singleQuote`, `trailingComma: all`, `printWidth: 100`) and the Tailwind plugin | One style across the repository |
| Code generation | `openapi-typescript` 7.13, `openapi-fetch` 0.17 | **Verify at scaffold:** `openapi-typescript` declares a TypeScript ^5 peer; check it under 6.0 and use an npm `overrides` entry if needed |
| Tests | Vitest 5 with jsdom, Testing Library, MSW 3, Playwright 1.64, `@axe-core/playwright` | |
| Scripts | `dev`, `build`, `start`, `typecheck`, `lint`, `lint:fix`, `format`, `test`, `test:e2e`, `api:generate`, `check:boundaries`, and `verify` = generate, typecheck, lint, test, build | `verify` mirrors the backend's |
| Git hooks | None for now | Hooks are repository-wide and would affect both teams; Claude hooks and CI cover it. Revisit lint-staged if both teams agree |
| Dependencies | Ask before adding one. Justify size, maintenance and server-rendering safety | |

---

## 7. Folder structure

```
frontend/
  CLAUDE.md                frontend agent rules (binding inside frontend/)
  AGENTS.md                pointer for Codex, like backend/AGENTS.md (open, A8)
  README.md                how to run it, scripts, links
  .claude/
    settings.json          permissions and hooks for sessions started here (§10)
    hooks/                 guard-paths.sh, guard-bash.sh, lint-changed.sh, boundary-report.sh
    skills/frontend-feature/SKILL.md
  docs/
    ARCHITECTURE.md  WORKFLOW.md  BACKEND_REQUESTS.md
  src/
    root.tsx               document, providers, root error boundary
    routes.ts              the route table, including the backend's route contract
    routes/                thin route modules: loader or clientLoader, meta, layout
      public/  capability/  auth/  app/
    features/              one folder per capability
      <capability>/        api.ts (queryOptions, mutations) · components/ · schemas.ts (Zod)
                           types.ts (interim responses) · index.ts (public surface)
      invitation-renderer/ shared by the guest page and the designer
    api/                   client.ts, fetch.ts (auth, refresh, request id, errors), errors.ts,
                           session/, schema.ts (generated, gitignored)
    lib/                   money/, time/, i18n/, capability-links/ (redaction)
    config/env.ts          validated configuration
    ui/                    shadcn components and the app shell
    styles/                Tailwind entry, tokens, @font-face
    locales/               hy/, ru/, en/ — one namespace per feature
  test/
    e2e/                   Playwright against the real local backend; support/ builds data via the API
  public/                  static files and fonts
  package.json  package-lock.json  tsconfig.json  vite.config.ts  react-router.config.ts
  eslint.config.mjs  .prettierrc  .nvmrc  .npmrc  .env.example  .gitignore  playwright.config.ts
```

**Rules:**

- Route modules stay thin; features own their UI and data access.
- A feature imports another feature only through its `index.ts`. `api/`, `lib/` and `ui/` never
  import from `features/`. Both are enforced with `no-restricted-imports`.
- Unit and component tests sit next to the code (`*.test.ts(x)`); end-to-end tests live in
  `test/e2e/`, the folder the scaffold already made.
- **There is no per-endpoint repository, service and hook layering.** The backend's API is already
  screen-shaped ("a screen is one request"), so one `api.ts` per feature is enough.
- **Additions to `frontend/.gitignore`:**
  - `.react-router/` (generated route types);
  - `.claude/settings.local.json` and `CLAUDE.local.md` — the root ignore rule for the first is
    anchored to the root `.claude/`, and nothing ignores the second today.

---

## 8. Documentation structure

The minimum that earns its place:

| File | Purpose | Why it is needed |
|---|---|---|
| `frontend/README.md` | How to run it: prerequisites, environment, backend services, scripts, links | The backend keeps the same in `backend/README.md`. This replaces a separate DEVELOPMENT.md |
| `frontend/CLAUDE.md` | Binding agent rules: boundaries, the template's non-negotiables, stack rules, verification. Under 200 lines | Root CLAUDE.md says to create it from `docs/CLIENT_CLAUDE.template.md` |
| `frontend/AGENTS.md` | A five-line pointer to CLAUDE.md for Codex | Mirrors `backend/AGENTS.md`. Open (A8) |
| `frontend/docs/ARCHITECTURE.md` | The stack and why; rendering; the API layer; session; state; errors; i18n, time and money; security; the testing strategy; a short decision log; "Not yet built" | One place for the client's reasoning, per the scaffold note |
| `frontend/docs/WORKFLOW.md` | Branches, commits, pull requests, the feature procedure, the agent's operating rules, the boundary check | For this team the Git workflow and the agent workflow are one procedure |
| `frontend/docs/BACKEND_REQUESTS.md` | Frontend needs not yet triaged into BACKLOG.md, each with the screen it blocks and the agreed shape | How "report it, don't change backend code" actually works. An entry is removed once it has a BACKLOG ID |

**Deliberately not created:**

- `frontend/docs/API.md`. The scaffold note in `frontend/docs/` forbids describing the API there,
  because a copy goes stale. How the client calls the API — the client layer — goes in
  ARCHITECTURE.md.
- Separate TESTING, GIT_WORKFLOW and AGENT_WORKFLOW files. They fold into ARCHITECTURE.md and
  WORKFLOW.md and split only if they outgrow a section.
- An ADR folder. A dated decision log in ARCHITECTURE.md is enough for now.

**Rules:**

- Documentation changes in the same commit as the behaviour, as root CLAUDE.md §4 requires.
- Every document keeps an honest "Not yet built" section.
- This proposal is deleted once the living documents absorb its decisions (decided, A11); git
  history keeps it.
- **Shared documents are proposed, not edited, from the frontend** (§4). Once the scaffold lands,
  the root `README.md` ("Scaffolded and empty, waiting on a stack"), root `CLAUDE.md` §1 and §6, and
  `AGENTS.md` ("once a stack is chosen") need their frontend rows updated.
- `backend/scripts/check-docs.mjs` does not scan `frontend/docs/`, so frontend docs cannot break the
  backend build. A small frontend link check can come later.

---

## 9. Claude Code strategy

### 9.1 Three layers, none trusted alone

| Layer | Mechanism | Role |
|---|---|---|
| Behaviour | `frontend/CLAUDE.md`, the `frontend-feature` skill | What the agent should do. The Claude Code docs say it themselves: CLAUDE.md is "context, not enforced configuration" |
| Enforcement | `frontend/.claude/settings.json` permission rules, plus hooks | What the agent cannot do in a frontend session, whatever it decides |
| Authority | Protected `main` and `frontend/integration`, CI boundary check, `CODEOWNERS` | What cannot reach a protected branch, whoever or whatever wrote it |

### 9.2 Start frontend sessions in `frontend/`

`cd frontend && claude`. Checked against the official documentation, this gives the following:

- **Files:** Claude can edit only inside `frontend/` without asking. Edits elsewhere need
  permission, and the path guard (§10) refuses them outright.
- **Instructions:** root `CLAUDE.md` and `frontend/CLAUDE.md` load at launch. `backend/CLAUDE.md`
  never loads, because it is neither an ancestor nor beneath the working directory.
- **Settings:** only `frontend/.claude/settings.json` applies; there is no fallback to the parent.
  So the root `.claude/settings.json`, with its backend lint, schema and docs-sync hooks, stays out
  of frontend sessions — the frontend needs no change to shared configuration at all.
- **Personal settings:** `.claude/settings.local.json` is still read from the repository root.
- **Skills:** the frontend's skills plus the root `feature` skill are visible. Ours is named
  `frontend-feature` so the two cannot be confused, and `frontend/CLAUDE.md` says the root one is
  backend-only.
- **Parallel work:** sessions started with `--worktree` load the worktree root's settings, which
  are the backend-oriented root ones. So for parallel frontend work, create the worktree by hand
  (`git worktree add ../aveline-<topic> frontend/<topic>`) and start Claude in its `frontend/`.

### 9.3 `frontend/CLAUDE.md` (outline, under 200 lines)

1. **Scope.** This file binds inside `frontend/`, alongside root CLAUDE.md; `docs/` is the contract.
2. **Boundaries.**
   - Edit only `frontend/**`.
   - Never touch `backend/**`.
   - Shared files only on explicit instruction, in a root session.
   - A missing or wrong API becomes an entry in `BACKEND_REQUESTS.md`, never a workaround.
   - When a document and the code disagree, stop and say so.
3. **Before writing code against the API.**
   - Read API.md §1, §8 and the section for the feature.
   - Run `npm run api:generate`.
   - Check `BACKEND_REQUESTS.md` and the BACKLOG items it names.
4. **Non-negotiable client behaviours.** Carried over from the template — refresh serialisation, no
   float money, retry on 401 but never 403, render `locale`, block order and unknown blocks, confirm
   after payment, the event's time zone — plus capability-link hygiene and "never use `devLink`".
5. **Stack rules** (binding):
   - strict TypeScript, no `any`;
   - thin routes;
   - the feature layout and its import rule;
   - TanStack Query for server state, URL state for filters;
   - forms with React Hook Form and Zod;
   - money and time only through `lib/`;
   - no hard-coded user-facing strings;
   - accessible by default;
   - no new dependency without asking.
6. **Verification.**
   - `npm run verify` must pass.
   - Review the diff against the plan.
   - `npm run check:boundaries` must be empty.
7. **Git.**
   - Conventional commits with the `frontend` scope.
   - Never commit or push unless asked.
   - Never `--no-verify`.
   - Never force-push to `main`.
   - While §3.8 applies, never push to `main` or open a pull request against it.
8. **Docs** move with the code; "Not yet built" stays honest.
9. **Never:** a list of the above in one place.

The template's API rules are copied in, with a line naming their source. FR-16 offers a cleaner
alternative: an importable file the backend maintains, pulled in with `@../docs/…`.

### 9.4 The `frontend-feature` skill

The order in which the rules apply, loaded only when needed. It mirrors the backend's `feature`
skill:

1. Locate the truth.
2. Check the backend requests.
3. Plan.
4. Write the failing test where there is logic.
5. Implement.
6. Run `verify`.
7. Update the docs.
8. Review the diff.
9. Check the boundary.

### 9.5 Planning, implementation, testing and diff review

- **Plan** in plan mode (`claude --permission-mode plan`, or Shift+Tab). The plan names:
  - what changes;
  - routes and files;
  - endpoints;
  - every UI state, including 403 and 409;
  - i18n keys;
  - tests and docs;
  - risks;
  - backend gaps.

  The user approves before any edit.
- **Implement** in default permission mode, or `acceptEdits` once the plan is approved. The path
  guard holds in either.
- **Test.** A PostToolUse hook lints each changed file. `npm run verify` runs before anything is
  called done.
- **Review the diff.**
  - `git diff <base>...HEAD` is read line by line against the plan, and anything unplanned is
    removed or explained. The base is `origin/frontend/integration` while §3.8 applies, and
    `origin/main` afterwards.
  - `/code-review` is optional, before asking a human.
  - The Stop hook (§10) reports any change outside `frontend/`.

---

## 10. Permission and protection strategy

### 10.1 What each layer stops

| Layer | Stops | Does not stop |
|---|---|---|
| `frontend/CLAUDE.md` rules | Casual edits by a well-behaved agent | Anything; instructions are not enforcement |
| Starting in `frontend/` | Silent edits outside `frontend/`, which now need permission | A user who approves the prompt |
| Path guard hook (PreToolUse, exit 2) | Edit, Write and NotebookEdit outside `frontend/`, before any permission rule is evaluated | Shell commands |
| Bash guard hook and `deny` rules | The usual forms of writing outside `frontend/`, force-pushes, pushes to `main` | Every form of shell command. The docs say plainly that Bash rules are "not a security boundary" |
| Stop hook | Ending a turn with unnoticed changes outside `frontend/` | Nothing on its own; it reports |
| CI boundary check, protected `main` and `frontend/integration`, `CODEOWNERS` | Any change to the wrong area reaching a protected branch, from humans and agents alike | — |
| The sandbox, if adopted (open, A9; §10.4) | Shell commands writing outside the allowed directories, at the operating-system level | — |

### 10.2 `frontend/.claude/settings.json` (sketch)

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "additionalDirectories": ["../docs", "../backend"],
    "allow": [
      "Bash(npm run verify)", "Bash(npm run typecheck)", "Bash(npm run lint)",
      "Bash(npm run lint:fix)", "Bash(npm run format)", "Bash(npm run test)",
      "Bash(npm run test *)", "Bash(npm run build)", "Bash(npm run api:generate)",
      "Bash(npm run check:boundaries)",
      "Bash(git status *)", "Bash(git diff *)", "Bash(git log *)", "Bash(git show *)",
      "Bash(git fetch *)"
    ],
    "ask": [
      "Bash(git commit *)", "Bash(git push *)", "Bash(git rebase *)", "Bash(git merge *)",
      "Bash(git reset *)", "Bash(git restore *)", "Bash(git checkout *)", "Bash(git clean *)",
      "Bash(git stash *)", "Bash(npm install *)", "Bash(npm uninstall *)", "Bash(npx *)"
    ],
    "deny": [
      "Bash(git push --force *)", "Bash(git push -f *)", "Bash(git push * main)",
      "Bash(npm publish *)",
      "Read(./.env)", "Read(./.env.*)", "Read(!.env.example)",
      "Edit(./src/api/schema.ts)"
    ]
  },
  "hooks": {
    "PreToolUse": [
      { "matcher": "Edit|Write|MultiEdit|NotebookEdit",
        "hooks": [{ "type": "command", "command": "\"${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/guard-paths.sh\"" }] },
      { "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "\"${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/guard-bash.sh\"" }] }
    ],
    "PostToolUse": [
      { "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "\"${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/lint-changed.sh\"", "timeout": 60 }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "\"${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/boundary-report.sh\"", "timeout": 15 }] }
    ]
  }
}
```

**Why each part is there:**

- **`additionalDirectories`** lets the agent read the contract and the backend source without a
  prompt each time. It also grants edit access, which is exactly what the path guard closes.
- **`ask`** keeps every commit, push, history rewrite and dependency change in human hands.
- **`deny`** covers the irreversible mistakes and secrets. Deny wins over every allow, in any
  settings file.
- **Verify at scaffold:** that `CLAUDE_PROJECT_DIR` resolves to `frontend/`, and the `.env`
  carve-out. The hooks resolve the repository root through `git` themselves, so they do not
  depend on where they are invoked from.

### 10.3 The hooks

| Hook | Does |
|---|---|
| `guard-paths.sh` (PreToolUse) | Resolves the target path. If it is outside `<repo>/frontend/`, or is a generated or `.env` file, exits 2 with: *"Outside frontend/. Frontend agents do not edit backend or shared files. Record the need in frontend/docs/BACKEND_REQUESTS.md, or ask the user to make this change in a root session."* |
| `guard-bash.sh` (PreToolUse) | Best-effort refusal of shell writes aimed outside `frontend/`: redirection, `tee`, `sed -i`, `rm`, `mv`, `cp`, `git checkout` / `restore` / `apply`, `patch` with such a path |
| `lint-changed.sh` (PostToolUse) | `eslint --fix` on the changed file and reports problems back to the agent. The pattern of the backend's `lint-changed.sh`, scoped to `frontend/` |
| `boundary-report.sh` (Stop) | Lists uncommitted changes outside `frontend/` and asks the agent to explain or revert them |

### 10.4 What stays possible, and what is optional

- **Reading** backend code and every document stays easy. Understanding the backend is part of the
  job.
- **A shared-file change the user approved** — for example the root README rows in §8 — is made in
  a session started at the repository root, on explicit instruction. Root sessions do not load the
  frontend guard.
- **The sandbox (open, A9)** enforces at the operating-system level that shell commands write only
  inside the working directory. It needs tuning first:
  - write access to the repository's `.git` (commits from `frontend/`) and the npm cache;
  - `docker` must be excluded;
  - `../backend` and `../docs` must be denied for writes, because additional directories become
    writable inside the sandbox.

  Worth a trial once the workflow settles.
- **A root guard, symmetric (optional, needs the backend developer).** A PreToolUse hook in the
  root `.claude/settings.json` that, on a `frontend/*` branch, refuses edits outside `frontend/`,
  and on a `backend/*` branch refuses edits inside it. It protects root sessions in both directions.

---

## 11. Development workflow

The fourteen steps from the setup brief, with three adaptations: classify the task first, check
the contract before planning, and update the docs before committing. `<base>` below is
`origin/frontend/integration` while §3.8 applies, and `origin/main` afterwards.

| # | Step | How |
|---|---|---|
| 0 | **Classify** | *Trivial* (typo, copy): read, change, review the diff. *Standard*: every step. *Architectural* (a new dependency or pattern, routes, session, anything shared): every step plus explicit approval and a decision-log entry |
| 1 | **Branch** | From `origin/frontend/integration` while §3.8 applies (§3.8.3); from `main` afterwards |
| 2 | **Read** | `frontend/CLAUDE.md`, ARCHITECTURE.md, the feature's section of `docs/API.md`, the domain doc (INVITATION_DESIGN, VENUES_AND_SEATING, …), `BACKEND_REQUESTS.md` and the BACKLOG items it names |
| 3 | **Inspect** | The feature folder, its nearest sibling, and `api/`, `lib/`, `ui/` before writing anything new |
| 4 | **Check the contract** | `npm run api:generate`. Each endpoint exists in `openapi.json` and in API.md. A mismatch means stop and report; a gap means a `BACKEND_REQUESTS.md` entry |
| 5 | **Plan** | In plan mode: what changes, routes and files, endpoints, UI states (loading, empty, error, 403, 409), i18n, tests, docs, risks, backend gaps |
| 6 | **Approve** | The user approves the plan. For backend-dependent parts, decide whether to wait or ship with the gap shown |
| 7 | **Implement** | The smallest coherent change; tests first for logic (money, time, session, error mapping) |
| 8 | **Verify** | `npm run verify` (generate, typecheck, lint with zero warnings, tests, build); `npm run test:e2e` for touched journeys, against the local backend |
| 9 | **Review the diff** | `git diff <base>...HEAD` against the plan; remove or explain anything unplanned; optional `/code-review` |
| 10 | **Check the boundary** | `npm run check:boundaries`: `git diff --name-only <base>...HEAD` must list only `frontend/` paths |
| 11 | **Document** | ARCHITECTURE.md ("Not yet built", decision log), README, BACKEND_REQUESTS.md — in the same commit |
| 12 | **Commit** | Conventional message, a why-body, "For the backend team:" when relevant |
| 13 | **Push** | `git push -u origin frontend/<topic>` — by the human, or by the agent when asked |
| 14 | **Open the pull request** | Template from §3.4; link the backend requests |
| 15 | **Review** | CI green. Frontend-only changes take the fast lane; anything shared needs the other developer (A5) |
| 16 | **Merge** | Into `frontend/integration` while §3.8 applies, squash merge; delete the branch |

**Definition of done:**

- [ ] The plan was approved.
- [ ] Tests were added where there is logic.
- [ ] `verify` is green.
- [ ] Touched journeys pass end-to-end.
- [ ] The diff was reviewed against the plan.
- [ ] The boundary check is clean.
- [ ] Docs were updated in the same commit.
- [ ] Backend gaps are recorded.
- [ ] No token appears in code, logs, tests or screenshots.

---

## 12. Testing strategy

| Layer | Tool | What belongs there |
|---|---|---|
| Unit | Vitest | `lib/money` (exponents, parsing, AMD), `lib/time` (wall time to UTC, DST zones), error mapping (field prefixes, string or array), the session (single-flight within and across tabs, 401 then retry, 403 not retried), the block registry (order kept, unknown types render nothing), the route contract (paths match what the backend emails) |
| Component | Vitest, Testing Library, MSW | Every UI state: loading, empty, error, 403, 409, 429; forms showing server field errors. MSW only for states hard to produce on a real backend |
| End-to-end | Playwright against the real local stack | Register, create the organization, create an event; two tabs refreshing at once; a guest opens a personal link, answers, edits the answer; CSV import with partial errors; seating conflict (409); ticket checkout with the FAKE provider (redirect, return, confirm); password reset read from Mailpit's API |
| Accessibility | `@axe-core/playwright` | Key pages, guest pages first; serious and critical violations fail |
| Server rendering | Playwright, fetching raw HTML | The invitation and event pages carry their title, Open Graph tags and robots directive before any JavaScript runs |

**Test data** is created through the API by helpers in `test/e2e/support/`. The seed cannot serve:
its demo users have no password, and guest tokens change on every seed. Tests that reach a
backend use `@demo.test` addresses, never real ones.

**Following the backend team's note** (`frontend/test/.gitkeep`): contract conventions — money as
strings, locale negotiation, the list envelope, token rotation — are tested against the real
backend, because "a mock that is wrong in the same way as the code proves nothing".

**Later, with what they guard:** Storybook with axe (when is open, A10); bundle and Lighthouse
budgets for the guest page; visual regression if templates multiply. There is no coverage
percentage; `lib/` and `api/` are tested thoroughly instead.

---

## 13. CI/CD considerations

*Backend developer: please read.*

**Today there is no CI** (`.github/` does not exist). AGENTS.md already names
`cd backend && npm run verify` as what CI should run.

**Proposed GitHub Actions** (repository `br1gade/aveline`):

| Workflow | Owner | Runs on | Does |
|---|---|---|---|
| `frontend.yml` | Frontend | Pull requests touching `frontend/**`, `backend/openapi.json` or `docs/API.md` | `npm ci`, generate, typecheck, lint, test, build. End-to-end later: nightly or on demand, with the backend services in Docker |
| `backend.yml` | Backend | Pull requests touching `backend/**` or `docs/**` | `npm ci && npm run verify`, with a Postgres service for the integration and end-to-end layers |
| `boundaries.yml` | Shared | Every pull request | A `frontend/*` branch may change only `frontend/**`; a `backend/*` branch may change `backend/**` and `docs/**` but not `frontend/**`. Root and shared files need a `shared-change` label and the other team's review. While §3.8 applies, it also refuses `frontend/*` into `main` except the joining pull request, and exempts sync pull requests **[Backend agreement, BA-2]** |

**Protecting `main`** (a repository ruleset):

- pull request required;
- status checks required;
- code-owner review required, which with the fast lane means shared files only (A5);
- linear history;
- no force-push or deletion;
- administrators included.

While the frontend stays off `main` (A6), these rules protect the backend's flow. Frontend pull
requests go into `frontend/integration`, which has its own protection and boundary rules
(§3.8.1, §3.8.3, §3.8.4) **[Backend agreement]**.

**`CODEOWNERS`** (sketch; usernames to be supplied):

```
# Fast lane (A5): frontend/ has no required code owner, so frontend-only PRs merge after CI.
# backend/ is listed only if the backend developer wants every backend PR reviewed (B-2).
/docs/                    @<backend> @<frontend>
/backend/openapi.json     @<backend> @<frontend>
/CLAUDE.md  /AGENTS.md  /README.md  /.gitignore  /.github/  /.claude/  /.codex/  /.agents/  @<backend> @<frontend>
```

**A two-person caveat.** GitHub never counts an author's own approval. With "require review from
code owners", a sole owner cannot merge changes to their own area without the other person. That
is why the fast lane leaves `frontend/` without a code owner. A shared file still needs the
developer who did not write the change, which is the intent.

**Deployment** waits until something is deployed (GOING_LIVE §4). When it comes:

- a `frontend/Dockerfile`;
- a web service in the production compose file and routing in Caddy (backend-owned, §5.13);
- deploy from `main`;
- source maps uploaded to Sentry without being served publicly.

---

## 14. geaclient comparison

geaclient is a mature, well-reasoned frontend. Much of its machinery answers problems Aveline
does not have — three external contracts, server-rendered prices, a multi-vertical catalogue —
and some of it costs more than it returns for a two-person team racing to a pilot.

| Area | geaclient | Aveline | Why |
|---|---|---|---|
| Exact pins, `engines`, `.nvmrc`, `engineStrict` | Yes | **Reuse** (npm `save-exact`, `engine-strict`) | Reproducible installs, and the right Node or a clear failure |
| Feature folders with an `index.ts` public surface | Yes | **Reuse** | Clear ownership; agents find context fast |
| TanStack Query for server state | Yes | **Reuse** | Polling, deduplication, invalidation |
| React Hook Form with Zod 4 | Yes | **Reuse** | — |
| Tailwind 4, shadcn/ui on Radix, lucide | Yes | **Reuse** for the app; the invitation renderer stays separate | Owned components, accessible primitives |
| Money value object with no arithmetic API (`@geaclient/money`) | Yes | **Adapt** | Different wire format (minor-unit strings), same principle |
| Transport core with single-flight refresh and a credential port | Yes | **Adapt** | Aveline's refresh token is shared between tabs, so the lock must span tabs (Web Locks) |
| Security headers module with a test; validated environment | Yes | **Adapt** | Same intent, smaller |
| Task lanes, the plan template, STOP conditions, "report faithfully", "don't fix out-of-scope problems silently" | Yes | **Reuse**, condensed (§11) | Proportional process |
| "Gates arrive with the step they guard" | Yes | **Reuse** | A gate before its subject exists asserts nothing |
| Next.js 16 App Router, server-first | Yes | **Reject** | Browser-held bearer sessions; a dashboard-heavy product (§5.2) |
| pnpm 11 workspace, 2 apps, 5 packages | Yes | **Reject for now** | One app; npm like the backend; geaclient's own notes record several silent pnpm-configuration traps |
| TypeScript 7 for builds and 6 for lint | Yes | **Reject** | One TypeScript, 6.0, until `typescript-eslint` supports 7 |
| Component → hook → service → repository → client, one repository per operation | Yes | **Reject** | Heavy for an API that is already shaped per screen |
| A custom 9-rule ESLint plugin and dependency-cruiser | Yes | **Reject for now** | `no-restricted-imports` first; escalate only if violations appear |
| CLAUDE.md of 3,400 lines (534 KB), with status narrative | Yes | **Reject** | Claude Code's guidance is under 200 lines per file; status lives in git and pull requests |
| 113 ADRs, a ~282-entry question register, five authority tiers, milestone files | Yes | **Reject the weight** | Aveline's hierarchy is already simple: `docs/` is the contract and the nearest rules file wins. A decision log plus `BACKEND_REQUESTS.md` |
| Milestone commits (`M97–M99` in one), `dev` and `implementation/*` branches | Yes | **Reject** | Focused `frontend/*` branches, one pull request per change |
| Kubb: types, Zod, fakers, MSW handlers | Yes | **Defer** | There are no response schemas to generate from yet (FR-1) |
| Storybook 10 with axe on every story | Yes | **Open (A10)** | It pays off most with the invitation renderer; timing undecided |
| Lighthouse CI, bundle budgets, degradation gates | Yes | **Defer** | For the guest page, once it exists |
| Register of unconsumed operations | Yes | **Defer** | Useful once most screens exist |
| husky with lint-staged | Yes | **Defer** | Repository-wide hooks would affect the backend team |

---

## 15. Unresolved questions

The open decisions — the merge method into `main`, A7, A8, A9, A10, and confirming A6b (§3.8) and
A12 — are tracked in the decision record. The questions below are the remaining unknowns.

1. **Hosting.** The production domain(s), and who operates deployment (A7 decides the layout).
2. **Brand.** Is there an existing brand (logo, colours, fonts) for the Claude Design work in A12 to
   start from? Who approves a template's design, given that templates are data rows?
   *Partly answered on 12 October 2026:* the designer supplied the brand. See
   [design/BRAND_BRIEF.md](design/BRAND_BRIEF.md). Who approves a template's design is still open.
3. **Languages.** Which UI languages ship for the pilot, and who translates Armenian and Russian?
4. **Browsers.** The support matrix, including the in-app browsers of Telegram, WhatsApp, Instagram
   and Facebook, where many invitation links will open.
5. **Analytics.** Wanted at all? If so, which, given the capability-link rules?
6. **Feature order after sign-in.** Suggested, following PRODUCT_SPEC §14 and the pilot's core loop:
   1. `frontend/auth` (register, sign in, organization);
   2. `frontend/events`;
   3. `frontend/invitations` (renderer and guest page, from the A12 designs);
   4. `frontend/rsvp`;
   5. `frontend/guests` (import, edit, send);
   6. `frontend/design`;
   7. `frontend/operations` (dashboard, check-in);
   8. `frontend/seating`.
7. **Offline door.** Does the door need offline check-in? Venue connectivity is often poor.
8. **Font licences** for the template fonts and the UI font. *Partly answered:* the brand's four
   Noto families are OFL, verified on 12 October 2026
   ([design/BRAND_BRIEF.md](design/BRAND_BRIEF.md#61-verified-font-facts-12-october-2026)). Fonts
   that other templates name are still open.
9. **GitHub usernames** for `CODEOWNERS`.

---

## 16. Backend coordination requirements

*Backend developer: please read. Nothing here is changed by the frontend; each item is a request.*

### 16.1 Already in BACKLOG.md, and blocking client screens

*23 October 2026: every item below is fixed or built at `d23ff2d`, except F24 and F26, which stay
P2 in BACKLOG.md. F28 stays open only for the template preview: its variants were built with B46.*

| Screen | BACKLOG items |
|---|---|
| Guest page and RSVP | B16 with D4 (find-your-seat through the guest's link), B33 (timeline entries cannot be matched to venues on the page), B49 (a private invitation readable by its generic URL), F16 (switching language on a personalised page), F26 (caching personalised pages) |
| Guest list | B11 (read-only roles still receive contacts through delivery, vendor and export routes; hiding them in the UI is not protection). F6 and F7, which this row used to list, were built at `2040a17` |
| Designer | B24 (rearranging leaves ties), B25 (partial updates wipe omitted fields), B46 and F28 (variants are free text), F11 (managing uploads, alt text), F18 (image resizing) |
| Seating | F8 (editing a table, storing positions), B28, B29 |
| Team and roles | F5 (team management): no screen for members or event roles can exist without it |
| Onboarding | B13 (read-only members can create events), B14 (one organization per account is not held) |
| Door | B34 (door staff cannot admit tickets), B31 |
| Public events | B35 (browsing rejects its own documented filters), F24 (share images) |
| Session | B53 (two refreshes with one token make two sessions), B15 (case-sensitive email at login) |
| Vendors | **B51** (`feeAmount` is a decimal string). Best fixed before the client depends on it, because changing it later is a breaking change |

### 16.2 New requests (FR = frontend request)

| ID | Request | Why the client needs it | Priority |
|---|---|---|---|
| FR-1 | **Response schemas for every operation in `openapi.json`.** At `2040a17`, 0 of 139 operations declare a success response, and all 55 schemas are request bodies | Generated types cover requests only, so every response type is hand-written and can drift. README and the template promise the opposite: "hand-written types drift from the server silently" | **Blocking** for typed responses |
| FR-2 | Declare security per operation: bearer, or public via `security: []` | The schema cannot tell the client, or a generator, which calls are public | High |
| FR-3 | Stop declaring `user-agent` as a **required** header on register, login and refresh | A browser cannot set it, yet the generated client demands it | High, and small |
| FR-4 | Type translated fields (`name`, `prompt`, `label`, `content`) as locale-to-string maps, not bare `object` | Generated types cannot describe `{ "hy": "…", "en": "…" }` | High |
| FR-5 | `GET /me`: id, name, email, whether it is verified, platform role, organization and role, preferred locale | The app shell, the onboarding gate, a "verify your email" banner, and staff-only tools (privacy is staff-only now) all need it | High |
| FR-6 | Effective permissions per event, on `GET /events` items and `GET /events/:id` | API.md says to "ask the API", but nothing answers. Without it a DESIGNER or VIEWER sees buttons that only ever return 403 | High |
| FR-7 | **Rate limits that fit the client:** per-account limits for authenticated calls (ACCESS_CONTROL §6.3, GOING_LIVE §2), and per-client attribution for server-rendered calls | 100 a minute per IP is reachable by one dashboard plus polling, and certainly by several door staff on one venue Wi-Fi. A rendering server would otherwise put every guest in one bucket | High, before the pilot |
| FR-8 | Write the route contract (§5.3) into `docs/API.md`; add `PUBLIC_APP_URL` to `backend/.env.example` | Every emailed link depends on it. The example file lists `PUBLIC_BASE_URL` as building guest links, but nothing reads it | Medium |
| FR-9 | Decide how template fonts reach the browser: templates carry font-file URLs, or a shared registry where a new font means a client release | "Adding a template is an INSERT" stops being true the first time a template names a font the client does not have | Medium |
| FR-10 | CORS: expose `x-request-id` and set a preflight `maxAge`. Not needed if same-origin (FR-11) | API.md tells clients to read the header, which a browser cannot do cross-origin | Medium |
| FR-11 | Agree the deployment topology: one origin through Caddy, a web service in the compose file, `CORS_ORIGINS`, `PUBLIC_APP_URL`, proxy trust for the rendering server | The pilot needs it deployed, and the files are backend-owned | Medium, before the pilot |
| FR-12 | Optional hardening: the refresh token as an httpOnly, Secure, SameSite cookie scoped to `/api/v1/auth` | Removes the token from JavaScript reach. The client keeps a `tokenStore` so the switch touches one file | Low |
| FR-13 | Derive the default return URLs from `PUBLIC_APP_URL` instead of `https://aveline.test/…`. Have the fake gateway respect an existing query string | Avoids surprises in development and tests. The client will always pass `returnUrl` | Low |
| FR-14 | A seeded login for manual testing (the demo users have no password) | Faster manual checks. The end-to-end tests do not depend on it | Low |
| FR-15 | Optional: a `metadata` object on the public invitation, like public events have | The client can derive previews from today's fields meanwhile | Low |
| FR-16 | Optional: move the template's API rules into an importable file, such as `docs/CLIENT_RULES.md` | `frontend/CLAUDE.md` could import it instead of copying it, so the rules cannot drift | Low |

### 16.3 Contradictions not yet in BACKLOG §4

- API.md §1, "Money is a string", converts through a float in its own example
  (`Number(BigInt(amountMinor)) / 10 ** exponent`).
- API.md §1 shows `response.headers.get('x-request-id')`, which returns `null` cross-origin unless
  CORS exposes the header (FR-10).
- `backend/.env.example` documents `PUBLIC_BASE_URL`, which nothing reads, and omits
  `PUBLIC_APP_URL`, which builds every emailed link (FR-8).

### 16.4 Process and shared infrastructure

1. Adopt pull requests into a protected `main` (§3, B-1). Today almost every commit goes straight
   to `main`. For now this concerns the backend's own changes, since the frontend stays off `main`
   (A6).
2. CI workflows, `CODEOWNERS` and the review rule (§13).
3. The triage flow from `BACKEND_REQUESTS.md` into BACKLOG.md (§3.6).
4. After the scaffold, update the frontend rows in root `README.md`, `CLAUDE.md` and `AGENTS.md`, and
   add frontend items to `GOING_LIVE.md`, by pull request (§8).
5. Optionally, the root branch-aware guard (§10.4).

---

## 17. Decisions and risks

### 17.1 Recommended decisions

These are uncontroversial. They are adopted unless someone objects.

1. Branch naming, commit style and one pull request per change (§3), with no bare
   `frontend` or `backend` branch.
2. The ownership table (§4), with no root `package.json`.
3. TypeScript 6.0 strict, npm with exact pins, `engine-strict`.
4. `openapi-typescript` with `openapi-fetch`, with interim hand-written response types until FR-1.
5. TanStack Query, React Hook Form with Zod, Tailwind with shadcn/ui; Zustand only on demand.
6. `lib/money`, `lib/time`, the block registry, the route table and capability-link scrubbing as
   tested modules.
7. Error handling by status (§5.10); Sentry off without a DSN, with token scrubbing.
8. The test layers, with end-to-end tests against the real backend (§12).
9. Sessions start in `frontend/`; `frontend/.claude/settings.json` and the four hooks (§10).
10. The documentation set (§8), without `frontend/docs/API.md`.
11. No git hooks for now; gates arrive with the screens they guard.
12. The `frontend.yml` workflow. Its place in the shared `.github/` needs agreement (BA-3).

### 17.2 Decisions for the frontend lead

Taken on 9 October 2026. The outcomes, and the options still open, are in the
[decision record](#decision-record) at the top. It is kept in one place so the two cannot disagree.

### 17.3 Decisions for the backend developer

| # | Decision | Why it is theirs |
|---|---|---|
| B-1 | Pull requests into a protected `main`, with the ruleset in §13. While the frontend stays off `main` (A6), this concerns the backend's own flow | It changes their current direct-to-`main` practice |
| B-2 | The frontend fast lane (A5), whether they want the same for backend-only work, and `CODEOWNERS` (§3.5, §13) | It decides what they review, and what reviews them |
| B-3 | `backend.yml` and `boundaries.yml`; who owns them; the `shared-change` label | Shared CI, and backend-owned checks |
| B-4 | The FR list, its priorities, and folding it into BACKLOG.md (§16) | Backend work and their register |
| B-5 | Deployment layout, decided together (A7): Caddyfile, compose, `CORS_ORIGINS`, `PUBLIC_APP_URL`, proxy trust (FR-7, FR-11) | Backend-owned files |
| B-6 | The route contract in `docs/API.md` (FR-8) | A shared contract they maintain |
| B-7 | Root document updates after the scaffold; frontend items in GOING_LIVE.md | Shared files |
| B-8 | A shared root `.nvmrc` with Node 26 (A4, decided on the frontend side) | It would bind their environment too |
| B-9 | Optional: the root branch-aware guard in the root `.claude/settings.json` (§10.4) | Root agent config, which runs their hooks |
| B-10 | Who maintains the API rules inside `frontend/CLAUDE.md` (copied, or imported per FR-16) | The template says the backend team maintains them |
| B-11 | The temporary integration workflow: every item marked **[Backend agreement]** in §3.8, listed there as BA-1 to BA-6 | A long-lived branch on the shared remote, its protection, shared CI rules, and when the frontend joins `main` |

### 17.4 Risks and blockers

| Risk | Severity | Mitigation |
|---|---|---|
| No response schemas (FR-1): response types are hand-written and can drift | **Blocking** for type safety | Interim types per feature; end-to-end tests against the real backend; FR-1 first |
| No `GET /me` or permissions (FR-5, FR-6): no permission-aware UI, and onboarding detection is a heuristic | High | Show actions and handle 403; detect "no organization" from the documented 403 |
| Per-IP rate limits at venues and behind a rendering server (FR-7) | High | Deduplicated queries, gentle polling; FR-7 before the pilot |
| The client is the only P0 for the pilot: pressure to skip setup | High | A deliberately small setup (§0); heavy gates deferred |
| Bugs that expose data (B11, B49): screens can make them more visible | High | Never treat UI hiding as protection; track the fixes. *Both fixed by 23 October 2026* |
| The frontend stays off `main`, possibly until launch (A6): a long-lived integration branch, ending in one large merge | Medium | The workflow in §3.8: weekly syncs by merge commit, written triggers for joining `main` (before any deployment at the latest), and the full risk table in §3.8.6 |
| Toolchain peer ranges: `openapi-typescript` (TypeScript ^5), `eslint-plugin-jsx-a11y` (ESLint ≤9) | Medium | Verify at scaffold; `overrides`, the ESLint 10 fork, or ESLint 9 |
| On the frontend lead's machine the default shell Node is 16.20, and Volta and nvm coexist | Medium | `.nvmrc`, `engine-strict`, README setup steps |
| Server rendering puts capability URLs in the server's logs | Medium | The same redaction patterns as `redact-url.ts`; no access logs of raw paths |
| Template fonts have no delivery path (FR-9); some example fonts lack Armenian glyphs | Medium | Font registry with Armenian fallback stacks; FR-9 |
| Two developers: review bottleneck and self-approval limits | Medium | The fast lane for frontend-only work (A5); AI review before human review |
| Shared docs contradict the code (BACKLOG §4, §16.3); agents believe documents | Medium | "When a document and the code disagree, stop and say so" in `frontend/CLAUDE.md`; contract checks in the workflow |
| Agents can still write through the shell | Low to medium | Bash guard, Stop report, CI boundary check; sandbox trial |
| In-app browsers (Telegram, WhatsApp, Instagram) behave differently | Low to medium | Add them to the end-to-end and manual matrix (§15, question 5) |

---

## 18. Next steps once approved

1. The frontend lead reviews §3.8 (A6b). The backend developer agrees BA-1 to BA-6, or changes
   them; BA-1, creating and protecting `frontend/integration`, is needed first. Decide A7 together.
2. The backend developer reads §3, §4, §13, §16 and §17.3.
3. On this branch, as separate commits:
   1. the documents and agent configuration (`frontend/CLAUDE.md`, `.claude/`, `docs/ARCHITECTURE.md`,
      `docs/WORKFLOW.md`, `docs/BACKEND_REQUESTS.md` seeded from §16, `README.md`);
   2. the toolchain and an empty app shell — React Router 8, TypeScript, ESLint, Prettier, Vitest,
      a Playwright skeleton, code generation, environment validation, the API client and session
      skeleton, the `verify` script — with **no feature screens**.
4. Run the A12 Claude Design session: the tokens, then one or two invitation templates. Time-box it.
5. Once BA-1 is in place, `frontend/integration` is created from `main` and `frontend/setup` merges
   into it by pull request (§3.8.2). `frontend/auth` then branches from `frontend/integration`
   (§3.8.3). Nothing reaches `main` until the join (§3.8.5).

---

## References

- Claude Code: [monorepos and large codebases](https://code.claude.com/docs/en/large-codebases),
  [settings](https://code.claude.com/docs/en/settings),
  [permissions](https://code.claude.com/docs/en/permissions),
  [hooks](https://code.claude.com/docs/en/hooks-guide),
  [sandboxing](https://code.claude.com/docs/en/sandboxing),
  [memory and CLAUDE.md](https://code.claude.com/docs/en/memory)
- [React Router v8 release notes](https://remix.run/blog/react-router-v8)
- Aveline: [`docs/API.md`](../../docs/API.md), [`docs/BACKLOG.md`](../../docs/BACKLOG.md),
  [`docs/CLIENT_CLAUDE.template.md`](../../docs/CLIENT_CLAUDE.template.md),
  [`backend/CLAUDE.md`](../../backend/CLAUDE.md)
