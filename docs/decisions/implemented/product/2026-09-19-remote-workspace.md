# Decision: SSH 远程工作区以代码级合并为桌面内置功能

Status: implemented

中文 | [English](2026-09-19-remote-workspace.en.md)

## Problem

用户需要把 SSH 远程目录作为 Agent 工作区：多台机器、凭据管理、镜像同步、远程文件与命令工具。桌面现状无此能力；上游 `packages/ssh/*` 是部署级方案（POSIX-only、OpenSSH alias + 远端 helper 二进制、BatchMode 单主机），不是产品面功能。第三方插件 `flymysql/dsh-remote`（v0.8.21）已实现完整方案并经社区验证，但插件安装形态不满足目标：不在包内、不可开关、UI 不符设计语言、凭据安全边界归第三方。

## Decision

把 `dsh-remote` 代码级合并为桌面内置，分四层落地：

1. **后端 vendor**：`vendor/dsh-remote` 快照 host 半 17 个模块（机器注册表、ssh2 连接池、SFTP 双向同步、20 个 `rw_*` 工具、端口转发、审计、TOFU 指纹、`/dsh-remote/*` 路由），依赖 `ssh2`/`schemastery`/`iconv-lite` 随 `vendor/dsh-remote/node_modules` git 跟踪（dshbot 同例）；砍掉 `update.js` 自更新（桌面统一管更新）。
2. **客户端重写**：原 client 半 ~160KB 不搬，按设计语言重写为三块——新设置 section「远程工作区」（与手机 `remote` section 分开）、侧栏远程文件 tab（`sidebarRightTabs`）、picker 远程 flow 孔 occupant；全部走 `ui-primitives` / `--dsw-alias-*` tokens / typed dictionaries。
3. **选择器合并**：`ui-directory-picker-browse` fork 声明一个新 `single` 远程 flow 子孔并渲染「本机 / 远程」tab 条；本机 tab 保持现页内浏览不变；远程 client 占孔，孔空（开关 off / 插件未挂）时退回本机-only——接缝原生缺省，无优先级争抢。
4. **挂载管线**：`src/main/dsh-remote-desktop.js` ensure —— junction `profiles/web/node_modules/dsh-remote` → vendor 源 + 写 `desktop-plugins/dsh-remote/desktop-dsh-remote.patch.yml`，每次启动（全量 + skip）经 `--patch` 挂载；`remoteWorkspaceEnabled` 默认 `true`，界面设置开关翻转重启 Harness（`dshbotEnabled` 管线同型），off 时只 strip 残留受管块 + 删 overlay，不校验 vendor、不阻断启动。

包名保持 `dsh-remote` 并入 `DROPPED_BASENAMES`：市场目录隐藏、in-chat `install_dsh_plugin` 拒绝、`stripDroppedPlugins` 每次启动剥 profile 同名行——内置为唯一供给（dshbot/dsh-im 同例）。用户既有第三方安装的机器清单/镜像/known_hosts 落在 `$DSH_HOME/remote-workspaces`，被内置天然接管，零迁移。forensics 按内置归因（`inBox`/`desktopRuntimeDamage`），disable 名单对该行无效，ensure 失败阻断启动且 skip 不可绕。

## Alternatives considered

- **保持第三方插件路线（catalog / in-chat 安装即用）** — rejected：不满足「内置 + 可开关 + 设计语言一致 + 凭据归桌面负责」的目标；且 -100 抢孔会挤掉自有 picker。
- **`dsh-remote` 原样 vendor，`priority: -100` 抢 directory-flow 孔** — rejected：挤掉 `ui-directory-picker-browse`（页内浏览、此电脑多盘、新建目录），本机体验退回系统对话框；client UI 反正要重写，索性把远程变成自家 picker 的一等 tab。
- **在 vendor 树新建 `packages/*` 桌面包（DESKTOP_PACKAGES 路线）** — rejected：该轨道是上游文件 fork 跟踪件；SSH 后端是完整第三方代码体，走 `vendor/dsh-*` 插件轨道（dshbot/dsh-im 同例）与上游 sync 隔离；picker UI 增量仍归 fork。
- **用上游 `packages/ssh/*` 栈实现** — rejected：部署级单主机、POSIX-only、无交互认证；产品要多机管理、密码/密钥/OTP/跳板机、Windows 远端（SFTP/Git Bash）——模型不匹配。
- **远程机器管理并入手机 `remote` settings section** — rejected：配对设备与 SSH 工作区语义混杂，误导用户。

## Consequences

以下功能已实现，自动化回归覆盖了挂载、客户端接线、主机密钥、绑定、同步、转发与 live runner 契约。当前测试使用合成目录和 fake SSH/SFTP client；`scripts/verify-remote-workspace-live.cjs` 的真机 SSH 路由流程虽已实现，但本 revision 未配置隔离 SSH fixture，也未运行真实 SSH 往返、真实转发或安装包 UI 验收。上述生产实机状态均为 **NOT RUN（not PASS）**；自动化门禁通过不构成实机 Pass。逐项生产验收见 [TC-RW-*](../../../qa/production-acceptance-test-cases.md)。

已实现的用户可见行为（以下清单说明产品行为，不代表生产实机已验收）：

- 设置出现「远程工作区」section：机器增删改、设为当前、测试连接按类别报错（认证/网络/指纹/超时）、转发面板、最近 30 条审计；界面设置有开关（默认开），翻转重启 Harness。
- Add workspace 弹窗为「本机 / 远程」双 tab：本机保持现页内浏览；远程选机 → 路径实时补全/浏览浮层 → 设为远程工作区 → `$DSH_HOME/remote-workspaces/<host>-<user>-<port>/<basename>` 镜像被收养为真实 workspace。
- 会话 cwd 位于镜像内时 system prompt 注入 remote 段，20 个 `rw_*` 工具可用（工具名过 `[A-Za-z0-9_-]{1,64}`）；写/删/移/转发落 `audit.log`；`rw_sync`/`rw_push` 三路冲突不静默覆盖；TOFU 指纹变更拒绝连接。
- 侧栏「远程文件」tab 可读/写远端文件（mtime 乐观锁、409 重读）。
- skip-user-plugins 启动仍挂载（内置行）；开关 off 后启动无该插件行、无 overlay、无残留受管块。
- 市场目录隐藏 `dsh-remote`、in-chat 安装拒绝、`stripDroppedPlugins` 剥离 profile 同名行；Recovery Board 把缺损标「内置组件损坏」。
- 远程工作区改动的 UI 路径通过 `verify-client-ui-i18n`；仓库级扫描仍报告其他路径中既存的 28 个硬编码字符串，本功能改动路径无命中。fork 门禁通过；`check-skip-compose-contract.js` 增 remote 行；`node --test` 覆盖 ensure/overlay/strip/toggle/forensics。

落地中的两个 host 修正（上游可回）：`/dsh-remote/machines` 更新时空 `proxy.password` 保留已存跳板密码；`/dsh-remote/test-connect` 接受 `machineId` 并回落到该机器已存凭据与连接旗标——上游原实现只探测 active 配置，已存机器根本无法测试。

**风险与 Deferred：**

- `vendor/dsh-remote` 与既有 `vendor/dshd-remote`（手机配对 daemon）目录名一字之差，评审与检索易混——保持目录名 = 包名的约定，文档首次出现处注明区分。
- `ssh2` 的可选原生依赖 `cpu-features`：vendor node_modules 只跟踪纯 JS 面，不放宽安装器构建脚本白名单；缺它仅加密走纯 JS 实现。
- 凭据保存在 `$DSH_HOME/remote-workspaces`。用户可选择逐机器 OS secret store：Windows CurrentUser DPAPI、macOS Keychain、Linux `secret-tool`；存储失败会回退为 `machines.json` 明文并报告 `secret-store-failed`，避免静默丢弃密码。因此该选项不保证每次都能加密落盘。强制加密、既有明文迁移和失效 keychain 恢复策略仍属独立决策。
- fork 维护成本：上游迭代活跃，`sync:harness` 不覆盖 `vendor/dsh-remote`（独立插件轨道），后续修复靠手工 port。
- 生产验收待执行：远程 tab 选目录、`rw_*` 工具链路、侧栏编辑、开关翻转、真实 SSH / 端口转发。live runner 的覆盖能力不代表它已连过真实机器；在结果与 CI artifact SHA 记录前，这些项目均维持 **NOT RUN**。
