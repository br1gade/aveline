# Frontend workflow

> **Status: in use.** Written on 18 October 2026 from the setup proposal §3 and §9–§11. Binding
> rules for agents are in [`../CLAUDE.md`](../CLAUDE.md); this file is the procedure.

## 1. Where work happens right now

- **The frontend stays off `main`** (A6). Nothing is pushed to `main` and no pull request targets
  it.
- **`frontend/integration` does not exist yet.** It needs the backend developer's agreement
  (BA-1 to BA-6, setup proposal §3.8), and they are unavailable.
- **Meanwhile:**
  - the setup and the guest invitation are built on `frontend/setup`;
  - nothing is committed until the frontend lead asks;
  - when commits are wanted, the setup goes first, and the guest invitation moves to its own
    `frontend/guest-invitation` branch made from `frontend/setup`;
  - both join `frontend/integration` once it exists, the setup first.

## 2. Branches, commits and pull requests

- **Branches:** `frontend/<topic>` in kebab-case, short-lived, owned by their author. Never a
  branch named exactly `frontend` or `backend`.
- **Commits:**
  - Conventional Commits with the `frontend` scope: `feat(frontend): …`, `fix(frontend): …`,
    `docs(frontend): …`;
  - the subject says what changed, the body says why;
  - a **"For the backend team:"** paragraph when the change depends on or asks for backend work;
  - one logical change per commit;
  - never generated files, `.env`, competitor material, or a screenshot showing a token.
- **Pull requests** (once a target branch exists):
  - one feature or fix each;
  - a description with: why; what changed; the API endpoints used and gaps hit; docs updated;
    verification commands and results; the boundary check output; screenshots with tokens
    redacted.
- **Review (A5, the fast lane):** a pull request touching only `frontend/**` merges after green
  checks, the definition of done below and an AI review. Anything shared needs the backend
  developer.

## 3. The feature procedure

| # | Step | How |
|---|---|---|
| 0 | Classify | **Trivial** (copy, typo): read, change, review the diff. **Standard:** every step. **Architectural** (a dependency, a pattern, routes, session, anything shared): every step, explicit approval, and a decision-log entry in [ARCHITECTURE.md](ARCHITECTURE.md) |
| 1 | Read | `CLAUDE.md`, ARCHITECTURE.md, the feature's section of `docs/API.md`, the design docs, [BACKEND_REQUESTS.md](BACKEND_REQUESTS.md) |
| 2 | Inspect | The feature folder, its nearest sibling, and `api/`, `lib/`, `ui/` before writing anything new |
| 3 | Check the contract | `npm run api:generate`. A mismatch means stop and report; a gap means a BACKEND_REQUESTS entry |
| 4 | Plan | In plan mode: changes, routes and files, endpoints, every UI state, i18n keys, tests, docs, risks, backend gaps |
| 5 | Approve | The user approves the plan |
| 6 | Implement | The smallest coherent change; tests first for logic |
| 7 | Verify | `npm run verify`; `npm run test:e2e` for touched journeys, with the backend running |
| 8 | Review the diff | Line by line against the plan; remove or explain anything unplanned |
| 9 | Check the boundary | `npm run check:boundaries` lists only `frontend/` paths |
| 10 | Document | ARCHITECTURE.md, README, BACKEND_REQUESTS.md, design docs, in the same change |
| 11 | Commit and push | Only when the user asks |

**Definition of done:**

- [ ] The plan was approved.
- [ ] Tests were added where there is logic.
- [ ] `verify` is green.
- [ ] Touched journeys pass end to end.
- [ ] The diff was reviewed against the plan.
- [ ] The boundary check is clean.
- [ ] Docs were updated in the same change.
- [ ] Backend gaps are recorded.
- [ ] No token appears in code, logs, committed fixtures or screenshots.

## 4. Agent sessions

- **Start frontend sessions in `frontend/`** (`cd frontend && claude`). Then `frontend/CLAUDE.md`,
  `.claude/settings.json` and the hooks apply:
  - `guard-paths.sh` refuses edits outside `frontend/`, to generated files and to `.env`;
  - `guard-bash.sh` refuses the usual shell writes outside `frontend/`, force-pushes and pushes to
    `main`;
  - `lint-changed.sh` lints each changed source file;
  - `boundary-report.sh` asks about uncommitted changes outside `frontend/` before a session ends.
- Sessions started at the repository root do not load these guards.
- For parallel work, make the worktree by hand (`git worktree add ../aveline-<topic>
  frontend/<topic>`) and start Claude in its `frontend/`.

## 5. The boundary check

`npm run check:boundaries` lists every changed path, committed against the base branch or
uncommitted, that is outside `frontend/`. The base is `origin/main` until `frontend/integration`
exists. An empty list is the only passing result.
