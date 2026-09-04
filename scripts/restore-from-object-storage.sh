#!/usr/bin/env bash
# Restores the most recent (or a specified) Postgres dump from Linode Object Storage.
# Usage: ./scripts/restore-from-object-storage.sh [s3-key]
set -euo pipefail

BUCKET="${BUCKET:-postgres-backups}"
REGION="${REGION:-us-ord-10}"
ENDPOINT="${ENDPOINT:-https://${REGION}.linodeobjects.com}"
PREFIX="${PREFIX:-waiver-app}"
NAMESPACE="${NAMESPACE:-gravitas}"
POD="${POD:-postgres-0}"
PGUSER="${PGUSER:-postgres}"
PGDATABASE="${PGDATABASE:-waiver_app}"

: "${LINODE_OBJ_ACCESS_KEY:?set LINODE_OBJ_ACCESS_KEY}"
: "${LINODE_OBJ_SECRET_KEY:?set LINODE_OBJ_SECRET_KEY}"
export AWS_ACCESS_KEY_ID="$LINODE_OBJ_ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$LINODE_OBJ_SECRET_KEY"
export AWS_DEFAULT_REGION="$REGION"

KEY="${1:-}"
if [[ -z "$KEY" ]]; then
  KEY="$(aws --endpoint-url "$ENDPOINT" s3 ls "s3://${BUCKET}/${PREFIX}/" --recursive \
    | sort | tail -n 1 | awk '{print $4}')"
fi
[[ -n "$KEY" ]] || { echo "no backup found under s3://${BUCKET}/${PREFIX}/" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> Downloading s3://${BUCKET}/${KEY}"
aws --endpoint-url "$ENDPOINT" s3 cp "s3://${BUCKET}/${KEY}" "$TMP/restore.dump"

echo "==> Restoring into ${NAMESPACE}/${POD} database ${PGDATABASE}"
kubectl -n "$NAMESPACE" exec -i "$POD" -- \
  pg_restore --clean --if-exists --no-owner -U "$PGUSER" -d "$PGDATABASE" < "$TMP/restore.dump"

echo "==> Restore complete"
