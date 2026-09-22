# CLI Module Handoff

## Role

`@chisacode/cli` is the terminal command surface for daemon, agent, chat, terminal, loop, schedule, permit, provider, worktree, and speech workflows.

## Owned Surfaces

- Commander command registration and parsing.
- CLI output renderers for human-readable and machine-readable modes.
- Command-specific daemon client calls.
- CLI utilities for paths, errors, durations, provider/model options, and timeline rendering.

## Dependencies

`cli` depends on `client`, `protocol`, and server-facing command contracts. It should not duplicate daemon state semantics locally.

## Downstream Consumers

- Developers and automation scripts use the CLI to control daemons and agents.
- Release and diagnostic workflows may rely on JSON output stability.

## Common Work

- Add a CLI command for an existing daemon feature.
- Add JSON/table/YAML rendering for a response.
- Adjust command options or validation.
- Improve daemon status, provider, agent, or terminal workflows.

## Invariants

- Run the checkout version with `npm run cli -- ...`.
- Do not assume globally installed `chisacode` points at this checkout.
- Keep machine-readable output stable when possible.
- CLI behavior should reflect daemon state, not invent independent state.

## Cross-Cutting Docs

- `docs/cross-cutting/websocket-rpc-protocol.md`
- `docs/cross-cutting/daemon-agent-lifecycle.md`
- `docs/cross-cutting/provider-plumbing.md`

## Verification

```bash
npm run build:server
npm run typecheck --workspace=@chisacode/cli
npm run lint -- packages/cli
```

Manual command smoke tests should use `npm run cli -- ...`.

## Graph

Generated graph: `docs/modules/cli/knowledge-graph.json`
