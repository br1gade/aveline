#!/usr/bin/env bash
# Stop: warn when backend source or schema changed in the working tree but no
# doc did. CLAUDE.md §8 requires them to move together.
set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-$PWD}"
git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

code=$(git -C "$root" status --porcelain -- backend/src backend/prisma 2>/dev/null | grep -c . || true)
docs=$(git -C "$root" status --porcelain -- docs CLAUDE.md backend/README.md 2>/dev/null | grep -c . || true)

if [ "$code" -gt 0 ] && [ "$docs" -eq 0 ]; then
  jq -nc --arg n "$code" '{
    systemMessage: ("Docs check: " + $n + " backend source/schema file(s) changed, no doc changed. CLAUDE.md §10 requires docs to move in the same commit.")
  }'
fi
exit 0
