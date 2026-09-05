# 远程设置（Settings → Remote）

连接方式为「局域网 / 服务器」，未设置时默认服务器（`relay`）。局域网保留为手动选项；默认模式不自动开启远程配对。

设置分区 `remote` 承载连接方式、网关高级项与**桌面内置** IM 渠道（`vendor/dsh-im`）；侧栏手机弹窗只负责开关、设备与扫码配对。产品契约见 [Feature: remote-settings](../../features/remote-settings.md)，配对网关见 [手机远程](mobile-remote.md)。

## 结构

| 标签 | id | 所有者 |
| --- | --- | --- |
| 网关 | `gateway` | `ui-settings-remote` |
| 消息渠道 | `channels` | 桌面内置 `@xmanrui/dsh-im`（`dsh-im-desktop.js`，不再软预置拷贝） |

加载入口：`src/main/dsh-im-desktop.js` → 桌面自有 overlay `desktop-plugins/dsh-im/desktop-dsh-im.patch.yml`（包名 insert，每次启动经 `--patch` 传，全量 + skip）+ `node_modules` junction 到 `vendor/dsh-im`；用户的 `cordis.patch.yml` 只做遗留受管块 strip（迁移），绝不写回。禁用名单不适用（config 归一化剔除别名；`shell:disable-plugin(s)` 返回 `desktop-builtin`）。缺依赖挡 `dsh web` 启动（skip 修不了）。市场同名包 `DROPPED`（家族 basename 匹配）。
