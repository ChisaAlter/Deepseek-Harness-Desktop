# Contributing to ChisaCode

Thanks for your interest in contributing. This guide covers the essentials.

## Development Setup

**Prerequisites**: Node.js >= 22, npm workspaces, Git.

```bash
git clone https://github.com/ChisaAlter/ChisaCode.git
cd ChisaCode
git checkout cn-main
npm ci
```

Start all surfaces:

```bash
# macOS / Linux
npm run dev

# Windows
npm run dev:win
```

Focused development:

```bash
npm run dev:server   # daemon only
npm run dev:app      # app only
npm run dev:desktop  # desktop only
```

## Project Structure

```
packages/
  server/      — Local daemon, WebSocket API, MCP server, agent lifecycle
  protocol/    — Shared WebSocket schemas/types and binary frame codecs
  client/      — Daemon WebSocket driver (used by app/CLI)
  app/         — Expo app (iOS, Android, web, desktop renderer)
  cli/         — Commander CLI
  desktop/     — Electron wrapper
  relay/       — E2E encrypted relay
docs/          — Architecture, development, testing, security docs
```

## Quality Checks

```bash
npm run lint          # oxlint
npm run typecheck     # TypeScript
npm run format        # oxfmt
```

Build dependency stacks before diagnosing cross-package errors:

```bash
npm run build:client    # protocol → client
npm run build:server    # full server chain
npm run build:app-deps  # app dependencies
```

## Testing

- Run only the changed test file: `npx vitest run <path> --bail=1`
- Never run full suites locally unless explicitly needed
- Avoid `setTimeout`/`sleep` in tests — use `vi.waitFor`, event emitters, or `vi.useFakeTimers`
- Avoid `vi.mock` — prefer real dependencies with injectable adapters

Server test categories:

```bash
npm run test:unit --workspace=@chisacode/server
npm run test:e2e --workspace=@chisacode/server
```

## Coding Style

- oxfmt: 2 spaces, double quotes, semicolons, trailing commas, 100-column width
- Prefer `function` declarations and `interface` over type aliases
- JSDoc for public APIs — `@param` / `@returns` / `@throws`
- No `any`, no array index keys, no nested ternaries

## Improvement Tracking

Before making changes, check `docs/refactors/comprehensive-improvement-roadmap.md`:

- Is there a related entry? Read it first
- Does your change create new tech debt? Add a roadmap entry
- Did your change resolve a tracked item? Update its status

## Commit Convention

We follow conventional commits:

- `feat(scope):` — new feature
- `fix(scope):` — bug fix
- `refactor(scope):` — code change without feature/fix
- `docs(scope):` — documentation
- `chore(scope):` — maintenance
- `test(scope):` — test changes

Scopes: `server`, `app`, `desktop`, `cli`, `protocol`, `client`, `relay`

## Pull Requests

1. Run `npm run lint` and `npm run typecheck` before opening
2. Ensure relevant tests pass: `npx vitest run <affected-test> --bail=1`
3. Update the improvement roadmap if your PR resolves a tracked item
4. Add a CHANGELOG entry for user-facing changes

## Security

For security issues, do NOT open a public issue. Email hello@moboudra.com.

See `SECURITY.md` for the full threat model and architecture.
