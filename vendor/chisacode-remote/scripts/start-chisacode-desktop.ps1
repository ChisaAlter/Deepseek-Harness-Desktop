# Launch the latest ChisaCode desktop app from this checkout (Windows).
# Used by Desktop / repo ChisaCode.lnk shortcuts.
$ErrorActionPreference = "Stop"

$Root = "C:\Ai\ChisaCode"
if (-not (Test-Path (Join-Path $Root "package.json"))) {
  $Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$LogDir = Join-Path $env:USERPROFILE ".chisacode-chisacode\logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogFile = Join-Path $LogDir "desktop-shortcut.log"

function Write-Log([string]$Message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -Path $LogFile -Value $line
  Write-Host $line
}

try {
  Set-Location $Root
  $nodeDir = "C:\Program Files\nodejs"
  if (Test-Path (Join-Path $nodeDir "node.exe")) {
    $env:PATH = "$nodeDir;$env:PATH"
  }
  $env:PATH = "$Root\node_modules\.bin;$env:PATH"

  Write-Log "Starting ChisaCode desktop from $Root"

  # Clean previous checkout desktop/dev instances so the shortcut always opens one good app.
  Get-CimInstance Win32_Process | ForEach-Object {
    $cmd = [string]$_.CommandLine
    if (-not $cmd) {
      return
    }
    if ($cmd -notmatch "C:\\Ai\\ChisaCode|C:/Ai/ChisaCode") {
      return
    }
    if ($cmd -match "CodeBuddyGUI|pi-desktop|zcode") {
      return
    }
    if ($cmd -match "expo start --port|@chisacode/desktop|packages\\desktop|start-chisacode-desktop|concurrently.*metro,electron") {
      Write-Log "Stopping pid=$($_.ProcessId) $($_.Name)"
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }

  foreach ($port in 8081, 8082, 8083, 8084, 8085, 6770, 6771, 9223) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      ForEach-Object {
        Write-Log "Freeing port $port pid=$($_.OwningProcess)"
        Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
      }
  }

  Start-Sleep -Seconds 1
  Write-Log "Running npm run dev:win --workspace=@chisacode/desktop"
  & npm.cmd run dev:win --workspace=@chisacode/desktop 2>&1 | Tee-Object -FilePath $LogFile -Append
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    Write-Log "Desktop exited with code $code"
    Write-Host ""
    Write-Host "Log: $LogFile" -ForegroundColor Yellow
    if (-not $env:CHISACODE_SHORTCUT_NO_PAUSE) {
      pause
    }
    exit $code
  }
} catch {
  Write-Log ("ERROR: " + $_.Exception.Message)
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host "Log: $LogFile" -ForegroundColor Yellow
  if (-not $env:CHISACODE_SHORTCUT_NO_PAUSE) {
    pause
  }
  exit 1
}
