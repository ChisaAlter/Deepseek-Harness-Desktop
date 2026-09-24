# Decision: 鲸鱼娘与桌宠设置在 Harness 0.1.7 上的恢复

Status: implemented

中文 | [English](2026-09-23-whale-pet-settings-recovery.en.md)

## Problem

升级后的设置客户端需要显式注入 `remote.session`；缺失时设置分区渲染抛错，桌宠页显示空白。鲸鱼娘插件仍调用已移除的 `settings.register`，并在未激活的注入子上下文里登记 Web 路由，导致插件启动失败和 `/dsh-whale/assistant/ensure` 返回 405。新版 Agent preset 不再扫描 `.agent-presets` 目录。

## Decision

- 设置客户端声明 `remote.session` 依赖，保留账户菜单内可见的设置入口，同时提供隐藏的 DOM 深链触发点供桌面 `settings-jump` 使用。
- 桌面通过 `--patch` 注入鲸鱼娘插件，SettingsForms 拒绝写入该插件的 Config。可编辑设置改存 `data/whale/settings.json`，以快照冲突检查和临时文件原子替换写入。首次读取从旧 `settings.yaml.imported` 迁移用户字段；保留旧文件，旧会话 ID 不自动复用，因为当前 Harness 无法重放部分旧会话。新会话 ID 写入新文件并跨重启复用。
- 在宿主根上下文登记经过连接鉴权的 `/dsh-whale` 路由；在显式注入的子上下文注册 `whale-girl` preset 和会话脉冲，随插件卸载清理。

## Alternatives considered

- 继续写 Harness SettingsForms：桌面 `--patch` 注入插件，写入始终被覆盖保护拒绝。
- 删除旧会话再建：会丢失历史。旧文件保留，新会话另建并持久化。

## Consequences

鲸鱼娘设置由插件数据文件承载，不再由 Harness 设置服务编辑；旧会话记录仍留在磁盘。桌宠设置深链恢复，可见入口仍在账户菜单。

## Verification

宿主路由、preset、设置持久化和设置客户端测试通过；持久化测试确认重新创建 scope 后读取同一会话 ID。源码应用在构建清理前实机验证桌宠设置字段可见、鲸鱼娘入口能创建并打开真实会话、未认证请求返回 401；新持久化实现仍待构建后实机复验。
