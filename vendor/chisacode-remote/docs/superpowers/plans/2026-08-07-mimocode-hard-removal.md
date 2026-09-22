# MiMoCode Hard Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the MiMoCode built-in coding-agent provider from every active product surface while preserving the separate Xiaomi MiMo speech provider.

**Architecture:** Delete MiMoCode at the shared provider-manifest boundary, then remove its server runtime, model-gateway face, client/app exposure, configuration aliases, and documentation. Provider ids remain open strings for custom providers; no tombstone, migration, alias, or special blacklist is introduced.

**Tech Stack:** Node.js 22+, TypeScript, Zod v3, Vitest, React Native/Expo, Electron, npm workspaces, oxfmt, oxlint.

## Global Constraints

- Do not preserve compatibility for `mimocode`, `extends: "mimocode"`, `<gateway>-mimocode`, `providers.mimocode`, or `MIMOCODE_*`.
- Preserve `providers.mimo`, `MIMO_*`, and `packages/server/src/server/speech/providers/mimo/*`.
- Do not map removed MiMoCode sessions or providers to OpenCode.
- Do not add Grok Build model-gateway support or change generic ACP support in this plan.
- Do not redesign provider/settings/model-selector layouts; deleting rows and updating copy does not require a new prototype.
- Preserve unrelated dirty-worktree changes and stage only files owned by the current task.
- Use Node.js 22 or newer and npm workspace commands from the repository root.
- Run only changed Vitest files with `npx vitest run <path> --bail=1`; never run full test suites locally.
- Run `npm run typecheck`, `npm run lint`, and targeted formatting after implementation.
- Complete a code review and downgrade/adversarial review after each task before starting the next task.
- Use the real Electron desktop application for final UI verification; browser preview is not a substitute.

---

## File Structure

- `packages/protocol/src/provider-manifest.ts` owns the user-facing built-in provider catalog.
- `packages/protocol/src/importable-providers.ts` owns the provider ids accepted by session import.
- `packages/protocol/src/provider-config.ts` owns strict custom-provider and model-gateway schemas.
- `packages/client/src/index.ts` owns the public provider configuration builders.
- `packages/server/src/server/agent/providers/opencode-agent.ts` and `providers/opencode/client.ts` own the shared OpenCode runtime wrapper and provider-specific configuration.
- `packages/server/src/server/agent/provider-registry.ts` owns provider factories, derived providers, and model-gateway face materialization.
- `packages/server/src/server/agent/provider-tooling.ts`, `provider-snapshot-manager.ts`, `mcp-server-management.ts`, and `skills-management.ts` own provider-adjacent product surfaces.
- `packages/server/src/server/persisted-config.ts` and `speech/providers/mimo/config.ts` own the MiMo speech credential boundary.
- `packages/app/src/data/acp-provider-catalog.ts` owns the app's add-provider catalog.
- `packages/app/src/screens/settings/custom-model-providers.ts` owns model-gateway ids, models, and supply-scope presentation data.
- `packages/app/src/provider-selection/*` owns provider/model selection and runtime routing.
- Current docs, public docs, prototypes, and package metadata own product claims and examples.

---

### Task 1: Remove The Shared Provider Contract And Client/App Catalog Entry

**Files:**

- Modify: `packages/protocol/src/provider-manifest.ts`
- Modify: `packages/protocol/src/importable-providers.ts`
- Modify: `packages/protocol/src/provider-manifest.test.ts`
- Modify: `packages/client/src/index.ts`
- Modify: `packages/client/src/index.test.ts`
- Modify: `packages/client/src/daemon-client-public-api.test.ts`
- Modify: `packages/app/src/data/acp-provider-catalog.ts`
- Modify: `packages/app/src/hooks/use-acp-provider-catalog.ts`
- Modify: `packages/app/src/hooks/use-acp-provider-catalog.test.ts`

**Interfaces:**

- Consumes: the approved provider set `claude`, `codex`, `opencode`, `pi`, `kimi`, `grokbuild`
- Produces: `BUILTIN_PROVIDER_IDS`, `IMPORTABLE_PROVIDERS`, client provider builders, and app catalog entries with no built-in MiMoCode surface

- [ ] **Step 1: Write failing exact-list assertions**

Update `provider-manifest.test.ts` and `use-acp-provider-catalog.test.ts` so they assert the complete remaining lists rather than asserting only one provider:

```typescript
expect(BUILTIN_PROVIDER_IDS).toEqual(["claude", "codex", "opencode", "pi", "kimi", "grokbuild"]);
expect(IMPORTABLE_PROVIDERS).toEqual(["claude", "codex", "opencode", "pi"]);

expect(getAcpProviderCatalog().map((entry) => entry.id)).toEqual([
  "claude",
  "codex",
  "opencode",
  "pi",
  "kimi",
  "grokbuild",
]);
```

In `daemon-client-public-api.test.ts`, replace the removed helper assertion with an exact builder-key assertion:

```typescript
expect(Object.keys(client.providers).filter((key) => !RPC_PROVIDER_METHODS.has(key))).toEqual([
  "codex",
  "claude",
  "opencode",
  "pi",
  "kimi",
  "config",
]);
```

Define `RPC_PROVIDER_METHODS` in the test from the existing RPC method names so this assertion describes the public builder contract without retaining a removed-provider string.

- [ ] **Step 2: Run the changed tests and verify the new list assertions fail**

Run each file separately:

```powershell
npx vitest run packages/protocol/src/provider-manifest.test.ts --bail=1
npx vitest run packages/client/src/daemon-client-public-api.test.ts --bail=1
npx vitest run packages/app/src/hooks/use-acp-provider-catalog.test.ts --bail=1
```

Expected: each exact-list assertion fails because the current catalog/API still contains one extra built-in provider.

- [ ] **Step 3: Remove the shared entries and public helpers**

Delete `MIMOCODE_MODES` and its manifest definition, remove the id from `IMPORTABLE_PROVIDERS`, remove the typed client builder and implementation, and delete the app catalog row. Simplify `use-acp-provider-catalog.test.ts` by removing the provider-specific patch case; keep the Kimi and Grok Build cases as coverage for built-in ACP patch generation.

- [ ] **Step 4: Update and run all affected public-contract tests**

Remove the old provider builder case from `packages/client/src/index.test.ts`, then run:

```powershell
npx vitest run packages/protocol/src/provider-manifest.test.ts --bail=1
npx vitest run packages/client/src/index.test.ts --bail=1
npx vitest run packages/client/src/daemon-client-public-api.test.ts --bail=1
npx vitest run packages/app/src/hooks/use-acp-provider-catalog.test.ts --bail=1
```

Expected: PASS.

- [ ] **Step 5: Format, review, and commit Task 1**

```powershell
npm run format:files -- packages/protocol/src/provider-manifest.ts packages/protocol/src/importable-providers.ts packages/protocol/src/provider-manifest.test.ts packages/client/src/index.ts packages/client/src/index.test.ts packages/client/src/daemon-client-public-api.test.ts packages/app/src/data/acp-provider-catalog.ts packages/app/src/hooks/use-acp-provider-catalog.ts packages/app/src/hooks/use-acp-provider-catalog.test.ts
git add -- packages/protocol/src/provider-manifest.ts packages/protocol/src/importable-providers.ts packages/protocol/src/provider-manifest.test.ts packages/client/src/index.ts packages/client/src/index.test.ts packages/client/src/daemon-client-public-api.test.ts packages/app/src/data/acp-provider-catalog.ts packages/app/src/hooks/use-acp-provider-catalog.ts packages/app/src/hooks/use-acp-provider-catalog.test.ts
git commit -m "refactor: remove MiMoCode provider contract"
```

Review gate: confirm no remaining public builder/catalog entry and no unrelated API changes.

---

### Task 2: Remove The Server Runtime, Factory, Tooling, And Snapshot Entry

**Files:**

- Modify: `packages/server/src/server/agent/providers/opencode-agent.ts`
- Modify: `packages/server/src/server/agent/providers/opencode/client.ts`
- Modify: `packages/server/src/server/agent/providers/opencode-server-manager.test.ts`
- Modify: `packages/server/src/server/agent/provider-registry.ts`
- Modify: `packages/server/src/server/agent/provider-registry.test.ts`
- Modify: `packages/server/src/server/agent/provider-tooling.ts`
- Modify: `packages/server/src/server/agent/provider-snapshot-manager.ts`
- Modify: `packages/server/src/server/agent/provider-snapshot-manager.test.ts`
- Modify: `packages/server/src/server/daemon-e2e/agent-configs.ts`
- Modify: `packages/app/e2e/global-setup.ts`

**Interfaces:**

- Consumes: remaining built-in definitions from Task 1
- Produces: a provider registry with no MiMoCode factory/client and provider snapshots/tooling with only supported providers

- [ ] **Step 1: Change registry and snapshot expectations before implementation**

Replace provider-id assertions with the complete remaining set:

```typescript
expect(Object.keys(registry).filter((id) => !id.startsWith("mock"))).toEqual([
  "claude",
  "codex",
  "opencode",
  "pi",
  "kimi",
  "grokbuild",
]);

expect(snapshot.providers.map((provider) => provider.provider)).toEqual([
  "claude",
  "codex",
  "opencode",
  "pi",
  "kimi",
  "grokbuild",
]);
```

Keep ordering aligned with `AGENT_PROVIDER_DEFINITIONS`; do not sort if the production contract is manifest order.

- [ ] **Step 2: Run focused server tests and verify failure**

```powershell
npx vitest run packages/server/src/server/agent/provider-registry.test.ts --bail=1
npx vitest run packages/server/src/server/agent/provider-snapshot-manager.test.ts --bail=1
```

Expected: FAIL because the server factory/snapshot still exposes the removed provider.

- [ ] **Step 3: Delete only the MiMoCode-specific OpenCode adapter**

Remove `MIMOCODE_PROVIDER_CONFIG`, `MimoCodeAgentClient`, the registry import/factory, tooling metadata, snapshot environment allowlist, daemon E2E config, and app E2E disable fixture. Preserve `OpenCodeAgentClientRuntime`, `OpenCodeAgentClient`, `OPENCODE_PROVIDER_CONFIG`, and all shared session/server-manager behavior.

Where `opencode-server-manager.test.ts` uses MiMoCode only as a second configuration to test manager isolation, rename the fixture to a neutral OpenCode-compatible id and label:

```typescript
const alternateManager = OpenCodeServerManager.getInstance(logger, undefined, {
  providerId: "opencode-alt",
  label: "OpenCode Alt",
  binary: "opencode-alt",
  serveArgs: (port) => ["serve", "--port", port],
  rotateServerOnForceRefresh: false,
  ignoreSystemEnvForDedicatedServer: true,
  installUrl: "https://opencode.ai",
});
```

- [ ] **Step 4: Remove obsolete test mocks/cases and run server regression tests**

Delete the MiMoCode constructor bucket, mock class, direct client case, and E2E availability branches. Preserve coverage for custom OpenCode-derived providers and server-manager isolation under neutral fixture names.

```powershell
npx vitest run packages/server/src/server/agent/provider-registry.test.ts --bail=1
npx vitest run packages/server/src/server/agent/provider-snapshot-manager.test.ts --bail=1
npx vitest run packages/server/src/server/agent/providers/opencode-server-manager.test.ts --bail=1
```

Expected: PASS.

- [ ] **Step 5: Format, review, and commit Task 2**

```powershell
npm run format:files -- packages/server/src/server/agent/providers/opencode-agent.ts packages/server/src/server/agent/providers/opencode/client.ts packages/server/src/server/agent/providers/opencode-server-manager.test.ts packages/server/src/server/agent/provider-registry.ts packages/server/src/server/agent/provider-registry.test.ts packages/server/src/server/agent/provider-tooling.ts packages/server/src/server/agent/provider-snapshot-manager.ts packages/server/src/server/agent/provider-snapshot-manager.test.ts packages/server/src/server/daemon-e2e/agent-configs.ts packages/app/e2e/global-setup.ts
git add -- packages/server/src/server/agent/providers/opencode-agent.ts packages/server/src/server/agent/providers/opencode/client.ts packages/server/src/server/agent/providers/opencode-server-manager.test.ts packages/server/src/server/agent/provider-registry.ts packages/server/src/server/agent/provider-registry.test.ts packages/server/src/server/agent/provider-tooling.ts packages/server/src/server/agent/provider-snapshot-manager.ts packages/server/src/server/agent/provider-snapshot-manager.test.ts packages/server/src/server/daemon-e2e/agent-configs.ts packages/app/e2e/global-setup.ts
```

Commit:

```powershell
git commit -m "refactor: remove MiMoCode server runtime"
```

Review gate: verify OpenCode runtime code was not deleted or weakened and snapshot ordering remains stable.

---

### Task 3: Remove The Model-Gateway Face Across Protocol, Server, And App

**Files:**

- Modify: `packages/protocol/src/provider-config.ts`
- Modify: `packages/server/src/server/agent/provider-registry.ts`
- Modify: `packages/server/src/server/agent/provider-registry.test.ts`
- Modify: `packages/server/src/server/agent/vision-fallback.ts`
- Modify: `packages/server/src/server/model-gateway/model-gateway.ts`
- Modify: `packages/app/src/screens/settings/custom-model-providers.ts`
- Modify: `packages/app/src/screens/settings/custom-model-providers.test.ts`
- Modify: `packages/app/src/screens/settings/custom-model-providers-section.test.tsx`
- Modify: `packages/app/src/screens/settings/synthetic-models-section.test.tsx`
- Modify: `packages/app/src/provider-selection/provider-selection.test.ts`
- Modify: `packages/app/src/provider-selection/provider-snapshot-models.test.ts`
- Modify: `packages/app/src/i18n/index.ts`

**Interfaces:**

- Consumes: model-gateway `supplyScope`, `protocolPreset`, upstream definitions, and remaining provider factories
- Produces: gateway faces `claude`, `codex`, `opencode`, `pi`, `kimi`; OpenAI-matched faces `opencode`, `pi`, `kimi`

- [ ] **Step 1: Write failing gateway-face expectations**

Update the server face-resolution tests to the exact shape:

```typescript
expect(resolveGatewayAgentFaces({ supplyScope: "all" })).toEqual({
  claude: true,
  codex: true,
  opencode: true,
  pi: true,
  kimi: true,
});

expect(resolveGatewayAgentFaces({ supplyScope: "matched", protocolPreset: "openai" })).toEqual({
  claude: false,
  codex: false,
  opencode: true,
  pi: true,
  kimi: true,
});
```

Update app gateway tests so generated provider ids equal only:

```typescript
expect(providerIds).toEqual(["zai-claude", "zai-codex", "zai-opencode", "zai-pi", "zai-kimi"]);
```

- [ ] **Step 2: Run gateway tests and verify they fail with the extra face**

```powershell
npx vitest run packages/server/src/server/agent/provider-registry.test.ts --bail=1
npx vitest run packages/app/src/screens/settings/custom-model-providers.test.ts --bail=1
```

Expected: FAIL because the face objects/provider-id arrays still contain an extra generated face.

- [ ] **Step 3: Remove the gateway schema and server materialization paths**

Delete `generatedProviderIds.mimocode` and `generatedModels.mimocode` from the strict schema. Change all gateway face unions, `allFaces`, upstream inference, OpenAI preset mapping, and materialization to five faces. Simplify `writeOpenCodeCompatibleGatewayConfig` to accept only OpenCode and always write `opencode.json`/`OPENCODE_CONFIG`. Remove the MiMoCode native-Xiaomi branch, managed directory, face registration, and vision-fallback suffix. Update model-gateway comments that enumerate OpenAI-family faces.

- [ ] **Step 4: Remove app gateway id/model generation and update copy**

Delete the dedicated id helper and result property from `custom-model-providers.ts`. For OpenAI matching return:

```typescript
return [ids.opencodeProviderId, ids.piProviderId, ids.kimiProviderId];
```

For all-scope return the five implemented gateway faces. Remove the generated model field and update English/Chinese copy to name Claude, Codex, OpenCode, Pi, and Kimi Code. Do not add Grok Build in this task.
(Superseded 2026-08-09: Grok Build is now included as the sixth model-gateway face.)

- [ ] **Step 5: Remove stale gateway fixtures and run every changed gateway test**

```powershell
npx vitest run packages/server/src/server/agent/provider-registry.test.ts --bail=1
npx vitest run packages/app/src/screens/settings/custom-model-providers.test.ts --bail=1
npx vitest run packages/app/src/screens/settings/custom-model-providers-section.test.tsx --bail=1
npx vitest run packages/app/src/screens/settings/synthetic-models-section.test.tsx --bail=1
npx vitest run packages/app/src/provider-selection/provider-selection.test.ts --bail=1
npx vitest run packages/app/src/provider-selection/provider-snapshot-models.test.ts --bail=1
```

Expected: PASS.

- [ ] **Step 6: Format, review, and commit Task 3**

```powershell
npm run format:files -- packages/protocol/src/provider-config.ts packages/server/src/server/agent/provider-registry.ts packages/server/src/server/agent/provider-registry.test.ts packages/server/src/server/agent/vision-fallback.ts packages/server/src/server/model-gateway/model-gateway.ts packages/app/src/screens/settings/custom-model-providers.ts packages/app/src/screens/settings/custom-model-providers.test.ts packages/app/src/screens/settings/custom-model-providers-section.test.tsx packages/app/src/screens/settings/synthetic-models-section.test.tsx packages/app/src/provider-selection/provider-selection.test.ts packages/app/src/provider-selection/provider-snapshot-models.test.ts packages/app/src/i18n/index.ts
git add -- packages/protocol/src/provider-config.ts packages/server/src/server/agent/provider-registry.ts packages/server/src/server/agent/provider-registry.test.ts packages/server/src/server/agent/vision-fallback.ts packages/server/src/server/model-gateway/model-gateway.ts packages/app/src/screens/settings/custom-model-providers.ts packages/app/src/screens/settings/custom-model-providers.test.ts packages/app/src/screens/settings/custom-model-providers-section.test.tsx packages/app/src/screens/settings/synthetic-models-section.test.tsx packages/app/src/provider-selection/provider-selection.test.ts packages/app/src/provider-selection/provider-snapshot-models.test.ts packages/app/src/i18n/index.ts
```

Commit:

```powershell
git commit -m "refactor: remove MiMoCode gateway face"
```

Review gate: compare app/server face-set branches side by side and verify `supplyScope` precedence is unchanged.

---

### Task 4: Remove MiMoCode Credential Aliases While Preserving MiMo Speech

**Files:**

- Modify: `packages/server/src/server/persisted-config.ts`
- Modify: `packages/server/src/server/persisted-config.test.ts`
- Modify: `packages/server/src/server/speech/providers/mimo/config.ts`
- Modify: `packages/server/src/server/speech/speech-config-resolver.test.ts`
- Verify: `packages/server/src/server/config-speech.test.ts`

**Interfaces:**

- Consumes: `PersistedConfig`, `RequestedSpeechProviders`, canonical `MIMO_*` environment values
- Produces: `resolveMimoSpeechConfig(...)` that resolves only canonical MiMo speech credentials

- [ ] **Step 1: Write failing strict-config and alias-removal tests**

Change the persisted-config test to keep only the canonical speech field and add a strict rejection assertion using a computed removed key so active tests do not retain a product claim:

```typescript
expect(() =>
  PersistedConfigSchema.parse({
    providers: {
      ["mimo" + "code"]: { apiKey: "removed-key" },
    },
  }),
).toThrow();
```

Add a speech resolver test that supplies only the old environment alias through a computed key and expects no MiMo runtime config:

```typescript
const env = { ["MIMO" + "CODE_API_KEY"]: "removed-key" } as NodeJS.ProcessEnv;
const result = resolveSpeechConfig({
  chisacodeHome: "/tmp/chisacode-home",
  env,
  persisted: PersistedConfigSchema.parse({}),
});
expect(result.mimo).toBeUndefined();
```

- [ ] **Step 2: Run the tests and verify old aliases are still accepted**

```powershell
npx vitest run packages/server/src/server/persisted-config.test.ts --bail=1
npx vitest run packages/server/src/server/speech/speech-config-resolver.test.ts --bail=1
```

Expected: FAIL because the schema/resolver currently accepts those aliases.

- [ ] **Step 3: Remove the old credential field and environment fallbacks**

Delete `ProvidersSchema.mimocode` and every `MIMOCODE_*` lookup. Retain this canonical resolution order:

```typescript
apiKey: firstDefined([params.env.MIMO_API_KEY, params.persisted.providers?.mimo?.apiKey]),
baseUrl: firstDefined([
  params.env.MIMO_BASE_URL,
  params.persisted.providers?.mimo?.baseUrl,
  DEFAULT_MIMO_BASE_URL,
]),
```

Keep canonical TTS model/voice env overrides and feature-scoped values unchanged.

- [ ] **Step 4: Run speech/config regression tests**

```powershell
npx vitest run packages/server/src/server/persisted-config.test.ts --bail=1
npx vitest run packages/server/src/server/speech/speech-config-resolver.test.ts --bail=1
npx vitest run packages/server/src/server/config-speech.test.ts --bail=1
```

Expected: PASS, including the existing canonical MiMo TTS test.

- [ ] **Step 5: Format, review, and commit Task 4**

```powershell
npm run format:files -- packages/server/src/server/persisted-config.ts packages/server/src/server/persisted-config.test.ts packages/server/src/server/speech/providers/mimo/config.ts packages/server/src/server/speech/speech-config-resolver.test.ts
git add -- packages/server/src/server/persisted-config.ts packages/server/src/server/persisted-config.test.ts packages/server/src/server/speech/providers/mimo/config.ts packages/server/src/server/speech/speech-config-resolver.test.ts
```

Commit:

```powershell
git commit -m "refactor: remove MiMoCode speech aliases"
```

Review gate: manually confirm every remaining `mimo` production match belongs to speech and no canonical `MIMO_*` name was removed.

---

### Task 5: Remove Management-Surface And Test-Fixture References

**Files:**

- Modify: `packages/server/src/server/agent/mcp-server-management.ts`
- Modify: `packages/server/src/server/agent/mcp-server-management.test.ts`
- Modify: `packages/server/src/server/agent/skills-management.ts`
- Modify: `packages/server/src/server/agent/skills-management.test.ts`
- Modify: `packages/app/src/screens/settings/mcp-servers-section.test.tsx`
- Modify: `packages/app/src/screens/settings/skills-section.test.tsx`
- Modify: `packages/app/src/desktop/components/integrations-section.test.tsx`
- Modify: `packages/app/src/agent-stream/model.test.ts`
- Modify: `packages/app/src/hooks/use-agent-history.test.ts`
- Modify: `packages/app/src/hooks/use-aggregated-agents.test.ts`
- Modify: `packages/app/src/utils/sidebar-session-source.test.ts`

**Interfaces:**

- Consumes: manifest-driven remaining provider list
- Produces: MCP, skill, integration, history, and fixture surfaces with no stale built-in-provider entry

- [ ] **Step 1: Update exact target-list expectations**

Use the manifest order plus target-specific entries. The provider portion must be:

```typescript
const expectedProviders = [
  { type: "provider", provider: "claude", label: "Claude" },
  { type: "provider", provider: "codex", label: "Codex" },
  { type: "provider", provider: "opencode", label: "OpenCode" },
  { type: "provider", provider: "pi", label: "Pi" },
  { type: "provider", provider: "kimi", label: "Kimi Code" },
  { type: "provider", provider: "grokbuild", label: "Grok Build" },
];
```

- [ ] **Step 2: Run MCP and skill tests and verify failure**

```powershell
npx vitest run packages/server/src/server/agent/mcp-server-management.test.ts --bail=1
npx vitest run packages/server/src/server/agent/skills-management.test.ts --bail=1
```

Expected: FAIL while hard-coded allowlists/labels still include the removed provider.

- [ ] **Step 3: Remove server allowlist/label branches and neutralize unrelated fixtures**

Delete the removed provider from scope arrays and label switches. In history/sidebar tests where `mimocode-desktop` is only an arbitrary project name, rename it consistently to `sample-desktop`; preserve the original aggregation/path behavior being tested.

- [ ] **Step 4: Remove stale app expectations and run changed tests**

```powershell
npx vitest run packages/server/src/server/agent/mcp-server-management.test.ts --bail=1
npx vitest run packages/server/src/server/agent/skills-management.test.ts --bail=1
npx vitest run packages/app/src/screens/settings/mcp-servers-section.test.tsx --bail=1
npx vitest run packages/app/src/screens/settings/skills-section.test.tsx --bail=1
npx vitest run packages/app/src/desktop/components/integrations-section.test.tsx --bail=1
npx vitest run packages/app/src/agent-stream/model.test.ts --bail=1
npx vitest run packages/app/src/hooks/use-agent-history.test.ts --bail=1
npx vitest run packages/app/src/hooks/use-aggregated-agents.test.ts --bail=1
npx vitest run packages/app/src/utils/sidebar-session-source.test.ts --bail=1
```

Expected: PASS.

- [ ] **Step 5: Format, review, and commit Task 5**

```powershell
npm run format:files -- packages/server/src/server/agent/mcp-server-management.ts packages/server/src/server/agent/mcp-server-management.test.ts packages/server/src/server/agent/skills-management.ts packages/server/src/server/agent/skills-management.test.ts packages/app/src/screens/settings/mcp-servers-section.test.tsx packages/app/src/screens/settings/skills-section.test.tsx packages/app/src/desktop/components/integrations-section.test.tsx packages/app/src/agent-stream/model.test.ts packages/app/src/hooks/use-agent-history.test.ts packages/app/src/hooks/use-aggregated-agents.test.ts packages/app/src/utils/sidebar-session-source.test.ts
git add -- packages/server/src/server/agent/mcp-server-management.ts packages/server/src/server/agent/mcp-server-management.test.ts packages/server/src/server/agent/skills-management.ts packages/server/src/server/agent/skills-management.test.ts packages/app/src/screens/settings/mcp-servers-section.test.tsx packages/app/src/screens/settings/skills-section.test.tsx packages/app/src/desktop/components/integrations-section.test.tsx packages/app/src/agent-stream/model.test.ts packages/app/src/hooks/use-agent-history.test.ts packages/app/src/hooks/use-aggregated-agents.test.ts packages/app/src/utils/sidebar-session-source.test.ts
```

Commit:

```powershell
git commit -m "refactor: remove MiMoCode management surfaces"
```

Review gate: confirm fixture renames did not reduce assertions or change the behavior under test.

---

### Task 6: Clean Current Documentation, Metadata, And Prototypes

**Files:**

- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `SECURITY.md`
- Modify: `CLAUDE.md`
- Modify: `CHANGELOG.md`
- Modify: `nix/package.nix`
- Modify: `skills/chisacode/SKILL.md`
- Modify: `packages/server/CLAUDE.md`
- Modify: `docs/architecture.md`
- Modify: `docs/custom-providers.md`
- Modify: `docs/glossary.md`
- Modify: `docs/product.md`
- Modify: `docs/providers.md`
- Modify: `docs/testing.md`
- Modify: `docs/testing/windows-desktop-test-matrix-2026-07-18.md`
- Modify: `docs/refactors/provider-god-file-decomposition-plan.md`
- Modify: `public-docs/custom-providers.md`
- Modify: `public-docs/metadata-generation.md`
- Modify: `public-docs/providers.md`
- Modify: `public-docs/security.md`
- Modify: `public-docs/supported-providers.md`
- Modify: `public-docs/alternatives/*.md`
- Modify: `prototypes/model-gateway-redesign.html`
- Modify: `prototypes/archive-flow-ux-prototype.html`

**Interfaces:**

- Consumes: final supported provider catalog and five-face gateway behavior
- Produces: current product claims, examples, matrices, and prototypes aligned with implementation

- [ ] **Step 1: Replace current provider claims and examples**

Use the canonical built-in list everywhere:

```text
Claude, Codex, OpenCode, Pi, Kimi Code, and Grok Build
```

Gateway copy must name only the five currently implemented faces:

```text
Claude / Codex / OpenCode / Pi / Kimi Code
```

Remove custom-provider examples that advertise the deleted base provider. Preserve historical archive files under `docs/refactors/archive/` unless they are rendered as current product guidance.

- [ ] **Step 2: Update public provider tables and links**

Delete the provider row and upstream installation link, update counts/descriptions, and ensure adjacent Markdown tables still have valid columns. Do not remove Xiaomi MiMo speech documentation if any current speech document legitimately uses it.

- [ ] **Step 3: Update active prototypes without changing layout**

Remove the provider name from gateway explanatory copy and rename the unrelated archive prototype fixture to a neutral title. Do not change CSS, layout structure, controls, or interaction behavior.

- [ ] **Step 4: Format and scan current documentation**

```powershell
npm run format:files -- README.md README.zh-CN.md SECURITY.md CLAUDE.md CHANGELOG.md skills/chisacode/SKILL.md packages/server/CLAUDE.md docs/architecture.md docs/custom-providers.md docs/glossary.md docs/product.md docs/providers.md docs/testing.md docs/testing/windows-desktop-test-matrix-2026-07-18.md docs/refactors/provider-god-file-decomposition-plan.md public-docs/custom-providers.md public-docs/metadata-generation.md public-docs/providers.md public-docs/security.md public-docs/supported-providers.md public-docs/alternatives prototypes/model-gateway-redesign.html prototypes/archive-flow-ux-prototype.html
```

Run a case-insensitive scan across current docs/public docs/prototypes. Expected matches are limited to the approved design/plan and explicitly historical archives:

```powershell
rg -n -i "mimocode|mimo code" README.md README.zh-CN.md SECURITY.md CLAUDE.md CHANGELOG.md nix skills packages/server/CLAUDE.md docs public-docs prototypes
```

- [ ] **Step 5: Review and commit Task 6**

```powershell
git add -- README.md README.zh-CN.md SECURITY.md CLAUDE.md CHANGELOG.md nix/package.nix skills/chisacode/SKILL.md packages/server/CLAUDE.md docs/architecture.md docs/custom-providers.md docs/glossary.md docs/product.md docs/providers.md docs/testing.md docs/testing/windows-desktop-test-matrix-2026-07-18.md docs/refactors/provider-god-file-decomposition-plan.md public-docs/custom-providers.md public-docs/metadata-generation.md public-docs/providers.md public-docs/security.md public-docs/supported-providers.md public-docs/alternatives prototypes/model-gateway-redesign.html prototypes/archive-flow-ux-prototype.html
```

Commit:

```powershell
git commit -m "docs: remove MiMoCode product references"
```

Review gate: verify no current doc claims generic ACP was removed and no MiMo speech documentation was accidentally deleted.

---

### Task 7: Final Static, Targeted, Adversarial, And Real-Surface Verification

**Files:**

- Verify all files changed in Tasks 1-6
- Do not modify unrelated dirty-worktree files

**Interfaces:**

- Consumes: completed implementation and all module review artifacts
- Produces: release-quality evidence that the provider is absent and remaining behavior is intact

- [ ] **Step 1: Rebuild producer dependencies and run static gates**

```powershell
npm run build:client
npm run build:server-deps
npm run typecheck
npm run lint
```

Expected: all commands exit 0. If output is broad, redirect it to a task-specific file and inspect the failure rather than rerunning blindly.

- [ ] **Step 2: Run each changed Vitest file exactly once**

Use the test commands from Tasks 1-5. Do not rerun a file already reported green by the responsible module executor. Record file, assertion count, and exit status.

- [ ] **Step 3: Run final repository scans**

```powershell
rg -n -i "mimocode|mimo code" packages README.md README.zh-CN.md SECURITY.md CLAUDE.md CHANGELOG.md nix skills docs public-docs prototypes
rg -n "MIMO_" packages/server/src/server/speech packages/server/src/server/config-speech.test.ts
rg -n -i "mimo" packages/server/src/server/speech packages/server/src/server/persisted-config.ts
```

Expected: no active coding-agent matches. Design/plan and explicitly historical archives may retain audit history. Every remaining `mimo`/`MIMO_*` match must be manually classified as canonical speech support.

- [ ] **Step 4: Run real Electron verification**

Start the real desktop development surface using the repository's Windows workflow without restarting an existing daemon on port 6767. Verify:

1. New-agent provider selector has no removed entry.
2. Settings provider/integration, MCP, and skill target surfaces have no removed entry.
3. Model-gateway settings/copy and generated providers have no removed face.
4. Claude, Codex, OpenCode, Pi, Kimi Code, and Grok Build still render and can be selected when available.
5. Canonical MiMo speech settings resolve through `providers.mimo`/`MIMO_*` when credentials are available; otherwise mark only this credentialed scenario unverified.

Capture screenshots or equivalent QA artifacts for the provider selector, settings provider list, and model-gateway surface.

- [ ] **Step 5: Perform final code and adversarial reviews**

The code review must inspect behavior, security, regressions, and missing tests. The adversarial review must specifically search for downgrade patterns: hidden/tombstone aliases, string-obfuscated compatibility branches, silent OpenCode remapping, generic ACP removal, Grok Build scope creep, weakened tests, or deletion of MiMo speech.

Expected verdict: no unresolved high/medium findings and no unverified non-credentialed desktop scenarios.

- [ ] **Step 6: Commit any review fixes and report final status**

If reviews require fixes, return to the owning task, add a failing regression test, implement the fix, rerun only the affected gates, and make a focused commit. Do not create an empty final commit.

Final report must include commits, targeted tests, static gates, residual scan classification, Electron evidence, and any credential-dependent unverified path.
