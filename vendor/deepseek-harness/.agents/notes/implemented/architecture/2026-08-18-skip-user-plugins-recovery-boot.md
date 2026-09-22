# Agent Note: --skip-user-plugins recovery composition

Status: implemented

English | [中文](2026-08-18-skip-user-plugins-recovery-boot.zh.md)

## Problem

A profile that lists an extra bundle or carries a broken user `cordis.patch.yml` fail-louds the whole plugin tree, including the official Web UI that a host still needs to start. The launcher already had `loadProfile(..., { userLayer: false })` for `--dump-default-config`, which still resolves every name in `dsh.profile.bundles` and still reads `$DSH_HOME/cordis.patch.yml` on a live boot, so it cannot recover from an unresolvable extra bundle or a poisonous home layer. Rewriting the user's manifest to guess which plugin to disable, or probing a second Loader against the same `$DSH_HOME`, would mutate or race the only composition the user owns.

## Decision

`--skip-user-plugins` is a launcher flag on the root command and the `web` alias, parsed before app flags such as `--host` / `--port`. It composes `PROFILE_TEMPLATES[name]` through `loadProfile(..., { userLayer: false, bundles: 'template' })`, or `DEFAULT_PROFILE_BUNDLES` when that name has no template, and it never writes `dsh.profile.bundles`. Template load reads the on-disk manifest only to leave it untouched, then resolves `PROFILE_TEMPLATES` / `DEFAULT_PROFILE_BUNDLES`. The profile and home `cordis.patch.yml` files are not read; `--patch` overlays and the telemetry switch still apply; `watchUserPatches` is not installed, because HMR would otherwise re-apply the skipped layers. `--dump-default-config` remains the manifest-bundle dump with no user files and no `--patch`; the skip stack is dumped with `--skip-user-plugins --dump-config`. The two flags are mutually exclusive. This does not disable loader ids, quarantine packages, or change Cordis fail-loud semantics; a host that needs official Web after a user-layer failure uses this second spawn of the same `$DSH_HOME`. Profile composition itself remains the [profile plugin bundles](2026-08-05-profile-plugin-bundles.md) decision.

## Alternatives considered

- **Fail-soft user `include` rows** — would hide a broken plugin inside a running tree and change the fail-loud contract every other composition relies on.
- **Auto `disabled: true` on an innermost loader id** — Cordis wraps apply failures in `include` / `modules` / official `tools`; `cannot get property "tools"` names a service, and group rows ignore `disabled`.
- **A temporary `$DSH_HOME` or a second port on the same home** — races sessions, profile healing, patch watchers, and Windows file locks; one Loader owns one home.

## Consequences

Hosts can recover official Web without rewriting the user's profile; the skip stack is inspectable and does not watch the files it skipped. A host that still needs a desktop-only insert (not a bundle) must pass it as `--patch`, because recovery no longer reads the profile patch file. `--dump-default-config` does not describe a skip boot, so operators who want that tree use `--skip-user-plugins --dump-config`.

## Testing

`packages/boot/app-boot/tests/profile.spec.ts` pins template selection against an unresolvable extra name, an installation-owned headless tuple left on disk, and `DEFAULT_PROFILE_BUNDLES` when the name has no `PROFILE_TEMPLATES` entry. `apps/cli/tests/args.spec.ts` pins parse routing and the dump-default mutex. `apps/cli/tests/profile-boot.spec.ts` and `apps/cli/tests/dump-config.spec.ts` pin skip compose, `--patch` overlays, empty watch lists, and dump labels that omit user YAML.
