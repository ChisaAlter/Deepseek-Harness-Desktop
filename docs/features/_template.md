# Feature: \<title\>

| Field | Value |
| --- | --- |
| **id** | `\<kebab-id\>` |
| **status** | `active`（`active` 现行契约 / `proposed` 已定未落地 / `killed` 负契约防复活，killed 卡文件名带 `_` 前缀） |
| **last verified** | YYYY-MM-DD — \<hand test / command\> |

## User paths

1. …
2. …
3. …

## Invariants

- …

## Allowed touch

- `path/to/dir/` — why

## Do not touch

- Behavior or surface that must stay unchanged
- Neighbor files/areas unless the user explicitly expands scope

## Gates

| Kind | What |
| --- | --- |
| Automated | \<command or “none”\> |
| Manual / QA | `TC-…` in [production-acceptance-test-cases.md](../qa/production-acceptance-test-cases.md) |

## Sources

- Design: …
- Spec / plan: …
- Decision（如有）: `docs/decisions/...`
- Upstream Agent Note（如有）: …
- Implementation entry: …
