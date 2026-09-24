# Feature: Launcher-managed components（启动器组件平台）

| Field | Value |
| --- | --- |
| **id** | `launcher-components` |
| **status** | `proposed` |
| **last verified** | 2026-09-24 — 计划与拟议契约已立；组件安装与监管尚未实现。 |

## User paths

1. 用户在启动器新增的组件分区浏览项目维护的组件，按需下载、安装、运行或停止工具/服务。
2. 用户独立更新或卸载单个组件；失败时仍可使用上一健康版本，组件数据是否删除由用户单独选择。
3. Launcher 窗口关闭时继续监管已运行服务；退出 Launcher 时停止其监管的服务。

## Invariants

- 组件是独立进程，不注入 Launcher renderer，不写 DSHD profile 或 `dsh-home`；第一版只接受项目审核并签名的包。
- 组件 id、版本、平台、兼容范围、入口、包大小/哈希、发布者与用途由签名清单绑定；下载遵循用户选择的线路。
- 二进制置于 Launcher 自有版本目录，数据置于独立数据目录；暂存验证成功后才切换 active，保留上一健康版本供回滚。
- main 进程以 `shell:false` 启动清单内相对入口，持有 PID、代际、健康与退出状态；失败有界退避，默认安装后不自启。
- 组件操作锁与 DSHD 安装锁分离；组件故障不得阻塞 Launcher 的下载/安装/启动主路径。

## Allowed touch

- `src/launcher/` — 组件清单、安装器与进程监管服务；不新建另一套启动器 UI
- `src/renderer/launcher.*`、`src/main/ipc.js`、`src/preload/index.js` 与提取出的启动器服务 — 组件分区、授权 IPC 与状态投影
- `docs/design-language.md` 与 Launcher UI — 组件页视觉角色及交互
- `.github/workflows/`、`scripts/` — 同源签名组件产物与测试夹具

## Do not touch

- `vendor/deepseek-harness` 插件市场、`marketplace-install.js` 的 profile 锁、HarnessController 生命周期
- 任意第三方组件加载或脚本执行入口

## Gates

| Kind | What |
| --- | --- |
| Automated | 签名、兼容、路径穿越、原子安装/回滚、进程单实例/停止/崩溃退避 |
| Manual / QA | 真实 Windows 工具与服务各一例：安装、运行、关窗托盘、停止、更新、卸载、断网恢复 |

## Sources

- Decision: [启动器独立分发架构](../decisions/proposed/architecture/2026-09-24-launcher-standalone-distribution.md)
- Plan: [启动器重构计划](../superpowers/plans/2026-09-24-launcher-refactor.md)
