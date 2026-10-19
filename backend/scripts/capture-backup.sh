#!/usr/bin/env bash
# Runs on the Docker host; the backup container never receives its socket.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
mkdir -p .backup
exec 9>.backup/capture.lock
flock -n 9 || { echo 'Another capture is running' >&2; exit 1; }
compose=(docker compose --env-file .env.production -f docker-compose.prod.yml)
run_id="$(date -u +%Y%m%dT%H%M%SZ)-$RANDOM"
services=()
resume_file=.backup/resume-services
resume() {
  if [ "${#services[@]}" -gt 0 ]; then "${compose[@]}" start "${services[@]}"; fi
  rm -f "$resume_file"
}
# A power loss cannot run a trap. Recover the recorded services on the next
# invocation or via the boot recovery unit before taking another capture.
if [ -f "$resume_file" ]; then
  while IFS= read -r service; do
    case "$service" in api|garage|worker|export-worker|seating-worker|private-media-worker) services+=("$service");; *) echo 'Invalid recovery journal' >&2; exit 1;; esac
  done < "$resume_file"
  resume
  services=()
fi
if [ "${1:-}" = --resume-only ]; then exit 0; fi
release=$(git rev-parse HEAD 2>/dev/null || printf unknown)
running_services=$("${compose[@]}" ps --services --status running)
while IFS= read -r service; do
  case "$service" in api|garage|worker|export-worker|seating-worker|private-media-worker) services+=("$service");; esac
done <<< "$running_services"
# Resume exactly the previously running services even when capture fails.
if [ "${#services[@]}" -gt 0 ]; then printf '%s\n' "${services[@]}" > "$resume_file"; fi
trap resume EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
if [ "${#services[@]}" -gt 0 ]; then "${compose[@]}" stop --timeout 60 "${services[@]}"; fi
for service in "${services[@]}"; do
  running=$("${compose[@]}" ps --services --status running "$service")
  [ -z "$running" ] || { echo 'A writer is still running; refusing capture' >&2; exit 1; }
done
"${compose[@]}" run --rm --no-deps -e BACKUP_QUIESCED=true -e "BACKUP_RUN_ID=$run_id" \
  -e "BACKUP_RELEASE=$release" backup /bin/sh /scripts/backup.sh
resume
trap - EXIT
# Slow uploads must never extend the maintenance window.
"${compose[@]}" run --rm --no-deps backup /bin/sh /scripts/backup-upload.sh "$run_id"
