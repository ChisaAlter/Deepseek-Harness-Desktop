# Decision: Share live state between the session stats switch and strip

Status: implemented

[中文](2026-09-29-session-stats-live-toggle.md) | English

## Problem

Interface settings update the switch immediately through ComposerSubmissionPolicy, while ui-chat maintained a separate strip preference from Host configuration. During the write, the switch was off while the figures remained visible. The running application showed a delay exceeding one second, and a cross-plugin regression reproduced the divergence.

The policy also unconditionally adopted whole-namespace pushes while the three dock switches were being saved. During rapid toggles, an older push could overwrite a newer unsaved selection. A superseded completion for the same switch cannot represent its latest click either. Sharing the statistics source alone does not eliminate these reversals.

Decision audit: the existing [interface visibility decision](../../../../vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-19-interface-settings-chrome-visibility.md) owns the switch and retained-gap semantics. This repair completes live propagation across plugins without replacing that decision. No decision in the desktop proposed, implemented, or rejected trees owned this live propagation path.

## Decision

The conversation.composer.dock slot injects ComposerSubmissionPolicy.statsLine directly. StatsPills subscribes to that source through the framework-generated useStatsLine hook; ui-chat removes its separate configuration mirror. The switch publishes before Host persistence, while the original policy continues adopting loaded and externally updated configuration.

Turning the switch off preserves the row gap and hides figures and interactions; turning it on restores the figures. Cost and peak/valley rows retain their own switches, and accounting remains unchanged.

The policy records the latest write identity separately for statsLine, sessionCost, and officialPeakValley. It retains the live choice until Host acceptance and reflection in the shared configuration mirror, including writes that settle before a later namespace write publishes their result. Superseded completions do not release a newer write's protection. Latest refusals or rejections restore confirmed configuration; external updates resume after confirmation, and disposal prevents further publication.

## Alternatives considered

- Continue waiting for Host confirmation: this needs less slot declaration code, but leaves the immediate switch and strip divergent during slow writes, so it is rejected.
- Add a cross-plugin service or global event: this could broadcast changes, but the existing dock already hosts the strip and can inject its owned state, so an extra channel is rejected.
- Release protection as soon as a request returns: the shared ConfigForm can defer publishing responses superseded by later writes, exposing an older mirror. Wait for both acceptance and reflection instead.

## Consequences

The strip follows the switch without depending on write latency. The dock type contract gains an observable preference consumed through derived props. Regressions cover old pushes, interleaved writes to all three fields, repeated same-field toggles, superseded success and failure, latest failure recovery, external updates, and disposal. Existing component tests cover retained spacing and the cost/peak visibility matrix. This repair does not rewrite settings persistence or change the switches' product dependencies.
