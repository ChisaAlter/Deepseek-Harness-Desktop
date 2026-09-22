# ChisaCode Full Optimization Plan

Date: 2026-06-16
Scope: repository hygiene, security dependency triage, test debt recovery, release reliability, and measurable performance work.

## Execution Order

1. Environment and repository hygiene.
2. Security dependency upgrades.
3. Test debt recovery.
4. Desktop, release, and runtime reliability.
5. Performance and architecture optimization.

## Phase 1: Baseline And Local Hygiene

- Use the active Node.js installation from `PATH`; the repository does not enforce an exact Node version.
- Keep Node version checks advisory, not blocking release checks.
- Keep local desktop release artifacts out of routine source scans.
- Verify with `node -v`, `npm run typecheck`, `npm run lint`, and `git status --short`.

## Phase 2: Security Dependency Upgrade

- Audit against the official npm registry:
  `npm audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org/`.
- Upgrade low-risk patch/minor batches first.
- Prioritize runtime paths: `ws`, `form-data`, `@anthropic-ai/claude-agent-sdk`, `ai`, and `@ai-sdk/*`.
- Do not use `npm audit fix --force`.
- Treat major upgrades as isolated follow-up slices after reading release notes.
- Triage `markdown-it` carefully because agent and user content render Markdown.

## Phase 3: Test Debt Recovery

- Make `npm run test:audit` pass without raising the baseline.
- Reduce `moduleMock` back to no more than 184 and `fixedWait` back to no more than 351.
- Prefer adapter/port fakes, Playwright behavior tests, selector waits, RPC state waits, and log-condition waits.
- Run changed Vitest files individually with `npx vitest run <path> --bail=1`.

## Phase 4: Desktop, Release, And Runtime Reliability

- Use packaged desktop logs as the source of truth:
  `C:\Users\48818\AppData\Roaming\ChisaCode\logs\main.log`.
- Extend the existing updater path only; do not add a second update system.
- Keep Android release generation in CI through `expo prebuild --platform android --non-interactive`.
- Release checks must cover format/lint/typecheck, desktop package output, artifact existence, asar path validation, and GitHub release manifest validation.
- Do not restart the main daemon on `localhost:6767` without explicit permission.

## Phase 5: Performance And Architecture Optimization

- Establish baselines before optimization: app/desktop cold start, workspace open, large timeline render, terminal webview load, and daemon WebSocket first byte.
- Optimize only measurable hot paths first: timeline render/dedupe, terminal webview loading, workspace/sidebar re-rendering, and provider snapshot fetch.
- Keep protocol changes backward compatible: optional/defaulted fields, dotted `.request`/`.response` RPC names, and `server_info.features.*` gates.
- Provider work must span protocol config, daemon persisted config, provider registry/runtime, and app catalog/icons/validation.
