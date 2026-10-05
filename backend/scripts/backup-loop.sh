#!/bin/sh
# Runs the backup on a schedule, in the foreground.
#
# A loop rather than cron inside the container: the container's own logs become
# the record of every run, and `docker compose logs backup` answers "when did
# this last work" without anyone exec-ing in to read a crontab.
set -eu

INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-86400}"

echo "[backup] every ${INTERVAL_SECONDS}s, keeping ${BACKUP_RETENTION_DAYS:-14} days"

while true; do
  # Never exits on failure. A backup that fails tonight must still be
  # attempted tomorrow — a crash-looping container that stops trying is how a
  # month passes with no backups at all.
  if ! /bin/sh /scripts/backup.sh; then
    echo "[backup] FAILED; will try again in ${INTERVAL_SECONDS}s" >&2
  fi
  sleep "$INTERVAL_SECONDS"
done
