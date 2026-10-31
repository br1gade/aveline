---
name: ship
description: Take a finished Aveline change through the local gate, write the commit and push it to the working branch. Use when asked to "ship", "commit and push", "push this", or after a review comes back clean.
---

# Ship a change

## 1. Ready?

- Docs moved with the code (`backend/CLAUDE.md` §10); "not yet built" lists
  are true.
- If a controller or DTO changed: `cd backend && npm run openapi` and commit
  the regenerated `openapi.json`.
- Quick checks pass for what you touched:

```bash
cd backend && npm run lint && npm run docs:check && npm run openapi:check && npx jest <changed specs>
```

Fix failures; never disable a rule or skip a test to pass.

## 2. Commit

Stage named paths, not `git add -A`. The message:

- Subject: what the change achieves, imperative, ≤ 72 characters.
- Body: **why**. If `docs/` or the API changed, say so; if a response
  field was renamed, removed or retyped, write `BREAKING for the client:`
  and what changed.
- Nothing from competitors, no secrets, no capability tokens.

## 3. Gate

```bash
cd backend && npm run ci:install-hook   # once per clone
npm run ci:local                        # needs Docker; validates the commit
```

The pre-push hook reuses a 24-hour proof for an unchanged tree. If Docker
is not available here, **say so** and list what you did run; do not push
around the hook with `--no-verify`. See `backend/docs/LOCAL_CI.md`.

## 4. Push

```bash
git push -u origin <branch>
```

Only to the branch you were told to use. Report: commit hash, what the gate
ran, anything it could not run.
