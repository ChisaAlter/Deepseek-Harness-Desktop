# Mirrors scripts/dev-home.sh so a dev daemon reads a seeded copy of the
# production home (config.json + agents/ + projects/ JSON metadata) instead of
# an empty temp dir. Without the seed, model-gateway face providers configured
# in production config.json are never registered, and isStoredAgentProviderAvailable
# filters every persisted agent out of the list (0 sessions in dev).

# Copy every *.json under $SourceDir into $TargetDir, preserving subdirectories.
# Used to seed agents/ and projects/ metadata trees.
function Copy-JsonTree {
    param([string]$SourceDir, [string]$TargetDir)

    if (-not (Test-Path $SourceDir)) {
        return
    }

    New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
    Get-ChildItem -Path $SourceDir -Recurse -File -Filter *.json -ErrorAction SilentlyContinue |
        ForEach-Object {
            $relative = $_.FullName.Substring($SourceDir.Length).TrimStart('\', '/')
            $targetFile = Join-Path $TargetDir $relative
            $targetParent = Split-Path -Parent $targetFile
            if ($targetParent -and -not (Test-Path $targetParent)) {
                New-Item -ItemType Directory -Force -Path $targetParent | Out-Null
            }
            Copy-Item -Path $_.FullName -Destination $targetFile -Force
        }
}

# Seed a dev CHISACODE_HOME from the production home so the dev daemon registers
# the same model-gateway face providers (and therefore sees the same persisted
# agents). Always refreshes config.json; agents/projects metadata is only
# seeded when missing (set CHISACODE_DEV_RESET_HOME=1 to force a full reseed).
function Seed-DevChisacodeHome {
    param([string]$TargetHome)

    $sourceHome = if ($env:CHISACODE_DEV_SEED_HOME) { $env:CHISACODE_DEV_SEED_HOME } else { Join-Path $env:USERPROFILE ".chisacode" }

    if (-not (Test-Path $sourceHome)) {
        Write-Host "  Seed:    skipped ($sourceHome missing)"
        return
    }
    if ($sourceHome -eq $TargetHome) {
        Write-Host "  Seed:    skipped (source is target)"
        return
    }

    # config.json carries the model-gateway definitions whose face providers
    # gate agent visibility, so always refresh it from the seed source (it is
    # small and the authoritative dev source). agents/projects metadata is
    # larger, so only seed it when the target tree is missing — unless
    # CHISACODE_DEV_RESET_HOME=1 forces a full reseed.
    $forceReset = $env:CHISACODE_DEV_RESET_HOME -eq "1"

    New-Item -ItemType Directory -Force -Path $TargetHome | Out-Null

    $sourceConfig = Join-Path $sourceHome "config.json"
    if (Test-Path $sourceConfig) {
        Copy-Item -Path $sourceConfig -Destination (Join-Path $TargetHome "config.json") -Force
        Write-Host "  Seed:    refreshed config.json from $sourceHome"
    }

    $seededMeta = $false
    if ($forceReset) {
        $agentsTarget = Join-Path $TargetHome "agents"
        $projectsTarget = Join-Path $TargetHome "projects"
        if (Test-Path $agentsTarget) { Remove-Item -Recurse -Force $agentsTarget -ErrorAction SilentlyContinue }
        if (Test-Path $projectsTarget) { Remove-Item -Recurse -Force $projectsTarget -ErrorAction SilentlyContinue }
    }

    if ($forceReset -or -not (Test-Path (Join-Path $TargetHome "agents"))) {
        Copy-JsonTree (Join-Path $sourceHome "agents") (Join-Path $TargetHome "agents")
        $seededMeta = $true
    }
    if ($forceReset -or -not (Test-Path (Join-Path $TargetHome "projects"))) {
        Copy-JsonTree (Join-Path $sourceHome "projects") (Join-Path $TargetHome "projects")
        $seededMeta = $true
    }

    if ($seededMeta) {
        Write-Host "  Seed:    seeded agents/projects metadata from $sourceHome"
    } elseif (-not $forceReset) {
        Write-Host "  Seed:    agents/projects already present (set CHISACODE_DEV_RESET_HOME=1 to reseed)"
    }
}

# Resolve a stable, seeded dev CHISACODE_HOME. Worktrees get ~/.chisacode-<name>;
# the main checkout gets ~/.chisacode-dev (stable across restarts so the seed
# persists). Honors an explicit $env:CHISACODE_HOME. Sets $env:CHISACODE_HOME
# and echoes the chosen home + seed status.
function Resolve-DevChisacodeHome {
    if ($env:CHISACODE_HOME) {
        Write-Host "  Home:    $env:CHISACODE_HOME (preset)"
        return
    }

    $GitDir = git rev-parse --git-dir 2>$null
    $GitCommonDir = git rev-parse --git-common-dir 2>$null

    if ($GitDir -and $GitCommonDir -and ($GitDir -ne $GitCommonDir)) {
        # Inside a worktree — derive a stable home from the worktree name
        $WorktreeRoot = git rev-parse --show-toplevel
        $WorktreeName = (Split-Path -Leaf $WorktreeRoot).ToLower() -replace '[^a-z0-9-]', '-' -replace '-+', '-' -replace '^-|-$', ''
        $env:CHISACODE_HOME = Join-Path $env:USERPROFILE ".chisacode-$WorktreeName"
    } else {
        # Main checkout — stable seeded home, kept across restarts
        $env:CHISACODE_HOME = Join-Path $env:USERPROFILE ".chisacode-dev"
    }

    New-Item -ItemType Directory -Force -Path $env:CHISACODE_HOME | Out-Null
    Write-Host "  Home:    $env:CHISACODE_HOME"
    Seed-DevChisacodeHome $env:CHISACODE_HOME
}