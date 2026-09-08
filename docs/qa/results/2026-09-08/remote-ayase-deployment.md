# ayase.cn 远程服务器迁移

日期：2026-09-08

## 交付

- DNS `ayase.cn` 解析到 `38.76.185.154`。
- dshd relay 部署为 Docker Compose 服务 `dshd-relay`，目录 `/opt/dshd-relay`，状态目录 `/opt/dshd-relay/data`。
- nginx TLS 入口使用精确 `/ws` 和 `/health` 转发 relay；`/dshd/` 提供当前 `mobile/web`，不改站点其他路由。
- live nginx 备份：`/opt/newapi-proxy/nginx.conf.bak-dshd-20260908T001226Z`。
- nginx 候选配置也写入同一 DSHD 标记块并单独通过 `nginx -t`，避免后续站点部署覆盖。
- 桌面默认中继改为 `ayase.cn:443`，TLS 开启；公网扫码页改为 `https://ayase.cn/dshd/`。
- 配置升级只迁移旧内置 `125.124.85.212:8411`；自定义中继与 TLS 选择保留。

## 验证

- relay 容器：`running`、`healthy`、`restarts=0`。
- nginx live 与候选配置：语法检查通过。
- 公网 HTTP：`/health` 200；`/dshd/`、`app.js`、`chisacode/session.js` 200，Cache-Control 为 `no-cache`。
- 公网 WSS：`wss://ayase.cn/ws?...` 完成 101 Upgrade。
- 公网目录一致性：本地 fixture 与 `https://ayase.cn/dshd/` 的 live/archived 目录相同。
- 聚焦 Node：92 pass、0 fail、1 环境 skip。
- `ui-settings-remote`：bundle 通过，Vitest 10/10。
- 真实 daemon + 公网 relay + 公网 SPA：`tools/remote-web-qa/run-e2e.mjs` 10/10，通过配对、会话界面、坏 offer、无 hash、停止与断线检查。

## 边界

- E2E 使用桌面 Chrome，不是真机系统相机或 Android WebView 验收。
- daemon 启动时本机 `better-sqlite3` Node ABI 不匹配，测试中的可选 Agent SQLite index 降级；远程控制、配对与会话界面未受影响。
- 未构建正式安装包，未执行保留用户数据的覆盖升级。
- SSH 密码、offer、device secret 与会话内容均未写入仓库或本报告。
