# Decision: Android chat becomes native Compose

Status: implemented

[中文](2026-09-29-mobile-native-chat.md) | English

## Problem

Android connect and scan use Compose, but the paired chat still displays the
mobile SPA in a WebView. The user explicitly requested native Android chat and
a more refined composer while keeping browser Web unchanged. The earlier ban
on a separate native UI no longer matches product intent. Kotlin `:protocol`
currently parses pairing links only; the bundled JS client owns ChisaCode E2EE,
sticky secrets and host RPC.

## Decision

- Kotlin + Compose renders the Android paired sessions, timeline, approvals and
  composer; browsers continue using `mobile/web`.
- The bundled same-origin Web client temporarily runs in the background for
  existing E2EE and host RPC, preserving secrets and origin. Only the trusted
  asset main document projects a minimal text view and receives whitelisted
  native actions. External main documents, stale session callbacks and unknown
  actions receive no authority.
- The first native path covers connection, sessions, history/incremental
  replies, send/stop and approval. Advanced Git/files/workspace flows retain
  an explicitly labeled legacy workspace page, without fake native controls.
  The composer follows the [mobile design language](../../../design-language-mobile.en.md#android-native-chat-migration)
  for semantic tokens, sizing and IME behavior.

## Alternatives considered

- **Rewrite ChisaCode encryption and all host RPC in Kotlin**: this could
  remove the background WebView, but secret migration, wire compatibility and
  relay risk would be coupled to the UI change. `:protocol` does not yet offer
  these capabilities; assess it separately after validating the native path.
- **Only polish WebView CSS**: it does not deliver the explicitly requested
  native Android UI and input experience.
- **Move browser Web and Android to Compose together**: browsers cannot run
  Compose, and the user explicitly wants Web to remain Web.

## Consequences

- Compose and Web maintain separate presentation layers but share the current
  communication protocol and semantic tokens. JS/Kotlin bridge contracts and
  real-device end-to-end acceptance are required.
- The background WebView still consumes process/memory resources; this phase
  is not an all-Kotlin network stack. Legacy workspace pages remain WebView
  until separately migrated.
- The mobile geometry from the [earlier structure decision](2026-09-24-mobile-remote-claude-structure.en.md)
  remains; its Android-chat-must-stay-WebView limitation is superseded here.
