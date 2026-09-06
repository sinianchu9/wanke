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

# Acceptance harness only: a throwaway self-signed localhost certificate lets the SMTP
# mock exercise the real SSL and STARTTLS code paths, including certificate verification.
# Regenerated every run so it can never expire, and never used by a real deployment.
SMTP_TEST_CERT="${SMTP_TEST_CERT:-$PWD/data/e2e-smtp-cert.pem}"
SMTP_TEST_KEY="${SMTP_TEST_KEY:-$PWD/data/e2e-smtp-key.pem}"
export WANKE_SMTP_TEST_CERT="$SMTP_TEST_CERT"
export WANKE_SMTP_TEST_KEY="$SMTP_TEST_KEY"
if command -v openssl >/dev/null 2>&1; then
  mkdir -p "$(dirname "$SMTP_TEST_CERT")"
  openssl req -x509 -newkey rsa:2048 -nodes -keyout "$SMTP_TEST_KEY" -out "$SMTP_TEST_CERT" \
    -days 2 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" >/dev/null 2>&1 || true
fi
if [ -f "$SMTP_TEST_CERT" ]; then
  export NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-$SMTP_TEST_CERT}"
else
  echo "== openssl unavailable: SMTP TLS/STARTTLS checks will be reported as skipped =="
fi

node_modules/.bin/next start -p "$PORT" > /tmp/wanke-e2e-server.log 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

# Readiness probe: the landing page is the only route that answers without a session
# (/api/status is member-only now), and a failed probe must not silently waste the run.
READY=0
for _ in $(seq 1 90); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then READY=1; break; fi
  sleep 1
done
if [ "$READY" != "1" ]; then
  echo "server did not become ready on port $PORT" >&2
  tail -40 /tmp/wanke-e2e-server.log >&2 || true
  exit 1
fi

echo "== e2e db: $DB =="
node "$SCRIPT"
