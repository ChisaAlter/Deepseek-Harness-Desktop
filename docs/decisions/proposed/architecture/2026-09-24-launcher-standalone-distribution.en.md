# Decision: Standalone launcher distribution architecture (dual lines, standalone delta packages, and a component platform)

Status: proposed

[中文](2026-09-24-launcher-standalone-distribution.md) | English

## Problem

The current launcher shares one Electron process, appId, install directory, and Setup with the full DSHD app: it cannot reliably overwrite-install the desktop while staying resident, and it has no boundary for hosting optional tools/services. Distribution has a single GitHub line with no fallback under domestic network conditions; every upgrade pulls the full Setup via `downloadFile`. The app already gained electron-updater blockmap differentials ([2026-09-17](../../implemented/product/2026-09-17-electron-updater-differential-updates.en.md)), but that is a self-update channel for an installed app, not a standalone delta artifact a launcher can distribute. Gitee attachment capacity, anonymous download, and Range behavior are unverified in this project.

## Proposal

Refactor the existing launcher into a standalone lightweight product that owns distribution, executed in the batches of `docs/superpowers/plans/2026-09-24-launcher-refactor.md`:

1. **In-place refactor of the single UI**: `src/renderer/launcher.*` keeps all five sections and the Recovery Board, and preservation is capability-level — desktop start/stop (start/stop/skip-user-plugins/full retry), version management (install detection, release list, per-version install/switch, uninstall entry), plugin forensics (inventory, attribution, per-plugin toggle, batch disable, removal), data import, and launcher settings all remain functional. First extract the launcher application service and install-detection boundary inside the same process, then split the DSHD runtime assembly so the launcher runs and installs while the desktop is absent. After the split, the desktop runtime serves the launcher over a narrow interface carrying versioning, local authentication, and caller identity; recovery and plugin-forensics logic is not duplicated.
2. **Two program identities**: the Launcher gets its own appId, install directory, uninstall record, and single-instance lock; the DSHD desktop is still installed by the full NSIS Setup, and the offline full package always remains usable. Existing users' settings and `dsh-home` are preserved; identity and migration details are validated when the packaging boundary lands, not inherited from any prototype.
3. **Two lines, same bytes**: each candidate build produces exactly one full Setup; GitHub and Gitee mirror identical files. A signed manifest binds the target version, candidate SHA, asset sizes and SHA-256s, the delta baseline, platform architecture, the minimum Launcher version, and both mirror URLs — it is the sole version authority; signed offline, verified by an embedded public key. When Gitee is selected, queries and downloads must not silently hit GitHub.
4. **Standalone delta packages**: publish `from→to` patches against a fixed previous formal Setup baseline; the client rebuilds the target full Setup offline and runs the installer only after length and SHA-256 match; on missing baseline, corrupt patch, or no benefit it falls back to the same target's full package. It coexists with the electron-updater blockmap at a different layer: blockmap keeps serving self-update of installed apps and is never passed off as a standalone delta package.
5. **Component platform**: the first batch accepts only project-reviewed, signed tools/services; each component is an independent process, binaries land in the launcher's own versioned directory and data in a separate data directory, with atomic activation and rollback to the last healthy version; component operation locks are separate from the DSHD install lock; closing the window while services run hides to the tray, quitting stops supervised services. No writes to `dsh-home` or the Harness profile, and the plugin marketplace is not reused.
6. **Slim capability boundary**: the slim package ships no vendored `dsh plugin` toolchain — operations that depend on it (plugin removal, import-page plugin reinstall) return an explicit `desktop-only` error and the UI marks those rows "operate inside the desktop app" instead of failing deep inside a spawn. Plugin disable/enable is a config write and still works in slim, taking effect on the runtime's next start. Removing a plugin only clears `disabledPlugins` after a successful uninstall — a failure must keep the disabled entry rather than silently re-enabling a crashing plugin.

## Alternatives considered

- **Keep one app, add a launcher-only switch to `index.js`** — rejected: the top level still imports Harness, marketplace, pets, and remote, so the lightweight boundary is unprovable; one process cannot reliably overwrite-install itself while resident.
- **Build a second launcher, then migrate old features** — rejected: it creates two UIs and duplicate entry points while old features wait; the user explicitly requires refactoring the existing UI.
- **Rename blockmap as the delta package** — rejected: it depends on `latest.yml`, old caches, and the current version; it cannot serve as a fixed `from→to` artifact for offline rebuild and verification.
- **Build and publish separately on GitHub and Gitee** — rejected: the same version with different bytes breaks caches and delta baselines; the release authority must be a single candidate build.
- **Open third-party components or script entry points** — rejected: components are executable code; without a multi-publisher trust root and isolation contract, v1 is limited to project-signed components.

## Acceptance criteria

- All five sections and recovery capability remain; source runs, installed, not-installed, failure recovery, and tray reopen show exactly one launcher UI. The lightweight package excludes Harness archives and desktop plugins, with measured size and startup time.
- Both mirrors carry identical bytes for the full package and delta packages of the same candidate SHA; the signed manifest verifies, and tampering, replayed sequence numbers, and cross-source mismatch are rejected.
- A target Setup rebuilt from a verified baseline Setup plus delta package matches the same candidate's full package in length and SHA-256; baseline mismatch or patch failure falls back to the full package automatically.
- On a machine without DSHD, the launcher selects a line, downloads, verifies, installs, and enters the desktop; first install, update, cancel, disconnect, and restart never break a previously working version.
- One tool and one service component each complete install, run, tray residency on window close, stop, update, rollback, and uninstall on real Windows.
- The Gitee line opens to users only after real same-scale attachments, anonymous download, domestic-network, and hash re-verification pass; disable resumable download there if Range is unavailable.

## Risks

The signing private key and Gitee token need separate custody, never committed to the repo or client. Delta gains over compressed Setups may be small and must be measured on real adjacent versions for size, rebuild time, and peak disk. The process split touches IPC, config, and lifecycle migration; the narrow interface must keep authentication and recovery capability, not substitute a hidden window for real wiring. Gitee attachment limits are unverified and may force line capability downgrades (e.g., no Range resume).
