# Provider Plumbing

Use this when adding or changing built-in providers, custom providers, model/mode discovery, provider diagnostics, provider settings, or runtime env/config behavior.

## Modules

- `protocol`: provider config schemas and protocol-visible provider data.
- `server`: provider registry, manifest, launch config, daemon config store, runtime adapters, diagnostics.
- `client`: request/response helpers and daemon transport behavior for provider operations.
- `app`: settings UI, provider selectors, icons, model/mode display, host-scoped refresh flows.
- `cli`: provider list/model commands and daemon-facing command options.

## Existing Docs

- `docs/providers.md`
- `docs/custom-providers.md`
- `docs/development.md`
- `docs/refactors/provider-probe-storm-2026-08-13.md`

## Invariants

- Built-in provider work is multi-surface. Do not stop after adding a provider class.
- Grok Build is a built-in ACP provider backed by the `grok agent stdio` launcher; keep its manifest, registry, tooling, and app catalog entries aligned.
- Provider IDs are runtime-validated strings, not closed TypeScript unions.
- Models and modes may be discovered dynamically; UI metadata and runtime truth are separate.
- Custom provider config is daemon-global and must be visible to all agents that use that daemon.
- Runtime settings replacement must not spawn provider processes unless an explicit refresh path asks for probing.

## Snapshot and settings reliability contract

Provider discovery is represented by a per-scope snapshot. The home scope is encoded as an omitted `cwd`; workspace scopes use the server's resolved canonical cwd. Pull responses and `providers_snapshot_update` pushes must address the same scope and carry equivalent entries.

A cold pull may return provisional `loading` entries, but every active provider load must publish a terminal `ready`, `error`, or `unavailable` state. `ready` with an empty `models` array is valid and means the command is available but no models were discovered. Structured reasons distinguish disabled providers, missing commands, runtime startup failures, discovery failures, refresh timeouts, and configuration changes. Refresh retains cached models/modes while loading and must expose a retryable error rather than leaving a permanent spinner.

Settings configuration replacement updates metadata without starting provider processes. Explicit refresh is responsible for probing; it invalidates all established scopes and force-refreshes the home scope. Opening the model selector is not an explicit refresh: the app may only stale-refetch the snapshot query. A full force refresh reuses in-flight loads and skips ready providers fresher than 60 seconds; a targeted Retry always forces the named providers. Provider snapshot listeners are owned by `ProviderHandler` and are removed with the session lifecycle.

The composer and model selector treat `error` as visible, not hidden. Last-good models stay in the selector; `RESOLVABLE_PROVIDER_STATUSES` and `SELECTABLE_PROVIDER_STATUSES` include `error`. `unavailable`/disabled stay gated. Do not collapse a selected error provider to "请选择模型".

Pi availability answers only whether its configured launch command exists. Authentication, gateway configuration, and model discovery are reported separately by snapshot discovery and diagnostics. Pi RPC close must reject pending requests, handle stdin failures, and produce at most one terminal turn event.

The minimum provider reliability gate covers protocol schema/compatibility, snapshot manager state transitions and scope isolation, ProviderHandler pull/push parity, Pi runtime close/cancellation/discovery, client timeout correlation, app query/refresh/retry states, tooling failure handling, and provider-switch model cache isolation. Run changed Vitest files, dependency builds, relevant typechecks, targeted lint/format, and a real packaged Electron settings smoke; web preview is not a desktop substitute.

1. Read provider docs before editing.
2. Map all touched surfaces: schemas, config store, registry, runtime adapter, app UI, CLI, tests.
3. Decide whether the provider is ACP-based or direct.
4. Check whether the change is built-in provider work, custom profile work, or both.
5. Refresh module graphs after structural changes.
6. Verify with targeted tests or package build chains; do not run broad provider E2E locally unless requested.
