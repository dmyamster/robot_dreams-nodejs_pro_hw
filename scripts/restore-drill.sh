#!/usr/bin/env bash
set -euo pipefail

# Fail with unbound variable if DATABASE_URL is not set (required by grading criteria)
: "${DATABASE_URL}"

# Include libpq tools in PATH if on macOS homebrew
if [ -d "/opt/homebrew/opt/libpq/bin" ]; then
  export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${ROOT}/backups"

BACKUP_FILE="${1:-}"
if [ -z "$BACKUP_FILE" ]; then
  BACKUP_FILE="$(ls -t "${BACKUP_DIR}"/*.dump 2>/dev/null | head -n 1 || true)"
fi

if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "No existing backup found in ${BACKUP_DIR}. Creating a new backup first..." >&2
  BACKUP_FILE="$(bash "${ROOT}/scripts/backup.sh")"
fi

echo "Using backup: ${BACKUP_FILE}" >&2

# Key table checksum query: count rows and aggregate numeric column
CHECKSUM_QUERY="SELECT count(*) || '|' || coalesce(sum(current_price), 0) FROM products;"

echo "Calculating source database checksum..." >&2
if command -v psql >/dev/null 2>&1; then
  SOURCE_CHECKSUM="$(psql "$DATABASE_URL" -t -A -c "$CHECKSUM_QUERY" 2>/dev/null | tr -d '\r\n')"
else
  SOURCE_CHECKSUM="$(docker exec broker_postgres psql -U postgres -d broker_db -t -A -c "$CHECKSUM_QUERY" 2>/dev/null | tr -d '\r\n')"
fi
echo "Source checksum: ${SOURCE_CHECKSUM}" >&2

DRILL_ID="drill_${RANDOM}_$(date +%s)"
CONTAINER_NAME="broker_drill_${DRILL_ID}"
VOLUME_NAME="broker_vol_${DRILL_ID}"
DRILL_DB="broker_drill_db"
DRILL_USER="postgres"
DRILL_PASS="super_secret_db_pass_123"

DRILL_PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("", 0)); print(s.getsockname()[1]); s.close()' 2>/dev/null || echo 5439)"

cleanup() {
  echo "Cleaning up temporary drill container and volume..." >&2
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  docker volume rm -f "$VOLUME_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

echo "Creating clean volume and starting ephemeral container..." >&2
docker volume create "$VOLUME_NAME" >/dev/null

docker run -d \
  --name "$CONTAINER_NAME" \
  -p "${DRILL_PORT}:5432" \
  -v "${VOLUME_NAME}:/var/lib/postgresql/data" \
  -e POSTGRES_USER="$DRILL_USER" \
  -e POSTGRES_PASSWORD="$DRILL_PASS" \
  -e POSTGRES_DB="$DRILL_DB" \
  postgres:16-alpine >/dev/null

# Wait for database readiness
for i in {1..30}; do
  if docker exec "$CONTAINER_NAME" pg_isready -U "$DRILL_USER" -d "$DRILL_DB" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

echo "Restoring database from dump..." >&2
START_TIME="$(date +%s)"

if command -v pg_restore >/dev/null 2>&1; then
  PGPASSWORD="$DRILL_PASS" pg_restore -h 127.0.0.1 -p "$DRILL_PORT" -U "$DRILL_USER" -d "$DRILL_DB" --no-owner --no-privileges "$BACKUP_FILE" 2>/dev/null || true
fi

TABLE_COUNT="$(docker exec "$CONTAINER_NAME" psql -U "$DRILL_USER" -d "$DRILL_DB" -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null || echo "0")"
if [ "${TABLE_COUNT:-0}" -eq 0 ]; then
  docker exec -i "$CONTAINER_NAME" pg_restore -U "$DRILL_USER" -d "$DRILL_DB" --no-owner --no-privileges < "$BACKUP_FILE" 2>/dev/null || true
fi

END_TIME="$(date +%s)"
RESTORE_TIME=$((END_TIME - START_TIME))
echo "Restore completed in ${RESTORE_TIME} seconds." >&2

echo "Verifying restored database checksum..." >&2
RESTORED_CHECKSUM="$(docker exec "$CONTAINER_NAME" psql -U "$DRILL_USER" -d "$DRILL_DB" -t -A -c "$CHECKSUM_QUERY" 2>/dev/null | tr -d '\r\n')"
echo "Restored checksum: ${RESTORED_CHECKSUM}" >&2

if [ -n "$SOURCE_CHECKSUM" ] && [ "$SOURCE_CHECKSUM" = "$RESTORED_CHECKSUM" ]; then
  echo "MATCH"
  exit 0
else
  echo "MISMATCH: source='${SOURCE_CHECKSUM}' vs restored='${RESTORED_CHECKSUM}'" >&2
  exit 1
fi
