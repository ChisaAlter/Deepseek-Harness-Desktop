# 市场分区评审跟进 · `qa:source` 走查结果 — ✅ PASS

PR #46（marketplace-settings 重排）评审跟进提交后的源码发布走查复跑。

## 环境

| 项 | 值 |
| --- | --- |
| 执行日期 | 2026-08-26 |
| 执行人 / 代理 | Cloud Agent（Cursor） |
| 平台 | Linux（xvfb-run，源码 Electron 运行） |
| 分支 / SHA | `cursor/marketplace-ui-polish-0559` @ `a0cc1c4b`（+ 本地未提交的 `ui-settings-remote` 测试 tsc 补丁，仅为构建 harness client face，跑完即还原） |
| 命令 | `xvfb-run -a npm run qa:source` |

## 结果

- 总计：**73 PASS / 3 SKIP / 0 FAIL**，`Source release QA passed`（exit 0）。
- 市场步骤全过：`market.section` PASS、`market.discover` PASS、`market.installed` PASS、
  `plugin.dshbot.market` PASS（standalone plugin, not installed on this profile）。
- SKIP 三项均为与市场无关的可选步骤：`composer.thinking`（composer 无 effort chips）、
  `git.commitDialog`（提交走快捷路径未开对话框）、`models.thinking`（无思考强度编辑器）。

## 备注

- 本次复跑覆盖评审跟进内容：安装按钮门禁（`deprecated` / 空 `installSpec`）、页签
  tab/tabpanel ARIA 关联、刷新按钮 `title`、`spec-match.ts` 边界匹配。走查的
  `已安装` 页签点击模式（`^(installed|已安装)( \(\d+\))?$`）与改后标签继续匹配。
- vendor harness 需先构建（`build:lib` + `build:web`）；`build:lib:client` 的 tsc 被
  `packages/client/ui-settings-remote/tests/remote-section.client.spec.tsx` 两处既有
  `exactOptionalPropertyTypes` 错误挡住（不在本次 Allowed touch 内），QA 期间用本地
  两行 `?? ""` / `?? false` 补丁绕过并在提交前还原，未入库。

## 第二轮复审复跑 — ✅ PASS

| 项 | 值 |
| --- | --- |
| 执行日期 | 2026-08-26 |
| 分支 / SHA | `cursor/marketplace-ui-polish-0559` @ `6e4db7fd`（+ 同上的本地 `ui-settings-remote` 测试 tsc 补丁，跑完即还原） |
| 命令 | `xvfb-run -a npm run qa:source` |

- 总计仍为 **73 PASS / 3 SKIP / 0 FAIL**，`Source release QA passed`（exit 0）；
  SKIP 三项与首轮相同、均与市场无关。
- 市场步骤全过：`market.section` / `market.discover` / `market.installed` PASS，
  `plugin.dshbot.market` PASS（standalone plugin, not installed on this profile）。
- 本轮覆盖第二轮复审修复：主进程拒绝已弃用行安装、刷新失败保留目录 +
  `role="alert"` 重试、刷新进行中禁用改标、分类 radiogroup 独立 aria-label。
  配套：vendor `ui-settings-market` vitest 40/40、vendor `test:gui` 全绿
  （410 文件 / 5373 测试）、desktop marketplace 引擎测试 48/48。
