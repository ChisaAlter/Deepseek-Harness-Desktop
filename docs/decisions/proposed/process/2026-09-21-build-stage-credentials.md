# Decision: 官方构建按阶段验证输入-产物凭据，命中即复用

Status: proposed

中文 | [English](2026-09-21-build-stage-credentials.en.md)

## Problem

根仓库的 prestart 门禁过去只有两种结局：`client-build-environment.json` 的四个公开值与当前
checkout 一致就用上轮产物，否则整条 `build:official` 重跑。一个只改了 `src/main/**`、安装器
或文档的 commit 会满足「HEAD 变了」，于是 native、host、client、web 四个阶段全部重做；而
真需要重建时，四个阶段之间也没有边界——即使只有浏览器 bundle 嵌入了新的 commit/version，
Node 侧产物同样被删掉重写。四个阶段各自读什么、写什么从未落盘，所以没有任何机制能在下一轮
证明某个阶段「确实还是那批字节」。

## Proposal

新增 `vendor/deepseek-harness/scripts/build-stage-credentials.mjs`，把「一个阶段能否复用」
变成可验证的事实，而不是对 HEAD 的推断。它是单一实现：根 `scripts/prestart-ensure.mjs`
直接以 `.mjs` 消费（不需要 TypeScript 工具链），`vendor/deepseek-harness/scripts/build.ts`
通过 `build-stage-credentials.d.mts` 类型声明导入同一份代码，不存在第二份判定逻辑。

### 阶段与产物归属

`BUILD_STAGES` 按依赖顺序固定为 `native-system`、`host`、`client`、`web`。`host` 与
`client` 正是 `build:lib` 展开出的两个子脚本（`build:lib:host`、`build:lib:client`），
`build.ts` 改为直接调用子脚本，不再调用 `build:lib`——否则一次调用必然重跑两个面，按面复用
就无从谈起。

每阶段的输入根与产物根：

- `native-system`：输入 `native/system` 的清单、tsconfig、`scripts/` 与
  `packages/entry/src`；产物 `native/system/packages/entry/bin`。宿主二进制只在 Linux /
  macOS 构建，所以 Windows 上零产物是合法凭据（`requiresOutputs` 随平台判定），其它平台
  零产物即判为不可复用。
- `host`：输入 `packages`、`apps/cli`、`apps/desktop`、`apps/desktop-host`、三个
  tsconfig 与 `pnpm-lock.yaml`；产物同上，但只认 `lib/**` 中**不是**浏览器 bundle 的那些。
- `client`：输入与 host 几乎相同，只是把 `tsconfig.host.json` 换成
  `tsconfig.client.json`；产物只认 `client.js`、`client.<name>.js` 及其 `.map`
  （`packages/client/tsdown.client.ts` 钉住的 `entryFileNames` / `chunkFileNames`）。
- `web`：输入 `apps/web`、`packages`、`pnpm-lock.yaml`；产物 `apps/web/dist`。

「哪些路径算产物」由 `isGeneratedArtifact()` 按**精确的产物根**判定（`packages/*/*/lib/**`、
`apps/*/lib/**`、`apps/*/dist/**`、`native/system/packages/*/bin/**`），绝不按目录名
`lib` 通配：`packages/foo/src/lib/util.ts` 是真实输入，误判为产物会让陈旧产物通过校验。
host 与 client 共用同一批输出根，因此必须靠 `ownsOutput` 把 `lib/**` 分成两半，否则两个
阶段会互相认领对方的产物，一侧被删另一侧却仍称「已记录」。

### 三条判据

每个阶段记录四项事实，全部命中才允许跳过：

1. **inputs**：该阶段会读到的每一个文件，既存廉价的 `size:mtime:ctime` manifest 摘要，
   也存路径绑定内容摘要（`sha256(len:path || entry)`，路径参与摘要所以改名也算变化）。
   新增未跟踪文件、删除与改名都改变路径列表，manifest 本身就覆盖。
2. **outputs**：该阶段写出的每一个产物，同样记 manifest + 内容摘要。产物被篡改、截断或部分
   删除时校验失败并重跑，而重建出**字节相同**的产物仍然算命中。
3. **environment**：产物真正内联的公开值。只有 `client` 与 `web` 参与全部 `DSH_CLIENT_*`
   ——依据是这两个值的消费点确实只有 `apps/web/vite.config.ts` 与
   `packages/client/tsdown.client.ts`；`native-system` 与 `host` 记 `{}`。因此 commit /
   version 变化只重建 client + web，既不会重做 native/host，也不靠伪造记录值蒙混过关。
4. **formatVersion**：不认识的 schema 一律忽略并重跑，而不是信任。

判定顺序是快路径优先：manifest 摘要先比；manifest 命中即复用，manifest 变动时再用内容摘要
兜底——所以 `touch` 或「同大小同 `mtime` 的改写但字节不变」仍复用，而内容真的变了就必然
落到重跑。`ctime` 覆盖「同大小同 mtime 改写」这种其它字段无法察觉的编辑。

### 何时重建

以下任一情况都必须重建，且判定为 fail-closed：

- 凭据文件缺失、不可读、JSON 无法解析；
- `formatVersion` 与当前实现不符；
- 缺该阶段的条目，或条目字段类型不对；
- 记录的文件数与当前实测不一致；
- 环境摘要不一致；
- 需要产物的平台上产物为零，或所需产物缺失。

凭据只可能**跳过**工作，永远不可能让本该失败的阶段「成功」。`stagesToRun()` 还实现依赖累积：
若 `native-system` 失效，其后所有阶段一律重跑，避免用陈旧上游产物拼出一个看似有效的下游。
`buildStageCredentials()` 只把「本轮跑过」或「本轮仍验证通过」的阶段写回，跳过且已不成立的
条目不会被带进下一轮。

### 成本

稳态校验是一次覆盖四阶段根并集的整树遍历加逐文件 `stat`（本机 18k 文件约 1.15–1.3 s，
四个阶段共用同一次遍历与同一个文件身份缓存，缓存只在进程内、不落盘）；只有 manifest 变动的
阶段才重算内容摘要（四阶段合计约 160 MB，有界并发 32）。落盘位置是
`.dsh-build/build-stage-credentials.json`。

## Alternatives considered

- **继续用 HEAD 与 build record 比对** — rejected：它既过粗（无关 commit 触发全量重建，是
  本次要修的主因），也无法表达阶段边界；client 产物确实内嵌 commit/version，所以只能改成
  「元数据变化 → 只重跑真正消费这些值的阶段」，不能直接删掉校验。
- **只改 `prestart` 的比较方式，`build.ts` 仍然跑 `build:lib`** — rejected：`build:lib`
  必然连跑 host 与 client 两个面，浏览器 bundle 之外的 Node 产物会被无谓重写，阶段复用
  在真正需要的场景下失效。
- **按目录名 `lib` / `dist` 判定产物** — rejected：`packages/*/*/src/lib/**` 是真实源码。
  过宽的产物判定会让源文件被排除出输入集，属于静默漏检；`isGeneratedArtifact()` 因此只认
  精确产物根。
- **持久化 stat 缓存以省掉遍历** — rejected：跨运行缓存无法区分「文件没变」与「本轮没查」，
  中断或外部改动会静默留下陈旧产物，这正是这条路径此前失败的模式。（R4 已就
  `source-scan` 的 memo 作出同一判断。）
- **把内容摘要作为唯一判据** — rejected：18k 文件每次启动全量读盘约 2.2 s，是 manifest
  快路径的近两倍；manifest 本身已含 `ctime`，足以发现常见的同大小同 mtime 改写。内容摘要
  保留为 manifest 变动时的兜底，`verifyStageCredential(..., { content: true })` 也留出了
  显式强制内容校验的入口；本轮**未**在 CLI 暴露该开关。
- **产物缺失时也允许复用，交给构建工具报错** — rejected：那会把「凭据校验」降级成「碰运气」。
  需要产物的阶段在产物为零时直接判 stale。

## Acceptance criteria

- `node vendor/deepseek-harness/node_modules/vitest/vitest.mjs run
  scripts/build-stage-credentials.client.spec.ts --environment node`：无变化时复用；同大小同
  mtime 改写（用 `utimes` 还原 mtime 后仍能发现）判 stale；新增未跟踪文件、删除输入均判
  stale；产物篡改与产物缺失判 stale，字节还原后重新命中；仅元数据变化时只跑
  `['client','web']`；凭据缺失、截断、未来 `formatVersion` 一律 fail-closed；跳过的阶段其
  记录被正确保留。
- `node scripts/prestart-ensure.mjs` 在无相关源码变化时不触发任何构建；commit/version 变化时
  只重建 client + web（实测约 37–68 s，而全量重建显著更久）。
- `tsc --noEmit -p tsconfig.host.json` 通过：`build.ts` 通过 `.d.mts` 使用同一份实现，没有
  第二份判定逻辑。
- 直接运行 `build.ts --profile official` 在稳态输出
  `build: all stages are up to date; reusing verified artifacts`，并刷新
  `client-build-environment.json` 的 274 个产物与四项公开值。

## Risks

- 稳态校验仍要遍历约 18k 文件、耗时约 1.2 s（内容模式约 2.2 s），只是把「每次启动全量重建」
  换成「每次启动一次 stat 遍历」。CLI 未暴露 `--verify-build` 这类强制内容校验开关；需要更高
  保证时只能从代码调用 `{ content: true }`。
- 输入集是在阶段自身来源内**刻意偏宽**的。漏掉真实输入会让陈旧产物被复用（静默错误），多算
  一个无关文件只造成一次多余重建；因此新增输入路径时必须同步更新 `STAGE_LAYOUTS`，宁可多。
- `environment` 只对 client/web 绑定 `DSH_CLIENT_*`，依据是当前代码里这两个值的唯一消费点。
  若将来 host 产物也开始内联这些值，`stageEnvironment()` 必须同步修改，否则会出现「宿主产物
  陈旧却被判可复用」。
- 本决策只管阶段级凭据；`scripts/source-scan.mjs` 的 mtime 扫描去重与 remote 剪枝仍由
  [2026-09-22-build-input-scan-dedup](2026-09-22-build-input-scan-dedup.md) 负责，两者互不
  取代：前者决定「改了什么」，本记录决定「因此要重跑哪几个阶段」。
- 同一份凭据是构建产物的一部分，不随发布产物分发；CI 环境每次都是干净检出，
  第一次构建必然全量。
