#!/usr/bin/env bash
# Android chain smoke for the desktop/mobile critical path.
#
# This wrapper keeps the default Android CI entrypoint stable while individual
# Maestro flows evolve. It runs from flow-specific temp directories, delegates
# artifact capture to the underlying harness, and never restarts the user's main
# daemon.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

echo "=== ChisaCode Android chain ==="
echo "Repo: $REPO_ROOT"
echo "App id: ${CHISACODE_MAESTRO_APP_ID:-sh.chisacode.debug}"
echo "Direct endpoint: ${CHISACODE_MAESTRO_DIRECT_ENDPOINT:-127.0.0.1:6767}"

bash "$REPO_ROOT/packages/app/maestro/test-workspace-create-android-crash.sh"

echo ""
echo "PASS: Android chain smoke completed."
