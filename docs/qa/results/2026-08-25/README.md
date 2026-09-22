# QA 证据目录 · 2026-08-25（Phase 5/6 占位脚手架）

本目录由合并收口计划
[2026-08-25-post-consolidation-closeout.md](../../../superpowers/plans/2026-08-25-post-consolidation-closeout.md)
的 Phase 5（Windows git-titlebar 实机）与 Phase 6（TC-EXT-007 dshbot 冒烟）预置。

> **诚实边界：** 本目录当前只有**模板与占位**，两个实机门均 **未执行（NOT
> RUN）**。云端 Linux 环境跑不了 Windows NSIS 安装包与打包 Electron GUI，
> 不得在实机执行前把任何 Pass/Fail 填进模板或汇总表。
> 若实机执行日期晚于 2026-08-25，请把报告落到实际执行日期的
> `docs/qa/results/<日期>/` 目录（可整体挪走本目录模板），并在汇总表引用
> 实际日期。

## 内容物

| 文件 | 对应门 | 状态 |
| --- | --- | --- |
| [git-titlebar-windows.md](git-titlebar-windows.md) | Phase 5 · TC-WS-006 / TC-GIT-001…007 实机 | ☐ NOT RUN（模板） |
| [tc-ext-007-dshbot.md](tc-ext-007-dshbot.md) | Phase 6 · TC-EXT-007 三相 | ☐ NOT RUN（模板） |

## 执行前置（两个门共用）

1. Windows x64 实机或长驻 VM。
2. 一次 **test.yml 已绿** 的 CI 运行产出的 `DeepSeek-Harness-windows-x64`
   artifact（Build installers workflow），记录 **CI SHA** 与 Setup SHA256。
3. 同一 SHA 的仓库检出（自动化探针 `run-packaged-smoke.mjs` 需要）。

## 回填链

- 汇总表：[../../production-acceptance-test-cases.md](../../production-acceptance-test-cases.md)
- 卡片：[../../../features/git-titlebar.md](../../../features/git-titlebar.md)
  （移除「实机 Windows 仍未覆盖」句）、
  [../../../features/dshbot.md](../../../features/dshbot.md)（Open follow-ups P0 行）
- 手册：[../../tc-ext-007-dshbot-install-smoke.md](../../tc-ext-007-dshbot-install-smoke.md)、
  收口计划 Phase 5 步骤表
