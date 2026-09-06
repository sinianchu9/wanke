#!/usr/bin/env bash
# Run an acceptance script against a production Next server with a throwaway DB.
#   scripts/e2e-run.sh scripts/saas-e2e.mjs
#   scripts/e2e-run.sh scripts/commerce-e2e.mjs
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-3100}"
DB="${DB:-./data/e2e-$(date +%Y%m%d-%H%M%S).db}"
SCRIPT="${1:-scripts/saas-e2e.mjs}"

export WANKE_DB_PATH="$DB"
export WANKE_INPUT_DIR="${WANKE_INPUT_DIR:-./data/e2e-inputs}"
export WANKE_OUTPUT_DIR="${WANKE_OUTPUT_DIR:-./data/e2e-outputs}"
export E2E_DB="$DB"
export E2E_BASE="http://127.0.0.1:$PORT"
export ADMIN_EMAIL="${ADMIN_EMAIL:-admin@wanke.test}"
export AUTH_SECRET="${AUTH_SECRET:-e2e-secret-0123456789abcdef0123456789abcdef}"
export NODE_ENV=production

node_modules/.bin/next start -p "$PORT" > /tmp/wanke-e2e-server.log 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:$PORT/api/status" > /dev/null 2>&1; then break; fi
  sleep 1
done

echo "== e2e db: $DB =="
node "$SCRIPT"
