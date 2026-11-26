#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EVIDENCE_FILE="$ROOT/evidence/demos.txt"
mkdir -p "$ROOT/evidence"
touch "$EVIDENCE_FILE"

upsert_kv() {
  local key="$1" val="$2"
  grep -v "^${key}=" "$EVIDENCE_FILE" > "${EVIDENCE_FILE}.tmp" || true
  printf '%s=%s\n' "$key" "$val" >> "${EVIDENCE_FILE}.tmp"
  mv "${EVIDENCE_FILE}.tmp" "$EVIDENCE_FILE"
}

START_TS="$(date +%s)"
pulumi --cwd "$ROOT/infra/demo" config set hw31:withNat true
pulumi --cwd "$ROOT/infra/demo" up --yes --non-interactive

# Immediately tear down NAT Gateway after creation to measure partial-hour billing
pulumi --cwd "$ROOT/infra/demo" config set hw31:withNat false
pulumi --cwd "$ROOT/infra/demo" up --yes --non-interactive
END_TS="$(date +%s)"

ELAPSED_SEC="$((END_TS - START_TS))"
NAT_MINUTES="$(( (ELAPSED_SEC + 59) / 60 ))"
if [ "$NAT_MINUTES" -lt 1 ]; then
  NAT_MINUTES=1
fi
NAT_BILLED_HOURS=1

upsert_kv "nat-minutes" "$NAT_MINUTES"
upsert_kv "nat-billed-hours" "$NAT_BILLED_HOURS"

echo "nat-minutes=$NAT_MINUTES"
echo "nat-billed-hours=$NAT_BILLED_HOURS"
