# desktop

Electron desktop app for ChisaCode.

## Packaging

- `npm run build` — full packaged build (all platforms/arches; used for release).
- `npm run build:x64` — x64-only Windows build (`nsis` + `zip`) for the local
  packaged e2e gate (`packages/app/e2e/desktop-packaged-slices.script.ts`).
  The command rebuilds the server, exports the Electron web renderer from
  `packages/app`, then packages the desktop app. Halves build time by skipping
  arm64. Run from `packages/desktop`.

`scripts/build-x64.js` mirrors the asar-integrity-after-rcedit packager in
`scripts/build.js` (re-embeds the asar hash after rcedit rewrites the exe).
Keep the two in sync whenever the packager logic changes, otherwise the
packaged gate silently validates a stale artifact.
