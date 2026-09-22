# ChisaCode Migration

ChisaCode keeps previous app state readable while new installs and new writes use ChisaCode names.
Do not remove compatibility paths until a later release explicitly drops the name-migration support.

## Runtime State

- `CHISACODE_HOME` is the canonical home override.
- Previous home directories remain migration sources when no ChisaCode home exists yet.
- Without an override, the daemon uses `~/.chisacode`.
- PID locks are written to `chisacode.pid`; compatibility readers still tolerate older lock names
  where required by migration code.

## Project Config

- `chisacode.json` is the canonical project config file.
- Previous config filenames are migration inputs only.
- If multiple config files exist, `chisacode.json` wins.
- If no config exists, new writes create `chisacode.json`.

## CLI And Environment

- `chisacode` is the primary CLI command.
- Server config reads `CHISACODE_*` environment variables.
- Legacy environment variable names should only appear in explicit compatibility code or historical
  changelog entries.

## App And Desktop

- The desktop preload exposes `window.chisacodeDesktop`.
- Electron IPC uses `chisacode:*` channels for the supported bridge.
- Packaged desktop content is served through `chisacode://`.
- Local daemon URLs are emitted as `chisacode+local:`.
- App settings, host registry, client id, preferred editor, and IndexedDB attachment bytes migrate
  from previous storage names on read.

## Protocol Compatibility

- New review attachments use `application/chisacode-review`; compatibility parsers may still accept
  previous media types.
- New parent-agent labels use `chisacode.parent-agent-id`; compatibility readers may still accept
  previous label names.
- New managed git remotes and auto stashes use `chisacode-pr-` and `chisacode-auto-stash:`;
  compatibility readers may still recognize previous prefixes.
