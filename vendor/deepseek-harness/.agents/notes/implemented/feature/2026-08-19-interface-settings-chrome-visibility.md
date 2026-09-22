# Agent Note: Interface Settings chrome visibility

Status: implemented

English | [中文](2026-08-19-interface-settings-chrome-visibility.zh.md)

## Problem

Titlebar Session log, Git, and panel toggles, plus the composer send/think border beam, had no product switch. Hiding a button by unmounting its owner would also drop `/export`, Git toasts and dialogs, and `Ctrl+\`` / `Ctrl+\\`. Treating a missing Host section as false would hide every control during loading and on remote `memory` scopes.

## Decision

Settings registers an Interface section (`settings.section` id `interface`, order 6, Chinese 「界面设置」 / English `Interface`) that only `renderSlot`s `settings.interface.item`. `ui-settings-general` owns that empty shell. Each feature package owns its Host boolean and Switch row. Chrome fields default `true`; `composerResize` defaults `false`:

| Field | Host namespace | Row id / order |
|---|---|---|
| `titlebarAction` | `session-log-export` | `session-log-export` / 10 |
| `titlebarGit` | `ui-git` | `titlebar-git` / 20 |
| `terminalToggle` | `ui-titlebar` | `terminal-toggle` / 30 |
| `surfacesToggle` | `ui-titlebar` | `surfaces-toggle` / 40 |
| `composerBeam` | `ui-conversation` (`ConversationSettingsSchema`) | `composer-beam` / 50 |
| `composerResize` | `ui-conversation` (`ConversationSettingsSchema`) | `composer-resize` / 60 |
| `statsLine` | `ui-conversation` (`ConversationSettingsSchema`) | `stats-line` / 70 |
| `viewTabs` | `ui-conversation` (`ConversationSettingsSchema`) | `view-tabs` / 80 |

Visibility is `snapshot.value?.[field] !== false`. Loading, unavailable, `value === undefined`, and remote `memory` keep the local show-default. `composerResize` is the exception: it is opt-in (`=== true`) because the shipped composer auto-grows with no drag handle, and a missing Host field must not enable resize on first paint. A Switch write publishes locally, then `host.set`. Remote `writable: false` disables the Switch and still shows chrome.

Hiding a button does not unload the owner. Session log hides the titlebar capsule; the Dialog stays mounted for `/export`. Git hides the init / branch / commit cluster; Toast, Commit, Publish, and confirm Modal stay mounted. PanelToggles never returns `null`: each hidden button is omitted, an empty cluster is not painted, and the keydown listener stays attached. InputBar adds `.cardBeam` / `data-beam` only when `beamLive && composerBeam`. Turning `composerResize` off removes the top/left/right edge handles on InputBar and ApprovalPanel and any inline scrollport height or card width, including `--dsh-composer-resized-*` on `[data-composer-seat]`; the textarea, mirror stack, and 14-line auto-grow stay. Turning `statsLine` off hides StatsLine figures with `visibility: hidden` and keeps the composer-dock row gap; the dock registration and `sessionStats` / `tokenUsage` projections stay. An empty session with no figures still renders nothing. Turning `viewTabs` off omits the header tablist; `views.list()` still includes Chat and Trajectory, and the active view stays (including Trajectory). Turning a panel switch off does not close an already-open drawer or column.

Bound settings fibers inject `connection`, `remote`, and `settingsScope`. The composer beam and resize stores are `ComposerBarInjected.hooks.composerBeam` and `composerResize`, beside `notices`, not `busyEnter`. ApprovalPanel reads that same resize store as `ApprovalComposerInjected.hooks.composerResize`. The stats-strip store is `StatsLineInjected.hooks.statsLine`. The tablist store is `ConversationSessionHeaderInjected.hooks.viewTabs`.

## Alternatives considered

**Register git / session-log / beam / panel fields on `ui-settings-general`.** Rejected: that package's Host surface is `ui-onboarding` only; feature-owned rows stay with the feature.

**A closed `InterfaceSection` that paints five switches.** Rejected: the General page already uses `settings.general.item`; Interface follows that list slot.

**A new `ui-interface` Host namespace.** Rejected: `composerBeam` belongs on the existing conversation section; each chrome owner already has a namespace.

**`if (!value?.git) return null` on the whole Git / Session-log / PanelToggles component.** Rejected: a missing section would hide chrome on first paint and remote Web, and unmounting Git or Session log drops in-flight UI that `/export` and busy Git still need.

## Consequences

Interface Settings is the stacking page for titlebar chrome, the composer beam, composer drag-resize, the session stats strip, and the Chat/Trajectory tablist. Crowding density still keys off conversation column width; Git and the panel toggles leave the cluster only when their Interface switches are off. Sidebar, other composer buttons, Surfaces toolbars, window controls, and the Settings gear are not on this page.

## Testing

Host specs pin each chrome schema default `true` and reject a non-boolean; `composerResize` defaults `false` and also rejects a non-boolean. ChromeVisibility (and `ComposerSubmissionPolicy` for the beam, stats strip, and view tabs) pin loading / memory / missing-field show, a local Switch write before `host.set`, and hide only on explicit `false`. `ComposerSubmissionPolicy` pins `composerResize` loading / memory / missing-field off and on only for explicit `true`. GitActionsControl hides the cluster while an init toast and a commit dialog stay mounted. HeaderAction hides the capsule and still opens the Dialog from `request()`. PanelToggles with both switches off keeps `Ctrl+\`` / `Ctrl+\\` and paints no `[data-panel-layout-controls]`. InputBar `running` plus `composerBeam: false` has no `data-beam`. InputBar and ApprovalPanel default have no `[data-composer-resize-handle]`; `composerResize: true` shows top/left/right handles, a top-edge drag sets the occupied scrollport height, and a side-edge drag sets the card width. ApprovalPanel adopts and publishes that size on `[data-composer-seat]`. StatsLine with `statsLine: false` keeps the dock row and hides figures (`data-stats-line="hidden"`). ConversationSessionHeader with `viewTabs: false` paints no `tablist` while the active view, including Trajectory, still renders. Apply specs pin three `ui-settings-general` sections and each feature's `settings.interface.item` rows. Settings nav snapshots include 「界面设置」 / `Interface`.

## Related

[Titlebar crowding density](../bug-fix/2026-08-17-titlebar-crowding-density.md). [Host-backed Web preferences](../bug-fix/2026-08-06-host-backed-web-preferences.md). [Approval takeover follows composer resize](../bug-fix/2026-08-20-approval-panel-composer-resize.md).
