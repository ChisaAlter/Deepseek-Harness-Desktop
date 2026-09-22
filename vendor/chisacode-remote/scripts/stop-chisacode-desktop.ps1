# Stop ChisaCode desktop/dev processes from this checkout.
# Never kill this script's own process tree or generic "start-chisacode-desktop"
# launchers — that made the desktop shortcut suicide on double-click.
$ErrorActionPreference = "SilentlyContinue"

$myPid = $PID
$parentPid = (Get-CimInstance Win32_Process -Filter "ProcessId = $myPid").ParentProcessId
$protected = New-Object "System.Collections.Generic.HashSet[int]"
[void]$protected.Add($myPid)
if ($parentPid) {
  [void]$protected.Add([int]$parentPid)
}

function Test-IsProtectedProcess {
  param([int]$ProcessId)
  if ($protected.Contains($ProcessId)) {
    return $true
  }
  # Protect ancestors a couple of levels up (cmd shortcut -> powershell stop).
  $current = $ProcessId
  for ($i = 0; $i -lt 4; $i++) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $current" -ErrorAction SilentlyContinue
    if (-not $proc) {
      break
    }
    $parent = [int]$proc.ParentProcessId
    if ($parent -le 0) {
      break
    }
    if ($protected.Contains($parent) -or $parent -eq $myPid -or $parent -eq $parentPid) {
      return $true
    }
    $current = $parent
  }
  return $false
}

Get-CimInstance Win32_Process | ForEach-Object {
  $cmd = [string]$_.CommandLine
  $processId = [int]$_.ProcessId
  if (-not $cmd) {
    return
  }
  if (Test-IsProtectedProcess -ProcessId $processId) {
    return
  }
  if ($cmd -notmatch "C:\\Ai\\ChisaCode|C:/Ai/ChisaCode") {
    return
  }
  if ($cmd -match "CodeBuddyGUI|pi-desktop|zcode") {
    return
  }

  # Kill actual desktop/dev workers only — not the shortcut launcher scripts.
  $isWorker =
    ($cmd -match "expo start --port") -or
    ($cmd -match "run dev:win") -or
    ($cmd -match "@chisacode/desktop") -or
    ($cmd -match "concurrently.*metro,electron") -or
    ($cmd -match "electron\.exe.*packages\\desktop") -or
    ($cmd -match "electron\.exe.*packages/desktop") -or
    ($cmd -match "supervisor-entrypoint") -or
    ($cmd -match "daemon-worker") -or
    ($cmd -match "terminal-worker")

  if ($isWorker) {
    Write-Output "Stopping pid=$processId $($_.Name)"
    Stop-Process -Id $processId -Force
  }
}

foreach ($port in 8081, 8082, 8083, 8084, 8085, 6770, 6771, 9223) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object {
      $owner = [int]$_.OwningProcess
      if ($owner -le 0 -or (Test-IsProtectedProcess -ProcessId $owner)) {
        return
      }
      Write-Output "Freeing port $port pid=$owner"
      Stop-Process -Id $owner -Force
    }
}

Start-Sleep -Seconds 1
Write-Output "Cleanup complete"
