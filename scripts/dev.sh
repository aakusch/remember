#!/usr/bin/env bash
# Spin up the core API in dev mode against the sample wiki. Kills any previous
# run first. Intended for contributors hacking on remember itself, not end-user
# wikis (end users just run `remember dev`).

set -euo pipefail

cd "$(dirname "$0")/.."

echo "→ killing any prior remember processes"
pkill -f "bin/remember.js" 2>/dev/null || true
sleep 1

echo "→ building @useremember/core"
pnpm --filter @useremember/core build > /dev/null

echo "→ starting core API on :4320 against examples/sample-wiki"
cd examples/sample-wiki
exec node ../../packages/core/bin/remember.js dev
