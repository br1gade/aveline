#!/usr/bin/env bash
# PostToolUse(Write|Edit): lint a backend TypeScript file right after it changes.
# Non-blocking: reports problems back to the model instead of failing the turn,
# so a mid-refactor edit is not interrupted. See CLAUDE.md §7.
set -uo pipefail

file=$(jq -r '.tool_response.filePath // .tool_input.file_path // empty')
case "$file" in
  *"/backend/"*.ts) ;;
  *) exit 0 ;;
esac

backend="${file%%/backend/*}/backend"
[ -d "$backend/node_modules" ] || exit 0

if ! output=$(cd "$backend" && npx eslint --fix "$file" 2>&1); then
  jq -nc --arg out "$output" '{
    systemMessage: "ESLint found problems in the file just written.",
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: ("ESLint reported problems. Fix them before committing (CLAUDE.md §7 requires zero warnings). Do not add eslint-disable to silence a complexity rule — extract instead.\n\n" + $out)
    }
  }'
fi
exit 0
