#!/usr/bin/env bash
# Daily PostgreSQL backup → Cloudflare R2
# Usage: ./scripts/backup-db.sh
# Schedule: 0 2 * * * /path/to/backup-db.sh (cron at 02:00 UTC)

set -euo pipefail

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="/tmp/vault_backups"
BACKUP_FILE="${BACKUP_DIR}/vault_${TIMESTAMP}.dump"
R2_BUCKET="${BACKUP_R2_BUCKET:-vault-backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

# Load .env if running outside Docker
if [ -f "$(dirname "$0")/../.env" ]; then
  # shellcheck disable=SC1090
  set -a && source "$(dirname "$0")/../.env" && set +a
fi

echo "[backup] Starting backup at ${TIMESTAMP}"

mkdir -p "${BACKUP_DIR}"

# Dump in custom format (supports parallel restore)
PGPASSWORD="${POSTGRES_PASSWORD:-vault}" pg_dump \
  --host="${POSTGRES_HOST:-localhost}" \
  --port="${POSTGRES_PORT:-5432}" \
  --username="${POSTGRES_USER:-vault}" \
  --dbname="${POSTGRES_DB:-vault_dev}" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-acl \
  --file="${BACKUP_FILE}"

echo "[backup] Dump complete: ${BACKUP_FILE}"

# Upload to R2 via AWS CLI (R2 is S3-compatible)
aws s3 cp "${BACKUP_FILE}" \
  "s3://${R2_BUCKET}/daily/vault_${TIMESTAMP}.dump" \
  --endpoint-url "https://${R2_ACCOUNT_ID:-your_account_id}.r2.cloudflarestorage.com" \
  --storage-class STANDARD

echo "[backup] Uploaded to R2: s3://${R2_BUCKET}/daily/vault_${TIMESTAMP}.dump"

# Remove local file
rm -f "${BACKUP_FILE}"

# Purge old backups from R2 (list and delete objects older than RETENTION_DAYS)
CUTOFF=$(date -d "-${RETENTION_DAYS} days" +%Y-%m-%dT%H:%M:%S 2>/dev/null \
  || date -v-"${RETENTION_DAYS}"d +%Y-%m-%dT%H:%M:%S)

echo "[backup] Removing backups older than ${RETENTION_DAYS} days (cutoff: ${CUTOFF})"

aws s3api list-objects-v2 \
  --bucket "${R2_BUCKET}" \
  --prefix "daily/" \
  --endpoint-url "https://${R2_ACCOUNT_ID:-your_account_id}.r2.cloudflarestorage.com" \
  --query "Contents[?LastModified<='${CUTOFF}'].Key" \
  --output text \
| tr '\t' '\n' \
| while IFS= read -r key; do
    if [ -n "${key}" ] && [ "${key}" != "None" ]; then
      aws s3 rm "s3://${R2_BUCKET}/${key}" \
        --endpoint-url "https://${R2_ACCOUNT_ID:-your_account_id}.r2.cloudflarestorage.com"
      echo "[backup] Deleted old backup: ${key}"
    fi
  done

echo "[backup] Done."
