# Desktop Release Artifact Hygiene - 2026-06-16

## Scope

The cleanup target was local desktop build output under:

```text
C:\Ai\ChisaCode\packages\desktop\release-*
C:\Ai\ChisaCode\packages\desktop\release-local
```

These paths are ignored/local artifacts and should not be part of routine source scans.

## Current State

- The only remaining local desktop release artifact is the latest verification directory:

```text
C:\Ai\ChisaCode\packages\desktop\release-voice-hidden-final-20260616-143000\win-unpacked\ChisaCode.exe
```

- Older `release-*` and `release-local` directories have been removed from
  `packages/desktop`.

## Cleanup Notes

- A stale `ChisaCode.exe` process observed during cleanup was PID `55652`, started on
  `2026-06-14 10:31:49`, with no visible window title and no live parent process found.
- After PID `55652` was stopped, Sysinternals `handle64.exe` showed that old
  `release-*\win-unpacked` directories were still held by stale `opencode.exe`, `node.exe`,
  and `mimo.exe` processes.
- The stale processes holding old release directories were stopped after explicit user
  authorization, excluding handles for the latest verification directory.
- The old empty directory shells were then removed successfully.

## Decision

Do not keep local historical `packages/desktop/release-*` directories inside the source tree.
Keep only the latest directory needed for manual verification, and rebuild fresh artifacts
when a new desktop smoke check is required.

## Cleanup Command For Future Runs

Remove old local release artifacts and keep only the latest verified directory:

```powershell
$desktop = "C:\Ai\ChisaCode\packages\desktop"
$keep = @("release-voice-hidden-final-20260616-143000")
Get-ChildItem -LiteralPath $desktop -Directory |
  Where-Object { ($_.Name -like "release-*" -or $_.Name -eq "release-local") -and $keep -notcontains $_.Name } |
  ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }
```
