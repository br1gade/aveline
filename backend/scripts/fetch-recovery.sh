#!/bin/sh
set -eu
umask 077
RUN_ID="${1:?usage: fetch-recovery.sh <run-id> <new-directory>}"
RECOVERY_DIR="${2:?usage: fetch-recovery.sh <run-id> <new-directory>}"
case "$RUN_ID" in ''|.|..|*[!a-zA-Z0-9_-]*) echo 'Invalid run id' >&2; exit 1;; esac
[ ! -e "$RECOVERY_DIR" ] || { echo 'Recovery directory must be new' >&2; exit 1; }
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD is required}"
restic restore latest --tag "aveline-$RUN_ID" --target "$RECOVERY_DIR" --verify
set_dir="$RECOVERY_DIR/backups/$RUN_ID"
[ -f "$set_dir/manifest.json" ] || { echo 'No matching complete recovery set in snapshot' >&2; exit 1; }
(cd "$set_dir"; sha256sum -c checksums.txt > /dev/null)
echo "Verified recovery set available at $set_dir"
