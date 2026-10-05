#!/usr/bin/env bash
# Brings a fresh Garage node into service and prints credentials for .env.
#
# Garage does not serve anything until a layout is assigned — a node with no
# role is healthy but useless, which is the step people miss.
set -euo pipefail

CONTAINER="${GARAGE_CONTAINER:-aveline-garage}"
BUCKET="${GARAGE_BUCKET:-aveline-media}"
KEY_NAME="${GARAGE_KEY:-aveline-backend}"
CAPACITY="${GARAGE_CAPACITY:-10G}"
ZONE="${GARAGE_ZONE:-aveline}"

garage() { docker exec "$CONTAINER" /garage "$@"; }

node_id=$(garage status 2>/dev/null | awk '/NO ROLE ASSIGNED/{print $1}')
if [ -n "$node_id" ]; then
  echo "Assigning layout to $node_id..."
  garage layout assign -z "$ZONE" -c "$CAPACITY" "$node_id" >/dev/null
  garage layout apply --version 1 >/dev/null
  sleep 2
else
  echo "Layout already assigned."
fi

garage bucket create "$BUCKET" >/dev/null 2>&1 || true

# `garage key create` does not check for an existing name — running it twice
# produces two keys with the same alias, and every later lookup by name then
# fails with "2 matching keys". Create only when none exists.
if ! garage key list 2>/dev/null | grep -q "[[:space:]]$KEY_NAME\b"; then
  echo "Creating key $KEY_NAME..."
  garage key create "$KEY_NAME" >/dev/null
fi

garage bucket allow --read --write --owner "$BUCKET" --key "$KEY_NAME" >/dev/null

# Anonymous reads. Invitation images are loaded by every guest from a link
# they were sent; signed URLs would expire and break a shared invitation, and
# proxying them through the API would pay for the bandwidth twice. The object
# key is a UUID, so the URL is unguessable without being secret.
garage bucket website --allow "$BUCKET" >/dev/null

key_id=$(garage key info "$KEY_NAME" --show-secret | awk -F': *' '/Key ID/{print $2}')
secret=$(garage key info "$KEY_NAME" --show-secret | awk -F': *' '/Secret key/{print $2}')

cat <<CREDS

Add to backend/.env:

S3_ENDPOINT="http://localhost:3900"
S3_REGION="garage"
S3_BUCKET="$BUCKET"
S3_ACCESS_KEY_ID="$key_id"
S3_SECRET_ACCESS_KEY="$secret"
S3_PUBLIC_URL="http://$BUCKET.web.garage.localhost:3902"
CREDS
