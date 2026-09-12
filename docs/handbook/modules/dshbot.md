# 模块：dshbot 内置 Bots

dshbot 是随桌面安装包交付的内置 Bots 插件，源码为 `vendor/dshbot`（剥离前仓内快照），每次启动挂载，无需用户安装。

## 挂载路径

`src/main/dshbot-desktop.js` 的 `ensureDesktopDshbot` 在每次启动（全量 + skip 恢复）执行：strip 用户层 `cordis.patch.yml` 中的旧受管块 → junction `profiles/web/node_modules/dshbot` → `vendor/dshbot` → 写桌面 overlay `desktop-plugins/dshbot/desktop-dshbot.patch.yml`（insert id `dsh-bot`，按包名装载）。`HarnessController` 把 overlay 追加到 `patchFiles`（install → usage → session-search → dsh-im → market → dshbot），经 `--patch` 传给 CLI；skip 启动同样携带。

## 升级迁移

`src/main/legacy-dshbot-preset.js` 只清除旧桌面写入的受管 patch 块和明确指向旧预置副本的链接，随后由内置 ensure 重建 junction 与 overlay。机器人设置、记忆、房间 preset、会话、manifest 依赖与 bundles 均保留。

## 内置语义

disable 名单对 `dshbot` 别名无效（config 归一化剔除，IPC 返回 `desktop-builtin`）；forensics 把它计入 `PRESET_PLUGINS`/`IN_BOX_PACKAGE_NAMES`，缺席 profile 清单的 suspect 即 `desktopRuntimeDamage`，Recovery Board 显示「内置组件损坏」。vendor 源或声明入口缺失时 ensure 失败并阻断启动——skip 修不了桌面损坏。

## 宿主契约

Harness 提供通用的插件会话展示契约：`session/presentation` 日志事件记录
`owner` 和 `title`，普通会话列表、搜索和空会话复用排除已归属会话；插件仍
通过原 Session ID 打开正常聊天界面。清除展示元数据恢复普通导航，用户显式
分叉不继承插件归属。此契约不授予工具权限，也不是访问控制或数据隐藏机制。
dshbot 用它对齐固定联系人/群聊会话（`origin: 'dshbot'`、`agentPreset:
'dshbot-room'`），侧栏 `sidebar.nav.tab`/`sidebar.page` 槽位由插件填充出
Bots tab；卸载语义已被内置取代，槽位恒有内容。

会话展示可显式声明 `composer: 'managed'`，继续使用同一个编辑器，但由插件
通过 `conversation.input.managed` 提供资料配置入口，隐藏独立模型和开发配置
快捷控制。受管会话保留真实标题和根级面板/窗口控制，同时隐藏普通开发会话的
预设、轨迹、Session 日志、Git 分支与 Commit；历史视图状态不会让会话滞留在
已隐藏的轨迹页。该字段不改变工具授权。插件应用模型使用 `saveAsDefault: false`，
不修改普通会话默认模型。

- 本体测试覆盖 overlay 写入/幂等、junction、旧块迁移、缺源/缺依赖 fail-closed、disable 免疫；机器人业务测试随 `vendor/dshbot` 快照维护。
- 独立仓 `ChisaAlter/dshbot` 继续存在，仅作历史参照，不是桌面运行时依赖。
- 契约：[dshbot](../../features/dshbot.md)；宿主扩展点：[plugin-session-navigation](../../features/plugin-session-navigation.md)。
