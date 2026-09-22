#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/../node_modules/.bin:$PATH"

source "$SCRIPT_DIR/dev-home.sh"
configure_dev_chisacode_home

if [ -z "${CHISACODE_LOCAL_MODELS_DIR}" ]; then
  export CHISACODE_LOCAL_MODELS_DIR="$HOME/.chisacode/models/local-speech"
  mkdir -p "$CHISACODE_LOCAL_MODELS_DIR"
fi

echo "══════════════════════════════════════════════════════"
echo "  ChisaCode Dev Daemon"
echo "══════════════════════════════════════════════════════"
echo "  Home:    ${CHISACODE_HOME}"
echo "  Models:  ${CHISACODE_LOCAL_MODELS_DIR}"
echo "══════════════════════════════════════════════════════"

export CHISACODE_CORS_ORIGINS="${CHISACODE_CORS_ORIGINS:-*}"
export CHISACODE_NODE_INSPECT="${CHISACODE_NODE_INSPECT:---inspect=0}"

exec npm run dev:server
