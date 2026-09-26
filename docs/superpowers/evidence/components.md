# 组件平台证据记录（车道 C）

日期：2026-09-26 · 车道：C · 范围：`src/launcher/components/`、`src/main/ipc-components.js`、`src/renderer/launcher-components.js`、`components/samples/`

## 持久化选择

选了**独立 JSON 文件**而非 config `components` 字段：记录承载高频运行时状态（pid / state / lastError），每次状态迁移都写会搅扰 config.json；64KiB 白名单上限是给渲染层 blob 的，不是给主进程生命周期簿记的。

- 注册表：`<launcher userData>/components/registry.json` — 同目录 tmp+rename 原子写；损坏文件改名 `registry.json.broken` 存证后从空表恢复。
- 负载：`<userData>/components/<id>/versions/<version>/`（每版本不可变目录，stage→verify→rename 切换）。
- 数据：`<userData>/components/<id>/data/`（跨版本/回滚保留；uninstall 删负载不删数据 — v1 默认保守保留，UI 删除选项待后续）。
- 日志：`<id>/data/component.log`（child stdout/stderr 落盘，>256KiB 截断重写）。

## 注册表形状

```json
{ "components": { "<id>": {
  "id": "launcher-notes", "name": "启动器便签",
  "version": "2.0.0", "previous": "1.0.0",
  "state": "installed|stopped|running|error",
  "pid": 1234, "url": "http://127.0.0.1:PORT/",
  "source": "bundled", "installedAt": "…", "updatedAt": "…", "lastError": ""
} } }
```

`previous` 保留最近 1 个版本供回滚；update 时被取代的旧 previous 目录即清理。回滚后 `previous` 指向被回退的版本（可重做 update）。`pid` 持久化使启动器重启后可收养仍存活的组件；`state==='running'` 且 pid 已死 → list 调和为 `stopped`。

## 组件模型 v1

- 目录清单源：`components/samples/<id>/<version>/manifest.json`（`{id,name,version,description,entry,kind}`，id/版本须与目录名一致，entry 拒绝绝对路径与 `..` 穿越）。`source` 字段现为 `bundled`，远端目录源以后按同形状插入。
- spawn：`spawn(process.execPath, [entry])` + `ELECTRON_RUN_AS_NODE=1`（Electron 二进制即 Node；源码 `node --test` 下同路径），`windowsHide:true`，非 detached — 组件生命周期绑定启动器；`before-quit` → `shutdown()` 同步 taskkill 全部 running 记录；关窗（非退出）不杀，符合「关窗驻留托盘」。
- 存活：win32 `tasklist /FI "PID eq n" /FO CSV` 查 `"pid"` 字段；其它平台 `process.kill(pid,0)`。
- 停止：先 `taskkill /PID n`（实测对无窗 node 拒绝：`只能强制终止`）→ 1.5s 宽限 → `taskkill /PID n /T /F`。
- 启动裁决：spawn error / grace 内即退出 → `error`；存活 → `running`；协作组件写 `data/state.json`（pid/port/url/heartbeat）被等待后回填 `url`。
- 监管：运行中非预期退出 → 有界退避重启（500ms×2^n，上限 3 次）→ 仍死 → `state:'error'` + lastError。
- 并发：组件操作锁为**每 id 一把**，与 DSHD 安装锁分离；忙时 `{ok:false,error:'busy'}`。

## IPC（冻结契约，已实现于 ipc-components.js）

`shell:components-list/-install/-start/-stop/-update/-rollback/-uninstall` 全部走 `ctx.handle(channel, ctx.LAUNCHER_ONLY, listener)`；进度经 `ctx.send(event,'shell:components-progress',{id,op,phase,percent,message?})`，phase ∈ copy/verify/switch/spawn/wait/stop/remove/retry/done/error。`contributeStatus()` 返回 `{components:[{id,state,version}]}`（缓存注册表，无探测，sync）；register 未运行前返回 `null`。

## 测试（31/31 绿，`node --test src/launcher/components/*.test.js`，~19.8s）

已覆盖迁移：`available →installed→running→stopped→running→installed(update)→installed(rollback)→removed(uninstall→available)`；`running→error`（grace 内早退、退避耗尽）；orphan pid 收养/调和；并发 busy；卸载保数据。

**真实端到端**（非 mock，`index.test.js` 末条）：装 `launcher-notes@1.0.0` → spawn 真 node 进程 → `GET /` 200 且 `version:'1.0.0'`、`POST /notes` 201、`state.json` 心跳落盘 → 运行中 `update`→`{from:'1.0.0',to:'2.0.0'}` 换 pid 重启 → `GET /` 报 `2.0.0`、v2 专属 `GET /stats` 200 且便签仍在（数据目录跨版本）→ `rollback`→`{to:'1.0.0'}` 重启回 v1、`/stats` 回到 404、便签仍在 → `stop` 后端口拒连 → `uninstall` 删 versions 留 data → list 回 `available`。

## 契约偏差

- **挂载面差异**：当前 `launcher.html` 尚无 `panel-components` 容器与 `<script src="launcher-components.js">` — 计划约定由车道 A 骨架预留（§5.0.3）。本车道产物按约输出 `window.__launcherComponents.mount(containerEl, window.shell)`，二次调用幂等（同容器+同 shell → 仅刷新）。需车道 A 合入后整体验证面板可见性。
- 组件页用现有 launcher.css 类（`.list/.row-main/.row-title/.row-meta/.badge/.actions/.primary/.ghost/.danger/.progress`），未新增 CSS；原型里的 `.comp-icon/.small` 类若由车道 A 落进 launcher.css 可再增强。
- 打包面：`components/samples/` 进 slim NSIS 需在 `electron-builder.launcher.yml` extraResources 登记（集成步职责）；源码运行与 `DSHD_LAUNCHER_PACKAGE=1` 下已可全链路运行。
