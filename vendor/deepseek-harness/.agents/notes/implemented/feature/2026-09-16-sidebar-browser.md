# Agent Note: Sandboxed Sidebar browser

Status: implemented

English | [中文](2026-09-16-sidebar-browser.zh.md)

## Problem

The right Sidebar can preview addressed workspace files, but it has no independent surface for visiting a Web page. Opening a page outside the application loses the Sidebar's split, float, and tab lifecycle. Treating an arbitrary page like Document Preview content also obscures a different trust model: a Web page controls a live browsing context, while a document renderer receives bytes selected for one preview.

A parent page cannot inspect or drive a cross-origin iframe's internal history. The supported behavior must not imply that capability.

## Decision

`@deepseek-ai/dsh-client-ui-sidebar-browser` registers the multi-instance `browser` right-Sidebar tab type. `SidebarRightTabParamsMap.browser` accepts an optional initial URL so another Client plugin can open a Browser without importing this package's runtime values.

`MarkdownDelegateProvider` gives nested Markdown anchors an optional owner callback for ordinary HTTP(S) activation while retaining native modified-click behavior. Chat places one provider around its node list and opens a new `browser` tab with the URL as typed navigation parameters when that type is registered, or uses the system browser otherwise; the Markdown renderer does not import the Browser feature.

The address parser accepts `http:` and `https:`, including loopback targets; a host name without a scheme becomes HTTPS. It rejects embedded credentials, the application's own origin, malformed addresses, `file:` URLs, and every other scheme. Document Preview remains the local-file surface.

The current carrier is an iframe in both Web and Desktop. Its default Web policy is `sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"`; the frame has no direct download or top-navigation flag. Popups escape the sandbox, and a Web popup retains its opener and can use that chain to navigate the top-level application. Same-origin lets the visited origin use its own cookies and Web storage; it does not make a cross-origin target same-origin with DSH. The iframe sends no referrer and adds no package-owned Permissions Policy, so browser defaults and user grants apply. A rightmost toolbar toggle removes the sandbox attribute for that tab occurrence; the mode is not persisted and renders a warning while active. An unsandboxed page can navigate the top-level application under browser activation rules and use downloads, modal dialogs, and input locks. The package performs no Host-side URL probe or proxy.

Each tab receives one `BrowserController` class. Its command interface contains only `loadUrl`, `goBack`, `goForward`, and `reload`; it owns address validation and the `BrowserNavigation` state machine. The `BrowserFrame` interface owns transient sandbox and document state plus carrier operations, and `IframeImpl` implements it for the current iframe carrier. Slot injection exposes keyed frame state through `useBrowserFrame` and supplies plain callbacks, so the React body receives neither the controller nor an observable source; it owns only the editable draft and iframe DOM. A future `ElectronWebViewImpl` can implement the same interface without putting URL or carrier state in the component.

`BrowserNavigation` keeps the canonical current URL, controlled-load revision, navigation state, and a bounded sequence with its index. A new address drops the forward branch; Back and Forward move the index; Reload recreates the last application-known URL without adding history. A remounted body reloads the latest application-known URL and consults its optional initial URL only before the first controlled target. The Session-scoped store only persists immutable snapshots from that class for title rendering and application reload. An occurrence abort removes its bucket; `TabDomain` uses that same abort for both tab removal and `ui-sidebar-right` unload, so unloading or hot-reloading the Sidebar clears Browser history even when DockKit later restores the tab record.

Browser state is presentation state. It does not enter the Session log, model request, resource model, or DockKit layout operations. The existing [right Sidebar infrastructure](2026-09-04-right-sidebar-docking-infrastructure.md), [tab type contract](../architecture/2026-09-05-sidebar-tab-types-and-navigation.md), [resource model](../architecture/2026-09-05-client-resource-model.md), and [Document Preview operations](../architecture/2026-09-08-document-preview-operations.md) retain their existing responsibilities.

## Web navigation states

The Web carrier treats only the first iframe `load` for a controlled revision as confirmation of the application-known URL. A later `load` for that revision proves that the document changed but cannot reveal the new cross-origin URL. Events carrying an older revision are ignored.

| State | Entry | Address and controls |
|---|---|---|
| `empty` | The tab has no controlled target. | The address is empty. Back, Forward, Reload, and external-open are disabled. |
| `loading` | Address submission, an application-history move, or Reload starts a new revision. | The requested URL remains authoritative. Back and Forward follow application-history bounds; Reload remains available; external-open follows the known target protocol. |
| `known` | The first iframe `load` arrives for the current revision. | The requested URL remains authoritative even when that first load includes an HTTP redirect. The controls follow the same known-target rules as `loading`. |
| `unknown` | A second or later iframe `load` arrives for the current revision. | The last controlled URL is muted and marked `URL changed`. Back and Forward are disabled because iframe exposes no cross-origin `canGoBack` or `canGoForward`; external-open is disabled. Reload starts a new revision at the last controlled URL. |

Address editing is available in every state. An invalid draft reports an address failure without changing the current navigation state. Focusing the unknown address hides its marker and reveals Go; Enter and Go both start a controlled load. Changing sandbox mode reloads the last controlled Web target under a new revision. An iframe `error` event marks only the current `BrowserFrame` revision with a transient load-failure notice; it does not change URL history, and the next controlled document clears it. Browsers do not reliably emit this event for DNS, TLS, mixed-content, CSP, or `X-Frame-Options` failures. `pushState`, `replaceState`, and fragment changes that emit no iframe `load` remain unobservable.

## Deferred Electron carrier

Electron `<webview>` support is designed but is not registered or tested. The controller keeps the same four commands, while a separate per-tab view object owns attachment, detachment, state observation, and target identity. This follows Playwright's Android WebView split: `AndroidWebView` is a target and lifecycle handle identified by package, process, and debugging socket, while `page()` returns the regular `Page` that owns Web navigation and DOM commands; device-level input remains on `AndroidDevice`.

The Desktop design enables `webviewTag` only on the application window. Its isolated preload receives an unguessable per-window capability, and every Browser tab appends a fresh UUID to form a distinct non-persistent partition. The main process accepts only an initial `about:blank` guest carrying that capability, removes any preload, and forces sandbox, context isolation, disabled Node integration in all frames, Web security, secure-content checks, disabled nested webviews, and disabled plugins.

The main process allows page-initiated main-frame navigation and redirects only to credential-free HTTP(S). Requests may use HTTP(S), WebSocket, data, and Blob URLs; direct file, custom-protocol, extension, and privileged requests are cancelled. Permission checks and requests, display capture, device grants, downloads, popup windows, and drag-and-drop navigation are denied.

The view object keeps an inactive guest connected in an owned hidden DOM host and moves it back into the visible placeholder without recreation. This retains page and target identity across Sidebar body remounts. Because `<webview>` participates in renderer layout and compositing, ordinary DOM dialogs, menus, tooltips, and drag previews can cover it. `WebContentsView` remains unsuitable because it is a native child surface: CSS cannot cover it, and every overlay or animation would require main-process visibility and bounds synchronization.

Each guest is a distinct WebContents and CDP target. Development may expose Electron's process-wide remote-debugging port and select the guest target explicitly. Production keeps that endpoint disabled; browser-use or computer-use requires an authenticated broker that binds one authorized tab to its WebContents and uses `webContents.debugger` or an equivalently scoped transport without publishing every application target.

## Alternatives considered

**Add a Host embeddability probe and persist the sandbox preference.** Rejected because fetching arbitrary targets on the Host adds an SSRF path, the probe can disagree with later redirects, and a persistent global escape makes later tabs inherit an unsafe choice. Browser instead offers an explicit per-tab, non-persistent sandbox toggle with a visible warning.

**Treat parent-owned history as the complete Web model.** Rejected because it silently leaves a stale address and enabled actions after an in-frame navigation. The bounded parent-owned history remains useful while the current controlled URL is known; the explicit `unknown` state removes claims that the iframe API cannot support.

**Support `file:` URLs in Browser.** Rejected because local files already belong to Document Preview, while browser navigation has a different trust model. Browser refuses the protocol instead of acquiring filesystem or Workspace Files access.

**Proxy Web pages through the Host.** Rejected because a compatible proxy would have to rewrite URLs, CSP, cookies, modules, streams, forms, and downloads while turning the Host into a general outbound requester.

**Implement the Electron carrier in the initial Browser change.** Deferred so the first implementation does not enable a new Electron guest surface without packaged-app evidence for overlay stacking, target lifetime, cookie isolation, and every permission denial.

## Verification

Unit tests cover protocol parsing, delegated Markdown links, controller commands and lifecycle, deterministic navigation-state transitions, bounded history, best-effort iframe errors, and plugin disposal. Keyless Web scenarios boot the shipped composition and exercise message-link routing, HTTP(S), Back, Forward, sandbox control, unknown navigation, and protocol refusal.

## Consequences

The Browser adds no Electron privilege and behaves identically in current Web and Desktop builds. Many sites refuse iframe embedding or require downloads or top-level navigation withheld from the frame by the default sandbox. An HTTPS application can block public HTTP pages as mixed content or restrict private-network requests, and disabling the sandbox does not bypass those browser policies. Disabling the sandbox otherwise trades its protections for compatibility: the frame can navigate the top-level application under browser activation rules and use downloads, modal dialogs, and input locks. A Web popup that escapes the sandbox retains its opener and can navigate the top-level application through that chain. Neither path adds Electron or Node APIs. The URL gate cannot prevent an embedded page from choosing its own destination. A later iframe load exposes that navigation occurred but not its cross-origin URL; History API and fragment changes can remain completely invisible. The deferred Electron carrier requires real packaged-app verification before it can become current behavior.

Site-cookie behavior follows the user's browser and is not isolated per Browser tab. Local files are rejected and remain owned by Document Preview. Persisted URLs can contain sensitive query or fragment values, so users must not enter credentials they do not want retained in application-local browser storage.
