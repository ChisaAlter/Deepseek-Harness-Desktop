# Decision: 远程配对主进程只窄 import server 模块，不再加载全量 barrel

Status: implemented

中文 | [English](2026-09-18-dshd-remote-narrow-server-api.en.md)

## Problem

装机包点「开启」远程（或弹窗自愈、轮询补码、刷新配对码、启动恢复任一入口）都汇聚到 `DshdRemote.ensureApi()` → `loadServerApi()`，原实现在 Electron **主进程** `import()` 整个 `exports.js` barrel——vendored 全量 daemon 依赖图（express、MCP SDK、全部 provider、speech 链）。ESM 加载是调用线程上的同步文件 I/O + 编译 + 顶层求值：实测该 import 产生约 3 万次模块加载事件、开发机热缓存约 1.3s；装机环境下 `resources/vendor/dshd-remote/node_modules`（107MB / 4098 个 JS）每文件首读都过杀软实时扫描，主线程同步阻塞可放大到数十秒——Windows 直接把窗口标为「未响应」（WER AppHangTransient 同型事故，harness-extract 的 `fs.rmSync` 前科）。主进程实际只需要三个符号：`generateLocalPairingOffer`、`RelayDeviceCredentialStore`、`DSH_VENDOR_PACKAGES`（12 个包名常量），为它们加载全图是越界。

## Decision

`loadServerApi()` 改为只 `import()` `exports.js` 同目录的两个窄入口：`pairing-offer.js` 与 `relay-device-credential-store.js`（实测合计 ~600 次模块加载、<100ms 热缓存），返回 `{ generateLocalPairingOffer, RelayDeviceCredentialStore, DSH_VENDOR_PACKAGES }` 窄面。`DSH_VENDOR_PACKAGES` 在主进程镜像为常量（上游定义在 `dsh-agent.ts`，该模块本身拖着 provider 子图），`dshd-remote.test.js` 新增 parity 测试把镜像钉到 vendored 源文件，vendor sync 改动清单时测试立即红。`SERVER_EXPORT` 仍是 runtime 完备性哨兵与 daemon 子进程 launch file 入口——子进程照常 `import()` 全量 barrel 跑 `createChisaCodeDaemon`，隔离架构不变。

## Alternatives considered

- **保留 barrel import、只在首次后缓存** — rejected：`serverApi` 本来就缓存，问题在首次加载那一次就足以让装机首点「开启」冻结数十秒；缓存不消除冷路径成本。
- **配对 mint / vendor 完备性检查全部移进 daemon 子进程，主进程零 vendored import** — rejected：需要给 runner 协议加 mint 请求/响应路由与错误传播，`rotateToken` 当前契约允许 daemon 不在场时凭 file-backed home 出 offer，迁入子进程会改变这条用户面契约；feature 卡本就定义主进程为「进程管理面 + file-backed 配对/快照」，窄 import 即可满足，不必搬边界。
- **运行时 regex 解析 `dsh-agent.js` 提取 `DSH_VENDOR_PACKAGES`** — rejected：dist 是构建产物，tsdown 输出形态一变提取即静默退化（vendor 回退后 dsh provider 悄悄不可用）；镜像常量 + parity 测试让漂移在 `node --test` 显红，比运行时解析更可控。
- **`worker_threads` 里跑 barrel import 再回传** — rejected：ESM namespace 不可跨线程结构化克隆，还得包一层消息协议把函数面 RPC 化；为三个符号建 RPC 边界成本与「移进子进程」同级，却没有它的收益。

## Consequences

代价：`DSH_VENDOR_PACKAGES` 镜像与 vendored 源之间靠 parity 测试维持同步（漏跑测试才会漂——门禁覆盖）；窄 api 面意味着主进程日后需要 barrel 新成员时必须显式加窄入口或评估迁移，不能再随手取。收益：开启路径的主线程同步负载从约 1.3s（热）/ 数十秒（装机冷 + 杀软扫描）降到 <100ms 量级；`shell:get-remote` 轮询补码、弹窗自愈 save、rotateToken、启动 `sync()` 恢复全部受益；`dshd-remote.test.js` 36 pass（窄面断言 + barrel 子进程契约 + parity），`dshd-daemon-runner`/`remote-epipe`/`stdio-guard`/`lan`/`ipc` 套件共 80 pass 不变，真实 vendored daemon 子进程端到端用例通过。
