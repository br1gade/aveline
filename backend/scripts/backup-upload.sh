#!/bin/sh
# Restic encrypts and authenticates the complete recovery set off-host.
set -eu
umask 077
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RUN_ID="${1:?usage: backup-upload.sh <run-id>}"
case "$RUN_ID" in ''|.|..|*[!a-zA-Z0-9_-]*) echo 'Invalid backup run id' >&2; exit 1;; esac
: "${RESTIC_REPOSITORY:?Set an off-host RESTIC_REPOSITORY}"
: "${RESTIC_PASSWORD:?Set RESTIC_PASSWORD and keep a recovery copy outside the host}"
marker_name=offhost-success.json
case "$RESTIC_REPOSITORY" in
  s3:https://*|sftp:*|rest:https://*) ;;
  /*)
    if [ "${NODE_ENV:-}" != test ] || [ "${BACKUP_ALLOW_LOCAL_REPOSITORY:-}" != true ]; then
      echo 'Local repositories are allowed only in an explicit test rehearsal' >&2; exit 1
    fi
    marker_name=rehearsal-success.json
    ;;
  *) echo 'An encrypted off-host HTTPS/SFTP repository is required' >&2; exit 1;;
esac
set_dir="$BACKUP_DIR/$RUN_ID"
[ -f "$set_dir/manifest.json" ] || { echo 'Incomplete recovery set' >&2; exit 1; }
(cd "$set_dir"; sha256sum -c checksums.txt > /dev/null)
# Initialization is explicit, never inferred from a failed authentication.
restic backup --quiet --host aveline --tag aveline-recovery --tag "aveline-$RUN_ID" "$set_dir"
restic check --quiet --read-data
marker=$(mktemp "$BACKUP_DIR/.offhost-success-XXXXXX")
jq -n --arg runId "$RUN_ID" --arg completedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{runId:$runId,completedAt:$completedAt}' > "$marker"
mv "$marker" "$BACKUP_DIR/$marker_name"
# Paths differ for each run; group by host so retention doesn't keep every run.
restic forget --quiet --host aveline --tag aveline-recovery --group-by host \
  --keep-daily "${BACKUP_REMOTE_KEEP_DAILY:-14}" --keep-weekly "${BACKUP_REMOTE_KEEP_WEEKLY:-8}" \
  --keep-monthly "${BACKUP_REMOTE_KEEP_MONTHLY:-12}"
# Retention starts only after a complete successful remote snapshot.
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d ! -name '.*' ! -name "$RUN_ID" \
  -mtime "+${BACKUP_RETENTION_DAYS:-14}" -exec rm -rf {} \;
echo "Encrypted repository snapshot confirmed for $RUN_ID ($marker_name)"
