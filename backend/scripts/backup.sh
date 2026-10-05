#!/bin/sh
# Takes one backup of everything that cannot be rebuilt.
#
# Two stores matter and they fail differently:
#
#   Postgres holds the entire domain. A logical dump is used rather than a
#   filesystem copy because it is restorable onto a different Postgres version,
#   which is what a recovery under pressure actually needs.
#
#   Garage holds every photo and generated document. Its data and metadata must
#   be captured together — metadata without data is an index of missing files,
#   and data without metadata is unaddressable blobs.
#
# Redis and Mongo are deliberately not backed up: one holds cache and locks,
# the other append-only analytics and the audit trail. Losing either costs
# insight, not correctness. That is a decision, not an omission — see
# docs/DATA_STORES.md.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:=aveline}"
: "${POSTGRES_HOST:=postgres}"
: "${POSTGRES_PORT:=5432}"

mkdir -p "$BACKUP_DIR"

log() { echo "[backup $(date -u +%H:%M:%S)] $*"; }

# ── Postgres ────────────────────────────────────────────────────────────
# Custom format, compressed, so a single table can be restored without
# replaying the whole dump — which is what is wanted when one thing was
# deleted by mistake rather than everything lost.
DUMP="$BACKUP_DIR/postgres-$STAMP.dump"
log "dumping $POSTGRES_DB"
PGPASSWORD="${POSTGRES_PASSWORD:-}" pg_dump \
  --host="$POSTGRES_HOST" \
  --port="$POSTGRES_PORT" \
  --username="$POSTGRES_USER" \
  --dbname="$POSTGRES_DB" \
  --format=custom \
  --compress=9 \
  --file="$DUMP"

# A dump nobody has read is a guess. Listing its table of contents proves the
# file is a complete, parseable archive rather than a truncated write.
log "verifying the dump is readable"
pg_restore --list "$DUMP" > /dev/null

# ── Garage ──────────────────────────────────────────────────────────────
# Mounted read-only into this container. Taken while Garage is running, which
# is acceptable for an object store whose files are written once and never
# modified: a file mid-upload is either absent or complete in the archive, and
# an absent one is re-uploadable. A live Postgres would not tolerate this,
# which is why that one is dumped rather than copied.
if [ -d /garage-data ] && [ -d /garage-meta ]; then
  log "archiving garage"
  tar -czf "$BACKUP_DIR/garage-$STAMP.tar.gz" -C / garage-data garage-meta
else
  log "garage volumes not mounted; skipping"
fi

# ── Retention ───────────────────────────────────────────────────────────
log "removing backups older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -type f -name 'postgres-*.dump' -mtime "+$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -type f -name 'garage-*.tar.gz' -mtime "+$RETENTION_DAYS" -delete

log "done: $(du -sh "$BACKUP_DIR" | cut -f1) in $BACKUP_DIR"

# ── The part this script cannot do ──────────────────────────────────────
# These backups are on the same host as the thing they protect, so they
# survive a bad migration, a wrong DELETE and a corrupted table — and not the
# loss of the machine or its disk. Copying them somewhere else is the step
# that turns this into a real backup, and it needs a destination only the
# operator can choose. See docs/DEPLOYMENT.md.
if [ -n "${BACKUP_SYNC_COMMAND:-}" ]; then
  log "copying off-host"
  sh -c "$BACKUP_SYNC_COMMAND"
else
  log "WARNING: BACKUP_SYNC_COMMAND is not set, so these backups live only on this host"
fi
