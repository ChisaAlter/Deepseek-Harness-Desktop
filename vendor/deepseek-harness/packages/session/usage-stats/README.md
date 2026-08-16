# @deepseek-ai/dsh-usage-stats

English | [中文](README.zh.md)

Function plugin registering the `usageDaily` projection unit and the `usageStats` service: timestamped, turn/step-deduped provider usage samples plus human prompt times, folded from usage chunks, assembled assistant messages, and `user/message` events, then cut into a trailing 7- or 30-day settings-page DTO. The fold does not bucket by local calendar day; `usageStats.summarize({ rangeDays, timeZone })` applies the client's IANA zone.

## Fold semantics

- A usage `assistant/chunk` opens a sample for its turn/step. A later same-step `assistant/message.usage` replaces it, so the pair is not double-counted.
- Token total is uncached input + output + cache-read + cache-write. Reasoning tokens are already in output.
- Model id comes from the assembled message, else the last `request/header` / `request/context` model, else `(unknown)`.
- `userMessageTimes` records only `user/message` events whose source kind is `user`.
- `summarize` counts tokens, messages, and heatmap cells across every session, including subagent children. `sessionCount` counts only root sessions that have a human prompt in the window.
- `currentStreak` is consecutive active days ending today, or yesterday when today is idle. Days before the window do not extend it.

## Composition

```yaml
- id: usage-stats
  name: '@deepseek-ai/dsh-usage-stats'
```

Injects `sessionProjections`. Optional `sessions`, `sessionPersistence`, and `sessionProjectionCache` are read with `ctx.get`: live sessions win, cold sessions use the cache, then a fail-soft `readFrom` restore.

## Model Experience

None, as the plugin only computes a client-facing read model of already-logged session events and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the plugin never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **No currency conversion** — the DTO reports tokens, not estimated spend. There is no model price table in this package.
- **Adapters that omit usage contribute 0 tokens** — sessions and human prompts still count; heatmap cells stay empty when only unmetered traffic landed.
- **Cold sessions may be slightly stale** — a cached `usageDaily` row is used without replaying the log. A missing cache row triggers a bounded concurrent `readFrom`; a failed read counts that session as empty.
- **Mounted only in the web-app bundle** — other assemblies serve no `usageDaily` key and no `usage.summary` RPC.
