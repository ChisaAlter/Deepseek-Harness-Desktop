# Decision: 构建输入按真实来源判定，每次运行只枚举一次

Status: proposed

中文 | [English](2026-09-22-build-input-scan-dedup.en.md)

## Problem

源码启动在 Electron 进程创建前先跑 `scripts/prestart-ensure.mjs`，它有两类固定的浪费：

1. **整树遍历 + 事后过滤**。`newestMtime()` 递归整个 vendored Harness，然后按文件路径正则丢掉
   `docs`、`website`、`mobile`、`benchmarks` 等不可能成为 client 输入的子树；
   `scripts/prepare-dshd-remote.mjs` 又在同一次运行里独立递归 `packages/protocol/src` 与
   `packages/client/src` 两次：server stack 一次、mobile bundle 一次。
2. **失效条件过粗**。除了「client 源码比 build record 新」，`officialBuildReason()` 还把整个
   桌面仓库的 HEAD 与 build record 的 `DSH_CLIENT_COMMIT_HASH` 比较。只改 `src/main/**`、安装器
   代码或文档的 commit 同样把 client 构建判为陈旧，于是没有源码变化也会跑完整 `build:official`。
   反过来，`packages/client/**/tests/**` 与 `README*.md` 改动又会被当成真实输入，触发同样的重建。

两处都发生在应用可见之前，属于每次源码启动都要付的固定成本。

## Proposal

把「什么算 client 构建输入」收进共享模块 `scripts/source-scan.mjs`，并让判定与遍历分离：

- `isClientSourceFile()`：client 输入的真实文件谓词。保留 `packages/client`、`apps/web`、
  `scripts` 下会被构建读取的 `ts/tsx/css/html/json/yml`；排除 `tests`、`__tests__`、
  `*.spec.*`、`*.test.*` 与 `README*` 配对文档。
- `createClientSourcePruner()`：同名谓词的目录半边。遍历在进入目录前跳过不可能命中的子树，
  因此不再走一遍 `docs`/`website`/`mobile` 再按文件路径丢弃结果。

  目录谓词必须与文件谓词逐条对齐，否则会出现「文件谓词接受、目录谓词却把整棵树剪掉」的静默漏检。
  最明显的一处是 `scripts`：它本身是输入，`scripts/**` 的子目录同样是输入（文件谓词接受
  `scripts/**/*.ts`），因此目录谓词对 `scripts` 及其所有子目录一律放行，不能只放行顶层。
- `createScanMemo()`：单次运行内的「每目录一次枚举」memo。`prepare-dshd-remote.mjs` 的
  server stack 与 mobile bundle 共用 protocol/client 的扫描结果；显式 `--force` 时完全不扫描，
  因为 freshness 结果不会被读取。
- memo 只存在于进程内，不落盘。跨运行的持久 mtime 记录无法区分「文件没变」与「扫描没跑」，
  中断或外部改动会静默留下陈旧产物，而这正是这条路径此前失败的模式。
- 目录谓词与文件谓词分开，是为了让 `source-scan.test.mjs` 能机检：旧整树扫描与新剪枝扫描必须
  给出相同的 newest mtime，且 `tests`/`README` 不再是输入。

两处调用方**不能**共用同一份剪枝名单：

- client 扫描的 `DEFAULT_PRUNED_DIRS`（`node_modules`、`lib`、`dist`、`.dsh-build`、`.git`、
  `coverage`、`.artifacts`）是按「这些名字在 client 输入树里只能是产物」得出的。
- remote 扫描的名单窄得多（`REMOTE_PRUNED_DIRS` = `node_modules`、`dist`、`.tmp`）：在 remote
  的源码树里 `src/lib/*` 可以是真实源码，把 `lib` 当通用产物名跳过会漏掉真实编辑。
- remote 扫描把**目录自身的 mtime** 计入结果（`includeDirMtime: true`）。只删除文件时，被删掉的
  文件不再贡献 mtime，只有父目录的 mtime 会动；不折入目录 mtime 就会漏掉这类变化。
  单文件输入（例如 mobile 入口模块）仍按文件 mtime 处理，不因 `ENOTDIR` 失败。

## Alternatives considered

- **继续整树遍历，只优化 `statSync` 调用** — rejected：成本主要是目录项数与递归本身，
  单次 stat 的微调不改变「枚举整棵树」这一级差。收益只能来自不进入无关子树。
- **只加文件谓词、不做目录剪枝** — rejected：`docs`/`website` 下同样有 `*.json`/`*.ts`，
  文件谓词无法在遍历前排除它们；实测整树 261 ms 与剪枝后 138 ms 的差值来自这部分。
- **删除 HEAD 比较，只信 client 源码 mtime** — rejected：client 产物嵌入了 commit/version
  元数据（`packages/client/ui-sidebar/src/client/SidebarRoot.tsx` 读取 `DSH_CLIENT_COMMIT_HASH`
  与 `DSH_CLIENT_VERSION`），元数据变化必须重跑受影响阶段。本决策只把与 client 无关的变化
  移出判定，阶段边界由 `docs/features/desktop-build-runtime.md` 继续约束。
- **把 prestart 整体改成异步** — deferred：Electron 仍要等 prestart 结束，换成异步 API 不缩短
  wall-clock，只把同步阻塞挪到别处。

- **让 remote 复用 client 的剪枝名单** — rejected（已实现并推翻）：通用名单会在任意深度跳过名为
  `lib` 的目录，而 remote 的 `src/lib/*` 可能是合法源码。每个调用方保留显式策略。

- **remote 只看文件 mtime** — rejected（已实现并推翻）：只删除文件时没有文件 mtime 会前进，
  变化信号只存在于父目录。`includeDirMtime` 是这类删除能否被发现的关键。

- **目录谓词只放行 `scripts` 这一层** — rejected（已实现并推翻）：`scripts/<子目录>/**/*.ts`
  满足文件谓词却会被目录谓词剪掉，属于「文件谓词接受但永远走不到」的静默漏检。

## Acceptance criteria

- `node --test scripts/source-scan.test.mjs`：剪枝前后 newest mtime 相等；`tests`/`README`/`docs`
  不是输入；memo 对同一目录只枚举一次并记录调用次数；`scripts/<子目录>` 下的输入仍被计入；
  remote 的 `src/lib/*` 不被误剪；只有文件被删除时目录 mtime 仍能反映变化。
- 同一套用例覆盖上述三种边界；删除文件的变化由目录 mtime 反映，不能被文件谓词漏掉。
- `node scripts/prestart-ensure.mjs` 在无相关源码变化时不触发 `build:official`，也不误触发
  ui-settings-remote 重新 bundle。
- `prepare-dshd-remote.mjs` 每次运行对 `packages/protocol/src`、`packages/client/src` 各只扫描
  一次。
- 去掉 `tests/`、`README*` 输入后，client 输入统计在本机约 138 ms（原整树扫描约 261 ms）。

## Risks

- 谓词现在按「构建实际读取的路径」收窄。若将来某个构建步骤读取 `packages/client/**/tests`
  或 `README` 作为输入（例如把用例当 fixture 打包），会漏掉真实变化；新增这类步骤必须同时
  更新 `isClientSourceFile()` 与测试。
- 目录剪枝依赖 `packages`/`apps`/`native`/`scripts` 这一层布局。仓库若把 client 源码移到这些
  顶层目录之外，判定会退化成「永不陈旧」，属于静默失效；测试固定了这层假设，移动目录前必须
  先改测试。
- memo 在单次运行内缓存 mtime。当前两个调用方都只在启动早期读一次、不写源码；复用到
  「扫描后写源码再扫描」的场景前必须重新确认。
- `DSH_CLIENT_COMMIT_HASH` 比较仍然存在，只是不再因其他目录的 commit 触发。元数据真正变化
  时的阶段复用由 build-runtime 卡负责，本决策不声称无关 commit 零成本。
- 本决策只修扫描语义与去重，**不**实现按阶段（native/host/client/web）的输入-产物凭据复用；
  后者是 ③ 的剩余部分，本记录不声称已完成。
