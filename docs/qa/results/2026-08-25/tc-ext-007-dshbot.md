# Phase 6 · TC-EXT-007 dshbot 安装冒烟报告 — ☐ NOT RUN

> 模板。步骤、命令与 Pass 标准以执行手册
> [tc-ext-007-dshbot-install-smoke.md](../../tc-ext-007-dshbot-install-smoke.md)
> 为准。**不得用旧「停放 Pass」冒充；执行前不得填任何 Pass/Fail。**

## 环境

| 项 | 值 |
| --- | --- |
| 执行日期 | ☐ |
| 执行人 / 代理 | ☐ |
| CI run / SHA | ☐ |
| Setup 文件名 + SHA256 | ☐ |
| 安装规格（市场 `#path:` 或 `dshbot@<semver>`） | ☐ |

## 三相结果

| 相 | 内容 | Pass 标准（摘要） | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| A | 默认安装无 Bots 页签（自动化） | 冒烟退出码 0；`plugin.dshbot.tabAbsent` / `plugin.dshbot.page` 未装分支 pass | ☐ | ☐ `[DSH_SMOKE]` JSON |
| B | 市场一键装 + 建群冒烟（半自动） | 重启后探针翻转（页签出现、已安装列出）；手工建群 2 bot、成员轮转发言、无崩溃死锁 | ☐ | ☐ 截图 / walk JSON |
| C | 卸载重启无残留（自动化 + 抽查） | 探针回未装分支；`.agent-presets\dshbot-room`、profile `dependencies`/`bundles`、`desktop-plugins\dshbot` 三处均无残留 | ☐ | ☐ 目录/manifest 抽查输出 |

## 回填

- ☐ 汇总表 TC-EXT-007 行（Pass/Fail + CI SHA；失败项引用 walk 探针 id）
- ☐ `dshbot` 卡 Open follow-ups P0 行状态
