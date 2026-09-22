#!/usr/bin/env bash
# Cloud-agent / fresh-VM setup. Node pinning has a single source: .nvmrc
# (engines ^22.19.0 || >=24). The default VM node can lag behind (e.g.
# 22.14), which breaks the vendor build (tsdown requires a matching engine),
# so align via nvm before installing dependencies.
set -euo pipefail
cd "$(dirname "$0")/.."

want="$(tr -d '[:space:]' < .nvmrc)"
have="$(node --version 2>/dev/null || echo none)"
if [ "$have" != "v$want" ]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # nvm.sh is not set -u clean.
    set +u
    . "$NVM_DIR/nvm.sh"
    nvm install "$want"
    nvm alias default "$want"
    nvm use "$want"
    set -u
  else
    echo "warning: node $have != v$want and nvm is unavailable; install Node $want manually" >&2
  fi
fi
node --version

npm ci

# .npmrc pins electron_skip_binary_download=true so packaging via electron-builder
# stays deterministic, but a source-run dev VM still needs the Electron runtime
# binary to launch `npm start` / the smoke + QA walks. Extract it from the cache
# (idempotent; no-op when dist already matches).
node node_modules/electron/install.js

# Build the vendored harness so the app runs from source, not just enough for the
# desktop-shell unit tests: setup:harness runs the vendor pnpm install
# (--frozen-lockfile), builds the client libs, stages the Ghostty terminal assets,
# and installs the bundled plugin runtime deps. It is idempotent.
npm run setup:harness
