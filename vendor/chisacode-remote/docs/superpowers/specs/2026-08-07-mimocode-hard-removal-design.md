# MiMoCode Hard Removal Design

Date: 2026-08-07
Status: Approved design

## Summary

Remove the `mimocode` built-in coding-agent provider from every active ChisaCode product
surface. This is a development-stage product-floor reset: no compatibility alias, data
migration, hidden provider, or historical-session fallback will remain.

The Xiaomi MiMo speech provider is a separate feature and remains supported under the
canonical `mimo` provider id and `MIMO_*` environment variables.

## Decision

Use a full hard removal. Removing only the registry entry or hiding the provider in the UI
would leave dead public APIs, accepted configuration, generated model-gateway faces, tooling,
and documentation. A hidden tombstone would be a compatibility layer and is intentionally
excluded.

This decision is an explicit exception to the repository's normal backward-compatibility
policy for the `mimocode` provider only. It is not a precedent for unrelated protocol or
configuration changes.

## Goals

- Remove MiMoCode from all provider discovery, selection, creation, launch, import, tooling,
  settings, skills, MCP, documentation, and public SDK surfaces.
- Stop generating model-gateway provider ids or model catalogs for a MiMoCode face.
- Reject configuration that relies on `mimocode` as a built-in base provider, gateway face, or
  speech credential alias.
- Preserve all OpenCode behavior that was shared by the MiMoCode adapter.
- Preserve Xiaomi MiMo speech configuration through `providers.mimo` and `MIMO_*`.
- Leave the remaining built-in provider behavior unchanged.

## Non-Goals

- Migrating old MiMoCode configuration or agent records.
- Displaying an unavailable or legacy MiMoCode tombstone.
- Mapping MiMoCode sessions or custom providers to OpenCode.
- Adding Grok Build as a model-gateway face. That is a separate provider integration.
  (Superseded 2026-08-09: Grok Build is now a first-class model-gateway face.)
- Changing generic ACP support.
- Redesigning provider, settings, or model-selector layouts.

## Product Behavior

After the change:

- Provider lists contain Claude, Codex, OpenCode, Pi, Kimi Code, and Grok Build, plus any
  supported custom or development providers.
- Session import no longer offers MiMoCode.
- Client code has no `client.providers.mimocode(...)` convenience API.
- Provider install, update, diagnostics, MCP target, and skill target surfaces no longer accept
  or display MiMoCode.
- Model gateways never generate an `<id>-mimocode` provider and do not persist
  `generatedProviderIds.mimocode` or `generatedModels.mimocode`.
- Existing config that contains `providers.mimocode`, `extends: "mimocode"`, or MiMoCode gateway
  fields is invalid. Existing agent records that name `mimocode` have no runnable provider.
- MiMo speech continues to resolve `MIMO_API_KEY`, `MIMO_BASE_URL`, `MIMO_TTS_MODEL`,
  `MIMO_TTS_VOICE`, and `providers.mimo`. The `MIMOCODE_*` aliases are removed.

## Architecture Changes

### Protocol

- Remove the MiMoCode mode definition and built-in provider manifest entry.
- Remove `mimocode` from importable provider ids.
- Remove the MiMoCode fields from the strict model-gateway generated-provider and
  generated-model schemas.
- Keep provider ids string-based for custom-provider extensibility; runtime registration
  remains the authority for whether a provider exists. Do not add a special blacklist for a
  user-defined custom provider that happens to choose the same opaque id.

### Server Runtime

- Remove the MiMoCode client factory and the `MimoCodeAgentClient` wrapper.
- Remove `MIMOCODE_PROVIDER_CONFIG` while retaining the shared OpenCode client, session,
  manager, and runtime implementation.
- Remove MiMoCode provider tooling, snapshot environment allowlists, daemon E2E entries, and
  provider-specific MCP and skill mappings.
- Remove MiMoCode from gateway face resolution, materialization, managed configuration,
  native Xiaomi routing branches, and vision-fallback provider-id parsing.
- Simplify the OpenCode gateway config writer so it is OpenCode-only.
- Remove `providers.mimocode` from persisted config and remove MiMoCode-named fallback aliases
  from MiMo speech resolution.

### Client And App

- Remove the public client provider helper and its contract assertions.
- Remove MiMoCode from the app provider catalog and configuration patch generation.
- Remove MiMoCode gateway id helpers and generated model payloads.
- Update gateway supply-scope calculations so OpenAI-compatible matching includes only the
  remaining implemented faces: OpenCode, Pi, and Kimi Code.
- Remove MiMoCode from provider-selection, snapshot-model, history, integrations, settings,
  skills, MCP, and end-to-end fixtures.
- Update localized copy without changing the existing layout or interaction structure.

### Documentation And Product Metadata

- Update current README, security, architecture, provider, custom-provider, testing, public
  documentation, skills documentation, package descriptions, and product copy.
- Remove current changelog claims that advertise MiMoCode as supported.
- Update active HTML prototypes and test fixture names that still present MiMoCode as a product
  capability.
- Historical Git history is not rewritten.

## UI Gate Decision

This change deletes existing rows/options and updates copy within established layouts. It does
not introduce or rearrange UI layout, so a new HTML prototype is not required. If implementation
expands into a provider/settings layout redesign, work must stop and pass the repository's HTML
prototype approval gate first.

## Error And Data Handling

No compatibility code will recognize or normalize `mimocode`.

- Strict persisted configuration containing the removed top-level field fails validation.
- A custom provider extending `mimocode` fails normal unknown-base-provider validation.
- A model gateway containing removed generated fields fails strict schema validation.
- A request to launch `mimocode` without an explicitly registered custom provider fails normal
  unregistered-provider validation.
- No error path silently substitutes OpenCode or another provider.

Because the application is still in development and old data is explicitly out of scope, these
failures are accepted. Development environments with obsolete configuration must remove or
reset that data.

## Testing Strategy

Follow the repository's targeted-test rule; do not run full package or workspace test suites.

1. Protocol tests prove the built-in manifest, importable ids, and strict gateway schema no
   longer accept or emit MiMoCode.
2. Client tests prove the public provider helper is absent and remaining helpers are unchanged.
3. Server tests prove registry construction, provider snapshots, tooling, MCP/skills targets,
   gateway face resolution/materialization, vision fallback, persisted config, and MiMo speech
   behavior after removal.
4. App tests prove catalogs, gateway config generation, provider selection, model routing, and
   copy contain only the remaining providers.
5. Run root typecheck and lint, plus formatting checks for changed files.
6. Run a case-insensitive repository scan for `mimocode`, `MiMoCode`, `MIMOCODE`, and
   `MimoCode`; active code, tests, current product docs, and prototypes must have no coding-agent
   references. This removal specification and historical archive records may retain the term as
   audit history.
7. Manually classify remaining `mimo` matches and confirm they belong only to the Xiaomi MiMo
   speech provider or unrelated external data.

## Real-Surface Verification

Use the real Electron desktop application, not the browser preview.

- Confirm the new-agent provider selector has no MiMoCode entry.
- Confirm Settings provider/integration, MCP, and skill target surfaces have no MiMoCode entry.
- Confirm model-gateway settings and generated providers contain no MiMoCode face or copy.
- Confirm remaining providers still render and can be selected.
- Confirm MiMo speech settings/runtime still resolve through the canonical `mimo` configuration
  when test credentials are available; otherwise report this credentialed path as unverified.

## Acceptance Criteria

- No active product surface registers, creates, launches, imports, configures, documents, or
  advertises MiMoCode.
- No model gateway emits an `<id>-mimocode` provider or MiMoCode model catalog.
- No public client or server tooling API exposes MiMoCode.
- `extends: "mimocode"`, `providers.mimocode`, and `MIMOCODE_*` are unsupported.
- OpenCode regression tests remain green after removal of the shared adapter branches.
- Xiaomi MiMo speech retains `providers.mimo` and `MIMO_*` support.
- Targeted tests, typecheck, lint, repository scans, and Electron verification pass, with any
  credential-dependent speech check explicitly reported if unverified.

## Delivery Boundary

This design covers MiMoCode removal only. Grok Build model-gateway configuration and model-list
coexistence will be designed and delivered as a separate module so its upstream-specific config,
runtime isolation, and model switching can be reviewed independently.
