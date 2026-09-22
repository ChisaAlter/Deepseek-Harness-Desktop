# vendor/ — vendored source trees

Index of everything vendored into the desktop app. Per-tree provenance and
divergence notes live in each tree's own `DESKTOP-FORK.md` / `AGENTS.md`.

| Tree | What it is | How the desktop uses it |
| --- | --- | --- |
| `deepseek-harness/` | Official DeepSeek Harness monorepo fork (pin in `harness-upstream.json`; sync via `npm run sync:harness`, build via `npm run setup:harness`). | The entire web UI + CLI runtime. Desktop-owned fork packages (the `DESKTOP_PACKAGES` registered in `src/shared/harness-desktop-forks.js`, e.g. `ui-settings-market`, `ui-surfaces`) live inside this tree and mount through the web-app bundle. |
| `dsh-im/` | First-party build of `@xmanrui/dsh-im` (Remote → 消息渠道 IM UI). | **Desktop built-in**, not a user plugin: `src/main/dsh-im-desktop.js` junctions it into the profile `node_modules` and mounts it via the desktop overlay `desktop-dsh-im.patch.yml` on every start (full + skip). Not disable-able; marketplace installs of the same family are `DROPPED`. |
| `dsh-usage-panel/` | Desktop restyle of the usage statistics panel (settings section `usage-stats`). | Soft desktop preset: `src/main/usage-panel-preset.js` copies it into `desktop-plugins/` and mounts via `desktop-usage-panel.patch.yml` on full starts only (never on skip-user-plugins recovery). See `docs/features/usage-stats.md`. |
| `dshbot/` | Standalone chatbot plugin. | Never force-ensured, never blocks start; default starts only clean legacy preset residue (`removeDshbotPreset`). Dev opt-in `dshbotPreset: true` keeps a workspace copy refreshed. See `docs/features/dshbot.md`. |
| `chisacode-remote/` | Full ChisaCode AGPL source tree powering mobile pairing/relay. | Main process `ChisaCodeRemote` daemon (see `docs/features/mobile-remote.md` and `chisacode-remote/AGPL-SHIPPING.md`). |
| `dshmarket/` | Attribution stub only (LICENSE + `DESKTOP-FORK.md` + marker `package.json`; source snapshot deleted). | Not packaged, not mounted, hidden from the catalog, install rejected (`DROPPED`). The marketplace is desktop-owned code (`ui-settings-market` + main-process engine); see `docs/features/marketplace-settings.md`. |

`harness-upstream.json` records the upstream pin (repo / ref / sha / npm version)
that `sync:harness` and `setup:harness` operate against.

The source baseline is `dsh-v0.1.6-alpha.2` (`ddefc45fbc7f8e46dd73185e68295696d1297887`). Desktop consumers use retained Session references and workspace navigation, including draft transfer before releasing the previous Session. Compatibility decisions and validation gates live in [harness-upstream-sync](../docs/features/harness-upstream-sync.md).

Desktop New Session navigation additionally checks complete Host history before reusing a blank identity. Previously titled or plugin-owned Sessions keep their data and remain explicitly openable, but are never repurposed as new drafts. See the [blank Session reuse decision](../docs/decisions/implemented/bug-fix/2026-09-18-blank-session-reuse.md).

```powershell
cd C:\ai\Deepseek-Harness-Desktop
npm run setup:harness
```
