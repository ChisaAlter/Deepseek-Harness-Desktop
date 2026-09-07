# DSH Mobile Plugin Interaction Review

Date: 2026-09-06
Scope: research for mobile-remote; no product, pairing, or transport changes.

## Evidence Boundary

Discovery used the live [plugin registry](https://awesome-dsh-plugin.com/plugins.json).
Read first-party documentation, implementation and selected test sources. Direct
GitHub retrieval was used when the web search tool returned no usable results.
Inspected author screenshots, not our own runtime screenshots. Images may predate
current source. No plugins installed, upstream code executed, tests run, or devices
paired. Rankings below concern useful references, not proven product maturity.

## Recommended References

### 1. saya-ch/dsh-mobile: shell and task surfaces

The dedicated mobile layout owns a controller while rendering Harness slots for
sidebar, conversation, details, and overlays. It is more than a stylesheet, but
not a completely independent chat implementation.

Implemented behaviors worth borrowing:

- Session selection finishes before the drawer closes, with unwanted editor autofocus suppressed.
- Branch and command actions have targeted soft-keyboard guards.
- Question and plan-review surfaces separate bounded scrolling content from touch-sized action areas.
- Settings become full-height; model text shrinks before fixed composer actions do.
- Test sources cover command focus, history loading, attachment ownership, and reduced motion.

Borrow deliberate focus ownership, stable actions, and reachable approval buttons.
Do not copy its gateway, extension execution, or full-control remote policy. Our
allowlist and pairing architecture differ. Timeout-based focus suppression and
DOM selectors are not reusable primitives. A browser-back contract was not verified.

Sources:

- [Architecture](https://github.com/saya-ch/dsh-mobile/blob/main/README.md)
- [Shell and questions](https://github.com/saya-ch/dsh-mobile/blob/main/src/mobile-layout.ts)
- [Presentation](https://github.com/saya-ch/dsh-mobile/blob/main/src/native-mobile.ts)
- [Layout tests](https://github.com/saya-ch/dsh-mobile/blob/main/tests/mobile-layout.test.ts)
- [Presentation tests](https://github.com/saya-ch/dsh-mobile/blob/main/tests/native-mobile.test.ts)

### 2. mexiaosqwq/dsh-web-mobile: touch and keyboard edge cases

This adapts the official desktop UI, offering concrete regression scenarios rather
than a replacement information architecture.

- Drawer gestures yield to horizontal scrolling and selected text, including input selection handles.
- An iOS composer guard prevents action buttons from reopening a dismissed keyboard through upstream focus handlers.
- Safe areas, touch-primary activation, shrinking labels, scrolling tabs, and reduced motion are considered.
- Gesture tests cover direction, velocity, scrolling ownership, and selected text; keyboard and zoom regression files also exist.

Borrow the rules and test cases. Implement correct focus ownership directly,
instead of shadowing DOM focus. Do not copy the large gesture start zone or
browser-history gesture suppression without a separate decision and device tests.

The author's settings screenshot still has clipped tabs and horizontal overflow.
It illustrates the adaptation, not current polished settings. Current source and
older screenshots must be distinguished.

Sources:

- [README](https://github.com/mexiaosqwq/dsh-web-mobile/blob/main/README.md)
- [Gestures](https://github.com/mexiaosqwq/dsh-web-mobile/blob/main/src/client/effects/sidebar-swipe.ts)
- [Keyboard](https://github.com/mexiaosqwq/dsh-web-mobile/blob/main/src/client/effects/composer-keyboard-guard.ts)
- [Layout](https://github.com/mexiaosqwq/dsh-web-mobile/blob/main/src/client/styles/layout.css.ts)
- [Tests](https://github.com/mexiaosqwq/dsh-web-mobile/blob/main/tests/sidebar-swipe.test.ts)
- [Author chat image](https://github.com/mexiaosqwq/dsh-web-mobile/blob/main/assets/hero.png)
- [Author settings image](https://github.com/mexiaosqwq/dsh-web-mobile/blob/main/assets/settings.png)

### 3. Phant0Meow/dsh-meow-smooth: composing versus reading

Implemented behaviors in the client source:

- Long drafts fold when focus leaves and expand with their saved scroll position.
- Touch Enter inserts a newline; modifier keys and IME composition bypass interception.
- A running-state send control accesses the host's existing steer/queue behavior.
- Keyboard detection uses visual viewport and editable-focus signals rather than physical screen height alone.

Borrow the reading/editing transition, no accidental phone Enter-send, and an
explicit running-state send path when the host supports it. Our textarea already
has native behavior; verify what exists before adding event interception.

Do not copy global zoom locking: the source sets maximum-scale=1 and
user-scalable=no. Preserve user zoom. Much of its editor integration is
textarea-specific, not proof of support for all current upstream editors.
Notifications and compression are separate backend/product changes.

Sources:

- [README](https://github.com/Phant0Meow/dsh-meow-smooth/blob/main/README.md)
- [Client](https://github.com/Phant0Meow/dsh-meow-smooth/blob/main/src/client.ts)
- [Running send](https://github.com/Phant0Meow/dsh-meow-smooth/blob/main/src/run-send.tsx)

### 4. ook826092-cloud/dsh-mobile-css: settings navigation

Settings present a full-screen menu, then hide it when an item opens its content.
The author's screenshots demonstrate both surfaces. This is a useful reference
for replacing cramped columns and crowded category tabs.

Borrow the two-level structure, not its implementation. Source uses literal
generated class names; return is a CSS-generated menu glyph plus a click handler
on the header, not a dedicated back button. Use a labeled back control, retained
selection/scroll, and a tested browser-back contract. Hiding the entire model
label is unsuitable for our current model-and-effort visibility invariant.

Sources:

- [README](https://github.com/ook826092-cloud/dsh-mobile-css/blob/master/README.md)
- [Implementation](https://github.com/ook826092-cloud/dsh-mobile-css/blob/master/lib/index.js)
- [Author menu image](https://github.com/ook826092-cloud/dsh-mobile-css/blob/master/assets/mobile-settings-menu.jpg)
- [Author detail image](https://github.com/ook826092-cloud/dsh-mobile-css/blob/master/assets/mobile-settings-visual.jpg)

## Other Candidates

- [AcidGr/dsh-web-mobile-fix](https://github.com/AcidGr/dsh-web-mobile-fix/blob/main/README.md): explicitly a CSS overlay. Full-screen settings and a fixed directory footer are useful; centering every menu and hiding model names do not solve our task-flow problem. README-level review only.
- [jasondu/dsh-ui-mobile](https://github.com/jasondu/dsh-ui-mobile): see the [focused source review](2026-09-06-dsh-ui-mobile-source-review.md). PWA features are not evidence of good navigation.
- [dsh-web remote UI](https://github.com/zhu1090093659/dsh-web/blob/main/packages/dsh-remote-web-ui/README.md): current README describes the official GUI plus portrait-touch adaptation, unlike the registry description of separate mobile/full interfaces. Its full-control remote policy is not ours. Do not change our SPA or transport based on a catalog summary. README-level review only.

## Application To DSHD

Proposals, not shipped invariants:

| Our surface | Proposed treatment | Reference |
| --- | --- | --- |
| Settings | Full-screen list to detail, explicit back and close | mobile-css structure |
| Model and permissions | Consistent short bottom panel, current choice and effort visible | Existing DSHD contract plus picker design |
| Directory and Git forms | Task surface, stable header/footer, scrolling content | saya-ch action separation plus our workflow needs |
| Session drawer | Select then dismiss, retain position, no implicit keyboard | saya-ch shell |
| Composer | Stable controls and deliberate editing, preserved draft/scroll | meow-smooth and mexiaosqwq |
| Gestures | Selection and code/table scrolling take precedence | mexiaosqwq guards |
| Back and close | One ordered navigation contract and browser-back tests | Our gap, not a proven borrowed capability |

Keep our design tokens, offer-v2 pairing, sticky state, host/Git allowlists, and
signed deferred capabilities. Most candidates attach to the official plugin tree;
our remote SPA does not. Installing their styles is not a drop-in solution.
Implement selected interaction rules within our owned components.

Before implementation: update the design-language document, confirm expanded
allowed touch if needed, then update the feature card for shipped changes.
Acceptance must cover browser back, nested returns, keyboard opening/closing,
long labels/lists, selected text, code/table scrolling, failures, retained drafts,
reduced motion, and real phones. This research passed none of those runtime gates.
