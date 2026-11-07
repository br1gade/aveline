#!/usr/bin/env bash
# PostToolUse(Edit|Write): lint a frontend source file right after it changes.
# Non-blocking: reports problems back to the agent instead of failing the turn.
# The pattern of the root .claude/hooks/lint-changed.sh, scoped to frontend/.
set -uo pipefail

file=$(jq -r '.tool_response.filePath // .tool_input.file_path // empty')
case "$file" in
  *"/frontend/"*.ts | *"/frontend/"*.tsx | *"/frontend/"*.mjs) ;;
  *) exit 0 ;;
esac

frontend="${file%%/frontend/*}/frontend"
[ -d "$frontend/node_modules" ] || exit 0

if ! output=$(cd "$frontend" && npx eslint --fix "$file" 2>&1); then
  jq -nc --arg out "$output" '{
    systemMessage: "ESLint found problems in the file just written.",
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: ("ESLint reported problems. Fix them before calling the work done (frontend/CLAUDE.md §6 requires zero warnings). Extract rather than disable a complexity rule.\n\n" + $out)
    }
  }'
fi
exit 0
