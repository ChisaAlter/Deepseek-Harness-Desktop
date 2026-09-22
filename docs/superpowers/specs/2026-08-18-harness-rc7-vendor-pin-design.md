# Harness rc.7 vendor pin

Reference for how Deepseek-Harness-Desktop records the official DeepSeek Harness baseline, merges a new official commit into `vendor/deepseek-harness/`, and keeps desktop forks, npx, node-pty, and pack assertions on one version.

## Pin

[`vendor/harness-upstream.json`](../../../vendor/harness-upstream.json) sits outside the vendor prefix and is the currently integrated official baseline, not the in-progress target.

The file has exactly four keys:

```json
{
  "repo": "https://github.com/deepseek-ai/deepseek-harness.git",
  "ref": "47f943859bef60e4160492346772ded9b24f765a",
  "sha": "47f943859bef60e4160492346772ded9b24f765a",
  "npm": "0.1.0-rc.5"
}
```

`sha` is a 40-character lowercase hex commit.
`ref` is the fetched tag, branch, or commit the operator passed; the first pin uses the rc.5 commit as both `ref` and `sha`.
`npm` is the `version` field from that commit's `apps/cli/package.json`, never a substring of the tag name.
A later successful apply of `dsh-v0.1.0-rc.7` (`99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`) rewrites the same four keys; the next sync uses `pin.sha` as the official merge base.

The first rc.5 pin is trusted only when `47f943859bef60e4160492346772ded9b24f765a^{tree}` equals `d2df50d17fdca6547e14264efc2cf4fc526e9a7a^{tree}`.

## Sync algorithm

`npm run sync:harness` requires `--ref` and `--sha` together.
There is no default `master`.
The command does not run `git subtree pull --squash`, `--allow-unrelated-histories`, or `git replace` on the main worktree, and it does not create a git commit.

`sync` / `--dry-run` / `--continue` / `--abort` are exclusive modes.
`--dry-run` still requires `--ref` and `--sha`.

1. Refuse unless `git status --porcelain` is empty, including untracked files.
2. Create `refs/backup/harness-pre-sync` pointing at current HEAD.
3. Fetch the requested ref from the existing `upstream-harness` remote if present, otherwise from `pin.repo`. Peel the ref to a commit and require it equal `--sha`.
4. When `pin.sha` is the rc.5 commit, enforce the squash-tree witness above.
5. Read `HEAD:vendor/deepseek-harness` and create an unreferenced synthetic ours commit with `git commit-tree <oursTree> -p <pin.sha>`.
6. Add a detached worktree at `<git-dir>/dsh-harness-sync-worktree` on that synthetic commit.
7. In that worktree run `git merge --no-commit --no-ff <targetSha>` so Git three-way-merges against the real official parent.
8. On conflict, write `.git/dsh-harness-sync.json` with `worktree`, `backupRef`, `targetRef`, `targetSha`, `syntheticOurs`, and `pinBefore`, print the worktree path, and leave the main index, worktree, and pin unchanged.
9. On a clean merge, or after `--continue` once the operator has staged resolutions in the temp worktree, `git write-tree` in that worktree is the merged vendor tree.
10. Build a candidate root tree with a temporary `GIT_INDEX_FILE`: read HEAD, remove the cached `vendor/deepseek-harness` prefix, then `git read-tree --prefix=vendor/deepseek-harness/ <mergedTree>`.
11. `git diff-tree --name-only HEAD <candidate>` must contain only paths under `vendor/deepseek-harness/`.
12. Re-check that the main worktree is still clean, then `git checkout <candidate> -- vendor/deepseek-harness`.
13. Write the pin with the new `ref`, `sha`, and `npm` from the target commit.
14. `--dry-run` stops before checkout, deletes the temp worktree, writes neither state nor pin, and reports the name-status plus conflicts.
15. `--abort` removes the temp worktree, the state file, and the backup ref; main and pin stay unchanged.
16. A successful apply keeps the backup ref until verification finishes.

## Desktop forks

Desktop customization stays inside `vendor/deepseek-harness/`.
This change does not extract an overlay or patch tree.

These packages must remain after every sync, and each `package.json` `version` must equal `pin.npm`:

- `@deepseek-ai/dsh-client-ui-agents-panel`
- `@deepseek-ai/dsh-client-ui-diff`
- `@deepseek-ai/dsh-client-ui-files`
- `@deepseek-ai/dsh-client-ui-git`
- `@deepseek-ai/dsh-client-ui-message-edit`
- `@deepseek-ai/dsh-client-ui-preview`
- `@deepseek-ai/dsh-client-ui-settings-mcp`
- `@deepseek-ai/dsh-client-ui-settings-remote`
- `@deepseek-ai/dsh-client-ui-settings-skills`
- `@deepseek-ai/dsh-client-ui-surfaces`
- `@deepseek-ai/dsh-client-ui-titlebar`
- `@deepseek-ai/dsh-client-ui-user-terminal`
- `@deepseek-ai/dsh-host-mcp-servers`
- `@deepseek-ai/dsh-host-skill-inventory`
- `@deepseek-ai/dsh-llm-vision-fallback`
- `@deepseek-ai/dsh-mcp-servers-file`
- `@deepseek-ai/dsh-client-ui-directory-picker-browse`
- `@deepseek-ai/dsh-host-directory-picker-browse`

`ui-settings-remote` may stay commented in the web-app patch; the package directory must still exist.

Composition is anchored by row `id` and `name`, never by line number:

- `packages/bundle/base/cordis.patch.yml` keeps `llm-vision-fallback` with `maxOutputTokens: 2048` and `timeoutMs: 120000`, and keeps `mcp-servers-file`.
- `packages/bundle/web-app/cordis.patch.yml` keeps `directory-picker` pointed at `@deepseek-ai/dsh-host-directory-picker-browse`.
- The same file keeps host rows `mcp-servers` and `skill-inventory`.
- The same file keeps `ui-titlebar`, `ui-git`, `ui-user-terminal`, `ui-surfaces`, `ui-files`, `ui-diff`, `ui-preview`, and `ui-agents-panel` after `ui-sidebar`.
- The same file keeps commented `ui-settings-remote` and enabled `ui-settings-mcp` / `ui-settings-skills` after `ui-settings-plugin-inventory`.
- The same file keeps `ui-message-edit` after `ui-conversation`.
- The same file keeps `ui-directory-picker-browse` after `ui-workspace`.

`packages/bundle/web-app/package.json` lists every package name above as a workspace dependency.
`packages/client/ui-layout` keeps slots `surfaces`, `shell.titlebar.trailing`, and `shell.terminalDrawer`.
`packages/client/web-react` `session-maybe` stores bind the empty string when no session is selected.
`ui-settings-plugins` uses the official keyed card ledger; list-plus-id semantics are not restored.

Generated catalogs, third-party notices, and module graphs are rebuilt by the vendor generators after source is stable.
Pure mode and symlink type differences follow the official tree unless the path is a desktop implementation.

## Lockfile and node-pty

Official rc.7 uses `node-pty@1.2.0-beta.15` and `patches/node-pty@1.2.0-beta.15.patch`.

On a lockfile conflict, take the official `pnpm-lock.yaml`, keep local desktop package manifests and `packageManager: pnpm@11.8.0`, then run desktop-root pnpm 11.8.0 `install --lockfile-only` so the desktop importers return, then `install --frozen-lockfile`.
The old `node-pty@1.1.0` patch and patchedDependencies key do not remain.
The desktop root `optionalDependencies.node-pty` is the exact version `1.2.0-beta.15`.
`build.npmRebuild` stays `false`.

## Shell alignment

`scripts/setup-harness.js` clones missing vendor trees with `git clone --depth 1 --branch <pin.ref> <pin.repo>` and refuses to continue unless `HEAD` equals `pin.sha`.
An existing vendor tree only runs `pnpm install --frozen-lockfile` and `pnpm run build`.

`src/main/dsh.js` `buildLaunch` uses `@deepseek-ai/dsh@${pin.npm}` on the npx path.
Missing Node text is `Node.js 22.19+ 或 24+`.
Source launch stays first.
The npx path is the official published CLI and does not include the desktop packages.

`scripts/after-pack.js` fails the installer when vendor root `package.json` or `apps/cli/package.json` is not `pin.npm`, or when the Electron 43 node-pty prebuild is absent.

Desktop `package.json` version stays `0.2.3`.

## Verification

`src/shared/harness-upstream.js` and `src/shared/harness-sync.js` are covered by `npm test`.
Sync integration tests prove: success changes only the vendor prefix plus the pin; conflict leaves main and pin unchanged; `--continue` updates the pin; `--abort` restores the pre-sync main state.

Desktop checks are `npm test`, `npm run setup:harness`, `npm run smoke:source`, `npm run pack`, and `npm run smoke:packaged`.
Source smoke must show titlebar Git, the surfaces column, the terminal drawer, settings MCP/Skills cards, and PTY create/write/kill.

Vendor checks are `pnpm run constraints`, `pnpm run test:gui`, `DSH_SNAPSHOT=replay pnpm run test:web`, `pnpm run verify-client-catalog`, `pnpm run gen-third-party-notices --check`, and `pnpm run doc-sync`.

After those pass, delete `refs/backup/harness-pre-sync`, the temp worktree, and `.git/dsh-harness-sync.json`.
Do not use `git reset --hard` as the cleanup path.

## Out of scope

This work does not follow `master`, does not ship a new desktop version, does not extract desktop plugins into an overlay, does not restore `git subtree pull --squash` as the sync path, does not remove the npx fallback, and does not replace the desktop `ui-layout` shell with the official three-column layout.
It does not run user-invoked `dsh-translate-docs`.
