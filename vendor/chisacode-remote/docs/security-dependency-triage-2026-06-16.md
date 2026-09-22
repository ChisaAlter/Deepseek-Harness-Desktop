# Security Dependency Triage - 2026-06-16

Audit command:

```bash
npm audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org/
```

## Applied

- Pinned direct workspace `ws` dependencies to `8.21.0`.
- Added root overrides for `ws@8.21.0`, `form-data@4.0.6`, and `shell-quote@1.8.4`.
- Upgraded `@chisacode/server` Express dependency to `^4.22.2`, which brings patched `qs` through the server-local install path.
- Added root overrides for high-risk Expo/tooling transitive dependencies that can be
  patched without an Expo/RN major upgrade:
  - `@xmldom/xmldom@0.8.13`
  - `node-forge@1.4.0`
  - `picomatch@4.0.4`, with scoped `2.3.2`/`3.0.2` overrides for older callers
  - `undici@6.24.0` under `@expo/cli`
- Added `hono@4.12.25` override for the `@modelcontextprotocol/sdk` server path after
  npm audit raised the `hono <=4.12.24` advisory to high severity.

## Audit Delta

- Before: 47 vulnerabilities, including 6 high and 1 critical.
- After this batch: 36 vulnerabilities, including 0 high and 0 critical.
- `npm ls ai @ai-sdk/provider-utils @anthropic-ai/claude-agent-sdk @anthropic-ai/sdk react-native-markdown-display markdown-it ws form-data shell-quote --all --depth=6` exited cleanly in the local audit environment; the local install tree reflects the `ws`, `form-data`, and `shell-quote` overrides.
- `npm ls @xmldom/xmldom node-forge picomatch undici --all --depth=10` exited cleanly
  in the local audit environment; the high-risk transitive dependency overrides are installed, not just
  declared.
- `npm ls hono --all --depth=10` now exits cleanly with `hono@4.12.25` installed under
  `@modelcontextprotocol/sdk`.

## Deferred

- Expo / React Native toolchain advisories that still require framework-level work
  (`postcss`, `uuid`, `js-yaml`, `tar`, and the `expo-*` package advisories): these sit
  mostly in mobile build/dev tooling and require Expo/RN framework upgrades. Do not
  force-upgrade Expo major in the security batch.
- `markdown-it`: no direct fix is available through `react-native-markdown-display`. Because user and agent Markdown is rendered in the app, evaluate either replacing the renderer or disabling high-risk Markdown rules in a focused follow-up.

## Notes

- Do not use `npm audit fix --force` for the remaining advisories.

## Resolved Follow-up - 2026-07-12

- Removed the legacy `ai@5.0.78` dependency entirely; server MCP consumers now use
  `@ai-sdk/mcp@2.0.10` and the stable `createMCPClient` API.
- The migration moves `@ai-sdk/provider-utils` from the vulnerable 3.x line to 5.0.7,
  raises the server Zod peer floor to `^3.25.76`, and establishes Node.js 22 as the minimum runtime.

## Resolved Follow-up - 2026-07-13

- Upgraded OpenAI SDK from 4.x to 6.46.0 as the Zod 4 compatibility prerequisite.
- Unified direct Zod dependencies in protocol, client, app, desktop, and server on 4.3.6. Existing schemas import the official `zod/v3` compatibility API so wire and persistence parsing semantics remain stable while the dependency graph uses one package version.
- Upgraded `@anthropic-ai/claude-agent-sdk` to 0.2.141, `@anthropic-ai/sdk` to 0.93.0, and direct `@modelcontextprotocol/sdk` to 1.29.0 without `--legacy-peer-deps` or `--force`.
- Production audit moved from 26 to 24 findings, remains at 0 high / 0 critical, and no longer reports Claude or Anthropic packages. Remaining moderate findings are primarily Expo/EAS framework-major work.

## Resolved Follow-up - 2026-07-13 (Compatible Transitive Patches)

- Upgraded the production dependency paths for `ajv`, `brace-expansion`, `js-yaml`, `postcss`, and `tar` to compatible patched releases.
- Regenerated the lockfile with npm 10.9.4 so workspace-local `@types/node` and cross-platform optional package entries remain complete for clean installs.
- Production audit moved from 24 to 19 findings and remains at 0 high / 0 critical. The five resolved advisory families no longer appear.
- Remaining findings are the Expo/EAS framework-major cluster, the `uuid` major migration coupled to Expo `xcode`, and a low-severity Babel issue without a Babel 7 patch release.

## Resolved Follow-up - 2026-07-13 (Server UUID Dependency Removal)

- Replaced all UUID generation in 11 server production files with the Node.js 22+ `node:crypto.randomUUID()` API.
- Removed the server's direct `uuid` runtime dependency and obsolete `@types/uuid` development dependency.
- Production audit remains at 19 findings with 0 high / 0 critical because the remaining `uuid` advisory is exclusively `@expo/config-plugins -> xcode@3.0.1 -> uuid@7.0.3`; no server production source imports `uuid`.
- The nested `xcode` path remains deferred to the Expo framework-major migration. It is not overridden independently because native project generation compatibility owns that dependency.

## Resolved Follow-up - 2026-07-13 (Expo SDK 55)

- Upgraded the App from Expo 54 / React Native 0.81 / React 19.1 to Expo 55.0.27 / React Native 0.83.6 / React 19.2.0, including the Expo module set, Router, Reanimated, Worklets, and the local two-way-audio module.
- Removed the App's direct `expo-modules-core` and local `eas-cli` dependencies. Native module callers now consume the public `expo` runtime API and use a local removable-subscription contract; React DOM types and `react-test-renderer` are explicit and locked to the React 19.2 line.
- Migrated the Gesture Handler patch from 2.28.0 to 2.30.1 and removed the Android runtime's explicit `implementation project(":expo")`, which caused a circular dependency under the Expo 55 aggregate module.
- `expo install --check`, Expo Doctor 19/19, the core React/Expo dependency tree, npm 10.9.4 clean install, App/module typechecks, Android prebuild, both custom Android module compiles, and App `compileDebugKotlin` passed.
- Production audit moved from 19 to 11 moderate findings and remains at 0 high / 0 critical. The remaining findings are confined to the Expo CLI/config/prebuild toolchain, including `xcode -> uuid`; continue with Expo 56/EAS rather than forcing a standalone native-tool override.

## Resolved Follow-up - 2026-07-13 (Expo SDK 56)

- Upgraded the App to Expo 56.0.15 / React Native 0.85.3 / React 19.2.3, including Expo Router 56.2.14, Reanimated 4.3.1, Worklets 0.8.3, Gesture Handler 2.31.2, and TypeScript 6.0.3.
- Removed the App's direct `@react-navigation/native` dependency and migrated navigation hooks to Expo Router. Updated React Native absolute-fill usage for the 0.85 API and made the local audio event-map import type-only for TypeScript 6.
- Migrated the Gesture Handler web pointer-capture patch to 2.31.2. The patch applies cleanly to source, CommonJS, and ESM builds after a clean install.
- `expo install --check`, Expo Doctor 21/21, the core React/Expo dependency tree, App dependency builds and typecheck, focused lint/tests, Android clean prebuild, both custom Android module compiles, and App `compileDebugKotlin` passed.
- Production audit reports 12 moderate findings and remains at 0 high / 0 critical. The findings remain confined to Expo CLI/config/prebuild tooling, including `xcode -> uuid`; Expo 57/EAS is the next compatibility migration instead of forcing a standalone override.

## Resolved Follow-up - 2026-07-14 (Expo SDK 57 and Worklets Bundle Mode)

- Upgraded the App to Expo 57.0.4 / React Native 0.86.0 / React 19.2.3, including Expo Router 57.0.4, Reanimated 4.5.0, Worklets 0.10.0, Gesture Handler 2.32.0, and the local two-way-audio module on Expo Modules Core 57.0.3.
- Enabled the official Worklets Bundle Mode mitigation for the Hermes V1 plus Reanimated memory regression. The existing custom Metro resolver is wrapped with Reanimated and Bundle Mode configuration, and the official Metro/Metro Runtime 0.84.4 patches are applied through the selective postinstall patch runner.
- Migrated the Gesture Handler web pointer-capture patch to 2.32.0. All four postinstall patches apply cleanly after install, and the npm 10.9.4 lockfile retains workspace-local Node type snapshots and npmjs-only resolved URLs.
- `expo install --check`, Expo Doctor 20/20, App dependency builds/typecheck, focused lint/format, Android clean prebuild, both custom Android module compiles, App `compileDebugKotlin`, and an Android Hermes bundle export passed. Local Expo config also resolved the app-version runtime policy, updates URL, EAS project ID, and Android package.
- EAS CLI 20.5.1 live production config resolution reached the Expo account gate and was not bypassed; authenticated EAS validation remains a release-time check. Production audit remains at 12 moderate findings with 0 high / 0 critical, still confined to Expo CLI/config/prebuild tooling and `xcode -> uuid`.
