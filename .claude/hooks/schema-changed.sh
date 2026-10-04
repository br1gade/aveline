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
    additionalContext: "prisma/schema.prisma was modified.\n\nCLAUDE.md §10: update the doc describing that part of the domain IN THE SAME COMMIT — docs/ACCESS_CONTROL.md (roles, permissions), docs/VENUES_AND_SEATING.md (venues, tables, seats), docs/INVITATION_DESIGN.md (templates, blocks, media, questions), docs/DATA_STORES.md (caching, analytics), docs/PRODUCT_SPEC.md (domain model §4).\n\nCLAUDE.md §11: the migration must be safe against a populated database. A new NOT NULL column means add nullable, backfill, then constrain. Never edit an applied migration."
  }
}'
exit 0
