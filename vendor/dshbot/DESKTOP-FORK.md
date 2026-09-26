# DESKTOP-FORK.md — vendor/dshbot 桌面分歧

Vendored `dshbot` is the shipping implementation for the desktop's optional
「机器人（Bots）」feature (`dshbotEnabled`, default off). It is mounted only via
the desktop overlay `desktop-plugins/dshbot/desktop-dshbot.patch.yml`; the
standalone repo `C:\Ai\dshbot` (`ChisaAlter/dshbot`) no longer tracks this tree —
syncing from it would overwrite the divergences below. Full context:
`docs/features/dshbot.md` and
`docs/decisions/implemented/bug-fix/2026-09-25-vendored-plugins-017-contract-drift.md`.

## Divergences vs standalone (Harness 0.1.7-rc.2 port)

- `package.json`: `@deepseek-ai/dsh-*` peer pins widened from exact
  `0.1.5-rc.2` to `^0.1.5-rc.2` for the Loader compatibility gate.
- `lib/catalog-scope.js`: catalog persistence ported off the removed
  `SettingsForms.register`/`update` path. The seven catalog fields are
  `.volatile().hidden()` Config fields projected by `describe()` as ns
  `dsh-bot`; writes atomically persist `$DSH_HOME/dshbot-catalog.json`
  (tmp+rename, counter-suffixed) then commit in place via
  `entry.update({config})`. A fiber-scoped `loader/volatile-update` listener
  reseeds the live catalog after external `reconcileProfilePatches` resets.
  Corrupt files are quarantined as `dshbot-catalog.rejected-*`.
- `lib/index.js`: `internal/status` ACTIVE hook runs restore → blob-avatar
  migration.
- `lib/control-plane.js`: `/dshbot` is self-mounted via
  `webServer.register` + `connection.admit` + a local client-request envelope
  bridge — `connection.rpc.handle` cannot serve external callers (its captured
  owner ctx lacks the `webServer` inject).
- `client/client.js`: `settingsScope` service removed in 0.1.7 → injects
  `configForms`; `uiSession.pendingInteractions` removed → projects
  `sessionStatus` with reference-memoized snapshots; writes go through the
  `/dshbot` RPC instead of `remote.settings.mutate`.
