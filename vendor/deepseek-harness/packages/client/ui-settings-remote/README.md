# `@deepseek-ai/dsh-client-ui-settings-remote`

English | [中文](README.zh.md)

Desktop-only **Remote** surfaces:

1. Sidebar footer phone control (`sidebar.footer.action` id `remote`) — on/off, pairing QR, bound devices with inline rename.
2. Settings section id `remote` with tabs (`settings.remote.tab`) — **gateway** (LAN/relay mode, port, bind, LAN TLS, relay URL/token, rotate pairing token) and **channels** (preset `@xmanrui/dsh-im`).

Registration requires Electron `window.shell` `getRemote` / `saveRemote` / `rotateRemoteToken` / `unbindRemoteDevice` / `renameRemoteDevice`. Plain `dsh web` has neither surface.

See desktop feature cards `remote-settings` and `mobile-remote`.
