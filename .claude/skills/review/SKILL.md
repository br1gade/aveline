---
name: review
description: Review an Aveline change before it ships by running the project's reviewer agents in parallel on the diff, verifying each finding and reporting only what survives. Use when asked to "review", "check my change", "is this ready", or before the ship skill.
---

# Review a change

## 1. Scope it — one command

```bash
git diff --stat origin/dev...HEAD; git diff --stat
```

Use the base the user names if it is not `dev`. Nothing changed → say so and stop.

## 2. Pick reviewers by what changed

| Changed | Reviewers (`.claude/agents/`) |
|---|---|
| Any code | `code-reviewer` |
| Any `*.spec.ts`, `*.int-spec.ts`, `*.e2e-spec.ts`, or code without a test change | `test-reviewer` |
| A controller, DTO, `schema.prisma`, `openapi.json` or anything in `docs/` | `contract-reviewer` |
| `access/`, `guests/`, `payments/`, `billing/`, `ticketing/`, `privacy/`, `media/`, auth, tokens, env/config | `security-reviewer` |

Launch the chosen ones **in one message** so they run in parallel. Give each
the base ref and the file list; do not paste the diff, and do not tell them
what you expect to find.

## 3. Verify before reporting

For every finding, open the cited line and confirm the failure is real. Drop
the ones that are not, and duplicates between reviewers. A finding that
survives has a file, a line, a concrete failing input and a fix.

## 4. Report

Most severe first, one line each: `path:line — problem — fix`. Then one line
on what was not reviewed (for example: integration tests could not run).
Do not fix unless asked; if asked, fix with the `feature` skill's cycle.
