#!/usr/bin/env bash
# PreToolUse(Bash): best-effort refusal of shell commands that write outside frontend/, force-push
# or push to main. Shell commands can always find another way; this catches the usual forms.
# CI and protected branches are the real authority (setup proposal §10.1).
set -uo pipefail

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
[ -n "$cmd" ] || exit 0

hook_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(git -C "$hook_dir" rev-parse --show-toplevel 2>/dev/null) || exit 0

refuse() {
  echo "$1" >&2
  exit 2
}

if printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+push[^|;&]*(--force([^-]|$)|[[:space:]]-f([[:space:]]|$))'; then
  refuse "Force-pushing is not allowed from a frontend session."
fi
if printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+push[^|;&]*[[:space:]]main([[:space:]]|$)'; then
  refuse "The frontend stays off main for now (setup proposal A6)."
fi

writes='(>>?|\btee\b|\bsed[[:space:]]+-i|\brm\b|\bmv\b|\bcp\b|\bpatch\b|git[[:space:]]+(checkout|restore|apply))'
outside="(\.\./(backend|docs)|\.\./[^[:space:]]*\.md|$repo/(backend|docs)|$repo/[^f/][^[:space:]]*)"
if printf '%s' "$cmd" | grep -Eq "$writes" && printf '%s' "$cmd" | grep -Eq "$outside"; then
  refuse "This command appears to write outside frontend/. Frontend agents do not edit backend or shared files. Record the need in frontend/docs/BACKEND_REQUESTS.md, or ask the user to make this change in a root session."
fi

exit 0
