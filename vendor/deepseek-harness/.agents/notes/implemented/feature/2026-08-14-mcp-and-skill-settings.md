# Agent Note: MCP and Skill settings management

Status: implemented

English | [中文](2026-08-14-mcp-and-skill-settings.zh.md)

## Problem

Harness already connects MCP servers through `dsh-mcp-client` and discovers skills through `dsh-skill-filesystem`, but neither catalog had a Settings management page. Users had to edit `cordis.patch.yml` or skill files by hand. Desktop has no separate persistence for these catalogs: they belong under `$DSH_HOME` and must work for CLI and Web alike.

## Decision

Settings grows two sections: `skills` (order 16) and `mcp` (order 18). Neither writes the user's `cordis.patch.yml`. Desktop only jumps to those sections through the existing `openHarnessSettings('mcp'|'skills')` menu path.

MCP persistence is `$DSH_HOME/mcp-servers.yaml`, owned by `@deepseek-ai/dsh-mcp-servers-file` on the base bundle. The file plugin mounts one `dsh-mcp-client` child per enabled record and reconciles on write or watch. `@deepseek-ai/dsh-host-mcp-servers` publishes Typert Remote `mcpServers` (`list` / `upsert` / `delete` / `setEnabled` / `retry` / `authorize`). `list` unions managed rows with live Loader mcp-client instances. Composition rows are read-only (`origin: 'composition'`). `retry` remounts one managed child without rewriting the file. `authorize` runs MCP HTTP OAuth in the system browser, writes `Authorization` on that managed record, and remounts so the child's tools are registered for chat. Secret-looking env and header keys are masked on list, on managed and composition rows alike; a blank or `********` upsert value keeps the stored secret. An omitted or empty env/headers map keeps previous secret keys and drops non-secret keys; an explicit new map that omits a key deletes that key.

Skill enablement stays the existing SKILL.md frontmatter pair `disable-model-invocation` and `user-invocable`. `@deepseek-ai/dsh-host-skill-inventory` publishes Typert Remote `skillInventory` (`list` / `get` / `create` / `update` / `delete` / `setInvocation`). Every method accepts optional `cwd` and `sessionId`; a present `sessionId` resolves the exact live Agent and reads that Agent's layered `ctx.skills` view, never creating or resuming an Agent, and a missing live Agent throws typed `session-not-found`. `list` omits the composer `isUserInvocable` filter. Writable roots are `user-dsh`, `user-agents`, and — when the current session supplies `cwd` — `project-dsh` / `project-agents`. Project create writes `<project-root>/.dsh/skills/...`, where `project-root` is the nearest `.git` ancestor of `cwd`. Bundled, runtime, and custom skills stay read-only. Create explicitly selects the user or current-project root and writes the caller's initial invocation flags. Update and invocation-only writes preserve frontmatter fields Settings does not own; delete removes the whole skill bundle directory. The catalog follows current-session `sessionId`/`cwd` changes and rejects late responses from the previous session; the client keeps the last known `cwd` per session so a sessions-store rebuild flicker cannot silently rescope a request to the no-project view. Composer `skill.list` is unchanged. `mcpServers/*` and `skillInventory/*` reads and writes are loopback-only; `trustedHosts` remains a DNS-rebinding fence, not authentication.

`@deepseek-ai/dsh-client-ui-settings-mcp` and `@deepseek-ai/dsh-client-ui-settings-skills` register the Settings pages. They share a compact management language: search, one source or enablement filter, result counts, hairline rows, source `Pill`s, the native-semantic shared `Switch`, contextual errors, and icon actions. MCP splits managed rows from read-only composition rows and keeps configured enablement distinct from Host `fiberPhase`; a row with no observed phase is neutral rather than warning-colored. The MCP editor Modal switches between a form and a JSON object. Skills rows show a model-invocation `Switch` and open the existing editor; read-only rows omit delete.

## Alternatives considered

**Write MCP rows into the user's `cordis.patch.yml`.** Rejected because that file may contain `!!js` and other hand-authored composition, and Settings must not become a YAML editor.

**A new skill enablement list beside frontmatter.** Rejected because `dsh-skill-filesystem` already owns invocation flags; a second list would drift from the files the watcher already reloads.

**Desktop `window.shell` APIs for these catalogs.** Rejected because persistence is `$DSH_HOME` and Settings already lives in the Harness Web UI. Desktop only needs the same section jump About and Plugins already use.

**Import Cursor or Claude `.mcp.json` in v1.** Rejected. The managed YAML is reserved for a later importer; v1 only reads and writes its own document.

## Consequences

CLI and Web share one MCP catalog because the file plugin sits on the base bundle. Hand-written mcp-client rows keep connecting and appear in Settings as read-only composition. Skill create/update/delete/setInvocation invalidate the viewed `SkillRegistry`'s cached catalog after the write, so Settings (and any same-registry reader) sees the change on its very next list; the filesystem watcher now only covers external edits. There is no marketplace and no connection-test button: rows report live connection health through the `mcp-client` status registry (`connecting` / `connected` / `reconnecting` / `failed` plus the last attempt error, visible on the row as `connection` on both managed and composition rows), falling back to `fiberPhase` only when no mcp-client instance reports. Settings polls `list` while any row is connecting or reconnecting. Refresh remounts managed children whose reconnect supervisor has given up, then lists again. `$` tokens and the composer picker are unchanged.

## Testing

Host suites cover YAML CRUD, illegal `serverName`, duplicate ids, composition write refusal, managed remount without a YAML rewrite, skill kebab-case, read-only roots, caller-selected invocation flags, unknown-frontmatter round trips, directory deletion, live-Agent `sessionId` resolution, and `session-not-found`. Client tests cover search/filter, flat rows, form/JSON editor, validation, optimistic and duplicate-guarded switches, operation-local failures, in-flight health polling, Refresh remount of given-up managed rows, visible last-attempt errors, user/project create scope, reactive session/`cwd` changes, and stale-response suppression. Connection tests exercise every MCP/Skill slash endpoint through both trusted-host and loopback requests. The assembled Web e2e opens both Settings pages against a live standard-preset session and a temp bundled fixture; it does not save, toggle, or delete MCP rows and starts no stdio process.

## Related

[MCP Settings polls health and remounts given-up children](../bug-fix/2026-08-20-mcp-settings-stale-health.md).
[MCP Settings signs in HTTP servers](2026-08-20-mcp-settings-oauth.md).
