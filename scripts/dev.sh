#!/usr/bin/env bash
# Spin up both the core API and the Astro viewer in dev mode. Kills any
# previous runs first. Intended for contributors hacking on remember itself,
# not end-user wikis. (End users get a single `remember dev` later in v0.1.)

set -euo pipefail

cd "$(dirname "$0")/.."

echo "→ killing any prior remember/astro processes"
pkill -f "bin/remember.js" 2>/dev/null || true
pkill -f "astro dev"        2>/dev/null || true
sleep 1

echo "→ building @remember/core"
pnpm --filter @remember/core build > /dev/null

echo "→ starting core API on :4320"
(
  cd examples/sample-wiki
  node ../../packages/core/bin/remember.js start
) &
CORE_PID=$!

# Wait for the API to come up before we start the viewer.
echo -n "  "
until curl -sf http://127.0.0.1:4320/v1/health > /dev/null 2>&1; do
  echo -n "."
  sleep 1
done
echo " core ready"

echo "→ starting Astro viewer on :4321"
pnpm --filter @remember/viewer dev &
VIEWER_PID=$!

cleanup() {
  echo ""
  echo "→ shutting down"
  kill "$CORE_PID" "$VIEWER_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo ""
echo "  core   http://127.0.0.1:4320"
echo "  viewer http://127.0.0.1:4321"
echo ""
echo "Ctrl+C to stop both."

wait
