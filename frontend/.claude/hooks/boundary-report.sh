#!/usr/bin/env bash
# Stop: if uncommitted changes exist outside frontend/, ask the agent once to explain or revert
# them before it finishes. stop_hook_active guards against asking twice in a row.
set -uo pipefail

input=$(cat)
active=$(printf '%s' "$input" | jq -r '.stop_hook_active // false')
[ "$active" = "true" ] && exit 0

hook_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(git -C "$hook_dir" rev-parse --show-toplevel 2>/dev/null) || exit 0

outside=$(git -C "$repo" status --porcelain | awk '{ print $NF }' | grep -v '^frontend/' || true)
[ -n "$outside" ] || exit 0

jq -nc --arg files "$outside" '{
  decision: "block",
  reason: ("There are uncommitted changes outside frontend/:\n" + $files + "\nIf this session made them, revert them or explain to the user why they are needed. Frontend sessions do not edit backend or shared files.")
}'
exit 0
