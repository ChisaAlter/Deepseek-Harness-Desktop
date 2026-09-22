# Postmortem（事故复盘）

事故叙事层——仓库里唯一允许讲故事的地方。决策记录写「为什么这样定」，feature 卡写「契约是什么」，这里写「当时怎么坏的、为什么所有检查都没拦住、之后加了什么防线」。

## 什么时候写

同时满足三条才值得一篇（上游标准）：

- **隐蔽**：缺陷在用户手里才暴露，或潜伏期很长；
- **系统性**：不是手滑，是流程/测试/设计上的洞；
- **昂贵**：排查或修复成本高，或影响面大。

普通 bug 修了就修了，进 `docs/decisions/implemented/bug-fix/` 即可，不占此层。

## 格式

文件名 `NNNN-topic.md`（四位序数递增）。骨架：

```
# Postmortem NNNN: <标题>

## Executive summary
## Timeline
## Root cause
## Why every test / check missed it
## Guardrails added
## Lessons
```

`Guardrails added` 是硬通货：每条新增的测试、规则、门禁列出其落点文件。`Lessons` 可推广的一句话教训。

写完后：若复盘暴露了「为什么当初这样定」值得留档，补一篇 `docs/decisions/` 记录并互链。
