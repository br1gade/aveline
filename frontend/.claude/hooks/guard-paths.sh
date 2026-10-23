#!/usr/bin/env bash
# PreToolUse(Edit|Write|MultiEdit|NotebookEdit): refuse writes outside frontend/, to generated
# files and to .env files. Exit 2 blocks the tool call and shows stderr to the agent.
# See frontend/CLAUDE.md §2 and the setup proposal §10.3.
set -uo pipefail

input=$(cat)
target=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')
[ -n "$target" ] || exit 0

hook_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(git -C "$hook_dir" rev-parse --show-toplevel 2>/dev/null) || exit 0
frontend="$repo/frontend"

case "$target" in
  /*) ;;
  *) target="$PWD/$target" ;;
esac
target=$(python3 -c 'import os, sys; print(os.path.normpath(sys.argv[1]))' "$target")

refuse() {
  echo "$1" >&2
  exit 2
}

case "$target" in
  "$frontend"/*) ;;
  *) refuse "Outside frontend/. Frontend agents do not edit backend or shared files. Record the need in frontend/docs/BACKEND_REQUESTS.md, or ask the user to make this change in a root session." ;;
esac

case "$target" in
  "$frontend/src/api/schema.ts") refuse "src/api/schema.ts is generated. Run npm run api:generate instead." ;;
  "$frontend/src/styles/tokens.css" | "$frontend/src/styles/theme.css") refuse "src/styles/tokens.css and theme.css are generated. Edit src/styles/tokens.json and run npm run tokens." ;;
  "$frontend/.env.example") ;;
  "$frontend/.env" | "$frontend"/.env.*) refuse "Environment files hold secrets and are not edited by agents." ;;
esac

exit 0
