$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DesktopDir = (Resolve-Path "$ScriptDir\..").Path
$AppDir = (Resolve-Path "$DesktopDir\..\app").Path
$RootDir = (Resolve-Path "$DesktopDir\..\..").Path

# Build the Electron main process
npm run build:main

# Prefer Metro's stable default port so dev browser storage keeps the same
# localhost origin across restarts. Fall back only when earlier ports are busy.
$env:EXPO_PORT = (npx get-port-cli 8081 8082 8083 8084 8085).Trim()

# Set EXPO_DEV_URL in the environment so Electron inherits it
$env:EXPO_DEV_URL = "http://localhost:$($env:EXPO_PORT)"

# --- Isolated, seeded dev daemon home + listen port ---
# The desktop Electron main spawns its own daemon via startDaemon(), inheriting
# this process env. Without an isolated CHISACODE_HOME + CHISACODE_LISTEN the dev
# daemon would collide with any already-running production daemon on
# localhost:6767 (~/.chisacode) and either adopt the production daemon (which
# rejects the Metro dev origin) or fight over the pid lock. We seed a stable
# copy of the production home so the dev daemon registers the same model-gateway
# face providers and sees the same persisted agents. Shared logic with the root
# dev scripts lives in scripts/dev-home.ps1.
$RootScriptsDir = (Resolve-Path "$DesktopDir\..\..\scripts").Path
. (Join-Path $RootScriptsDir "dev-home.ps1")
Write-Host "  Desktop dev home:"
Resolve-DevChisacodeHome

# Pick a free daemon port (above the production 6767 default and the root
# dev.ps1 6767-6776 range) so desktop dev and root dev:win can coexist.
$DaemonPort = (npx get-port-cli 6770 6771 6772 6773 6774 6775 6776 6777 6778 6779 6780 6781 6782 6783 6784 6785).Trim()
if (-not $DaemonPort) {
    Write-Error "无法确定空闲 dev daemon 端口（6770-6785）。"
    exit 1
}
$env:CHISACODE_LISTEN = "localhost:$DaemonPort"

$RemoteDebuggingPort = if ($env:CHISACODE_ELECTRON_REMOTE_DEBUGGING_PORT) {
    $env:CHISACODE_ELECTRON_REMOTE_DEBUGGING_PORT
} else {
    (npx get-port-cli 9223 9224 9225 9226 9227).Trim()
}
$ExistingElectronFlags = if ($env:CHISACODE_ELECTRON_FLAGS) {
    "$($env:CHISACODE_ELECTRON_FLAGS) "
} else {
    ""
}
$env:CHISACODE_ELECTRON_FLAGS = "$($ExistingElectronFlags)--remote-debugging-port=$RemoteDebuggingPort"

# Allow any origin in dev so Electron on random ports works.
# SECURITY: wildcard CORS is unsafe in production — only acceptable here because
# the daemon binds to localhost and this script is never used for production.
$env:CHISACODE_CORS_ORIGINS = "*"

Write-Host @"
======================================================
  ChisaCode Desktop Dev (Windows)
======================================================
  Metro:     http://localhost:$($env:EXPO_PORT)
  CDP:       http://127.0.0.1:$RemoteDebuggingPort
======================================================
"@

# Launch Metro + Electron together, kill both on exit
& "$RootDir\node_modules\.bin\concurrently.cmd" `
    --kill-others `
    --names "metro,electron" `
    --prefix-colors "magenta,cyan" `
    "cd /d `"$AppDir`" && set `"CHISACODE_WEB_PLATFORM=electron`" && npx expo start --port $($env:EXPO_PORT)" `
    "npx wait-on tcp:$($env:EXPO_PORT) && npx electron `"$DesktopDir`""
