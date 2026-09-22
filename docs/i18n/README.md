# 双语配对契约

中文 | [English](README.en.md)

一对双语文档是三件套：`foo.md` 中文正本、`foo.en.md` 英文副本、`foo.i18n.yaml` 确认记录。本文件定义配对规则；机制动机见 [2026-09-17-bilingual-pairing-contract.md](../decisions/implemented/process/2026-09-17-bilingual-pairing-contract.md)。

## 适用范围

- `docs/decisions/**`：每篇记录强制三件套（目录门禁另查 sibling 齐全）。
- 其余对采用登记制：stem 路径列入 `scripts/i18n-pairs.manifest.json` 后进入门禁。
- 反向约束：任何 `*.en.md` / `*.i18n.yaml` 必须属于某个已发现或已登记的对——不允许影子副本。
- `docs/superpowers/`、`docs/qa/results/`、`vendor/` 不配对（过程稿与历史记录）。

## 机检内容（verify-translation-pairing）

1. 三件套齐全。
2. 切换行：中文侧 `中文 | [English](<stem>.en.md)`、英文侧 `[中文](<stem>.md) | English`，各出现在文件头八个非空行内；带居中 HTML 头的文档（如根 README）可用等价的 `<a href="<stem>.en.md">English</a>` / `<a href="<stem>.md">中文</a>` 形式。
3. `foo.i18n.yaml` 记录两侧 git blob hash 与结构签名 hash；任一侧改动后不重录即红。
4. 结构签名：标题深度序、列表种类与条数、表行×列、code fence 序列逐字节等值、规范化相对链接序列——两侧必须相等（段落文字不计，译文措辞自由）。链接各指各语言侧：中文侧不得链 `.en.md`；英文侧对已有英文副本的目标必须链 `.en.md`。
5. 棘轮：stale 对可登记进 `scripts/i18n-pending.manifest.json` 换取过渡期；恢复一致的对必须移出清单（登记失效即红）。pending 只减不增是约定，新增登记在 diff 里可见、需 PR 里说明。

## 操作

- 改任一侧后：`node scripts/verify-translation-pairing.mjs --write <对内任一路径>` 重录 sidecar。重录是「我确认两侧在此内容上一致」的可审查动作。
- `node scripts/verify-translation-pairing.mjs --list` 列所有对状态（ok / stale / pending / incomplete / violations），不失败。
- 门禁全量跑在 `npm run doc-sync` 内。

## 诚实边界

绿灯只证明：两侧在这份内容时被确认过一致、结构骨架相同。它不证明翻译质量——那是评审的另一半合同。
