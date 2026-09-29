# dsh-platform-session

Desktop-owned Host bridge for embedded DeepSeek Platform usage and top-up pages.
The shell mounts this plugin through `desktop-platform-session.patch.yml` on each
start and reads `GET /dshd-platform/session` using its per-boot Bearer token.

The route resolves `ctx.get('deepseekAccount')` on every authorized request.
WebServer may start before the account service; a captured reference would keep
returning an empty session after sign-in. Service replacement and removal must
also take effect on the next request. Credentials stay inside the existing
Host-to-main-process bridge.

Regression check: `node --test src/main/platform-session.test.js` from the desktop
repository root. The test drives the installed route before account availability,
after availability, after replacement, and after removal.
