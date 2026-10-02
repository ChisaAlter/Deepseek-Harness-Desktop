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

## Upstream differences（仅存在相关差异时保留）

- 保护的用户行为与差异理由：引用本卡已有不变量，避免重述。
- 来源与基线：实际 DSH / 桌面来源，已知 ref/SHA 或来源记录链接；未知如实标明。
- 当前差异及负责入口：本地保留 / 已融合 / 上游等价接管 / 待裁定的事实，链接源码或装配入口。
- 验证与取舍：引用已有 Gates、最近实际证据及相关决定；缺口如实标明，不提前准备测试。

本节只记录该功能差异；合并执行遵循[统一维护准则](../maintenance/README.md#上游合并与差异保护)，不追加独立门槛。

## Allowed touch

- `path/to/dir/` — why

## Do not touch

- Behavior or surface that must stay unchanged
- Neighbor files/areas unless the user explicitly expands scope

## Gates

只列对应真实风险的验证入口。先完成实现，再准备并执行必要测试和实际 QA；不复制全量治理清单或测试数量目标。维护执行只遵循 [WhaleIsle 唯一维护准则](../maintenance/README.md)；本节只定位实际行为验证。

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
