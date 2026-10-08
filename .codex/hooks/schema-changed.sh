#!/usr/bin/env bash
# PostToolUse(Write|Edit): remind that a schema change carries doc and
# migration obligations. See CLAUDE.md §8 and §9.
set -uo pipefail

file=$(jq -r '.tool_response.filePath // .tool_input.file_path // empty')
case "$file" in
  *prisma/schema.prisma) ;;
  *) exit 0 ;;
esac

jq -nc '{
  systemMessage: "schema.prisma changed — docs and migration obligations apply.",
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: "prisma/schema.prisma was modified.\n\nbackend/CLAUDE.md §10: update the doc describing that part of the domain IN THE SAME COMMIT — backend/docs/DATA_MODEL.md (the model inventory and its invariants), docs/ACCESS_CONTROL.md (roles, permissions), docs/VENUES_AND_SEATING.md, docs/INVITATION_DESIGN.md, backend/docs/DATA_STORES.md.\n\nbackend/CLAUDE.md §11: the migration must be safe against a populated database. A new NOT NULL column means add nullable, backfill, then constrain. Never edit an applied migration."
  }
}'
exit 0
