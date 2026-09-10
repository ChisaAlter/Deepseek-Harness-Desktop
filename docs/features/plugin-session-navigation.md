# Feature: Plugin Session Navigation

- ID: plugin-session-navigation
- Status: navigation and managed-session chrome integration present
- Last verified: 2026-09-09; managed-session header/titlebar integration passed
  160 focused client tests, the full client TypeScript check, and the official
  build. Live Electron verified Bot and room sessions retain their real title
  and shared composer while preset, trajectory, Session log, branch and Commit
  controls are absent; root panel/window controls remain, and an ordinary New
  Session still shows Session log, branch and Commit. Conversation 35/35 and
  dshbot browser 49/49 passed. A blank plugin Session with an elected composer-overlay
  body removes the ordinary blank canvas from flex layout; live Electron verified
  the new room body uses the full 846px conversation height with zero document
  overflow. Real dshbot full-shell acceptance verifies fixed first-prompt IDs,
  blank-session non-reuse, docked input, list/search isolation and Host restart
  history.
  Existing preview Bot/room sessions also verified in isolated Electron.

Plugin-owned persistent sessions remain addressable through the same Session
Controller. Optional log-only presentation metadata records owner and title;
it does not grant execution permissions, change session identity, rewrite old
logs or fake a turn. Ordinary workspace lists/search and blank reuse exclude
owned rows. The conversation surface keeps its normal docked composer before
the first message and displays the owner title. Null metadata releases ownership.

Allowed touch: vendored api/session-controller types, commands, list projection
and client summaries; client/ui-workspace navigation/tree; ui-conversation root
rendering; related focused tests, documentation and built artifacts; independent
dshbot integration. Preserve unrelated changes and all existing user session data.

Managed composer extension: optional presentation
`composer: 'managed'` selects the shared editor without independent model,
permission shortcut, plan, preset and developer-statistics chrome. It also
keeps the owner title while suppressing lineage/actions/utilities, multi-view
tabs, Session-log download and Git titlebar actions; stale stored view selection
falls back to the default conversation view. Root panel and window controls stay
available. Its
`conversation.input.managed` slot lets the owner open its configuration. This
is presentation only, never an authorization bypass. The Session model-selection
command accepts `saveAsDefault: false` for explicit plugin-local selections;
ordinary callers retain the existing default-saving behavior.
Managed sessions also suppress implicit default saving from other ordinary
session-model entry points, such as the command menu. This is mutation scope,
not authorization; selecting a session-local model is not denied by presentation.

Overall dshbot workflow completeness remains tracked in the independent plugin's
docs/feature-gap-audit-2026-09-08.md.

Gates: projection/command tests, workspace list and draft reuse tests, conversation
render tests, official build, actual dshbot full-shell first-send/isolation/reload
acceptance and an isolated Electron preview. No branches, publication or live
profile overwrite.
