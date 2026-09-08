# Agent Note: 桌面插件市场版本更新

Status: implemented

[English](2026-09-07-desktop-marketplace-version-updates.md) | 中文

## 问题

桌面自有插件市场最初只保留目录浏览、安装和卸载行为。上游 `dshmarket` 源码原本支持逐插件 npm 版本与 Git commit 更新，因此移除该源码时也移除了用户预期的维护路径，用户只能手动卸载再重新安装插件。

## 决定

本决定部分反转 [Desktop-owned marketplace section](2026-08-25-desktop-owned-market-section.zh.md) 中暂不移植更新的决定。桌面自有引擎恢复版本和 commit 更新，同时继续移除第三方 `dshmarket` 运行时、独立 HTTP 路由、HMR、热禁用状态与自身更新通道。

`marketplace-updates.js` 只检查已安装且仍能匹配精选目录行的插件。npm 行比较 web profile 中实际存在的包版本与注册表 `latest` 值，只有普通 semver 优先级能够证明目标版本更高时才提供更新。GitHub 行比较 profile 锁文件 commit（或 manifest 中的显式 commit pin）与仓库 HEAD。来源缺失、非 semver、本地链接、未收录或其他无法判定的行都不提供更新。npm 或 GitHub 来源查询失败会传播为聚合检查失败，不会宣称所有插件均为最新。结果使用 30 分钟进程内缓存，缓存键包含目录时间戳、依赖规格、已安装版本和锁文件 commit。

渲染进程只通过 `shell:update-marketplace-plugin` 发送 catalog id。主进程重新校验目录收录、弃用状态、退役家族、已安装包身份和检测到的目标。npm 更新安装检测到的精确版本；普通 GitHub 更新安装检测到的精确 commit。精选 `#path:` monorepo selector 不能同时编码 commit 与路径，因此继续使用精选 selector，只有结果锁文件 commit 等于检测到的 HEAD 时才提交操作。

引擎在运行 `dsh plugin add` 前快照 profile `package.json`、`pnpm-lock.yaml` 和 `pnpm-workspace.yaml`。命令失败、构建脚本被拦截、版本或 commit 未变化、缺少可加载入口或出现新的 loader id 冲突时，引擎恢复三个文件（包括本次尝试写入的 allowBuilds 授权）并运行 profile install，以重建此前的依赖树。结果会报告回滚是否完成。更新成功后清除检查缓存，并通过既有 HarnessController 路径重启 Harness。

设置分区在匹配的发现卡片与已安装行中显示紧凑的当前值到最新值文本和「更新」按钮。Git commit 显示 7 个字符，无障碍 title 保留完整值。现有进度日志、`needsAllowBuilds` 确认、成功 / 错误通知以及 primary / ghost 按钮层级仍是唯一的操作 UI。

## 曾考虑的替代方案

**恢复完整 `dshmarket` 包。** 否决，因为这会重新引入第二个市场所有者、HTTP 接口、UI 皮肤以及重启 / HMR 路径，违背桌面自有市场决定。

**不检测更新，直接再次运行安装命令。** 否决，因为用户无法区分存在更新与无变化；当 npm `latest` 标签落后于已安装版本时，更新操作还可能变成降级。

**更新所有已安装依赖，包括未收录插件。** 否决，因为桌面无法在执行包管理器变更前校验精选来源身份。未收录行仍可从市场卸载，但不能在市场中更新。

**把包管理器成功退出直接视为更新已提交。** 否决，因为新发布版本等待窗口、不完整产物和 loader id 变化可能导致已安装版本不变，或使下次启动失败。安装后检查与回滚属于更新事务的一部分。

## 后果

用户无需先卸载即可维护目录收录的社区插件。更新检查会增加有界的 npm 与 GitHub 元数据请求，但不会阻塞目录渲染；无法判定时不提供操作。更新仍会重启 Harness，本功能不承诺实时替换。回滚会恢复 profile 声明和锁定状态，然后依赖 profile install 重建包文件；重建失败会明确显示，不会被误报为回滚成功。

## 测试

桌面测试覆盖仅前向 semver 比较、npm 与 GitHub 检测、精确版本 / commit 目标、成功更新、命令失败回滚、成功但未变化时回滚、preload 暴露和既有安装 / 卸载互斥。客户端测试覆盖桌面 API 门控、npm 与短 commit 差异、更新操作、构建脚本授权重试、进度及已安装 / 发现页呈现。聚焦桌面市场套件 72 项通过，聚焦客户端套件 37 项通过，完整 GUI 套件 5476 项通过、1 项跳过，客户端类型检查和包 bundle 通过。

## 相关

- 部分反转：[Desktop-owned marketplace section](2026-08-25-desktop-owned-market-section.zh.md)
- 目录身份：[Desktop marketplace curated catalog](2026-08-18-desktop-marketplace-curated-catalog.zh.md)
