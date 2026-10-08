#!/usr/bin/env bash
# Stop: warn when backend source or schema changed in the working tree but no
# doc did. CLAUDE.md §8 requires them to move together.
set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-$PWD}"
git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

code=$(git -C "$root" status --porcelain -- backend/src backend/prisma 2>/dev/null | grep -c . || true)
docs=$(git -C "$root" status --porcelain -- docs backend/docs backend/README.md backend/CLAUDE.md CLAUDE.md 2>/dev/null | grep -c . || true)

# A changed controller is a changed contract. docs/API.md is what the client
# team builds against, so it gets called out separately from internal docs.
controllers=$(git -C "$root" status --porcelain -- 'backend/src/**/*.controller.ts' 2>/dev/null | grep -c . || true)
api_doc=$(git -C "$root" status --porcelain -- docs/API.md 2>/dev/null | grep -c . || true)

if [ "$controllers" -gt 0 ] && [ "$api_doc" -eq 0 ]; then
  jq -nc '{
    systemMessage: "A controller changed but docs/API.md did not. That file is the contract the client team builds against — check whether the change is visible to them."
  }'
elif [ "$code" -gt 0 ] && [ "$docs" -eq 0 ]; then
  jq -nc --arg n "$code" '{
    systemMessage: ("Docs check: " + $n + " backend source/schema file(s) changed, no doc changed. backend/CLAUDE.md §10 requires docs to move in the same commit.")
  }'
fi
exit 0
