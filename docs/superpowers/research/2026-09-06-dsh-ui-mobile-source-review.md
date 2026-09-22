# dsh-ui-mobile: bounded mobile interaction source review

Research date: 2026-09-06. Research only; no product contract or implementation changes.

## Evidence and limits

- Repository: `jasondu/dsh-ui-mobile` only. Registry entries and other plugins were not inspected.
- Inspected HEAD: **`3ba0c08c8a1cb542861768f499f558d5a1df6b72`**, committed **2026-08-18T14:12:30Z**; checked-in package version **0.1.7**. This pins source, not the published npm artifact. [Commit][commit], [package][package].
- A background research agent inspected the source and wrote this focused assessment; the coordinating agent reviewed the report alongside the broader plugin comparison.
- Repeated `web.run` open/search attempts returned empty results. Primary evidence was therefore obtained through read-only GitHub API and raw-content requests. The immutable links below are direct source citations, not fabricated web-tool citation handles.
- The recursive tree and both READMEs contained no mobile UI screenshots or demo captures; the checked-in image assets were three PWA icon PNGs. This is not a rendered visual-quality assessment. [Tree][tree], [README][readme].
- **No upstream installation, build, execution, browser test, device test, or test-suite run occurred.** Tests were read as evidence of intended coverage only. This bounded assessment does not establish behavior inherited from the external Harness host.

## Assessment

Borrow selected interaction patterns, not the plugin. The README correctly identifies it as a Harness Web plugin, not a standalone application. Its browser entry uses Harness layout, slots, and sessions; its server entry supplies PWA routes and HTML injection. Those integration layers do not belong in our independently served, paired remote SPA. [README][readme], [client entry][client], [host entry][host].

## Navigation, overlays, and Back

- **Implemented:** below 768px, the center becomes a single column. The left drawer is `min(78vw, 300px)`; the right details drawer is `min(100vw, 480px)`. Both use fixed positioning and 240ms transforms; reduced-motion removes their transitions. There is no implemented bottom navigation bar in the current client registrations, despite the stale package description mentioning one. [Styles][styles], [client entry][client], [package][package].
- **Navigation continuity:** an icon-only menu appears in ordinary session headers. A separate body-portaled menu appears for absent/blank sessions when the ordinary header is absent. Both toggle the existing host sidebar. This is useful for avoiding an empty-chat navigation dead end. [Header menu][header], [blank-session menu][blank].
- **Edge opening:** one touch must start within the leftmost 24px, travel at least 56px right, and stay within 32px vertical drift; recognition requires phone width and a closed sidebar. Listeners are passive. This is a threshold-triggered open action, not a finger-tracked drawer animation or swipe-to-close implementation. Coexistence with native edge-back gestures remains untested. [Gesture][gesture].
- **Dismissal:** the plugin's labeled scrim button exists only for an open sidebar. It toggles that sidebar. Details state is observed and styled, but no details trigger, details-specific scrim, or details close action is registered by this plugin; those depend on the host. The source does not automatically close either drawer when the other opens or when a session is selected. Do not describe host-dependent behavior as independently verified. [Scrim][scrim], [frame][frame], [client entry][client].
- **Back rules absent from inspected plugin source:** no `popstate`, history manipulation, `Escape` handling, modal focus trap, background `inert`, or focus-restoration policy was found. The state permits both drawers to be open. A standalone SPA needs its own overlay stack and browser/Android Back contract; CSS off-canvas transforms do not supply that contract. [Frame][frame], [client entry][client], [scrim][scrim], [source inventory][tree].
- **Layering and accessibility limits:** declared drawer/scrim/composer z-indices are 40/35/31, but actual stacking across the host's overlay context was not rendered. Menu controls are 36px square; tooltips are hidden across the phone page. The install banner and push prompt use body portals and maximum z-index without an explicit shared overlay priority policy. Treat touch comfort, focus order, and overlapping chrome as validation items, not a passed quality claim. [Styles][styles], [header CSS][header-css], [scrim CSS][scrim-css], [install CSS][install-css], [push CSS][push-css].

## Keyboard, safe areas, and composer

- **Implemented layout:** phone roots use `100dvh`; the composer seat becomes fixed at `bottom: 0`; transcript padding reserves `--dsh-composer-height` with a 152px fallback. The live height variable is supplied by the host, not measured by this plugin. Overscroll rules reduce scroll chaining. These are useful layout intentions, not proof that the composer tracks every virtual keyboard correctly. [Styles][styles].
- **Safe areas are partial:** `viewport-fit=cover` is injected. Explicit `safe-area-inset-top` occurs on the blank-session menu and install/push prompts. No bottom/left/right safe-area adjustment or `visualViewport` listener was found in this plugin. Any composer bottom inset or additional keyboard handling inherited from Harness remains outside this review. [Host entry][host], [blank CSS][blank-css], [install CSS][install-css], [push CSS][push-css], [styles][styles].
- **Composer adaptation:** center-column editing controls are set to 16px; session-log download is hidden; toolbar wrappers become `display: contents` to place Access mode last. A mutation observer marks matching textareas with `enterkeyhint="send"`. This changes a keyboard hint only: it implements no submission, queueing, attachments, IME protection, stop action, or remote transport. Preserve those behaviors in our existing composer rather than attributing them to this plugin. [Styles][styles], [send hint][send], [frame adapter][frame].
- **Focus workaround is not established browser behavior:** the guard blurs an `INPUT` within the composer card only when its `focusin` event is untrusted. Its tests dispatch synthetic focus events or supply a chosen `isTrusted` value; they do not validate the assumption that real scripted focus is distinguishable from taps this way. Do not port the heuristic as a proven keyboard fix. The guard and send-hint installer also check the phone breakpoint only at installation, unlike the responsive frame controller. [Focus guard][focus], [focus tests][focus-tests], [send hint][send].
- **Do not borrow the zoom lock:** host metadata sets `maximum-scale=1, user-scalable=no`, while document listeners prevent pinch/multi-touch gestures on phone widths. This removes a user magnification route and conflicts with an accessible remote work surface. Prefer readable controls and validate permitted user zoom. [Host entry][host], [zoom lock][zoom].
- **Host coupling:** frame columns are discovered from the parent of `[data-shell-overlay]` and stamped by child order. Control discovery matches English `Session log` text and English/Chinese Access mode ARIA prefixes, then walks parent nodes. Whole-body child mutations trigger these scans. Our SPA should own stable markup/state directly instead of importing these compatibility assumptions. [Frame adapter][frame].

## PWA: implemented versus claimed

**Implemented, not merely promotional:** the host entry injects PWA metadata and a boot placeholder, serves a manifest/icons, registers `/sw.js`, and provides push routes. Install state supports a retained browser install event, iOS guidance, and persistent dismissal. The manifest uses `display: fullscreen`. These are real source implementations, but installation, offline launch, and notification delivery were not tested. [Host entry][host], [install controller][install].

**Documentation drift:** `docs/pwa-host.md` says a host patch is required and the plugin alone cannot supply installability, whereas the current README and host entry describe and implement packaged host-side provisioning. The README also groups the service worker under `/pwa/`, but its actual route and registration are `/sw.js`. Use current source for route ownership; do not apply the historical patch based solely on that document. [Legacy document][legacy], [README][readme], [host entry][host], [registration][sw].

### Risks for our standalone remote SPA

1. **Cache scope is too broad.** The generated service worker handles same-origin GETs with cache-first behavior except `/` and `/index.html`, which are network-first. There is no API/auth/session-route exclusion. It also deletes every origin cache whose name differs from its single cache name. Recommendation: static-asset allowlisting, app-specific cache cleanup, and explicit exclusion of remote/session/auth data. Source establishes the risky strategy; no live data leak was tested. [Worker generator][host].
2. **Root-path assumptions:** manifest identity, start URL, scope, worker registration, asset paths, push requests, and cold-launch destination assume `/`. They are not directly suitable for our separately deployed SPA or `/dshd/` entry. A cached shell is not offline access to a remote host, and this worker contains no offline prompt queue. [Host entry][host], [registration][sw], [push client][push-client].
3. **Registration lifecycle:** worker registration is attached only to the future window `load` event and failures are swallowed. There is no already-loaded-document branch, which is a risk for late plugin loading; whether the host actually mounts it late was not tested. [Registration][sw], [registration tests][sw-tests].
4. **Push routing and installed-state mismatch:** a warm notification click focuses the first window and posts a session ID; a cold click opens `/` without preserving that ID. Push installation detection checks `standalone` but not `fullscreen`, while the manifest requests fullscreen and the install controller recognizes both. This can suppress push affordances when only fullscreen matches. These are source-level limitations, not device-tested failures. [Host entry][host], [push client][push-client], [install controller][install].
5. **Push authorization is host-specific:** successful `turn/end` events trigger delivery to the stored subscription set; the sender does not partition subscriptions by paired device, user, or workspace. Host access controls were not inspected. Do not transplant its server routes, subscription store, or event fan-out into our paired remote security model. [Host entry][host], [push sender][push-host].

## Borrow without host APIs

These are recommendations derived from the source above, not shipped changes:

- Keep one reachable menu action in populated and empty chat states; retain a deliberate outside-tap strip next to a compact drawer.
- Use explicit SPA-owned drawer state, mutually exclusive panels where appropriate, and a single topmost-overlay Back/close/focus-restoration policy.
- Keep composer movement independent of transcript overscroll, measure its height in our own UI, and reserve matching transcript space. Validate keyboard and all safe-area edges on devices.
- Use readable editing text, a send keyboard hint, and reduced-motion drawer transitions while preserving our existing IME, draft, send/stop, approval, and disconnect contracts.
- Separate optional install guidance from conversation controls. Implement any PWA assets in our own serving layer with base-path-aware URLs and a static-only cache policy.
- Do not import Harness slots/services, Cordis patches, DOM-discovery adapters, push host APIs, or the upstream visual skin. Preserve our design tokens and remote capability boundaries.

## Remaining verification

Unverified: real phone layout and stacking, keyboard animation, landscape/notches/home indicator, native back gestures, focus and screen-reader behavior, resize across the breakpoint, details dismissal inherited from the host, install prompts, offline upgrades, and notification cold starts. CSS-text, jsdom, and worker-sandbox tests in the repository are not substitutes for these checks, and none was executed here. [Style tests][style-tests], [focus tests][focus-tests], [host tests][host-tests].

[commit]: https://github.com/jasondu/dsh-ui-mobile/commit/3ba0c08c8a1cb542861768f499f558d5a1df6b72
[tree]: https://api.github.com/repos/jasondu/dsh-ui-mobile/git/trees/3ba0c08c8a1cb542861768f499f558d5a1df6b72?recursive=1
[package]: https://github.com/jasondu/dsh-ui-mobile/blob/3ba0c08c8a1cb542861768f499f558d5a1df6b72/package.json
[readme]: https://github.com/jasondu/dsh-ui-mobile/blob/3ba0c08c8a1cb542861768f499f558d5a1df6b72/README.en.md
[client]: https://github.com/jasondu/dsh-ui-mobile/blob/3ba0c08c8a1cb542861768f499f558d5a1df6b72/src/client/index.ts
[host]: https://github.com/jasondu/dsh-ui-mobile/blob/3ba0c08c8a1cb542861768f499f558d5a1df6b72/src/index.ts
[styles]: https://github.com/jasondu/dsh-ui-mobile/blob/3ba0c08c8a1cb542861768f499f558d5a1df6b72/src/client/mobile.module.css
[header]: https://github.com/jasondu/dsh-ui-mobile/blob/3ba0c08c8a1cb542861768f499f558d5a1df6b72/src/client/HeaderMenuButton.tsx
[blank]: https://github.com/jasondu/dsh-ui-mobile/blob/3ba0c08c8a1cb542861768f499f558d5a1df6b72/src/client/NewSessionMenuButton.tsx
[gesture]: https://github.com/jasondu/dsh-ui-mobile/blob/3ba0c08c8a1cb542861768f499f558d5a1df6b72/src/client/edge-swipe.ts
[scrim]: https://github.com/jasondu/dsh-ui-mobile/blob/3ba0c08c8a1cb542861768f499f558d5a1df6b72/src/client/DrawerScrim.tsx
[frame]: https://github.com/jasondu/dsh-ui-mobile/blob/3ba0c08c8a1cb542861768f499f558d5a1df6b72/src/client/frame.ts
[header-css]: https://github.com/jasondu/dsh-ui-mobile/blob/3ba0c08c8a1cb542861768f499f558d5a1df6b72/src/client/HeaderMenuButton.module.css
[blank-css]: https://github.com/jasondu/dsh-ui-mobile/blob/3ba0c08c8a1cb542861768f499f558d5a1df6b72/src/client/NewSessionMenuButton.module.css
[scrim-css]: https://github.com/jasondu/dsh-ui-mobile/blob/3ba0c08c8a1cb542861768f499f558d5a1df6b72/src/client/DrawerScrim.module.css
[install-css]: https://github.com/jasondu/dsh-ui-mobile/blob/3ba0c08c8a1cb542861768f499f558d5a1df6b72/src/client/InstallBanner.module.css
[push-css]: https://github.com/jasondu/dsh-ui-mobile/blob/3ba0c08c8a1cb542861768f499f558d5a1df6b72/src/client/PushPrompt.module.css
[send]: https://github.com/jasondu/dsh-ui-mobile/blob/3ba0c08c8a1cb542861768f499f558d5a1df6b72/src/client/mobile-enter-send.ts
[focus]: https://github.com/jasondu/dsh-ui-mobile/blob/3ba0c08c8a1cb542861768f499f558d5a1df6b72/src/client/command-focus.ts
[focus-tests]: https://github.com/jasondu/dsh-ui-mobile/blob/3ba0c08c8a1cb542861768f499f558d5a1df6b72/tests/command-focus.client.spec.ts
[zoom]: https://github.com/jasondu/dsh-ui-mobile/blob/3ba0c08c8a1cb542861768f499f558d5a1df6b72/src/client/page-zoom-lock.ts
[install]: https://github.com/jasondu/dsh-ui-mobile/blob/3ba0c08c8a1cb542861768f499f558d5a1df6b72/src/client/install.ts
[legacy]: https://github.com/jasondu/dsh-ui-mobile/blob/3ba0c08c8a1cb542861768f499f558d5a1df6b72/docs/pwa-host.md
[sw]: https://github.com/jasondu/dsh-ui-mobile/blob/3ba0c08c8a1cb542861768f499f558d5a1df6b72/src/client/sw.ts
[sw-tests]: https://github.com/jasondu/dsh-ui-mobile/blob/3ba0c08c8a1cb542861768f499f558d5a1df6b72/tests/sw.client.spec.ts
[push-client]: https://github.com/jasondu/dsh-ui-mobile/blob/3ba0c08c8a1cb542861768f499f558d5a1df6b72/src/client/push.ts
[push-host]: https://github.com/jasondu/dsh-ui-mobile/blob/3ba0c08c8a1cb542861768f499f558d5a1df6b72/src/push.ts
[style-tests]: https://github.com/jasondu/dsh-ui-mobile/blob/3ba0c08c8a1cb542861768f499f558d5a1df6b72/tests/mobile-styles.client.spec.ts
[host-tests]: https://github.com/jasondu/dsh-ui-mobile/blob/3ba0c08c8a1cb542861768f499f558d5a1df6b72/tests/host-pwa.spec.ts
