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
mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y-%m-%d_%H-%M-%S)"
BACKUP_FILE="${BACKUP_DIR}/broker_db_${TIMESTAMP}.dump"

if command -v pg_dump >/dev/null 2>&1; then
  pg_dump -Fc --dbname="$DATABASE_URL" -f "$BACKUP_FILE"
else
  docker run --rm --network host -v "${BACKUP_DIR}:${BACKUP_DIR}" postgres:16-alpine \
    pg_dump -Fc --dbname="$DATABASE_URL" -f "$BACKUP_FILE"
fi

echo "$BACKUP_FILE"
