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

ALB_DNS="$(pulumi --cwd "$ROOT/infra/demo" stack output albDnsName)"
TG_ARN="$(pulumi --cwd "$ROOT/infra/demo" stack output targetGroupArn)"

echo "Waiting for ALB target to become healthy..."
for _ in $(seq 1 30); do
  TARGET_STATE="$(aws elbv2 describe-target-health --region "$REGION" --target-group-arn "$TG_ARN" --query 'TargetHealthDescriptions[0].TargetHealth.State' --output text)"
  if [ "$TARGET_STATE" = "healthy" ]; then
    break
  fi
  sleep 5
done

HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://${ALB_DNS}/health" || echo "000")"

upsert_kv "alb-dns" "$ALB_DNS"
upsert_kv "http-code" "$HTTP_CODE"
upsert_kv "target-state" "$TARGET_STATE"

echo "alb-dns=$ALB_DNS"
echo "http-code=$HTTP_CODE"
echo "target-state=$TARGET_STATE"
