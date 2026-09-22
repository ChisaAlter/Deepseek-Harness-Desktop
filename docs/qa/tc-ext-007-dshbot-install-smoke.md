# TC-EXT-007 · dshbot 独立插件安装包冒烟 · 执行手册

对 **CI Windows 安装包** 跑「默认无页签 → 市场一键装 → 建群冒烟 → 卸载重启无残留」。
结果写入 `docs/qa/results/<日期>/`，并回填
[production-acceptance-test-cases.md](production-acceptance-test-cases.md) 汇总表
TC-EXT-007 行（Pass + CI SHA）。**不得用旧「停放 Pass」冒充。**

> **当前阻塞（2026-08-25）：** 云端 Linux 环境无法运行 Windows NSIS 安装包与
> Electron GUI，本手册即「下一次拿到 CI artifact 后一键执行」的完整脚本化路径；
> 自动化部分（A/C 两相）已由 `plugin.dshbot.*` walk 探针覆盖，建群冒烟为唯一
> 纯手工步骤。
>
> **2026-08-26 预演：** 三相已在云端 Linux 源码级 GUI 上完整轮换 PASS（同安装
> 规格、同 walk 探针、同残留抽查；不替代本手册的安装包执行）：
> [results/2026-08-26/tc-ext-007-dshbot.md](results/2026-08-26/tc-ext-007-dshbot.md)。

## 前置

- Windows x64 实机（或长驻 VM）。
- 从一次 **test.yml 已绿** 的 CI 运行下载 `DeepSeek-Harness-windows-x64`
  artifact，记录其 **CI SHA**。
- 同一 SHA 的仓库检出（跑 `scripts/run-packaged-smoke.mjs` 需要）。

## Phase A — 默认安装：无 Bots 页签（自动化）

```powershell
# 1. 静默安装（NSIS）
.\Deepseek-Harness-Desktop-Setup-<ver>.exe /S

# 2. 对已装 exe 跑打包冒烟；walk 内置 dshbot 探针：
#    plugin.dshbot.tabAbsent —— 未安装则侧栏必须没有 Bots 页签
#    plugin.dshbot.page / plugin.dshbot.market —— 两态一致性
$env:DSH_SMOKE_EXE = "$env:LOCALAPPDATA\Programs\deepseek-harness-desktop\Deepseek-Harness-Desktop.exe"
node scripts/run-packaged-smoke.mjs
```

通过标准：冒烟退出码 0；`[DSH_SMOKE]` JSON 中 `plugin.dshbot.tabAbsent` 与
`plugin.dshbot.page` 均 pass（未装分支），启动日志无 dshbot 阻断。

## Phase B — 市场一键装 + 建群冒烟（半自动）

1. 正常启动应用 → 设置 → 插件市场 → 第一方 `dshbot` 行 → 安装
   （等价 CLI：`dsh plugin --profile web add github:ChisaAlter/dshbot`，
   发布 npm 后可用 `dsh plugin --profile web add dshbot@<semver>`）。
2. 重启应用；再次跑 Phase A 的冒烟命令 —— 此时 profile manifest 判定已装，
   walk 断言翻转：`plugin.dshbot.page` 要求 Bots 页签**出现**、
   `plugin.dshbot.market` 要求「已安装」列表列出 dshbot。
3. **手工建群冒烟**（无自动化探针）：Bots 页签 → 新建 2 个 bot → 建群
   （名称 + description + 2 成员）→ 发一条消息 → 确认成员轮转发言
   （`send_room_message` 气泡或 `(pass)` 静默），无崩溃、无死锁。

## Phase C — 卸载重启无残留（自动化 + 抽查）

1. 插件市场「已安装」→ 移除 dshbot（或 `dsh plugin remove dshbot`）。
2. 重启应用；再次跑冒烟 —— walk 回到未装分支（`tabAbsent` 必须 pass）。
3. 残留抽查（桌面 `DSH_HOME` = `%APPDATA%\Deepseek-Harness-Desktop\dsh-home`）：
   - `dsh-home\.agent-presets\dshbot-room` 不存在（无任何 dshbot 安装时启动清理会删）；
   - `dsh-home\profiles\web\package.json` 的 `dependencies`/`bundles` 无 dshbot；
   - `dsh-home\desktop-plugins\dshbot` 拷贝与预置软链不存在。

## 回填

- `docs/qa/results/<日期>/` 写执行报告（三相输出 + CI SHA + 安装器文件名）。
- 汇总表 TC-EXT-007 行填 Pass/Fail + CI SHA；失败项引用 walk 探针 id。
- 更新 `docs/features/dshbot.md` Open follow-ups 首行状态。
