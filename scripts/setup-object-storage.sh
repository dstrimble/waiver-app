#!/usr/bin/env bash
# Creates the Linode Object Storage bucket used for off-cluster Postgres backups,
# applies a retention lifecycle policy, and stores the access key in Kubernetes.
#
# Prerequisites:
#   - linode-cli configured (`linode-cli configure`)
#   - aws-cli v2 installed
#   - kubectl pointed at the target cluster
#
# Required env vars for the access key (create at:
# Linode Cloud Manager > Object Storage > Access Keys, scoped read/write to the bucket):
#   LINODE_OBJ_ACCESS_KEY, LINODE_OBJ_SECRET_KEY
set -euo pipefail

BUCKET="${BUCKET:-postgres-backups}"
PREFIX="${PREFIX:-waiver-app}"
REGION="${REGION:-us-ord-10}"
ENDPOINT="${ENDPOINT:-https://${REGION}.linodeobjects.com}"
NAMESPACE="${NAMESPACE:-gravitas}"
SECRET_NAME="${SECRET_NAME:-linode-object-storage}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

: "${LINODE_OBJ_ACCESS_KEY:?set LINODE_OBJ_ACCESS_KEY}"
: "${LINODE_OBJ_SECRET_KEY:?set LINODE_OBJ_SECRET_KEY}"

export AWS_ACCESS_KEY_ID="$LINODE_OBJ_ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$LINODE_OBJ_SECRET_KEY"
export AWS_DEFAULT_REGION="$REGION"

s3() { aws --endpoint-url "$ENDPOINT" "$@"; }

echo "==> Ensuring bucket s3://${BUCKET} in ${REGION}"
if s3 s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  echo "    bucket already exists"
else
  s3 s3 mb "s3://${BUCKET}"
fi

echo "==> Blocking public access and enabling versioning"
s3 s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" \
  || echo "    (public access block unsupported on this endpoint; verify ACLs manually)"
s3 s3api put-bucket-versioning --bucket "$BUCKET" \
  --versioning-configuration Status=Enabled

# The bucket is shared with other apps, so merge our rule into the existing
# lifecycle config instead of replacing it.
echo "==> Applying ${RETENTION_DAYS}-day retention lifecycle for ${PREFIX}/"
EXISTING="$(s3 s3api get-bucket-lifecycle-configuration --bucket "$BUCKET" 2>/dev/null || echo '{"Rules":[]}')"
MERGED="$(PREFIX="$PREFIX" RETENTION_DAYS="$RETENTION_DAYS" EXISTING="$EXISTING" python3 - <<'PY'
import json, os
prefix, days = os.environ["PREFIX"], int(os.environ["RETENTION_DAYS"])
rule_id = f"expire-{prefix}-backups"
rules = [r for r in json.loads(os.environ["EXISTING"]).get("Rules", []) if r.get("ID") != rule_id]
rules.append({
    "ID": rule_id,
    "Status": "Enabled",
    "Filter": {"Prefix": f"{prefix}/"},
    "Expiration": {"Days": days},
    "NoncurrentVersionExpiration": {"NoncurrentDays": days},
    "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 3},
})
print(json.dumps({"Rules": rules}))
PY
)"
s3 s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" \
  --lifecycle-configuration "$MERGED"

echo "==> Writing ${SECRET_NAME} secret into namespace ${NAMESPACE}"
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
kubectl -n "$NAMESPACE" create secret generic "$SECRET_NAME" \
  --from-literal=AWS_ACCESS_KEY_ID="$LINODE_OBJ_ACCESS_KEY" \
  --from-literal=AWS_SECRET_ACCESS_KEY="$LINODE_OBJ_SECRET_KEY" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "==> Done. Bucket: s3://${BUCKET} (${ENDPOINT})"
