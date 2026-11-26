#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGION="${AWS_REGION:-eu-north-1}"
EVIDENCE_FILE="$ROOT/evidence/demos.txt"
mkdir -p "$ROOT/evidence"
touch "$EVIDENCE_FILE"

upsert_kv() {
  local key="$1" val="$2"
  grep -v "^${key}=" "$EVIDENCE_FILE" > "${EVIDENCE_FILE}.tmp" || true
  printf '%s=%s\n' "$key" "$val" >> "${EVIDENCE_FILE}.tmp"
  mv "${EVIDENCE_FILE}.tmp" "$EVIDENCE_FILE"
}

DB_ID="$(pulumi --cwd "$ROOT/infra/demo" stack output dbIdentifier)"
AZ_BEFORE="$(aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$DB_ID" --query 'DBInstances[0].AvailabilityZone' --output text)"
echo "az-before=$AZ_BEFORE"

START_TS="$(date +%s)"
aws rds reboot-db-instance --region "$REGION" --db-instance-identifier "$DB_ID" --force-failover >/dev/null

echo "Waiting for failover to complete..."
while true; do
  STATUS="$(aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$DB_ID" --query 'DBInstances[0].DBInstanceStatus' --output text)"
  AZ_NOW="$(aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$DB_ID" --query 'DBInstances[0].AvailabilityZone' --output text)"
  if [ "$STATUS" = "available" ] && [ "$AZ_NOW" != "$AZ_BEFORE" ]; then
    break
  fi
  sleep 5
done

END_TS="$(date +%s)"
FAILOVER_SECONDS="$((END_TS - START_TS))"
EVENT_MSG="$(aws rds describe-events --region "$REGION" --source-identifier "$DB_ID" --source-type db-instance --duration 60 --query 'Events[-1].Message' --output text)"

upsert_kv "az-before" "$AZ_BEFORE"
upsert_kv "az-after" "$AZ_NOW"
upsert_kv "failover-seconds" "$FAILOVER_SECONDS"
upsert_kv "event" "$EVENT_MSG"

echo "az-before=$AZ_BEFORE"
echo "az-after=$AZ_NOW"
echo "failover-seconds=$FAILOVER_SECONDS"
echo "event=$EVENT_MSG"
