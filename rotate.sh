#!/usr/bin/env bash
set -euo pipefail

NEW_PASSWORD="${1:-$(openssl rand -hex 16)}"
SECRET_FILE="secrets/db_password"
DB_NAME="broker_db"
DB_USER="postgres"

echo "🔄 Starting database password rotation..."

# Execute SQL command inside the postgres container
execute_sql() {
  local sql="$1"
  if docker compose ps postgres 2>&1 | grep -q "Up"; then
    docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -c "$sql"
  elif docker ps --format '{{.Names}}' | grep -q "broker_postgres"; then
    docker exec -T broker_postgres psql -U "$DB_USER" -d "$DB_NAME" -c "$sql"
  else
    psql -U "$DB_USER" -d "$DB_NAME" -c "$sql"
  fi
}

# 1. Update password in PostgreSQL
echo "🔑 Step 1: Updating password in PostgreSQL (ALTER ROLE)..."
execute_sql "ALTER ROLE $DB_USER WITH PASSWORD '$NEW_PASSWORD';"

# 2. Update the secret file
echo "📁 Step 2: Updating secret file $SECRET_FILE..."
mkdir -p "$(dirname "$SECRET_FILE")"
printf "%s" "$NEW_PASSWORD" > "$SECRET_FILE"

# 3. Terminate old connections to force re-authentication with new secret
echo "⚡ Step 3: Terminating old connections (pg_terminate_backend)..."
TERMINATE_SQL="SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '$DB_USER' AND pid <> pg_backend_pid();"
execute_sql "$TERMINATE_SQL"

echo "✅ Password rotation completed successfully! Database and secret file are synchronized."
