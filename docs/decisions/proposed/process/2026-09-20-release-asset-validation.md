# Decision: 晋级前由共享的只读校验器核对发布资产

Status: proposed

中文 | [English](2026-09-20-release-asset-validation.en.md)

## Problem

`publish.yml` 的晋级步骤此前只做两件事：数一数 `dist-out` 里有几个 `Setup`、`blockmap` 与 `latest.yml`，然后把 `Setup` 的 SHA256 与操作者传入的摘要比一次。它从不解析 `latest.yml`，因此三种坏候选都能被晋级：`latest.yml` 指向另一个安装包（更新器会把用户引向错误资产）、`blockmap` 的 stem 与 `Setup` 不匹配（差量更新会拿着错误的索引去补丁）、以及元数据里的版本/大小/摘要与实际字节不符（更新器装到一半才发现，或静默装错）。同时 `release.yml` 与 `publish.yml` 的 `uses:` 仍是可变 tag，发布链的供应链约束弱于测试链。

## Proposal

新增 `scripts/check-release-assets.mjs`：**只读、离线、不读 GitHub 凭据、有界**的发布资产校验器，并由 `publish.yml`、测试与本地排障共用同一份实现（workflow 不复制一套检查逻辑）。

契约（每一句都有对应用例）：

- 资产目录内必须恰好一个 `Deepseek-Harness-Desktop-Setup-<version>.exe`、其同名 `<Setup>.exe.blockmap`，以及恰好一个 `latest.yml`。
- 三个资产都必须是非符号链接/非 junction 的**普通文件**，且真实路径不得逃出资产目录；目录顶替文件同样拒绝。
- `Setup` 文件名、release tag、`package.json` 版本与 `latest.yml` 的 `version` 四者一致。
- `Setup` 的 **SHA256** 必须等于操作者提供的摘要（校验器打印实际确认的摘要，workflow 的 provenance 用这个值，而不是把输入字符串回声一遍）。
- `latest.yml` 的 `files[]` 必须**恰好有一个**条目指向本地那个 `Setup` 文件名，且其 `size` 与 base64 `sha512` 与磁盘字节一致；出现任何其它 `files[]` 引用（包括非 exe）都拒绝。
- 旧式顶层 `path` / `sha512` 允许缺失，但**一旦存在就必须与 `files[]` 条目一致**，不得互相矛盾。
- 拒绝畸形 YAML、重复映射键、类型错误（`files` 非数组、条目非映射、`size` 非安全非负整数、`sha512` 不是 88 字符 base64）、绝对/远程 URL、`..`/`%2F` 遍历、反斜杠、超限元数据（512 KiB，读取前后各查一次）以及任何读取失败。

`latest.yml` 用仓库已解析的 `js-yaml` 4.3.1（经 `electron-updater` 依赖），`JSON_SCHEMA` 数据模式解析，不新增依赖、不改版本。`Setup` 用流式读取分别算 SHA512 与 SHA256，不整份读入内存。

**明确不证明**：`.blockmap` 的字节是否对应这个 `Setup`。v26 元数据不携带 blockmap 摘要，因此只核对文件名 stem；不得为了「看起来更严」而发明一个不存在的字段。

`publish.yml` 相应改为：稀疏检出补上校验器、`package-lock.json` 与 `.nvmrc`；用声明式、尊重 lockfile 且禁用生命周期脚本的 `npm ci --ignore-scripts` 准备运行时（不按需下载、不依赖 runner 上的环境包）；在 checksum/provenance 与 `gh release create` **之前**调用校验器；候选 SHA 缺少该 helper 时显式失败，绝不替换成别的 revision 的代码。

## Alternatives considered

- **继续在 workflow 里用 shell 数文件** — rejected：shell 无法可靠解析 YAML（`latest.yml` 的语义是嵌套映射），而且这些检查没有测试覆盖；把同样的逻辑再写一遍只会制造两套会漂移的实现。
- **用正则解析 `latest.yml`** — rejected：元数据是结构化的，正则面对引用、缩进、重复键与类型变化会一边假通过一边假失败。
- **校验 `.blockmap` 与 `Setup` 的密码学对应关系** — rejected：v26 元数据里没有可供比对的 blockmap 摘要字段；发明一个（或自算一个「应当如此」的等价物）会造出无依据的门禁。
- **新增 YAML 依赖** — rejected：`electron-updater` 已带来 `js-yaml` 4.3.1，新增一份依赖只会扩大供应链面并把版本选择变成第二个真相来源。
- **在候选 SHA 之外回退到当前分支的 helper** — rejected：被晋级的是候选 SHA，用另一个 revision 的验证代码证明候选合规没有任何意义。
- **让校验器写入校验结果副产物** — rejected：晋级链只需要一个「通过/不通过 + 实际摘要」，写文件会让只读承诺失效。

## Acceptance criteria

`node --test scripts/check-release-assets.test.mjs` 全绿（32 项），覆盖：合法 v26 元数据被接受；缺少旧式 `path`/`sha512` 被接受；SHA256 不符、大小不符、版本不符、tag 与版本不符、元数据 sha512 不符、blockmap stem 陈旧、重复 Setup、重复 YAML 键、畸形 YAML、`files` 类型错误、条目非映射、旧式 `sha512`/`path` 与 `files[]` 矛盾、URL 遍历、意外的 exe 引用、远程 URL、绝对 URL、百分号编码遍历、超大元数据、缺少 Setup/blockmap/latest.yml、符号链接 Setup、目录顶替元数据或 Setup、读取失败——全部拒绝。

其中四条是**变异检验**：把校验器复制到检出之外，分别禁用 SHA256 比对、SHA512 比对、`files[].url` 与本地文件名的比对（同时禁用同因的「意外资产」扫描），以及 `files[].size` 比对（同时禁用哈希后的复查层），然后要求变异副本**接受**一个出厂版本会拒绝的坏资产集、同时仍**接受**一份完全合法的资产集。这样既证明这些门是真正拦下缺陷的那一个（而不是后面某个检查顺带拦下），也证明用例不是靠「什么都拒绝」通过。变异副本在测试结束即删除，检出内不落任何中间文件。

`src/main/ci-isolation.test.js` 增加 workflow 钉子：`publish.yml` 仍只晋级 main 上成功的 `release.yml` 候选、仍要求同一 SHA 的 Desktop tests 通过、仍禁止重建；稀疏检出包含 helper 与锁文件、运行时准备是 `npm ci --ignore-scripts` 且全文件无 `npx`、校验器在 checksum/publish 之前被调用、缺少 helper 时显式失败。

## Risks

- 资产校验只能证明「这组资产自洽且 Setup 摘要符合操作者输入」。操作者摘要本身是否正确、CI 构建是否可信，不在这份记录的范围内。
- `npm ci --ignore-scripts` 仍需 runner 具备网络与 lockfile；这是既有前提，本次把「按需取包」换成「按锁文件取包」而不是新增信任。
- 校验器依赖 `latest.yml` 的 v26 形状（`files[]` + 可选旧式字段）。electron-builder 若改变元数据格式，门禁会失败关闭——这是期望行为，但需要同步更新记录与用例。
- 本轮未实际调度 `publish.yml`（需要真实候选 run 与 tag），验证限于本地单测与静态 workflow 钉子。
