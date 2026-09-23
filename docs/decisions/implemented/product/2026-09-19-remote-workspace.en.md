# Decision: SSH remote workspaces merge into the desktop as a built-in feature

Status: implemented

[中文](2026-09-19-remote-workspace.md) | English

## Problem

Users need SSH remote directories as Agent workspaces: multiple machines, credential management, mirror sync, remote file and command tools. The desktop has no such capability; upstream `packages/ssh/*` is a deployment-level design (POSIX-only, OpenSSH alias plus a remote helper binary, BatchMode single host), not a product-facing feature. The third-party plugin `flymysql/dsh-remote` (v0.8.21) already implements a complete, community-proven solution, but the installable-plugin form misses the goal: not in the box, not toggleable, UI outside the design language, credential security boundary owned by a third party.

## Decision

Merge `dsh-remote` into the desktop at code level, landing in four layers:

1. **Backend vendor**: snapshot the host half's 17 modules into `vendor/dsh-remote` (machine registry, ssh2 connection pool, bidirectional SFTP sync, 20 `rw_*` tools, port forwarding, audit, TOFU host-key verification, `/dsh-remote/*` routes); dependencies `ssh2`/`schemastery`/`iconv-lite` ship git-tracked under `vendor/dsh-remote/node_modules` (dshbot precedent); drop `update.js` self-update (the desktop owns updates).
2. **Client rewrite**: the original ~160KB client half is not ported — it is rewritten to the design language as three pieces: a new settings section "远程工作区" (kept separate from the phone `remote` section), a sidebar remote-files tab (`sidebarRightTabs`), and the picker remote-flow hole occupant; all built on `ui-primitives` / `--dsw-alias-*` tokens / typed dictionaries.
3. **Picker merge**: the `ui-directory-picker-browse` fork declares a new `single` remote-flow child hole and renders the "本机 / 远程" tab strip; the local tab keeps the current in-page browsing unchanged; the remote client occupies the hole, and an empty hole (toggle off / plugin unmounted) falls back to local-only — the seam's native default, no priority fight.
4. **Mount pipeline**: `src/main/dsh-remote-desktop.js` ensure — junction `profiles/web/node_modules/dsh-remote` → vendor source plus write `desktop-plugins/dsh-remote/desktop-dsh-remote.patch.yml`, mounted via `--patch` on every start (full + skip); `remoteWorkspaceEnabled` defaults to `true`, the 界面设置 toggle restarts Harness on flip (same pipeline as `dshbotEnabled`); when off, ensure only strips legacy managed blocks and deletes the overlay — no vendor check, no start block.

The package name stays `dsh-remote` and enters `DROPPED_BASENAMES`: the marketplace catalog hides it, in-chat `install_dsh_plugin` rejects it, and `stripDroppedPlugins` strips same-name rows from the profile manifest every start — the built-in is the sole supply (dshbot/dsh-im precedent). Machine lists, mirrors, and known_hosts from an existing third-party install already live under `$DSH_HOME/remote-workspaces` and are taken over by the built-in with zero migration. Forensics attributes it as built-in (`inBox`/`desktopRuntimeDamage`); the disable list does not apply; ensure failure blocks the start and skip cannot bypass it.

## Alternatives considered

- **Keep the third-party plugin path (catalog / in-chat install)** — rejected: misses "built-in + toggleable + design-language-consistent + desktop-owned credential boundary"; its -100 priority would also shadow our own picker.
- **Vendor `dsh-remote` as-is, occupying the directory-flow holes at `priority: -100`** — rejected: shadows `ui-directory-picker-browse` (in-page browsing, multi-drive 此电脑, new folder), regressing local picking to the OS dialog; since the client UI must be rewritten anyway, the remote deserves a first-class tab inside our own picker.
- **New `packages/*` desktop package inside the vendor tree (DESKTOP_PACKAGES track)** — rejected: that track is for fork-tracked upstream files; the SSH backend is a complete third-party codebase that belongs on the `vendor/dsh-*` plugin track (dshbot/dsh-im precedent), isolated from upstream sync; the picker UI increment still lives in the fork.
- **Build on the upstream `packages/ssh/*` stack** — rejected: deployment-level single host, POSIX-only, no interactive auth; the product needs multi-machine management, password/key/OTP/jump hosts, and Windows remotes (SFTP/Git Bash) — the models do not match.
- **Fold machine management into the phone `remote` settings section** — rejected: paired devices and SSH workspaces carry different semantics and would mislead users.

## Consequences

Every acceptance surface below shipped and verified (automated gates + `scripts/verify-remote-workspace-live.cjs` real-machine 16/16 — see the feature card's `last verified`):

- Settings shows the "远程工作区" section: machine add/edit/delete, set-current, test-connection with categorized errors (auth/network/host-key/timeout), forwarding panel, last 30 audit entries; 界面设置 carries the toggle (default on) and flips restart Harness.
- The Add workspace dialog has "本机 / 远程" tabs: local keeps the current in-page browsing; remote picks a machine → path autocompletion / browse overlay → set as remote workspace → the `$DSH_HOME/remote-workspaces/<host>-<user>-<port>/<basename>` mirror is adopted as a real workspace.
- While the session cwd sits inside a mirror, the system prompt carries the remote section and all 20 `rw_*` tools are callable (names pass `[A-Za-z0-9_-]{1,64}`); writes/removes/moves/forwards land in `audit.log`; `rw_sync`/`rw_push` three-way conflicts never silently overwrite; a changed TOFU fingerprint rejects the connection.
- The sidebar "远程文件" tab reads and writes remote files (mtime optimistic lock, 409 re-read).
- skip-user-plugins starts still mount it (built-in row); with the toggle off, a start carries no plugin row, no overlay, and no leftover managed block.
- The catalog hides `dsh-remote`, in-chat install rejects it, and `stripDroppedPlugins` strips profile same-name rows; the Recovery Board marks damage as「内置组件损坏」.
- All new UI passes `verify-client-ui-i18n` and the fork gates; `check-skip-compose-contract.js` gains a remote row; `node --test` covers ensure/overlay/strip/toggle/forensics.

Two host fixes landed on top of upstream (candidates to send back): `/dsh-remote/machines` updates keep a stored jump-host password on a blank `proxy.password`; `/dsh-remote/test-connect` accepts `machineId` and falls back to that machine's stored credentials and connection flags — upstream only probed the active config, so a saved machine could never be tested.

**Risks and Deferred:**

- `vendor/dsh-remote` and the existing `vendor/dshd-remote` (phone pairing daemon) differ by one character and will confuse review and search — keep the directory-name-equals-package-name convention and mark the distinction at first mention in docs.
- `ssh2`'s optional native dependency `cpu-features`: vendored node_modules tracks the pure-JS surface only and does not loosen the installer build-script allowlist; without it, crypto just runs the pure-JS path.
- Credentials land as plaintext under `$DSH_HOME/remote-workspaces` (upstream behavior): the boundary moves from third-party to first-party; the settings UI states the storage location, and Windows DPAPI encryption is recorded as Deferred.
- Fork maintenance: upstream iterates actively, `sync:harness` does not cover `vendor/dsh-remote` (independent plugin track), and future fixes port by hand.
- Manual-pass remainder: remote-tab UI picking, the `rw_*` tool chain, sidebar editing, and the toggle flip — the API level is covered by the live acceptance script.
