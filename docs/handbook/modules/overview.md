# 模块：产品总览

## 职责与非目标

**职责：** 说明 Desktop 是什么、用户能看见哪些表面、与纯 `dsh web` / npx 的差别。  
**非目标：** 不重述上游 agent-loop；不替代 README 营销页。

## 用户可见行为

- 安装即可用：本机起官方 Web UI，无需用户手跑 `dsh web`。桌面 Harness **不读** 官方 `~/.dsh`；数据在 `userData/dsh-home`（见 [dsh-home.md](dsh-home.md)）。
- 主框：对话 + 工具审批 + 侧栏会话；`Ctrl+\` 右栏 Surfaces；`` Ctrl+` `` 底栏终端；`Ctrl+,` 设置。
- 桌面增强：冷启动启动器（更新询问、导入、版本、插件问诊）、Git 标题栏、工作区文件、内嵌 Browser 预览、壁纸图库、设置内市场、设置内用量统计、托盘/更新、插件恢复、手机远程（侧栏入口；默认关、开才监听）。

## 架构要点

见 [../blueprint.md](../blueprint.md)。官方 UI 在 BrowserView；壳提供启动器、boot、IPC、预置插件与打包。市场 / 壁纸图库仍禁止另开产品窗。

## 实现入口

- 产品说明：[../../../README.md](../../../README.md)
- 壳入口：`src/main/index.js`
- 上游钉：`vendor/harness-upstream.json`

## 不变量

- 不另做一套聊天页皮肤；视觉跟 `dsh web`。
- npx 官方包路径不承诺桌面 surfaces / Git / 终端。

## 门槛

- 发版总门禁：每次发布前走完 [production-acceptance-test-cases.md](../../qa/production-acceptance-test-cases.md)。对象是 `release.yml` windows artifact，与即将上传的 Setup **同一 SHA**；本机 dist / `qa:*` 不能顶替。

## 延伸阅读

- [dsh-home.md](dsh-home.md)、[boot-lifecycle.md](boot-lifecycle.md)、[../../features/desktop-launcher.md](../../features/desktop-launcher.md)、[design-and-spine.md](design-and-spine.md)
