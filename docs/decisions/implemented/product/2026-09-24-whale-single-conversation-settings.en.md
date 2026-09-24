# Decision: One resident whale conversation and reorganized settings

Status: implemented

[中文](2026-09-24-whale-single-conversation-settings.md) | English

## Problem

The whale assistant appears in the main window, desktop quick chat, and IM. IM previously bound one Session per chat, so one character could have several histories. Assistant settings were buried below desktop behavior, while the navigation still said “Pet.” Desktop management tools also could not change pet behavior or the assistant's own profile.

## Decision

The `sessionId` in `data/whale/settings.json` is the whale assistant's sole conversation identity. The main window and desktop quick chat continue using it. Before each IM prompt and model command, dsh-im reads that ID and verifies that the Session exists. A prompt after `/new` still enters that Session. A missing resident Session produces an error instead of a per-chat replacement. Bots with another explicit preset keep independent Sessions. The whale's session creation tool rejects `whale-girl`, and its fork tool cannot fork her resident Session.

When the whale assistant is enabled, IM enters this conversation by default; users can still disable IM access in whale settings. Each IM channel retains its existing access rules, with no additional identity layer.

The Settings navigation is “Whale.” The existing DSHD setting cells and dialogs are arranged into “Chat and capabilities” and “Desktop appearance and behavior” tabs. The authenticated desktop control channel gains a pet settings API using the pet manager's normalizer. The assistant's own profile uses conflict-checked persistent settings.

## Alternatives considered

- **Create a `whale-girl` Session for every IM chat**: each chat would have separate history, breaking the resident manager identity.
- **Keep all settings on one long page**: the assistant controls were already difficult to find, and adding more rows would make navigation worse.
- **Let tools edit desktop JSON directly**: that would bypass normalization, live updates, and restart alignment.

## Consequences

Desktop and IM can share one history. Other explicit IM presets retain their existing Sessions. IM access carries cross-session privileges, so deployments must control who can speak to each bot under the channel access rules. IM cannot silently repair a missing resident Session. The settings page requires one tab switch but each page is shorter.
