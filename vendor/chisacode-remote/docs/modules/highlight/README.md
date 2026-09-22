# Highlight Module Handoff

## Role

`@chisacode/highlight` provides shared syntax highlighting support used by client-facing surfaces.

## Owned Surfaces

- Highlighting helpers and token output.
- Shared code display support that should not be coupled to a specific screen.

## Dependencies

`highlight` should stay small and reusable. Avoid importing app UI, daemon runtime, or platform-specific modules.

## Downstream Consumers

- `app` uses highlight output for rendered code and rich text surfaces.
- Other UI-facing packages may consume it through package exports.

## Common Work

- Fix tokenization or language handling.
- Adjust shared highlight output shape.
- Improve rendering-safe metadata consumed by UI.

## Invariants

- Keep output stable for downstream renderers.
- Do not introduce platform-specific dependencies.
- Prefer targeted tests around changed language or token behavior.

## Cross-Cutting Docs

- `docs/cross-cutting/app-platform-boundaries.md`

## Verification

```bash
npm run build:highlight
npm run typecheck --workspace=@chisacode/highlight
npm run lint -- packages/highlight
```

## Graph

Generated graph: `docs/modules/highlight/knowledge-graph.json`
