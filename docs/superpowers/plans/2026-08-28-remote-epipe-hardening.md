# 远程 EPIPE 止血与守护进程收敛 — 执行计划

Date: 2026-08-28

Feature: `remote-settings`（涉及 [mobile-remote](../../features/mobile-remote.md) 的提供方就绪面）

Work branch: `cursor/remote-epipe-hardening-2f82`

## 背景（已复核的根因）

1. **P0 EPIPE 崩溃**：开启远程 → 主进程内联跑 `createChisaCodeDaemon` → 手机端首个请求触发 `DshAgentClient` 懒构造 → `resolveDshVendorDir()` 调 `execSync("npm root -g")` **未传 `stdio`**。Node 对无 `stdio` 的 `execSync` 会把子进程 stderr 用 `process.stderr.write()` 转写回父进程；桌面 GUI 的 stderr 常是已断开的管道（安装器/启动器父进程已退出），这笔写入以 uncaughtException `EPIPE: broken pipe, write` 打爆 Electron 主进程。函数体内的 `try/catch` 拦不住——写入发生在 `execSync` 返回之后、Node 内部。已用最小复现脚本确认（栈与用户截图一致）。
2. **崩溃时序造成「默认开启」假象**：`shell:save-remote` 先 `saveConfig({remoteEnabled:true})` 再 `sync()`；崩溃后重启读到 `remoteEnabled:true`，引导期 `sync()` 再次尝试拉起 daemon。`config.js` 默认值本身是 `false`。
3. **P0 架构**：上游 chisacode desktop 用 `packages/desktop/src/daemon/daemon-manager.ts` 把 daemon 放**独立子进程**（显式 pipe stdio、崩溃只死子进程）；本仓库把 daemon 塞进 Electron 主进程，daemon 侧任何未捕获错误都威胁整个应用。
4. **P1 失败不可见**：引导期 `beginRuntimeRecovery` 的 `Promise.allSettled([remote.sync(), …])` 吞掉启动失败（连日志都没有）；弹窗里「开启」按钮在 `enabled=true` 时是 no-op，启动失败后用户无法重试，只看到「还没有可扫描的配对二维码」。
5. **P1 未接通桌面 Harness**：`CHISACODE_DSH_VENDOR_DIR` 未设置 → dsh provider 反复探测 npm 全局安装（每次都是一笔 `execSync`），桌面自带的 harness 插件树从未被利用。
6. **P2 stop 断线**：`HarnessController.shutdown()` 调 `this.remote?.stop?.()`，而 `ChisaCodeRemote` 只有 `stopDaemon()` —— 可选链让它静默 no-op，退出时 daemon / mobile-web server 泄漏。

## 分阶段

### 阶段 1（本轮交付）— 止血 + 接线 + 可见性 + 收敛

1. **vendor 修复（根因）**：`dsh-agent.ts` 的 `execSync("npm root -g", …)` 增加显式 `stdio: ["ignore", "pipe", "pipe"]`。Node 只在 `options.stdio` 缺省时才转写 stderr（`inheritStderr = !options.stdio`），显式给出后转写路径整体消失。同时导出 `DSH_VENDOR_PACKAGES` 供桌面侧复用（见 4）。`prepare-chisacode-remote.mjs` 按 mtime 重建 dist，改动会随下次启动/打包生效。
2. **主进程 stdio 防线（纵深）**：新增 `src/main/stdio-guard.js`：
   - `installStdioGuard()`：给 `process.stdout` / `process.stderr` 挂 `error` 监听，吞掉断管类错误（EPIPE / EIO / EBADF / ERR_STREAM_DESTROYED）——日志 fd 断了永远不该杀 GUI 应用；其他流错误记入 dsh 日志。
   - `installUncaughtBrokenPipeGuard()`：`uncaughtException` 中仅对「写系统调用 + 断管类 code」放行返回（覆盖 in-process daemon 里向已死子进程 stdin 写入等 Electron 主进程护不住的场景），其余错误复刻 Electron 默认行为（错误框 + 继续运行）并记日志，不改变非 EPIPE 的可见性。
   - `index.js` 尽早安装（在 ChisaCodeRemote 构造前）。
3. **失败可见 / 可重试**：
   - `HarnessController` 引导期 remote sync 失败改为记日志（与 596 行 runtime 路径同款文案），不再被 `allSettled` 无声吞掉；`snapshot().error` 本就会带给弹窗。
   - `RemoteSection`：`enabled && !listening` 时「开启」按钮允许重试（再次 `save({remoteEnabled:true})` → `sync()` 重启 daemon）；提示语从泛泛的 `noQr` 换成明确的 `notListening`（zh/en 双语新 key）。
4. **桌面 harness 收敛（第一步）**：`ChisaCodeRemote.startDaemon` 在创建 daemon 前，若用户未自设 `CHISACODE_DSH_VENDOR_DIR`，探测 `harnessRoot()/node_modules/@deepseek-ai` 是否含全部 `DSH_VENDOR_PACKAGES`（且各自 `lib/index.js` 已构建），完整则设置该环境变量。效果：
   - 桌面自带 harness 构建完成时，dsh provider 直接用桌面插件树（不再依赖 npm 全局安装）；
   - 环境变量一旦设置，`resolveDshVendorDir` 走 override 分支，**桌面上不再发生 `npm root -g` 的 `execSync`**（EPIPE 向量在桌面侧二次消除）；
   - 不完整时不设置，保留 npm 全局回退（已被 1 修安全），不回归已有全局安装用户。
5. **stop 接线**：`shutdown()` 改调 `stopDaemon()`；测试 fixture 同步。
6. **回归测试**：
   - `src/main/stdio-guard.test.js`：断管吞掉 / 非断管透传 / uncaught 分类。
   - `src/main/remote-epipe.test.js`：(a) 源码 tripwire——vendored `dsh-agent.ts` 的 execSync 必须带显式 stdio；(b) 行为测试（dist 存在时）——真实 broken-stderr 子进程内跑 `resolveDshVendorDir`，断言不再 uncaught（dist 缺失时 skip，CI 不依赖 vendor 构建产物）。
   - `chisacode-remote.test.js`：vendor-dir 探测（完整→设 env、不完整→不设、用户已设→不动）。
   - `harness-controller.test.js`：shutdown 调 `stopDaemon`。
   - `remote-section.client.spec.tsx`：enabled+未监听 → 开启按钮重试、`notListening` 提示。

### 阶段 2（2026-08-28 第二轮实施）— daemon 子进程隔离（对齐上游架构）

上游对照（`packages/desktop/src/daemon/daemon-manager.ts`）：daemon 以 `ELECTRON_RUN_AS_NODE` runner 子进程运行，`stdio: ['ignore','pipe','pipe']` 捕获启动输出，pid-lock + CLI `daemon status` 轮询就绪；配对 offer 由**另一个进程**（CLI `daemon pair`）对同一 chisacode home 生成——`websocket-server.ts` 每次 pairing 握手都 `new RelayDeviceCredentialStore(home)` 从磁盘重读，跨进程签发的一次性 token 可被 daemon 消费。上游无自动退避重启（仅版本不匹配重启 + 手动 restart）。

本仓库落法（差异点：产品把 daemon 生命周期绑定桌面应用，不用 detached 常驻）：

1. **runner**：新增 `src/main/chisacode-daemon-runner.mjs`（纯 node ESM，`asarUnpack`）。argv 传 launch JSON 路径（`<home>/daemon-launch.json`，0600，含 serverExport 路径 + daemonConfig，不含任何密钥）。runner `import()` vendored server dist，`createRootLogger(format: 'json', file: false)`（pino JSON → stdout），`createChisaCodeDaemon` + `start()` 后打 `dshd_daemon_ready` 日志行；stdin 收到 `stop` 或 **stdin 关闭（父进程死亡）** 都优雅 `daemon.stop()` 后退出——attached 语义，主进程崩溃不留孤儿。SIGTERM/SIGINT（posix）同样优雅停。未捕获异常 → fatal 日志 + exit(1)。
2. **父进程（`ChisaCodeRemote`）改为进程管理面**：`spawn(process.execPath, [runner, launchFile], { stdio: ['pipe','pipe','pipe'], env: bridge })`，逐行解析子进程 stdout 的 pino JSON：`dshd_daemon_ready` → 就绪；`relay_control_connected` / `relay_error` / `relay_control_disconnected` → relay 状态（**替换** in-process 的 `attachRelayStatusProbe` logger 探针——同一批上游稳定日志标识，只是改在进程边界上读，不发明第二套协议）；全部行转发进 dsh 日志。就绪超时（30s）→ 杀子进程 + 抛出含 stderr 尾部的错误。运行中意外退出 → `snapshot.error` 置「守护进程异常退出」+ listening=false（阶段 1 的弹窗重试即恢复路径；与上游一致**不做**自动退避重启循环）。
3. **快照/配对不走 daemon 面**：`generateLocalPairingOffer` / `RelayDeviceCredentialStore` 本就 file-backed，主进程继续 in-process 调用（与上游 `daemon pair` 独立进程的形状一致）；`snapshot()`、设备列表、unbind 全部不变。mobile-web :3180 留在主进程（静态 SPA，不依赖 daemon）。
4. **stop**：stdin 写 `stop\n` → 等退出 ≤5s → 超时 `kill()`（Windows 无 SIGTERM 语义，stdin 通道即优雅路径）。
5. **打包**：runner 加入 `build.asarUnpack`（node 子进程读不了 asar），运行时以 `app.asar → app.asar.unpacked` 替换解析；vendored dist + 生产 node_modules 本就走 extraResources（asar 外）。

### 阶段 3（2026-08-28 第二轮实施）— dsh provider 接通 + DSHD_* 命名收敛

**命名表**（桌面对外一律 `DSHD_*`；`CHISACODE_*` 只出现在 daemon 子进程 env 的受控注入里，主进程自身 env 不再写任何 `CHISACODE_*`）：

| 桌面字段（对外 / 文档） | 语义 | Bridge（仅 daemon 子进程 env） |
| --- | --- | --- |
| `DSHD_CHISACODE_HOME`（debug env） | 覆盖 remote 运行时 home，默认 `userData/chisacode-home`；打包版仅 `DSHD_ALLOW_ENV_HOME=1` 时生效（复用 dsh-home 的守卫开关，语义一致） | `CHISACODE_HOME=<resolved home>` |
| `DSHD_DSH_VENDOR_DIR`（env） | dsh provider 插件树覆盖；优先级：`DSHD_DSH_VENDOR_DIR` > 继承的 `CHISACODE_DSH_VENDOR_DIR`（上游兼容）> 自带 harness 完备目录 > 不设（子进程内走已加固的 npm 回退） | `CHISACODE_DSH_VENDOR_DIR=<resolved>` |

选名理由：字面量 `DSHD_HOME` 已被 dsh-home 卡占用（桌面 dsh home debug 覆盖），不可抢占；`DSHD_REMOTE_HOME` 与 mobile-web/remote 配置面易混；`DSHD_CHISACODE_HOME` / `DSHD_DSH_VENDOR_DIR` 与上游名一一对应、映射自明。

1. **home 收敛**：daemon 子进程 env 注入 `CHISACODE_HOME`，dsh provider 的 managed home（`resolveManagedDshHome`）随之落在 `userData/chisacode-home/provider-runtime/…`，不再泄漏 `~/.chisacode`；主进程 env 零污染（PTY / `dsh web` 子进程不再看到任何 CHISACODE_*）——阶段 1 里 `applyDshVendorDir` 对主进程 `process.env` 的全局写入随之**移除**。
2. **`dsh-acp-demo` 启动路径**：自带 harness 存在 `packages/examples/acp-demo/lib/bin.js` 时，向 `<home>/bin/` 物化 `dsh-acp-demo`（sh）与 `dsh-acp-demo.cmd`（Windows）shim——`ELECTRON_RUN_AS_NODE=1 "<execPath>" "<bin.js>" "$@"`——并 prepend 到子进程 PATH。上游 `resolveProviderLaunch`/`findExecutable` 走 PATH 查找、`spawnProcess` 自带 Windows `.cmd` shim 处理，零上游改动。不走 `command replace`：保留上游 managed cordis.yml 组合与每会话模型 pin。harness 未构建时不物化（provider 显示不可用，诚实降级）。
3. **凭据通道**：daemon 子进程 env 经 `applyOfficialDeepSeekSpawnEnv`（`src/shared/official-deepseek-env.js`）注入 `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL`——与 `dsh web` 子进程同一策略（仅官方 https 主机），provider 继承 daemon env。密钥只进 env，不进 launch JSON。

### 阶段 2/3 风险与回滚

- **Windows spawn**：runner 由 `process.execPath` 直接拉起（非 `.cmd`，不涉 shell 引号）；provider 侧 `.cmd` shim 交由上游 `spawnProcess` 的 Windows shim 逻辑。打包真机 QA 仍是 Manual gate。
- **asar**：runner 必须在 `asarUnpack`；after-pack 若有布局校验后续可加断言（本轮 Gates 记录）。
- **孤儿进程**：stdin-close 自停 + attached（不 detach、不 unref）双保险。
- **回滚**：整段迁移集中在 `chisacode-remote.js` + runner 新文件，revert 对应 commits 即回到阶段 1 的 in-process 形态；launch JSON / shim 均为运行时生成物，无迁移负担。

### 阶段 2/3 Gates

| Kind | What |
| --- | --- |
| Automated | runner 集成测试（stub server export：ready / stdin stop / stdin-close 自停 / 崩溃 exit code）；父进程假 runner 测试（就绪、relay 状态解析、意外退出可见、stop 优雅+超时杀）；env bridge 纯函数测试（home/vendor 优先级、DEEPSEEK 官方策略、PATH prepend、ELECTRON_RUN_AS_NODE）；acp shim 物化测试；`DSHD_CHISACODE_HOME` 打包守卫测试；dist 存在时真实 daemon 起停集成测试 |
| Manual | Windows 打包机：开启远程 → 子进程隔离下扫码配对 → 强杀主进程无孤儿 daemon → 重启后设备仍在；dev 机（harness 已构建）：手机端 dsh provider 可创建会话 |

## 回滚

- 阶段 1 全部为加法/局部修复：revert 单个 commit 即可回滚对应行为；`CHISACODE_DSH_VENDOR_DIR` 探测不完整时零行为变化。
- vendor dist 由 prepare 脚本按 mtime 重建，revert 源码后下次启动自动回到旧产物。

## Gates

| Kind | What |
| --- | --- |
| Automated | `npm test`（含新增 stdio-guard / remote-epipe / chisacode-remote / harness-controller 用例）；`remote-section.client.spec.tsx` |
| Manual | Windows 打包机：开启远程（stderr 断管场景）不崩；开启失败 → 弹窗错误 + 「开启」重试；退出应用 daemon/3180 端口释放 |
