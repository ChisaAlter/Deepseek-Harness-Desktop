# Decision: Restoring Whale Assistant and Pet Settings on Harness 0.1.7

Status: implemented

[中文](2026-09-23-whale-pet-settings-recovery.md) | English

## Problem

The updated settings client requires an explicit `remote.session` injection. Without it, the settings section throws during rendering and the pet page appears blank. The whale plugin still called the removed `settings.register` API and registered its web route inside an injection child context that did not activate. The plugin failed to start and `/dsh-whale/assistant/ensure` returned 405. The new Agent preset registry no longer scans `.agent-presets` directories.

## Decision

- Declare the `remote.session` dependency in the settings client. Keep the visible settings entry in the account menu and provide a hidden DOM trigger for desktop `settings-jump` deep links.
- The desktop inserts the whale plugin through `--patch`, so SettingsForms refuses writes to its Config. Store editable settings in `data/whale/settings.json`, check snapshots for conflicts, and replace the file atomically. On first read, migrate user fields from the old `settings.yaml.imported` file. Keep that file, but do not automatically reuse its session ID because current Harness cannot replay some older sessions. Persist the new session ID across restarts.
- Register the authenticated `/dsh-whale` route on the host root context. Register the `whale-girl` preset and session pulse in an explicitly injected child context and clean them up on plugin removal.

## Alternatives considered

- Continue writing through Harness SettingsForms: the desktop `--patch` insertion always triggers its override protection.
- Delete the old session before creating a new one: that would discard history. Keep the old file and persist a separate new session.

## Consequences

The whale plugin owns its editable data file; Harness SettingsForms no longer edits those values. Old session records remain on disk. Pet settings deep links work while the visible settings entry remains in the account menu.

## Verification

Host route, preset, settings persistence, and settings client tests passed; the persistence test reads the same session ID from a newly created scope. Before the build cleanup, the source app rendered the pet settings fields, created and opened a real whale session, and returned 401 to an unauthenticated request. The new persistence implementation still needs an app check after the build succeeds.
