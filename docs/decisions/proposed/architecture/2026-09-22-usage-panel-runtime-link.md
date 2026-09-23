# Decision: 用量统计面板改挂运行时链接，不再维护 profile 副本

Status: proposed

中文 | [English](2026-09-22-usage-panel-runtime-link.en.md)

## Problem

`src/main/usage-panel-preset.js::ensureDesktopUsagePanel` 每次启动都把
`vendor/dsh-usage-panel` 复制到 `profiles/web/desktop-plugins/dsh-usage-panel`，再把
`profiles/web/node_modules/dsh-usage-panel` 链到那份副本。

2026-09-03 把阻塞主线程的 `fs.cpSync` 换成增量异步 `fsp.cp` 之后，UI 不再卡死，但**稳态成本仍在**：
`fsp.cp` 的 filter 对每个候选文件各做一次 `stat(src)` 与 `stat(dest)`，约 6k 文件的 bundle 因此
每次启动都要走 12k 次 stat 加一次全目录遍历。实测（本机、`ensureDesktopUsagePanel` 单独调用、
空 profile 起算）：

| 轮次 | 旧实现（异步增量复制） | 链接实现 |
| --- | --- | --- |
| 首次（需落盘） | 13928 ms | 9.5 ms |
| 稳态第 2 次 | 1129 ms | 9 ms |
| 稳态第 3 次 | 1117 ms | 3 ms |

这段工作在 `harness-controller.js::performStartOnce` 里排在 `dsh.start()` 之前，直接推后
`dsh` 子进程创建。它是启动路径上确定性的一段固定支出，不随网络或机器负载波动。

## Proposal

面板运行时代码从 `vendor/dsh-usage-panel`（打包后为 resources 内同一路径）**直接链接**进 profile，
不再维护第二份副本——与 `@xmanrui/dsh-im` 已经采用的机制一致：

- `profiles/web/node_modules/dsh-usage-panel` 是指向 runtime 目录的 junction/symlink。
- `profiles/web/desktop-plugins/dsh-usage-panel/` 是**普通目录**，只承载 overlay 文件。
  node_modules 是链接、overlay 是目录，两者形态不同，不要按「两个目录都是 junction」理解。
- 链接目标未变时不 unlink/relink：重新链接会移动 ctime，并在 Package 名解析上留出短暂空窗。
- overlay 写入走同目录 tmp + rename，避免半写文件被 Loader 读到。
- `missingRuntimeFiles(sourceDir)` 的 fail-closed 检查保持不动：runtime 缺依赖仍然挡住启动。

迁移不再递归删除旧副本。`isManagedUsagePanelCopy()` 只把「真实目录 + package name 匹配」认成
受管副本；`isManagedOverlayDir()` 只认 overlay 与 `.tmp`。命中受管副本时用**同父目录 rename**
把它隔离成带任务标识的保留副本（`quarantine`），而不是 `rmSync`——启动关键路径上不做递归删除，
失败时还能恢复：

- `linkToTarget()` 返回 `{ relinked, quarantine }`。未知的非链接内容**拒绝替换**并返回
  `{ ok:false, error:'refusing to replace unknown content…' }`；只有错误链接或悬空链接才可替换。
- 链接创建失败时回滚刚做的 quarantine，恢复旧副本。
- `ensureDesktopUsagePanel()` 在失败路径上删掉新建链接、清掉替换目录、恢复旧副本，返回
  `quarantinedCopy` 供调用方与诊断使用。

前提是面板**运行时代码只读**。它的可写状态（`prices` / `peakValleyEnabled`）保存在
`dsh_usage_panel_billing` storage domain，不在自己的安装目录里；因此不需要「每个 profile 一份
可写副本」的语义。

## Alternatives considered

- **保留增量复制，只把 stat 比较换成内容哈希** — rejected：哈希要读全部字节，比 12k 次 stat
  更贵；而且仍然维护第二份副本，升级与陈旧副本的问题照旧。

- **给复制加「一次性 stamp，之后永远跳过」** — rejected：这正是把「缺文件检测」让位给
  一枚可能说谎的标记。缺文件必须继续 fail closed。

- **改用 `fs.cpSync` 的 `force:false`** — rejected：`force:false` 不删除目标多余文件，也不
  减少遍历成本，同时会让被删除的源文件在副本里存活。

- **把面板挂到 `node_modules` 之外（例如 file:// URL 直接 insert）** — rejected：Loader 拒绝
  目录形式的 `file://` 导入（`ERR_UNSUPPORTED_DIR_IMPORT`），按包名解析才是可行路径。

- **迁移时直接 `rmSync` 旧副本** — rejected（已实现并推翻）：不可恢复、在启动关键路径上重新引入
  大目录同步删除，且链接失败后无法回到原状态。改为同父目录 rename 保留。

- **保留旧副本文件不动，只把链接指过去** — rejected：磁盘上会残留一份陈旧 bundle，之后的
  升级与排障都无法判断哪一份在生效。

- **同时上内容 manifest 缓存，只复制变化的子树** — deferred：链接方案已经去掉全部稳态遍历；
  在只有单副本语义需求时才需要更细的复制策略。

## Acceptance criteria

- 稳态（第二次起）启动不创建任何副本文件、不做全 tree stat 遍历；
  `ensureDesktopUsagePanel` 单测保持通过。
- `realpathSync(profiles/web/node_modules/dsh-usage-panel)` 等于 runtime 目录。
- 源运行时改动立即可见（同一次启动读到的就是新内容），不需要复制步骤。
- 旧版本留下的 `desktop-plugins/dsh-usage-panel` 整份副本在首次启动被 **rename 成保留副本**，
  而不是被删除；overlay 仍作为普通目录写入。
- 遇到未知内容（非受管副本、非受管 overlay）时拒绝替换并返回 `ok:false`，不擅自删除。
- 链接创建失败、overlay 写入失败时恢复旧副本；带空格的路径同样通过。
- `missingRuntimeFiles` 的缺依赖路径继续返回 `ok:false` 并挡住启动。
- 统计面板在真实桌面里仍能打开并读取会话数据（QA `TC-EXT-008`）。

## Risks

- 链接模型要求面板不写自身安装目录；若将来把可变数据写进面板目录，会污染 vendor 运行时。
  该前提写入卡片不变量，改动时必须重新评审本决策。
- Windows junction 对相对路径导入、`node_modules` 解析与权限的行为与普通目录不同；已在真实
  桌面（Windows）验证加载，macOS 侧仍需同等验证。
- 打包产物必须包含完整 runtime（`extraResources` 已覆盖 `vendor/dsh-usage-panel/**`）；
  若打包裁剪掉 node_modules，链接目标将不完整——`missingRuntimeFiles` 会挡住启动而不是静默降级。
- 保留副本意味着首次迁移后磁盘上会多出一份隔离目录；它由任务标识命名，清理策略尚未自动化，
  需要后续决定保留多久。
