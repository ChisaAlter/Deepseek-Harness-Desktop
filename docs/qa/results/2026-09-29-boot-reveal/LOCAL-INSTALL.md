# Local installer repair verification

The user requested local packaging and verification before CI. This is diagnostic local installer evidence, not production-release acceptance. No push, CI dispatch, tag or publication is authorized by this local run.

## Build identity

- Source commit: `bbe3fc0a857` (local commit completed during the interrupted command; not pushed).
- Node used for build: installed runtime `v22.22.2`, matching `.nvmrc`.
- Build command: `npm run dist -- --config.directories.output=dist/local-repair-20260929` with the Node 22 executable and PATH explicitly selected.
- Build log: `.omc/local-repair-build.log`.
- Existing user profile and installation are preserved until the new package is ready and the application exits through its protection coordinator. No profile deletion or icon-cache reset is part of this test.

## Status

Local build completed successfully. Setup: `dist/local-repair-20260929/Whale-Isle-Setup-0.3.3.exe`, 597569387 bytes, SHA256 `5faea8d3bd8c46a6d0f16986aebd69efc5958dbf1d418b364f3e10c65967c998`. The release-asset consistency validator passed; this does not turn a local build into a CI release candidate.

The packaged executable passed the isolated UI/titlebar/PTY smoke (`.omc/local-repair-packaged-smoke.log`); packaged `window.js`, `desktop-plugin-link.js`, task-control and usage-panel modules match source after newline normalization. Embedded Node is `v22.22.2`.

The old installed process reported kernel error/webReady false. Its protected `prepare-install` returned `ok: true, quit: true`, and absence of installed processes was checked before starting silent overwrite at `C:\软件\Whale Isle`.

The user approved the Windows administrator prompt manually. Installer session 5641 completed with exit code 0. Installed `resources/app.asar` SHA256 matches the local unpacked artifact: `B028593AACF97311FC5C4BDA26771D80BB0B2BF2A6B7F9C128CC8B716BD2F121`. The desktop shortcut was recreated and used to launch the installed application.

## Installed findings

- Initial navigation went to import because empty desktop sessions plus optional shared skills triggered the old import hold. This was not simply the last-start-failure route. The later source fix removes this optional-data hold, while keeping interrupted-import recovery protection.
- `read-window-icon.ps1 -ProcessId 31104` read the actual installed launcher WM_GETICON images. Both sizes show the whale artwork, not Electron. See `window-31104-icon-0.png` and `window-31104-icon-1.png`.
- The per-user Start Menu contained `Electron.lnk`, targeting the repository Electron executable with the SAME `ai.deepseek.harness.gui` AppUserModelID as the installed whale shortcuts. This obsolete link was moved to `.omc/shortcut-backup-20260929/Electron.lnk` after checking its target. No global cache, Explorer restart or appId change was used. After a protected quit and shortcut relaunch, the user explicitly confirmed the taskbar now shows the whale avatar.
- Starting the installed desktop with the original profile completed: `last-desktop-start.json` is `ok:true` at `2026-09-29T06:20:29.201Z`; the live peer later reported `kernel:ready, webReady:true` for PID 32968. This proves one installed-profile startup, not every environmental EEXIST trigger or transition frame.
- `.omc/local-repair-after-links.json` compares five original profile junctions against the pre-install snapshot; task-control, platform-session, usage-panel, dsh-im and dsh-remote all retained their original inode and target. No user profile data was cleared to obtain this successful start.
- The pending startup screenshot exposed a separate launcher UX defect: stale errors and idle text remained visible beside a progress hint, while a duplicate retry stayed enabled. The runtime subsequently became ready; no permanent hang was established.

## Source follow-up and interaction boundary

The optional-import gate and single-action launcher home changes are newer than this installer. They are not installed acceptance. The user requested no surprise computer interaction: do not automatically focus/click windows, restart the client or run another installer. Further installation or interactive verification needs agreement first.

Hidden Electron tests use the real launcher HTML/preload with deferred IPC fixtures. They cover double-click exclusion, disabled conflicting actions, elapsed waiting text, failure and rejected promises, retry, stop, initially collapsed single-copy diagnostics and 860x560 geometry at 100%/200% zoom. Optional-import gate/recovery tests passed 75/75. The earlier source smoke passed with no page errors and working titlebar/PTY; it preceded the home layout changes. See `.omc/launcher-home-bound.log` and `.omc/optional-import-source-smoke.log`.

Final related suite: 95 passed, zero failed (`.omc/launcher-home-final-targeted.log`). Hidden surface captures: `home-collapsed.png`, `home-starting.png`, `home-failed-1x.png`, `home-failed-2x.png`. These are source fixtures, not screenshots of the installed user application.

The full suite run reported 2808 passed, 2 failed, 2 skipped (`.omc/launcher-home-full-tests.log`). Failures were the component lifecycle probe with ECONNREFUSED and a welcome-renderer timeout. Both files passed an isolated serial rerun, 19/19 (`.omc/launcher-home-recheck.log`); this is not a claim that the full run passed. The working tree also contains concurrent unrelated runtime/remote edits, which were preserved.

Documentation gates: 7/8 passed (`.omc/launcher-home-doc-sync-final.log`); design-language word count was 14497 versus the 14400 ceiling. This task's launcher section remains 170 words under the gate metric, identical to its HEAD budget; other concurrent sections account for the remaining increase. No ceiling was raised or unrelated changes reverted. `git diff --check` passed.
