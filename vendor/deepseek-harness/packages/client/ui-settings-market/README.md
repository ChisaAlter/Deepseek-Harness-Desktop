# @deepseek-ai/dsh-client-ui-settings-market

English | [中文](README.zh.md)

Desktop-owned plugin marketplace Settings section (`market`). It registers only when Electron exposes the complete marketplace preload API. All mutations target the desktop web profile and use HarnessController for restart; this package does not run the third-party dshmarket runtime or its HTTP/HMR routes.

## User workflows

- Discover: curated catalog, search, categories, star/date sorting, time filters and bounded incremental paging.
- Favorites: desktop-persisted favorite ids, sharing Discover filters.
- Details: catalog screenshots, bounded public repository README rendered by MarkdownText, and npm author-declared requirements. Requirements are informational, not a verified host-compatibility verdict.
- Installed: category groups, per-plugin update checks, update/failure filters, and sequential batch updates with a single restart. Install/removal and batch updates require confirmation; build approval remains explicit and per-plugin.
- Operations: recent redacted desktop operation records and log export. Records survive section unmount and Harness restart; interrupted desktop-process operations are not replayed.

The section uses DSHD theme tokens and baseline Modal, Menu, Tooltip and MarkdownText primitives. Failures remain visible, including rollback and restart failures. Ordinary browser sessions without desktop preload do not register the section.

## Model Experience

None. This package registers no model-facing tools or prompt content.

#### KV Cache effect

None; this package neither assembles nor sends provider requests.

## Limitations

No automatic compatibility verdict, Release-asset installation, shared comments or generic cancellable operation queue. Theme store, cloud backup, hot replacement and multi-registry management remain desktop product exclusions. Rollback cannot restore plugin-managed data migrations; arbitrary sensitive log content needs review before sharing.

No runtime invariant companion is published: durable state belongs to the desktop main process, and focused package tests cover the injected UI behavior.
