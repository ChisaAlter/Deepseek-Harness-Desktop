$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path "$ScriptDir\.."
$env:PATH = "$ProjectRoot\node_modules\.bin;$env:PATH"

# --- Pre-flight checks ---

# Verify node_modules exists; warn if not
if (-not (Test-Path "$ProjectRoot\node_modules")) {
    Write-Warning "node_modules 未找到。请先运行: npm ci"
    Write-Warning "或运行一键设置脚本: powershell scripts/setup-dev.ps1"
    Write-Host ""
}

# Verify concurrently is available
$concurrentlyPath = Get-Command concurrently -ErrorAction SilentlyContinue
if (-not $concurrentlyPath) {
    Write-Error "concurrently 未找到。请运行: npm ci"
    exit 1
}

# --- Derive + seed CHISACODE_HOME ---
# Dev home is a stable, seeded copy of the production home so the dev daemon
# registers the same model-gateway face providers and sees the same persisted
# agents (instead of an empty temp dir that filters every agent out). Shared
# logic lives in scripts/dev-home.ps1.
. (Join-Path $ScriptDir "dev-home.ps1")
Resolve-DevChisacodeHome

# --- Share speech models ---

if (-not $env:CHISACODE_LOCAL_MODELS_DIR) {
    $env:CHISACODE_LOCAL_MODELS_DIR = "$env:USERPROFILE\.chisacode\models\local-speech"
    New-Item -ItemType Directory -Force -Path $env:CHISACODE_LOCAL_MODELS_DIR | Out-Null
}

# --- Port resolution: find a free port starting from 6767 ---

$BASE_PORT = 6767
$MAX_PORT = 6776

function Test-PortAvailable {
    param([int]$Port)
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
        $listener.Start()
        $listener.Stop()
        return $true
    } catch {
        return $false
    }
}

$DAEMON_PORT = $null
for ($port = $BASE_PORT; $port -le $MAX_PORT; $port++) {
    if (Test-PortAvailable $port) {
        $DAEMON_PORT = $port
        break
    }
}

if (-not $DAEMON_PORT) {
    Write-Error "端口 $BASE_PORT-$MAX_PORT 均被占用。请释放端口后重试。"
    exit 1
}

if ($DAEMON_PORT -ne $BASE_PORT) {
    Write-Host "端口 $BASE_PORT 被占用，使用备用端口 $DAEMON_PORT" -ForegroundColor DarkYellow
}

# --- Build server dependencies if dist/ is missing ---

$serverDist = "$ProjectRoot\packages\server\dist"
$protocolDist = "$ProjectRoot\packages\protocol\dist"
$clientDist = "$ProjectRoot\packages\client\dist"

if (-not (Test-Path $serverDist) -or -not (Test-Path $protocolDist) -or -not (Test-Path $clientDist)) {
    Write-Host ""
    Write-Host "正在构建 server 依赖（协议层 + client + server）..." -ForegroundColor Yellow
    Push-Location $ProjectRoot
    try {
        npm run build:server-deps 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "server-deps 构建失败，继续使用缓存版本。如果遇到类型错误请先运行: npm run build:server-deps"
        }
    } finally {
        Pop-Location
    }
    Write-Host ""
}

# --- Display banner ---

Write-Host @"
======================================================
  ChisaCode Dev (Windows)
======================================================
  Home:    $($env:CHISACODE_HOME)
  Models:  $($env:CHISACODE_LOCAL_MODELS_DIR)
  Daemon:  localhost:$DAEMON_PORT
======================================================
"@

# --- Environment configuration ---

# Allow any origin in dev so Electron on random ports all work.
# SECURITY: wildcard CORS is unsafe in production — only acceptable here because
# the daemon binds to localhost and this script is never used for production.
$env:CHISACODE_CORS_ORIGINS = "*"

# Configure the app to auto-connect to this daemon on localhost
$env:APP_VARIANT = "development"
$env:EXPO_PUBLIC_LOCAL_DAEMON = "localhost:$DAEMON_PORT"
$env:BROWSER = "none"

# Pass the daemon listen address
$env:CHISACODE_LISTEN = "localhost:$DAEMON_PORT"

# --- Pre-watch build: compile protocol+client in watch mode ---
# The npm scripts handle this internally, but we ensure the initial build exists.
# watch:protocol and watch:client are started by dev:server via concurrently.

Write-Host "正在启动 server (watch) + app (expo) ..." -ForegroundColor Cyan
Write-Host ""

# Run both with concurrently
# On first launch, dev:server starts watch:protocol + watch:client + dev:server:raw
concurrently `
    --names "daemon,metro" `
    --prefix-colors "cyan,magenta" `
    "npm run dev:server" `
    "cd packages/app && npx expo start"
