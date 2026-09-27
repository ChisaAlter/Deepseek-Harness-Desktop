# 交叉审查报告 C —— 契约与文档一致性（独立子代理）

- 对象：提交 `d00d528ffca`
- 方法：文档↔实现逐条核对、归档/封印/链接治理、测试覆盖充分性、boot-recovery 接线完整性（无 exec，按工作树=提交后状态）
- 日期：2026-09-26

## 维度结论

1. **文档↔实现**：14 项文档声称逐条在代码中找到证据（62% 水线/天空层/水下层/扫光/省略号/ticker/抽屉/重要行/跳板 gating/动作面/零字面量/covered/--boot-* 作用域/IPC 边界），1 处真漏项 + 2 处措辞瑕疵。
2. **治理完整性**：归档三件套规范（Status/Archived 标记、manifest 六条 sha256、入站链接重接、新篇 Supersedes 互链正确、无 Superseded-by 于归档篇——符合冻结规则）；新决策 i18n 配对结构对齐。
3. **测试覆盖**：结构钉得牢，行为规则有真实空洞（下表 I-3）。
4. **boot-recovery 接线**：8 导出中 7 接线；`startupErrorLabel` 唯一死导出且测试钉的文案（'启动失败'）与页面（'桌面端启动失败'）漂移——原 plan 处方明确要求接线。

## 问题清单（按发现时严重级；处置见 report.md）

| # | 级 | 位置 | 问题 |
|---|---|---|---|
| I-1 | 中 | design-language L63 双侧 | 「boot 页 `.stage` 圆角卡」死引用（本批编辑过的文件内，未列入 QA 遗留清单） |
| I-2 | 中 | boot-recovery.js vs boot.js | `startupErrorLabel` 死导出 + 文案漂移 |
| I-3 | 中 | boot-recovery.test.js | `showLauncherBridge` 不覆盖 ('error','scheduled'/'restarting')→false——settled 语义最关键组合无断言 |
| I-4 | 低 | boot-page.md L42 | Do-not-touch 仍写「仪器画布产品路径」 |
| I-5 | 低 | boot-page.md L15 / design-language L178 | 「四件瞬时动作直接出现」措辞偏松（scheduled 仅 3 件、restarting 仅 2 件同屏） |
| I-6 | 低 | production-acceptance-test-cases.md L112 | TC-INST-003 期望「仪器画布（状态章、常驻日志）」，按字面必失败且被 Gates 引用——已声明范围外，但咬合力最强 |
| I-7 | 低 | prototypes/boot-page/ | 旧三方向仪器画布原型仍在仓且链接现网 tokens，建议标注归档或删除 |

## 疑点

1. 「26/26」计数与两文件 21 例不符（后澄清：含 boot-log-dump 5 例=26，卡措辞已修正为 21/21）
2. manifest/sidecar 哈希无法离线验算（后 doc-sync 8/8 实证）
3. diff 全文不可得（无 exec，以 HEAD==提交推导）
4. `applyPluginBootCopy(failed)` 不弹动作——依赖主进程后续 settled error 快照接管，文档未声明时序（已记录）
5. report.md `L 7` 转述 vs 实现 `L 07`（padStart）——属概括非错误
