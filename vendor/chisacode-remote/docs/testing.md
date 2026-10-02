# Testing

Inside this checkout, [WhaleIsle maintenance policy](../../../docs/maintenance/README.md) alone selects development order, necessary verification and delivery. Complete implementation before preparing tests. This page describes test mechanics; it adds no gates, approvals or CI shortcuts.

## Philosophy

Tests prove behavior, not structure. Every test should answer: "what user-visible or API-visible behavior does this verify?"

## Development order

Read existing code and observe the fault during diagnosis. Complete the authorized implementation, then prepare necessary tests, verify affected paths and observe real operations. Missing local evidence cannot be deferred to CI.

## Determinism first

Tests must produce the same result every run:

- No conditional assertions or branching paths
- No reliance on timing, randomness, or network jitter
- No weak assertions (`toBeTruthy`, `toBeDefined`)
- Assert the full intended behavior, not fragments

```typescript
// Bad: conditional and weak
it("creates a tool call", async () => {
  const result = await createToolCall(input);
  if (result.ok) {
    expect(result.id).toBeDefined();
  }
});

// Good: deterministic and explicit
it("returns timeout error when provider times out", async () => {
  const result = await createToolCall(input);
  expect(result).toEqual({
    ok: false,
    error: { code: "PROVIDER_TIMEOUT", waitedMs: 30000 },
  });
});
```

## Flaky tests are a bug

Never remove a test because it's flaky. Find the variance source (time, randomness, race condition, shared state, non-deterministic output, environment drift) and fix it.

## Real dependencies over mocks

Choose the observation needed to detect the fault. Isolated tests can use existing adapters; they do not certify a real external operation. No separate approval is required for a routine test implementation choice.

- **Database**: real test database, not a mock
- **APIs**: real APIs with test/sandbox credentials, not request mocks
- **File system**: temporary directory that gets cleaned up, not fs mocks

Ask: "will this still hold with real dependencies at runtime?" If no, don't mock.

### Use swappable adapters instead

Reuse an existing injectable dependency for isolation where available. Do not introduce product abstractions solely for test convenience. An existing adapter can be exercised as follows:

```typescript
interface EmailSender {
  send(to: string, body: string): Promise<void>;
}

// Production
const realSender: EmailSender = { send: sendgrid.send };

// Test: in-memory adapter
function createTestEmailSender() {
  const sent: Array<{ to: string; body: string }> = [];
  return {
    send: async (to: string, body: string) => {
      sent.push({ to, body });
    },
    sent,
  };
}
```

## End-to-end means end-to-end

When a test is labeled end-to-end, it calls the real service. No environment variable gates, no conditional skipping, no mocking the external dependency.

## Test organization

- Collocate tests with implementation: `thing.ts` + `thing.test.ts`
- Extract complex setup into reusable helpers
- Test bodies should read like plain English
- Build a vocabulary of test helpers that make complex flows simple

### File naming

Vitest picks up tests by suffix. The suffix tells the runner which category it belongs to.

| Suffix                | What it is                                                                                                                 | Where it runs                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `*.test.ts(x)`        | Unit test — pure, fast, no daemon                                                                                          | `npm run test:unit`                                                                  |
| `*.posix.test.ts`     | Unit test that needs POSIX-only behavior                                                                                   | unit, skipped on Windows                                                             |
| `*.browser.test.ts`   | App test that needs a real browser (DOM)                                                                                   | `npm run test:browser` (Vitest browser mode, Playwright provider, headless Chromium) |
| `*.e2e.test.ts`       | End-to-end against a real daemon                                                                                           | `npm run test:e2e`                                                                   |
| `*.real.e2e.test.ts`  | E2E that hits a real provider (Claude/Codex/OpenCode/Pi/Kimi Code/Grok Build) — needs creds in `packages/server/.env.test` | `npm run test:integration:real` / `test:e2e:real`                                    |
| `*.local.e2e.test.ts` | E2E that needs a local-only resource                                                                                       | `npm run test:integration:local` / `test:e2e:local`                                  |

App-level Playwright browser E2E lives in `packages/app/e2e/*.spec.ts` and runs via `npm run test:e2e --workspace=@chisacode/app` (separate from Vitest E2E). App Playwright specs that hit real providers use `*.real.spec.ts` and run through `npm run test:e2e:real --workspace=@chisacode/app`; the default app E2E project ignores that suffix so CI does not need provider credentials.

Live provider smoke tests belong in `*.real.e2e.test.ts`, not `*.test.ts`, even when guarded by environment variables. Default unit suites must use deterministic provider adapters/fakes so missing credits, auth outages, and upstream model drift do not block normal CI.

### Test setup

- Server: `packages/server/src/test-utils/vitest-setup.ts` loads `.env.test`, sets `CHISACODE_SUPERVISED=0`, and disables Git/SSH prompts. Add new global env shims here, not in individual tests.
- App: `packages/app/vitest.setup.ts` provides `expo`/`__DEV__` shims and stubs a few native-only modules (`react-native-unistyles`, `react-native-svg`, `expo-linking`, `@xterm/addon-ligatures`). Stubbing here is for modules that have no meaningful Node behavior — not a license to mock app code.

## Running tests locally

Select checks for the actual changed behavior after implementation. A targeted command is `npx vitest run <path> --bail=1`; broader checks are necessary only when the changed risk warrants them. Record resource-intensive commands and their results, and reuse evidence for the same version. Missing tools or credentials remain blocking for necessary checks. CI is final verification after all necessary local QA and actual operations pass.

### Chain entrypoints

These entrypoints locate existing checks. Select the affected paths under the host policy rather than running a fixed chain for every change:

- `npm run test:desktop-chain` — builds the server stack, runs protocol/client
  tests, desktop package tests, and the desktop-critical Playwright specs.
- `npm run test:android-chain` — runs the Android Maestro chain wrapper. It
  assumes a development Android build, a connected emulator/device, and an
  isolated daemon reachable at `127.0.0.1:6767`.
- `npm run test:audit` — checks test debt counts against
  `scripts/test-audit-baseline.json`. New `vi.mock`, `vi.spyOn`, unconditional
  skips, conditional skips, fixed waits, weak assertions, and direct
  `process.env` mutations fail CI unless the baseline is intentionally updated.

The CLI test runner discovers both legacy executable scripts in
`packages/cli/tests/*.test.ts` and Vitest files in `packages/cli/tests/e2e/` and
`packages/cli/src/`. Use `npx tsx packages/cli/tests/run-all.ts --list-tests` to
verify discovery without building or running the suite.

## Agent authentication in tests

Agent providers own their authentication. Verify authentication when it is part of the changed boundary, without adding unrelated login probes or skips to make missing prerequisites appear successful. Report authentication failures accurately.

## Debugging with tests

Use the test as your debugging ground:

1. Add temporary logging to the code under test
2. Run the test, observe actual values
3. Trace the flow end-to-end through test output
4. Confirm each assumption with actual output
5. Remove logging when done

Tests supply behavior evidence; source inspection explains implementation. Neither substitutes for observing a necessary real user operation.

## Design for testability

Reuse current public interfaces and existing helpers. Do not refactor product architecture merely to simplify testing or add hypothetical boundaries. A product change needs an authorized requirement or evidence of a real fault.

## Evidence scope

Unit, component and protocol tests may each detect concrete failures. Keep assertions on observable behavior and do not weaken them to clear a failure. A real end-to-end claim requires the real daemon, network and browser or isolated service. A mock or component test alone cannot certify that path.
