# Decision: 全量双语配对机制与迁移棘轮

Status: implemented

中文 | [English](2026-09-17-bilingual-pairing-contract.en.md)

## Problem

`docs/` 下已有 4 对 `.en.md` 副本（README、design-language、motion、release-notes），但没有任何机制保证副本与正本同步——漂移无声发生，英文读者与英文 agent 读到的可能是过期契约。

## Decision

配对三件套：`foo.md` 中文正本 + `foo.en.md` 英文副本 + `foo.i18n.yaml` 确认记录（双方 git blob hash）。`verify-translation-pairing` 机检：三件套齐全、hash 与记录一致、语言切换行（中文侧 `中文 | [English](foo.en.md)` 紧跟 H1；英文侧 `[中文](foo.md) | English`）、结构签名（标题深度序、表行列数、列表种类与条数、code fence 序列字节等值、相对文档链接各指各语言侧）。`--write <pair>` 重录=可审查的确认动作；`--list` 只报状态不失败。`.gitattributes` 对 `*.i18n.yaml` 启用 `dshd-translation-pairing` merge driver：两侧 owner 文本合并都干净且合并后结构签名匹配时自动合成记录，否则 fail-closed 留人工，`scripts/resolve-pairing-conflicts.mjs` 处理已停下的 merge。

范围与排除写在 `scripts/translation-pairing.manifest.json`（排除 `docs/superpowers/**`、`vendor/**`、一次性稿件）。存量未配对的 in-scope 文件进 `pending` 清单：门禁拒绝**清单外**的新不配对文件，pre-commit 要求编辑 pending 文件须同提交补齐三件套——清单只减不增的迁移棘轮。

## Alternatives considered

- **一次性全量翻译后再开门禁** — rejected：~60 篇一次翻译拖慢落地，且落地前新文档继续不配对。
- **只配 feature 卡** — rejected：handbook 与 qa 同样是契约面，外部读者一样会读到漂移。
- **允许长期 rollout 清单** — rejected：上游明确禁止 per-file rollout；`pending` 只收存量迁移，规则是「碰它就必须配对」，只减不增。
- **不装 merge driver** — rejected：配对 yaml 在分支合并时是必然冲突点，自动合成省掉每 merge 一次的手工修复。

## Consequences

in-scope 文档改动需维护英文副本（工作 agent 一趟过 + `--write` 重录）；门禁绿了只证明「两侧在这份内容时被确认一致」，不证明翻译质量——语义归 reviewer。`pending` 清单在迁移完成前是已知债。
