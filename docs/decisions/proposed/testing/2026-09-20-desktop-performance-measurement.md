# Decision: 桌面热路径性能以“先测量、后优化”的 C1 基线推进

Status: proposed

中文 | [English](2026-09-20-desktop-performance-measurement.en.md)

## Problem

审计修复计划把 Phase 6 定为“测量启动、主线程阻塞、IPC、内存、会话扫描、Files 搜索与打包，然后只优化被测量的热点”。此前项目没有任何性能测量脚本，也没有预登记的阈值，因此“哪里慢”只能靠代码阅读猜测。直接优化会把未经验证的假设固化进产品代码，而且无法证明改进不是回归。

## Proposal

引入一个**纯测量**的 C1 切片，只测三个主进程函数在**独立 Node 进程**中的行为：

| 用例 | 生产路径 | 结果能说明什么 | 结果不能说明什么 |
| --- | --- | --- | --- |
| P1 / P2 | `probeImportHold`（`src/main/data-import.js`），启动门闩在 `probeImportHold` 上早退 | 启动门闩探针的自身代价 | 整个应用启动、启动页绘制、Harness 就绪、打包后启动 |
| S1 / S2 | `scanImport`（导入页专用），会枚举会话并读取全部日志元数据 | 会话扫描函数自身代价 | Electron IPC 往返、Harness 自己的会话列表、压缩日志 |
| F1 / F2 | `listDir`（`src/main/workspace-fs.js`），含权威校验、目录枚举、一次批量 `git check-ignore` 与排序 | 目录列举函数自身代价 | 端到端 Files 搜索或渲染层响应性 |

测量协议（预登记，事后不得调整）：

- 两个**顺序**批次，每批每个用例一个**全新进程**；第二批用例顺序反转以暴露顺序/缓存效应。测量期间不并发跑完整测试、构建或人为负载。
- 每进程记录：模块加载时长（单独）、**真实的首次调用**（单独计时，其正确性在窗口之外用夹具摘要核对；其前不得再有未计时的“控制调用”，否则“首次调用”名不副实）、2 次不计时预热、10 次计时调用。计时窗口只包住生产调用本身；夹具生成、摘要、断言、内存采样与序列化都在窗口之外。调用返回后**先**取内存终点，再做投影/摘要/断言分配，避免把 harness 自身的分配算进增长。
- 指标：单调时长、`process.cpuUsage()` 的 user/system 差值（微秒统一换算为毫秒，不与其他单位混算）、10 ms 心跳的事件循环阻塞延迟（相对每次实际触发重新计时；`arm()` 结束预热后必须**同时取消并重挂定时器与其期望截止时间**，不得只重置期望值），以及内存：每次计时调用先取一个终点，固定让出 100 ms 再取第二个终点，发布全部 10 组观测，并**从发布的端点重新推导**增长序列后再取中位数（对照加载后基线）；与其矛盾的冗余汇总序列视为无效数据。
- 所有序列同时报告全部样本、中位数、最小、最大与 MAD；这批小样本不宣称 p95/p99。
- 判定阈值（**调查阈值**，非用户可见 SLO）：P1/P2 中位数 > 25 ms；S1/S2 > 250 ms；F1 > 100 ms；F2 > 250 ms；阻塞先对**每次调用窗口取最大值**得到 10 个观测，**再取批次中位数**，该中位数 > 50 ms 且比匹配空转对照（同样取窗口最大值）高 30 ms 以上；让出后 RSS 增长中位数 > 64 MiB 或 heap 增长中位数 > 32 MiB。
- 可重复性门只作用于**触发建议的那个指标**：延迟建议由各批中位数与 MAD 判定，阻塞建议由各批“窗口最大值的中位数”与围绕该中位数的 MAD 判定，两个层次不得混用（窗口最大值的批次最大值只能作为诊断值保留）；未触发建议的其他序列即使抖动也不得反过来制造 `INCONCLUSIVE`。内存沿用预登记的“两批同时越线”规则，不额外加 MAD 门——终点观测受 GC 时机影响，额外门会把时序噪声铸成发现。空转对照最大延迟超过 20 ms 即判环境受污染；对照最大值缺失或非有限同样使该用例无效。
- **无效测量不得产生被接受的建议，也不得保留否定结论**：worker 退出码非 0（即使输出形状正确）、schema/用例身份/摘要不符、样本缺失或非有限、校准缺失或未检出、任何必需输入哈希缺失或前后变化（含 worker 实际加载的本地生产依赖）、夹具内容摘要前后变化，任一出现即抑制候选选择并把结论改为 `INCONCLUSIVE`；`CORRECTNESS_FAILURE` 优先级最高。一致性检查不能只看两次哈希是否相等——同一缺失文件前后都得到 `null` 也必须判为缺失。决策使用的统计量一律由发布的原始样本与端点重算，不采信 worker 自报的汇总值。缺失或失败的校准逐条留档，后续成功不得掩盖先前的失败。
- 超时是显式结果而非普通失败：worker 超时后父进程在确认其自有进程结束前不得启动下一个用例；超时后停止扩展本次运行，后续用例记为无效。每个 worker 的时限取 `min(30 s, 运行剩余预算)`，不再设 1000 ms 下限以免超出总预算；worker 在 spawn 到任务自有子进程时立即向 stdout 声明其 PID，因此即使 worker 被杀死，父进程仍能保留并只终止这些已声明的子进程。父进程把这些声明消费成**按 PID 记账的生命周期账本**，而不是每次重新解析历史行：只有当前仍处于 open 状态、且 PID 为正整数的子进程才可被 signal；已声明关闭的 PID 只是历史（其数值可能已被系统复用给无关进程），永不作为 kill 目标；关闭声明重复到达只累加计数，不改变状态；畸形或截断的声明被丢弃而不会挤掉已知良好记录。账本区分**已尝试 signal**与**OS 层已确认终止**：每次尝试逐条记录 `{pid, command, signaled, error}`，随后轮询进程存活直到全部消失才算确认。
- 终止确认只有一个完成条件，且**超时路径与退出后清理路径共用它**：`worker 退出已确认 AND 每个已跟踪子进程要么已声明关闭要么已被确证不存在`。发送过 signal、`child.kill()` 返回 false 或抛出、找不到子进程列表、探针未给出结论，都不能替代 worker 退出确认；超时期间 worker 的 close 事件也不得跳过子进程轮询或提前清掉宽限观察器。worker 退出与否只由 spawn 句柄的生命周期事件确立，绝不从失败名反推。
- 存在性探针是三态的：只有正面确认才算 `alive`，只有明确的 `ESRCH` 才算 `absent`，其余（含 `EPERM` 以外的未知错误）一律记为 `unknown` 并保留错误诊断。`unknown` 与 `alive` 一样计入未决，绝不折算为“已消失”。
- 子进程的 `error` 事件不是一种结果，而是一条证据：Node 明确说明它既可能是**创建失败**，也可能是**已经创建成功之后**（例如 `kill()` 发不出信号）上报的失败，且其后不保证再有 `exit`/`close`。因此只有 `spawn` 之后从未拿到 PID 的创建失败才可作为有界的 `SPAWN_ERROR` 立即结束；一旦 worker 已有 PID，`error` 只记录 `{code, message}`（并挂到对应的 kill 尝试上），**不得**提前 `finish`、不得取消宽限观察器、不得递归再次调用 `terminate()`/`kill()`，结果仍由“worker 退出 AND 自有子进程清零”这一个完成条件裁定，超时原因继续单独保留在 `requestedFailure`。
- 终止无法确认时必须是致命结果：宽限期内仍有自有子进程存活或状态未知，或 worker 退出本身未被观察到时，本次运行立即以 `UNRESOLVED_PROCESS` 结束并保留夹具，记下 `unresolvedChildren`、`unresolvedWorker` 与 `terminationConfirmed:false`，同时用 `requestedFailure` 单独保留原始超时原因；在未决进程存续期间不得再启动任何用例。该结果使执行无效（非 0 退出码），且不会被后续成功掩盖。worker 正常退出本身不构成其子进程已死的证据——父进程在采纳结果前仍要检查存活者。
- 判定用的耗时序列必须是**原始墙上时间**：`rawDurationMs` 是权威序列，阈值比较、可重复性判定与报告展示的中位数一律取它；从其中扣除 spawn 观察器同步簿记得到的 `adjustedDurationEstimateMs` 只作为单独命名的估计值发布，不得参与任何门禁。worker 必须在载荷中声明 `authoritativeDurationSeries: 'rawDurationMs'`，缺失或指向其他序列的载荷判为无效（`DURATION_SERIES_MISLABELED`），以免“扣掉开销”的估计值悄悄变成判定依据。已复核跑批若只有估计值序列可用于阈值，必须改用其存储的 `rawDurationMs` 重算，且只作为分析，不得因此重跑或改写该次记录。
- **执行有效性**与**分析结论**是两个独立轴：输入门禁失败（输入/依赖/夹具哈希缺失或变化、载荷结构无效、未决进程、超时）意味着这次运行在方法上无效，必须 `ok:false` 且非 0 退出码，并逐条保留具体原因；而输入完全有效、只是证据不足以支持任何优化的 `INCONCLUSIVE` 仍是一次成功的测量，退出码为 0。两者不得用“结论不是 `CORRECTNESS_FAILURE`”这类单一表达式合并判断。
- 落盘报告必须保留观察到的终止事实而不是重新推断：worker 身份取**实际 spawn 出来的 PID**（即使超时后从未打印最终载荷），`terminated` 取 `terminationConfirmed`，并同时写入 signal 尝试与错误、worker 退出确认、worker kill 结果、`unresolvedWorker`/`unresolvedChildren`、原始 `requestedFailure` 与子进程生命周期状态。不得再用 `failure !== 'UNRESOLVED_PROCESS'` 反推清理成功。
- 结论词表固定为 `NO_OPTIMIZATION_JUSTIFIED` / `PROFILE_ONE_HOT_PATH` / `INCONCLUSIVE` / `CORRECTNESS_FAILURE`；内存项目用 `profileFocus: memory` 标记且只触发画像，不单列结论类型。即使 `PROFILE_ONE_HOT_PATH` 也不授权直接改生产代码；后续优化必须另行预登记“至少 20% 且 10 ms 延迟下降”等门槛。
- 单批次内存越线（`memoryUnstable: true`）按噪声记录，不构成发现；内存端点本身受 GC 时机影响，不作为泄漏证据。
- 运行边界与溯源：测量截止时间从夹具准备**之后**起算，并把剩余预算传给每个 worker；每个 worker 必须观察到自有进程结束才能启动下一个用例，无法确认结束时立即停止并保留夹具、记为未决进程（不新建清理子系统）。报告记录实际启动的 worker 及其哈希、worker 报告的全部已解析生产依赖、夹具清单/摘要的测量前后对照、Git 忽略预检结果与隔离配置。夹具必须位于本次运行独占的新位置，`prepareFixture()` 拒绝复用已存在的目录，不会删除调用方提供的路径。
- F 用例的生产函数会 spawn 一个任务自有的 `git check-ignore` 子进程；父进程 API 观察不到孙进程，因此 worker 在加载生产模块**之前**安装 spawn 观察器，逐个记录子进程 PID、退出码、时长，以及观察器自身加到调用帧上的簿记耗时。上报的 `rawDurationMs` 是权威的墙上时间，`durationMs` 扣除簿记为估计值而非“未被观测影响”的证明（close 监听器上的工作不计入同步簿记累加器）。

### 检查点 C2 - S1 归因（2026-09-20）

C2 同样是**纯测量**，且明确**不重新裁定 C1 的结论**。C1 发现 1,000 个小会话下的
`scanImport` 每次调用会阻塞事件循环约 140-156 ms，并把关注点标为 `blocking`；C2 追问这些时间
究竟花在哪里，任何结论都不授权修改生产代码。

协议（预登记，且与 C1 使用完全相同的夹具与 oracle 摘要）：

- 两轮。每轮先跑一个**未插桩的对照进程**，再跑一个**插桩进程**；四个进程严格顺序执行，绝不并发。
- 每个进程先做 2 次不计时预热，再做 10 次计时扫描。进程内 `node:inspector` 会话只在 10 次计时
  扫描期间开启，在投影/摘要/oracle/序列化**之前**停止，并在 `finally` 中 `disconnect()`，
  因此扫描失败也不可能把 inspector 留在附加状态。
- 每轮保留原始 `.cpuprofile` 并记录其 SHA256。父进程重新解析该文件并**重算全部份额**，绝不采信
  worker 自报的汇总。
- 类别份额基于 **self time**，因而是**互斥**的：它们之和等于被归因总时长。inclusive（嵌套）总时长
  只发布在另一张诊断表里，禁止求和、也禁止与互斥份额相加。
- 采样时间记到调用栈上最近的**具名生产函数**：因此匿名回调、或嵌套在 `readPlainSessionMeta`
  之下的 `node:fs` 帧都算作该生产函数的开销。`gc`、`dependency`、`unclassified` 各自独立成桶；
  只有既不在被测根目录、也不在本检出内、且没有具名生产祖先的 `unclassified` 才被记为“无法归因”。
- 报告同时发布墙上时长、逐次 CPU 差值、采样间隔、采样数、加权 time-delta 总量，以及对照与插桩的
  开销比。

判定规则（测量前登记，事后绝不调整）：**无论结果如何都不授权任何生产优化**。只有当同一类别在
两轮中都同时达到**被归因工作量的 20%**且**每次扫描 20 ms**，正确性摘要仍与 C1 oracle 一致，
插桩开销不超过 **20%**，无法归因的时间不占主导（**≤ 50%**），且两轮的主要排名一致时，才可支持
一个**后续**优化提案。若插桩开销超过 20%、无法归因时间占主导、或排名出现实质性分歧，则结果为
**limitation**，不给出任何建议。其余情况原样返回既有否定结论：
“Attribution remains inconclusive; no optimization is justified.”。执行有效性同样与分析结论
分离：输入哈希变化、夹具摘要变化、存在未决进程或摘要不符时以非 0 退出，而结果有效但结论为否定或
限制时仍以 0 退出。

在工作区（source root `C:\Ai\Deepseek-Harness-Desktop`）、Node 22.22.2 上的结果——两轮均有效，
且 S1 正确性摘要与 C1 oracle 完全一致
（`sha256:2149b23b8b0b9032d6d1e4a82e56e00e6d9c37b7497ec84db29962b33b42b246`）：

| 轮次 | 对照中位数（ms） | 插桩中位数（ms） | 开销 | 采样数 |
| --- | --- | --- | --- | --- |
| 1 | 155.58 | 216.45 | **+39.1%** | 3,520 |
| 2 | 146.28 | 213.12 | **+45.7%** | 3,545 |

两轮都越过预登记的 20% 插桩开销上限，因此记录的结论是
**`LIMITATION_PROFILER_OVERHEAD`**，不提出任何类别。类别份额仍作为**形态**证据发布，而不是建议：
`session-meta-read` 39.8% / 40.7%（每次扫描 86.33 / 89.35 ms），`session-walk` 37.3% / 36.6%
（81.01 / 80.33 ms），`dest-existence` 19.1% / 18.5%（41.56 / 40.66 ms），`gc` 1.3% / 1.5%，
无法归因 1.1% / 1.1%，其余均低于 1%。另有一次**单独声明**的粗粒度配置（1,000 µs 采样间隔），
同样记录为 `LIMITATION_PROFILER_OVERHEAD`，且开销更大（+61.6% / +67.9%）；也就是说在这台机器上
调粗采样并不能让门禁可达。该次运行同样按限制上报，不当作“再要一个好看结论”的第二次机会。

证据：`C:\Ai\_dshd-validation\c2c_6678-C2-1A-r1\{report.json,summary.md}`（250 µs）与
`C:\Ai\_dshd-validation\c2c_6678-C2-1A-r1-coarse\{report.json,summary.md}`（1,000 µs），各自保留
原始 `.cpuprofile`。工装：`scripts/profile-import-scan.mjs`、
`scripts/lib/import-scan-profile-worker.cjs`、`scripts/profile-import-scan.test.mjs`
**79/79**。原始证据记录于溯源字段加入之前，因此它只能通过**当前**的逐行门禁重放，不能当作
**历史**跨轮身份证明：发布器现已记录四个实际执行模块与全部已解析依赖的测量前哈希、在写报告前
逐一复核，并在缺少或不一致时把执行判为无效；判定改为直接读取前后哈希映射与已发布溯源，三者任一
缺失、格式不合法或不一致即判无效（`PROVENANCE_MODULE_HASH_MISSING`），最终依赖复核必须与规范
依赖集合一一对应（`RESOLVED_DEPENDENCY_RECHECK_MISSING` / `RESOLVED_DEPENDENCY_RECHECK_FAILED`），
`unchanged` 只作为可读摘要而不再承担授权判定。这不改变 C1 已接受的 S1 阻塞结论、其中位数统计或
原始耗时判定规则。

依赖身份随后改为**逐轮**判定，而不是跨轮并集：规范集合取第一个有效必需轮的解析依赖，
其余每个必需轮/模式都必须携带**完全相同**的文件集合与**完全相同**的哈希
（缺失 `resolvedModules` 或空列表 → `RESOLVED_DEPENDENCY_SET_INCOMPLETE`；缺少、多出或重复记录 →
`RESOLVED_DEPENDENCY_SET_MISMATCH`；同一文件哈希不一致 → `RESOLVED_DEPENDENCY_IDENTITY_UNSTABLE`）。
并集规则会让某一轮“少解析了一个依赖”时仍能通过，因为该文件可由其他轮补进并集；逐轮规则下
这种报告被视为执行无效。已发布溯源同样要求每个规范依赖恰好一行（同哈希重复行 → `PROVENANCE_DEPENDENCIES_INCOMPLETE`），
最终复核仍按一对一规则比对同一规范集合。

## Alternatives considered

- **直接优化看起来最重的 `scanImport`** — rejected：没有基线时无法区分真实热点与代码印象，也无法证明改进。C1 先给出可复现的测量。
- **在真实 Electron 主线程里测 IPC 往返** — deferred：需要启动应用与稳定负载，成本高且噪声大；先测函数自身代价，IPC 与渲染仍标为 NOT MEASURED。
- **把测量挂进 CI 作为性能门禁** — rejected：CI 机器的调度噪声会让硬计时断言产生误报；本次只记录测量结果，不新增 CI 性能门禁或 npm alias。
- **用 `process.memoryUsage()` 高频采样计时窗口内部** — rejected：Node 文档已说明采样自身有成本，会污染被测时间；只做端点观测。
- **为 F 用例新建 Git 仓库** — rejected（禁止新建仓库/分支/提交）：改用只读的 `GIT_DIR` + `GIT_WORK_TREE` 指向既有隔离副本的 Git 脚手架，并隔离 global/system 配置。
- **直接优化 C2 中占比最大的 `session-meta-read`** — rejected：C2 自己的预登记门禁已判定该插桩
  过于侵入（39-46% 开销），因此这次归因是**限制**而非发现；照着它动手正好会重犯 C1 要避免的错误。
- **在看到结果后调高 20% 开销上限** — rejected：规则在测量前登记，事后移动它等于把限制变成不
  应得的建议。
- **把测量结果写成“历史稳定”** — rejected：原始跑批没有记录模块与依赖的测量前身份，事后补录等于
  伪造从未采集过的哈希。因此报告分开呈现“当前逐行门禁重放通过”与“历史跨轮身份证明未采集”，
  由后者缺失把该次执行判为无效，而不是用前者的通过去补足。
- **只保留一个索引文件来暴露证据** — rejected：索引本身不含正文，读取方仍看不到记录内容；
  改为把三份记录与复核输出逐条登记为可读执行产物。

## Acceptance criteria

`node --test scripts/measure-desktop-lifecycle.test.mjs` 全绿，覆盖：夹具正确性与预计算摘要、样本计数、时间与 CPU/内存单位、阈值边界（等于阈值不算越线）、可重复性门、真实首次调用顺序与调用计数、逐次内存观测协议、确定性调度器下的心跳 arm/settle、以及经**真实决策/编排函数**验证的失败路径——成功形状但非 0 退出码、样本缺失、校准失败、输入变化（含否定结论与两个缺失哈希的情形）、同长度夹具改动、依赖哈希变化、端点与增长序列矛盾、对照最大值缺失、摘要不符、畸形载荷、超时停止扩展且不能变成成功载荷、以及“隔离离群值不越线 / 真实重复中位数越线 / 两批中位数不一致”三种阻塞统计情形。子进程账本另有独立用例：已关闭 PID 与系统复用后的同号 PID 永不被 signal（通过**注入 signal/probe 函数**证明，不依赖真实无关进程）、signal 失败只记为尝试而非终止确认、非正/非整数 PID 不可操作、分片与畸形声明被丢弃且不挤掉已知良好记录、重复关闭声明只累加计数。编排层另有用例：未确认终止判为致命，其后不再启动任何用例，后续用例全部记为无效。

终止确认另有四条**真实 `runWorker` 完成路径**的注入式集成用例（注入 spawn 句柄、探针与虚拟时钟，不触碰真实无关进程）：worker kill 返回 false 且退出未被观察时，超时后必须在宽限期满返回 `UNRESOLVED_PROCESS`、`terminationConfirmed:false`、`unresolvedWorker` 含 worker PID、`requestedFailure` 保留 `WORKER_TIMEOUT`；worker 退出事件迟到时不得提前判定完成；超时期间 worker 已 close 但自有子进程仍存活时，close 回调不得绕过子进程轮询，须等待子进程确证消失后才确认（持续存活则保持未决）；探针返回未知错误时必须判为未决而非“已消失”。另有 `probeProcess` 三态用例（alive/absent/unknown）与报告序列化用例：真实失败结果经生产报告构造后，即使没有 `PERF_RESULT` 也要保留 spawn 出来的 worker PID、signal 尝试、`terminationConfirmed`、`unresolvedChildren` 与 `requestedFailure`，且未决结果仍使 CLI `ok:false`、退出码非 0。这些用例做过**变异检验**：分别移除“worker 退出确认”“unknown 计为未决”“close 路径走同一完成条件”后各自失败，证明它们确实判别上述绕过点。

post-spawn `error` 另有三条真实 `runWorker` 路径的注入用例：kill 期间 `error` 抛出且返回 false、退出始终未被观察时，不得提前产出 `SPAWN_ERROR`（必须等到宽限期满返回 `UNRESOLVED_PROCESS`，保留 worker PID、`workerKill.error` 与 `workerError.code`，且 kill 只被调用一次以免递归），该真实返回值再经 `workerIdentityFor`、`persistedCaseRow`、`runControlAfter` 与执行状态链路证明未被决即停跑且 `ok:false`；同一 error 之后若 close 迟到，仍须等 close 与子进程清零后确认终止，同时保留 error 证据；真正无 PID 的创建失败才是有界的 `SPAWN_ERROR`，不得发出任何 signal 或声称终止。变异检验：把“已有 PID 时只记录 error”改回无条件 `finish(SPAWN_ERROR)` 后两条用例失败；把 `error` 处理器改回递归 `terminate()` 后同样失败（判别性成立）。该 `error` 通路不改变已接受的中位数统计、原始耗时判定或 S1 结论。

耗时序列有确定性用例：原始时长越线而估计值不越线时，门禁必须跟随原始序列；`authoritativeDurationSeries` 缺失或指向其他序列时载荷无效。执行有效性有独立用例：输入有效但无优化依据的 `INCONCLUSIVE` 必须 `ok:true`、退出码 0，而输入失效、未决进程与 `CORRECTNESS_FAILURE` 必须 `ok:false` 且非 0。普通测试不使用真实阈值时序，也不启动真实无关进程。`node scripts/measure-desktop-lifecycle.mjs --profile c1 --source-root <root> --out <新目录>` 在隔离副本上产出 `report.json` 与 `summary.md`，其中含输入身份哈希、夹具内容摘要、每用例全部样本与判定表。普通测试套件**不得**运行完整基准。

## Risks

- 这是合成长夹具下的函数级测量，不代表真实用户负载；报告必须保留“非实测项”清单。
- 事件循环阻塞在独立 Node 进程中测得，不等于实时 Electron 主线程阻塞。
- RSS 端点在独立进程中包含 GC 时机差异，只能触发内存画像，不能作为泄漏结论。
- 报告目录不得位于源码检出内；基准夹具默认保留并记录位置，不做独立清理监督器。
