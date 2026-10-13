#!/bin/sh
# Capture only. The host coordinator resumes services before remote upload.
set -eu
umask 077

[ "${BACKUP_QUIESCED:-}" = true ] || { echo 'Refusing capture: API, workers and Garage must be quiesced by capture-backup.sh' >&2; exit 1; }
BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_RUN_ID="${BACKUP_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
GARAGE_DATA_DIR="${GARAGE_DATA_DIR:-/garage-data}"
GARAGE_META_DIR="${GARAGE_META_DIR:-/garage-meta}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:=aveline}"
: "${POSTGRES_HOST:=postgres}"
: "${POSTGRES_PORT:=5432}"
if [ "${NODE_ENV:-}" = production ]; then
  for config in /runtime-config/garage.toml /runtime-config/env.production; do
    [ -f "$config" ] || { echo 'Production recovery requires both protected configuration files' >&2; exit 1; }
  done
fi
case "$BACKUP_RUN_ID" in ''|.|..|*[!a-zA-Z0-9_-]*) echo 'Invalid backup run id' >&2; exit 1;; esac
if [ ! -d "$GARAGE_DATA_DIR" ] || [ ! -d "$GARAGE_META_DIR" ]; then
  echo 'Both Garage volumes are required' >&2
  exit 1
fi
mkdir -p "$BACKUP_DIR"
[ ! -e "$BACKUP_DIR/$BACKUP_RUN_ID" ] || { echo 'That recovery set already exists' >&2; exit 1; }
work=$(mktemp -d "$BACKUP_DIR/.incomplete-XXXXXX")
trap 'rm -rf "$work"' EXIT

PGPASSWORD="${POSTGRES_PASSWORD:-}" pg_dump --host="$POSTGRES_HOST" --port="$POSTGRES_PORT" \
  --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --compress=9 --file="$work/postgres.dump"
pg_restore --list "$work/postgres.dump" > /dev/null
# Garage is stopped: both SQLite WAL files and data blocks are stable.
tar -czf "$work/garage-data.tar.gz" -C "$GARAGE_DATA_DIR" .
tar -czf "$work/garage-meta.tar.gz" -C "$GARAGE_META_DIR" .
tar -tzf "$work/garage-data.tar.gz" > /dev/null
tar -tzf "$work/garage-meta.tar.gz" > /dev/null
if [ -f /runtime-config/garage.toml ]; then cp /runtime-config/garage.toml "$work/garage.toml"; fi
if [ -f /runtime-config/env.production ]; then cp /runtime-config/env.production "$work/env.production"; fi
jq -n --arg runId "$BACKUP_RUN_ID" --arg capturedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg database "$POSTGRES_DB" --arg release "${BACKUP_RELEASE:-unknown}" \
  --arg architecture "$(uname -m)" --arg garageVersion "${GARAGE_VERSION:-v2.1.0}" \
  '{formatVersion:1,runId:$runId,captureMode:"quiesced",capturedAt:$capturedAt,database:$database,release:$release,architecture:$architecture,garageVersion:$garageVersion}' > "$work/manifest.json"
(cd "$work"; sha256sum postgres.dump garage-data.tar.gz garage-meta.tar.gz manifest.json > checksums.txt
  for config in garage.toml env.production; do
    if [ -f "$config" ]; then sha256sum "$config" >> checksums.txt; fi
  done)
mv "$work" "$BACKUP_DIR/$BACKUP_RUN_ID"
trap - EXIT
echo "Captured complete local recovery set $BACKUP_RUN_ID; remote protection is not yet confirmed"
