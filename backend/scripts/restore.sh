#!/bin/sh
# Restores a backup. Read this before you need it.
#
# Deliberately interactive and deliberately noisy: this overwrites the live
# database, and the one thing worse than having no backup is restoring the
# wrong one over a database that was fine.
#
#   docker compose -f docker-compose.prod.yml run --rm \
#     -v aveline_backups:/backups backup \
#     /bin/sh /scripts/restore.sh /backups/postgres-20261006T030000Z.dump
set -eu

DUMP="${1:-}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:=aveline}"
: "${POSTGRES_HOST:=postgres}"
: "${POSTGRES_PORT:=5432}"

if [ -z "$DUMP" ]; then
  echo "usage: restore.sh <dump file>" >&2
  echo "" >&2
  echo "available:" >&2
  ls -1t /backups/postgres-*.dump 2>/dev/null | head -20 >&2
  exit 1
fi

if [ ! -f "$DUMP" ]; then
  echo "no such file: $DUMP" >&2
  exit 1
fi

echo "About to restore $DUMP over database '$POSTGRES_DB' on '$POSTGRES_HOST'."
echo "Everything currently in it will be replaced."
printf "Type the database name to confirm: "
read -r CONFIRMED
if [ "$CONFIRMED" != "$POSTGRES_DB" ]; then
  echo "Aborted." >&2
  exit 1
fi

# --clean drops objects before recreating them, and --if-exists keeps that from
# failing on a database that is already empty — which is the shape of a restore
# onto a fresh host.
echo "restoring..."
PGPASSWORD="${POSTGRES_PASSWORD:-}" pg_restore \
  --host="$POSTGRES_HOST" \
  --port="$POSTGRES_PORT" \
  --username="$POSTGRES_USER" \
  --dbname="$POSTGRES_DB" \
  --clean \
  --if-exists \
  --no-owner \
  --single-transaction \
  "$DUMP"

# Evidence, not a word.
#
# "done." after restoring an empty or wrong dump is indistinguishable from
# "done." after restoring the right one — which was true of this script until
# a test restored an empty dump and it reported success. An operator under
# pressure needs to see that the data is actually there.
echo ""
echo "Restored into '$POSTGRES_DB':"
PGPASSWORD="${POSTGRES_PASSWORD:-}" psql \
  --host="$POSTGRES_HOST" \
  --port="$POSTGRES_PORT" \
  --username="$POSTGRES_USER" \
  --dbname="$POSTGRES_DB" \
  --tuples-only --no-align \
  --command="SELECT '  tables:      ' || count(*) FROM information_schema.tables WHERE table_schema = 'public'" \
  --command="SELECT '  migrations:  ' || count(*) FROM _prisma_migrations" \
  --command="SELECT '  events:      ' || count(*) FROM events" \
  --command="SELECT '  guests:      ' || count(*) FROM guests" \
  --command="SELECT '  payments:    ' || count(*) FROM payments"

TABLES=$(PGPASSWORD="${POSTGRES_PASSWORD:-}" psql --host="$POSTGRES_HOST" --port="$POSTGRES_PORT" \
  --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align \
  --command="SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")

if [ "$TABLES" -lt 2 ]; then
  echo ""
  echo "FAILED: '$POSTGRES_DB' has $TABLES tables after the restore, so that dump" >&2
  echo "was empty or came from the wrong database." >&2
  echo "" >&2
  # Worth stating, because the instinct is to assume the worst: --clean only
  # drops objects the dump itself contains, so an empty dump changes nothing.
  echo "Nothing was destroyed — pg_restore only drops what the dump contains," >&2
  echo "so an empty dump is a no-op. Find the right dump and run this again:" >&2
  ls -1t /backups/postgres-*.dump 2>/dev/null | head -10 >&2
  exit 1
fi

echo ""
echo "Next: restart the API so it reconnects, and check that it comes up:"
echo "  docker compose -f docker-compose.prod.yml restart api"
echo "  curl -fsS https://\$API_DOMAIN/api/v1/health/ready"
