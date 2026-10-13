#!/bin/sh
# Restore a complete recovery set into fresh Garage volumes and a chosen DB.
set -eu
umask 077
SET_DIR="${1:?usage: restore-recovery.sh <recovery-set-directory>}"
GARAGE_DATA_DIR="${GARAGE_DATA_DIR:-/garage-data}"
GARAGE_META_DIR="${GARAGE_META_DIR:-/garage-meta}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:=aveline}"
: "${POSTGRES_HOST:=postgres}"
: "${POSTGRES_PORT:=5432}"
[ "${RESTORE_QUIESCED:-}" = true ] || { echo 'Stop API, workers and Garage before restoring' >&2; exit 1; }
(cd "$SET_DIR"; sha256sum -c checksums.txt > /dev/null)
[ "$(jq -r .formatVersion "$SET_DIR/manifest.json")" = 1 ] || { echo 'Unsupported recovery format' >&2; exit 1; }
[ "$(jq -r .architecture "$SET_DIR/manifest.json")" = "$(uname -m)" ] || { echo 'Restore on the same CPU architecture; metadata may not be portable' >&2; exit 1; }
contents=$(pg_restore --list "$SET_DIR/postgres.dump")
for table in _prisma_migrations events guests; do
  printf '%s\n' "$contents" | grep -q " TABLE DATA public $table " || { echo 'Recovery dump is not a complete Aveline database' >&2; exit 1; }
done
for archive in garage-data garage-meta; do
  tar -tzf "$SET_DIR/$archive.tar.gz" | awk '
    /^\// || /(^|\/)\.\.(\/|$)/ { exit 1 }
  ' || { echo 'Unsafe archive member' >&2; exit 1; }
  # Disallow symlinks/devices as well as path traversal before extraction.
  tar -tvzf "$SET_DIR/$archive.tar.gz" | awk 'substr($0,1,1)!="d" && substr($0,1,1)!="-" { exit 1 }'
done
for target in "$GARAGE_DATA_DIR" "$GARAGE_META_DIR"; do
  [ -d "$target" ] || { echo 'Both target Garage volumes must exist' >&2; exit 1; }
  [ -z "$(find "$target" -mindepth 1 -maxdepth 1 -print -quit)" ] || { echo 'Use fresh, empty Garage volumes; existing media will not be overwritten' >&2; exit 1; }
done
echo "This replaces database '$POSTGRES_DB' on '$POSTGRES_HOST' and fills the fresh media volumes."
if [ "${NODE_ENV:-}" = test ] && [ "${RESTORE_DISPOSABLE:-}" = true ]; then
  case "$POSTGRES_DB" in *_test|*_test_*) ;; *) echo 'Automated restore requires a disposable *_test database' >&2; exit 1;; esac
else
  printf 'Type the database name to confirm: '
  read -r confirmed
  [ "$confirmed" = "$POSTGRES_DB" ] || { echo 'Aborted' >&2; exit 1; }
fi
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/data" "$work/meta"
tar -xzf "$SET_DIR/garage-data.tar.gz" -C "$work/data"
tar -xzf "$SET_DIR/garage-meta.tar.gz" -C "$work/meta"
PGPASSWORD="${POSTGRES_PASSWORD:-}" pg_restore --host="$POSTGRES_HOST" --port="$POSTGRES_PORT" \
  --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --clean --if-exists --no-owner \
  --single-transaction "$SET_DIR/postgres.dump"
cp -a "$work/data/." "$GARAGE_DATA_DIR/"
cp -a "$work/meta/." "$GARAGE_META_DIR/"
PGPASSWORD="${POSTGRES_PASSWORD:-}" psql --host="$POSTGRES_HOST" --port="$POSTGRES_PORT" \
  --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align \
  --command="SELECT 'events: ' || count(*) FROM events" \
  --command="SELECT 'guests: ' || count(*) FROM guests" \
  --command="SELECT 'migrations: ' || count(*) FROM _prisma_migrations"
echo 'Paired restore finished. Install the protected config from the recovery set, start Garage, then the API; run pilot:smoke and verify existing guest/media links.'
