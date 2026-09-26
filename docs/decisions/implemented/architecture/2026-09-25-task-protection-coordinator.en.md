# Decision: Task-protection coordinator and Host admission lock

Status: implemented

[中文](2026-09-25-task-protection-coordinator.md) | English

## Problem

Upstream 0.1.7-rc.2 ships desktop task protection (`apps/desktop-host` update-tasks/quit-inspection) wired into the official Desktop Host composition. Whale Isle runs a standalone Node Web profile without that wiring. Quit, restart, stop, update, and delta install each have their own entry points; any path that skips inspection interrupts running agents, background jobs, due schedules, or bot routines. The launcher previously `taskkill /F`'d the external desktop outright, bypassing confirmation entirely.

## Decision

Protection is split across three layers, with all decisions centralized in the shell coordinator `src/main/task-protection.js`:

1. **Host plugin** `vendor/dsh-task-control/`: a singleton lock, pending-request set, and inspection surface. The webServer's register/registerUpgrade/registerFallback are wrapped in place (including routes registered before this plugin loads); while locked, new requests get a uniform 503. `sessionController.resolveAgent` and `jobs.start` are wrapped so Schedule delivery, dshbot routines, and IM channels cannot start work under a lock. `/dshd-task-control/<inspect|acquire|renew|release|cancel|status>` is gated by a per-boot Bearer token (`DSHD_TASK_CONTROL_TOKEN` injected by the shell). Locks validate owner + lockId + generation; acquire drains pending requests then rechecks the generation; TTL expires lazily; the unlock hook drives `schedule.runtime.requestDrive()` so armed reminders resume delivery.

2. **Shell coordinator**: `inspect → confirm-if-dirty → acquire → drain → recheck → commit`. The confirm step is a native dialog (operation verb + work list + unknown-coverage warning); a missing Host or failed inspection blocks unattended commits. `terminal: true` (quit/install/update) latches after commit so duplicate before-quit coordination passes through; non-terminal commits release the lock afterward, and a throwing commit releases before propagating. `hostLock: false` (reload) skips the Host lock and keeps only the prompt. Component shutdowns register as onCommitCleanup and run only on terminal commits — a cancelled quit no longer kills launcher-supervised services.

3. **Cross-process handshake**: the desktop writes `task-control-peer.json` under userData (url/token/pid/generation; per-boot token; file removed on quit). The slim launcher's `stopExternalDesktop`/`installRuntime`/`installDelta` first resolve the peer: with a handshake they call `stop-desktop`/`prepare-install` (the desktop coordinates itself and exits the process on approval); without one (older desktop) they fall back to a graceful WM_CLOSE and confirm the process is actually gone — **never taskkill /F**. A still-running desktop reports `desktop-still-running` and blocks the install.

The delta lane therefore reports a declined/busy desktop directly instead of falling back to the full installer (which would re-prompt through the same handshake). The electron-updater channel runs the same coordination before `quitAndInstall`; a cancellation no longer falls back into the whole-file download.

## Alternatives considered

- **Electron-side before-quit inspection only**: simpler, but before-quit is merely a hook — timer producers (Schedule/Bots) keep starting work during the confirmation wait, and the installer may already be launched; admission control must live in the Host.
- **Reusing the desktop-install-control channel for coordination**: different semantics (install control vs lifecycle decisions); mixing would make existing endpoints dual-purpose. Separate `/dshd-task-control` + peer-file channel instead.
- **Keeping taskkill /F for older desktops**: exits the process but bypasses every confirmation — violates "protection before the first side effect"; graceful close plus a still-running block instead.
- **A second coordinator inside launcher-service**: two state machines would drift; a process-level singleton with dependency injection converges both.

## Consequences

- Every quit/restart/stop/update/install/delta path passes through one coordinator; idle hosts proceed with no prompt, while active work or unknown coverage prompts.
- A missing plugin or unreachable control route makes acquire report `dshd/unreachable` and blocks unattended updates/installs — fail closed.
- The lock TTL (10 min default) bounds a crashed coordinator's residue; release is idempotent.
- During a slim-package install the desktop runs its full confirmation chain itself; the launcher only waits for the process to exit; older desktops ask the user to quit normally.
- Test surface: the coordinator is fully unit-testable via `fetchImpl`/`confirm` injection; the plugin's state/inspection/wrap modules are pure ESM covered by `src/main/task-control-plugin.test.js`.
- Packaging: `vendor/dsh-task-control` ships via extraResources with an after-pack closure assertion; its overlay is asserted exactly-once in both skip and full compose-contract rounds.
