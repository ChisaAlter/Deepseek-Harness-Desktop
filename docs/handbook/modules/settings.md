# 模块：设置导航

## 职责与非目标

**职责：** 从菜单 / 托盘 / 快捷键跳进设置指定 section；列出桌面相关入口。  
**非目标：** 不重写官方各 settings 插件内部表单（模型 / MCP 等属 harness）。

## 用户路径

- `Ctrl+,` 或菜单「设置」。  
- `openSettings` / `settings-jump` 可深链到 section（如 `market`、`usage-stats`、`appearance`）。  
- 设置 → 关于：「打开运行目录」打开桌面 `dsh-home`（见 [dsh-home.md](dsh-home.md)）。  
- Section id 表：[../appendix/settings-sections.md](../appendix/settings-sections.md)

## 架构要点

- Main：`settings-jump.js`；IPC `shell:open-settings`。  
- 各 section 由 harness / 预置插件注册 `settings.section`。

## 实现入口

- `src/main/settings-jump.js`、`menu.js`、`tray.js`

## 不变量

- 市场在设置内，无独立市场窗（见 [marketplace.md](marketplace.md)）。
- 模型 / MCP / 技能写桌面 `dsh-home`，不写 `~/.dsh`（[dsh-home.md](dsh-home.md)）。
- 设置侧栏导航按 section id 使用互异的 16px `currentColor` 线框图标，未知 id 回退齿轮；映射见[设置 section id 附录](../appendix/settings-sections.md)。

## 门槛

- QA：`TC-EXT-001`、`TC-EXT-006`、`TC-EXT-008`；`TC-WS-002`、`TC-WS-003`

## 延伸阅读

- [marketplace.md](marketplace.md)、[usage-stats.md](usage-stats.md)、[wallpaper.md](wallpaper.md)
