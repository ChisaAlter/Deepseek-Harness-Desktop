# Agent Note: Sidebar region tabs, dshbot session origin, and session-only model selection

Status: implemented

English | [中文](2026-08-19-sidebar-tabs-dshbot-origin.zh.md)

> The sidebar, session-origin, and session-only model decisions remain current. dshbot's product realization is maintained by the standalone [feature card](../../../../../../docs/features/dshbot.md); that card supersedes this note for installation, group protocol, and editor behavior.

## Problem

The left sidebar was a closed geometry shell: plugins could only replace `sidebar.workspaces` wholesale, so a desktop contact list could not sit beside the official session browser. Sessions created for those contacts would also appear in the workspace list, and `session.selectModel` always wrote the user's global default model.

## Decision

`ui-sidebar` declares a list hole `sidebar.nav.tab` and a keyed hole `sidebar.page`. Occupancy is the only signal that draws the tab strip; zero entries keep New Session and `sidebar.workspaces` with no extra chrome. Selecting a plugin tab hides New Session and fills the region from `sidebar.page` keyed by the tab id. Tab components are not mounted; the shell reads `id` / `label` / `order` from the list ledger. The nav store persists `selectedTab` and falls back to `sessions` when the stored id is gone.

`SessionHeader.origin` is `'subagent' | 'dshbot'`. `session.create` may stamp `origin: 'dshbot'` only; `subagent` remains owned by subagent start. List summaries carry origin, and `sessionVisible` hides both. Client `SessionManager.create` forwards `origin` and `agentPreset` and stamps them on the optimistic row so a dshbot session does not flash in the workspace list. ConversationRoot skips EmptyHero for `origin: 'dshbot'` even while the log is empty: the session header stays visible, the composer docks, and ChatView may fill `conversation.chat.empty`. `connectWorkspace` and `connectNoDirectory` refuse to reuse blank rows whose origin is `dshbot` or `subagent`. The session-header agent-preset label hides on `origin: 'dshbot'`.

`session.selectModel` accepts `persistDefault` (default `true`). Passing `false` keeps the switch on that session and does not write `agent-default-model`.

A room is a shared transcript whose visible bubbles are the user and member deliveries only. Code selects the mentioned members, or everyone, and emits one sequential `ask_participant` call through an `llm/stream` short-circuit that never calls a room chat model. Rounds rotate peer-equal order; `NEXT:` footers are stripped only for legacy display and do not schedule. Rooms contain 2–6 bots. The hard limits are 10 member attempts and 3 rounds; pass, member failure, and replayed calls without results consume attempts, and a full pass round stops. `ask_participant` starts a one-shot spawn child restricted to `send_room_message`, converts member failures to silent pass, awaits the result, and disposes the run. The catalog editor offers non-overlapping persona chips (oppose / fill / ship / sharp), locks workspace selection for established rooms, and contains neither a notification switch nor memory text field; durable memory is written only by `remember`. Room ChatView drops context injection, `Deep diving...`, and turn-tails; InputBar also skips `+`, plan, ContextMeter, and the `$` skill menu. The dshbot `@` source lists members; file, subagent, cordis, and `/` sources return no candidates in `dshbot-room`. InputBar skips `conversation.input.model` when `origin` is `dshbot` or `agentPreset` is `dshbot-room`. The catalog editor is the only model switch for a 1:1 bot. Sidebar rows show the catalog name over the model id (or the deployment-default copy); a room has no preview line and a 群 badge on the avatar. The plugin stamps `dshbot-room` onto each catalog room's session-list row so ChatView and InputBar hide room chrome even when the host summary omitted the preset.

Catalog items may carry `avatar`: a blob `{ kind: 'blob', shape, color }` or a baked image `{ kind: 'image', dataUrl, crop }`. A missing record hashes the item id or name onto one of eight blob shapes. The editor Modal picks shape and color, or uploads a circle/square crop baked as a small JPEG. Sidebar rows think while `session.running`; `ask_participant` bubbles think while the tool has no result. Generate and an avatar store stay out.

dshbot is a standalone dsh plugin installed through the curated desktop marketplace or `dsh plugin add`. The desktop does not preset it. On load the plugin provisions `dshbot-room` under `$DSH_HOME/.agent-presets`; desktop startup removes only legacy desktop-owned residue and preserves profile dependencies, bundles, real directories, and pnpm or marketplace symlinks.

## Alternatives considered

**Occupy `sidebar.workspaces` with the bot list.** That single hole replaces the official project/session browser, and a plugin cannot import `WorkspaceBrowser`.

**Put bot settings on the right-hand surfaces column.** Surfaces are work loops (Files / Browser / Diff), not an IM profile editor. Edit UI uses `shell.overlay` and `Modal`.

**Let several models write one agent-loop.** One session is one Agent. A room is a technical parent whose preset tool starts a one-shot child with each member's model.

**Ask an LLM parent to pick the next speaker.** That is AutoGen SelectorGroupChat and the failed Muse Spark dispatcher. Speaker selection stays in code.

**Ship dshbot as an official `packages/client` package.** That would bind an IM product to the 100% coverage gate and the web-app roster for every `dsh web` install. Desktop copies a vendored plugin instead.

**Stamp `origin: 'subagent'` for 1:1 bot sessions.** Subagent origin is lineage for hidden children. dshbot contacts are parent conversations that must stay out of the workspace list without joining that lineage.

**Derive `composerPhase: 'active'` for an empty dshbot log.** The empty-log bit and first-prompt engaging path stay on `derivePhase`. Origin only skips New Session chrome and blank reuse.

## Consequences

Official Web without the optional plugin is unchanged. Installing dshbot adds a Bots tab whose sessions stay out of the project list; removing it removes that tab. Saving a bot model does not move the coding-session default. The dshbot plugin registers `ask_participant` globally, and the `dshbot-room` preset restricts the room agent to that tool. Execute refuses a caller that is not a catalog room. The room session never speaks; members receive the room history since their last turn and either deliver through `send_room_message` or pass. `ask_participant` cards show the catalog name beside an outside avatar and that member's visible speech; spawned members get a complete child persona so they do not inherit the harness identity line. A dshbot composer has no model seat; a room composer also has no command, plan, meter, or `$` chrome, and `@` lists only members. 1:1 bots take their model from the catalog editor. Bot and room rows show a catalog avatar (blob or cropped image); blob characters morph while that session is running. Opening a never-messaged contact or room shows the conversation chrome and a member roster, not the New Session hero. New Session never lands on those blank rows.

## Testing

`packages/client/ui-sidebar/tests` pin zero-tab chrome and plugin-tab region swap. `packages/client/ui-workspace/tests/tree.client.spec.ts` hides `origin: 'dshbot'`. `packages/host/apiproxy/tests/api-proxy-models.spec.ts` pins `persistDefault: false`. `packages/client/runtime/tests/manager.client.spec.ts` forwards origin on create. `packages/client/ui-conversation/tests/skeleton.client.spec.tsx` skips EmptyHero for a blank `origin: 'dshbot'` session. `packages/client/runtime/tests/workspaces-service.client.spec.ts` refuses blank dshbot/subagent reuse. `packages/client/ui-agent-preset/tests/components.client.spec.tsx` hides the header preset label on `origin: 'dshbot'`. `packages/client/ui-conversation/tests/input-bar.client.spec.tsx` skips `conversation.input.model` when `origin` is `dshbot` or `agentPreset` is `dshbot-room`, and hides `+` / plan / ContextMeter / `$` in a room. `packages/client/ui-conversation/tests/chat-view.client.spec.tsx` skips `Deep diving...`, context injection, and turn-tail chrome in a room. `packages/client/ui-files/tests/path-trigger.client.spec.ts`, `packages/client/ui-subagent/tests/browser-plugin.client.spec.ts`, `packages/client/ui-commands/tests/service.client.spec.ts`, and `packages/client/ui-skill/tests/browser-plugin.client.spec.ts` return no `@` / `/` candidates in `dshbot-room`. Desktop `src/main/dshbot-*.test.js` pin standalone preset cleanup and pnpm-link preservation, room preset install, fixed group limits, attempt-count scheduling, member-failure pass behavior, 2–6 membership, editor cleanup, catalog helpers, avatar normalization, room bubbles, and host registration.
