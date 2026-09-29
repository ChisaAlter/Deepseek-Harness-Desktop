# Whale Isle 0.3.3 — Node 24 installer

## Artifact

- Output: `dist/release-20260929-node24/Whale-Isle-Setup-0.3.3.exe`
- Platform: Windows x64; size: 598807877 bytes (571.07 MiB).
- SHA256: `730c513da4ee0c5f839a04e3589d1fc81c7c4f1ed6cabe4dcd9460c428a3989d`.
- Companion assets: matching `.exe.blockmap`, `latest.yml`, and `SHA512SUMS.txt` in the same directory.
- Authenticode: NotSigned.
- Source: `bbe3fc0a85703bcc88ebe54b99ef7bd76a0541be` plus the current working-tree changes. This is not an exact-commit CI artifact; see [source identity](source-build.json).

## Runtime choice

The user explicitly replaced the old Node 22.22.2 constraint. The build uses official Node 24.21.0 LTS, installed only under `.tmp/node-runtime/`. The Windows archive SHA256 was verified as `158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541`. `.nvmrc` now selects the same version for future CI runs. Executing the packaged `resources/node.exe --version` returns `v24.21.0`.

## Verification

- Official native/host/client/web build completed under Node 24.
- Full desktop suite: 2809 passed, 2 skipped, 0 failed.
- Runtime instance graph: 747 packages, 3602 links verified; Office payload and runtime closure verified.
- Real CLI skip/full composition checks passed.
- Packaged P0 passed: desktop startup, no renderer page errors, titlebar hit tests, terminal echo, sibling workspace Git/PTY, Ghostty wasm, replacement of a stale runtime, and no automatic external browser launch. See [packaged result](packaged-p0.json).
- ASAR contents match five relevant current source files, including the pet transparency registration and launcher changes. See [ASAR audit](asar-audit.json).
- Release asset validator passed: version/name/size/SHA256/SHA512 and updater metadata match.
- 7-Zip tested the embedded Setup archive with exit code 0 and “Everything is Ok”; it also reported trailing data beyond the embedded archive. This checks compressed file integrity, not interactive installation.
- Documentation gates: 7/7; governance: 6/6.

## Scope of acceptance

This is a locally built and tested installer. No installer was run against the user's existing installation or profile, no Git changes were committed or pushed, and no release or tag was published. Formal production acceptance remains unexecuted: it requires a CI candidate from the final source commit and the installed-app acceptance matrix. Local packaged P0 results do not substitute for that matrix.

Logs: `.omc/release-node24-prestart.log`, `.omc/release-node24-tests.log`, `.omc/release-node24-build.log`, `.omc/release-node24-packaged-p0.log`, and `.omc/release-node24-archive-test.log`.
