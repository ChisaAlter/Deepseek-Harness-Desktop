# Expo Two-Way Audio Module Handoff

## Role

`@chisacode/expo-two-way-audio` is the native Expo module that bridges two-way audio streaming for realtime voice features.

## Owned Surfaces

- Native module packaging.
- iOS and Android audio bridge code.
- JavaScript/TypeScript module surface consumed by app voice runtime.

## Dependencies

This module sits below the app voice UX. It should expose native capability cleanly without owning app session state or voice product flow.

## Downstream Consumers

- `app` consumes the module for realtime voice and dictation paths.

## Common Work

- Fix native audio capture/playback bridge behavior.
- Change module exports.
- Update Expo native module packaging.
- Adjust platform-specific audio behavior.

## Invariants

- Keep native behavior separated from app-level voice UX.
- Verify both native platforms when changing shared native behavior.
- Coordinate with app platform boundaries for UI-facing voice changes.

## Cross-Cutting Docs

- `docs/cross-cutting/app-platform-boundaries.md`

## Verification

```bash
npm run build --workspace=@chisacode/expo-two-way-audio
npm run lint -- packages/expo-two-way-audio
```

Native runtime changes need platform-specific smoke testing beyond static checks.

## Graph

Generated graph: `docs/modules/expo-two-way-audio/knowledge-graph.json`
