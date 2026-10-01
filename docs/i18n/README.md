# 双语配对

中文 | [English](README.en.md)

已有双语对使用 `foo.md`、`foo.en.md` 和 `foo.i18n.yaml` 保存正文与确认记录。内部新决定默认单语；范围调整见[维护系统决定](../decisions/implemented/process/2026-10-02-maintenance-feedback.md)。

## 适用范围

- 内部单语决定只需 `slug.md`，可使用中文或英文，不登记 pending，不建空译文。
- 决策目录出现英文副本、确认记录或指向自身英文副本的切换链接时，自动作为配对检查；README 和模板继续双语。
- 其他必须双语的文档登记在 `scripts/i18n-pairs.manifest.json`。已有对外配对和已有译文继续维护。
- 未登记的副本、孤立 sidecar、不完整配对仍失败。pending 只暂缓摘要过期，不能放过缺失文件或结构差异。
- 过程稿、历史 QA 和 vendor 内容不纳入本仓库双语治理。封存配对保持完整，单语归档不需要补译文。

## 检查内容

1. 配对文件齐全；单语决定不进入配对检查。
2. 切换行位于前 14 个非空行内；中文侧 `中文 | [English](<stem>.en.md)`，英文侧 `[中文](<stem>.md) | English`，现有 HTML 形式也可。
3. 确认记录中的正文摘要与结构摘要对应当前内容；修改任一侧需核对后重录。
4. 标题、列表、表格、代码块和相对链接结构一致；措辞不要求逐字相同。英文有对应目标时链接英文，中文链接中文。
5. pending 对恢复一致后必须移出清单；新增 pending 必须说明原因，不能作为修复缺失译文的替代品。

## 操作

```sh
node scripts/verify-translation-pairing.mjs --list
node scripts/verify-translation-pairing.mjs --write <path>
npm run doc-sync
```

`--list` 只展示状态，退出成功不代表配对通过。`--write` 在缺少正文或结构不一致时拒绝更新确认记录；机器不能确认译文语义，维护者仍需阅读核对。不得仅为消除红灯批量刷新摘要。

## 能证明与不能证明

通过表示文件、结构和确认摘要一致，不表示翻译正确或产品通过。新内部单语决定不降低产品测试要求。旧[配对决定](../decisions/implemented/process/2026-09-17-bilingual-pairing-contract.md)中内部记录强制双语的执行范围由当前维护规则取代。
