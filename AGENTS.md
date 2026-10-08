# Aveline — agent rules

The rules live in [`CLAUDE.md`](CLAUDE.md). **Read that file.**

This one exists only because Codex looks for `AGENTS.md` where Claude Code
looks for `CLAUDE.md`. It is a pointer rather than a copy on purpose: two
files carrying the same rules drift, and the one that drifts is the one nobody
is reading at the time.

Working inside an area? The nearest rules file still wins:

| Working in | Read |
|---|---|
| `backend/` | [`backend/CLAUDE.md`](backend/CLAUDE.md) |
| `frontend/` | `frontend/CLAUDE.md` once a stack is chosen — start from [`docs/API.md`](docs/API.md) |

Everything else an agent needs is shared, not tool-specific:

- [`docs/`](docs/) — the product and the API contract, written for both teams
- [`backend/docs/`](backend/docs/) — architecture, data model, stores, gaps
- `.claude/skills/feature/SKILL.md` — the order to apply the backend rules in.
  `.agents/skills/feature/SKILL.md` is a symlink to it.
- `.claude/hooks/` — lint, schema and docs-sync checks. `.codex/hooks/` holds
  symlinks to the same scripts, so there is one copy of each to maintain.

The Codex hook commands are written as `"${CODEX_PROJECT_DIR:-.}/.codex/..."`.
That variable name is inferred from Claude Code's `CLAUDE_PROJECT_DIR` and has
not been verified against Codex; the `:-.` fallback is what actually makes it
work, so the hooks run whenever the working directory is the repository root.
If Codex runs them from somewhere else, that one file is where to fix it.

None of this is load-bearing. The checks that matter are in the repository:
`cd backend && npm run verify` runs lint, the docs check, the build and all
three test layers, and it is what CI should run regardless of which agent
wrote the code.
