# Agent Note: Desktop marketplace version updates

Status: implemented

English | [中文](2026-09-07-desktop-marketplace-version-updates.zh.md)

## Problem

The desktop-owned marketplace initially retained only catalog browse, install, and uninstall behavior. The upstream `dshmarket` source had supported per-plugin npm version and Git commit updates, so removing that source also removed an expected maintenance path and left users to uninstall and reinstall plugins manually.

## Decision

This decision partially reverses the update deferral in [Desktop-owned marketplace section](2026-08-25-desktop-owned-market-section.md). The desktop-owned engine restores version and commit updates while keeping the third-party `dshmarket` runtime, its independent HTTP routes, HMR, hot-disable state, and self-update channels removed.

`marketplace-updates.js` checks only installed plugins that still match a curated catalog row. npm rows compare the package version present under the web profile with the registry `latest` value and offer an update only when plain semver precedence proves the target is newer. GitHub rows compare the profile lockfile commit, or an explicit manifest commit pin, with repository HEAD. Missing, non-semver, linked, uncatalogued, or otherwise undecidable sources do not offer an update. A failed npm or GitHub source lookup propagates a failed aggregate check instead of claiming every plugin is current. Results use a 30-minute in-process cache keyed by the catalog timestamp, dependency specs, installed versions, and lockfile commits.

The renderer sends only the catalog id through `shell:update-marketplace-plugin`. The main process revalidates catalog membership, deprecation, dropped-family status, installed package identity, and the checked target. npm updates install the exact checked version; ordinary GitHub updates install the exact checked commit. A curated `#path:` monorepo selector cannot encode a commit alongside the path, so it reuses the curated selector and commits the operation only when the resulting lockfile commit equals the checked HEAD.

Before running `dsh plugin add`, the engine snapshots the profile `package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml`. A failed command, blocked build script, unchanged version or commit, missing loadable entry, or new loader-id conflict restores all three files, including any allowBuilds grant written for the attempt, and runs profile install to reconstruct the previous dependency tree. The result reports whether rollback completed. Successful updates invalidate the check cache and restart Harness through the existing HarnessController path.

The Settings section shows compact current-to-latest text and an `Update` button on matching Discover cards and Installed rows. Git commits display seven characters while the accessible title retains the complete values. The existing progress log, `needsAllowBuilds` approval, success/error notice, and primary/ghost button hierarchy remain the only operation UI.

## Alternatives considered

**Restore the complete `dshmarket` package.** Rejected because it would recreate a second marketplace owner, HTTP surface, UI skin, and restart/HMR path that the desktop-owned decision deliberately removed.

**Run the install command again without update detection.** Rejected because users could not distinguish an available update from a no-op, and an npm `latest` tag behind the installed version could turn an update action into a downgrade.

**Update every installed dependency, including uncatalogued plugins.** Rejected because the desktop would have no curated source identity to validate before executing the package-manager mutation. Uncatalogued rows remain removable but not updateable from the marketplace.

**Treat a successful package-manager exit as a committed update.** Rejected because fresh-release holds, incomplete artifacts, and loader-id changes can leave the installed version unchanged or make the next boot fail. The post-install checks and rollback are part of the update transaction.

## Consequences

Users can maintain catalogued community plugins without uninstalling them first. Update checks add bounded npm and GitHub metadata requests but never block catalog rendering, and undecidable checks fail closed by withholding the action. Updates still restart Harness; this feature does not promise live replacement. Rollback restores profile declarations and lock state, then depends on profile install to reconstruct package files; a failed reconstruction is surfaced explicitly rather than reported as a successful rollback.

## Testing

Desktop tests cover forward-only semver comparison, npm and GitHub detection, exact version/commit targets, successful updates, failed-command rollback, stale-success rollback, preload exposure, and the existing install/uninstall mutex. Client tests cover desktop API gating, npm and short-commit differences, update actions, build-script approval retry, progress, and installed/discover presentation. The focused desktop marketplace suite passes 72 tests, the focused client suite passes 37 tests, the complete GUI suite passes 5,476 tests with one skip, and the client typecheck and package bundle pass.

## Related

- Partial reversal of: [Desktop-owned marketplace section](2026-08-25-desktop-owned-market-section.md)
- Catalog identity: [Desktop marketplace curated catalog](2026-08-18-desktop-marketplace-curated-catalog.md)
