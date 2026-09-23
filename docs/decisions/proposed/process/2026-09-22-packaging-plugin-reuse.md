# Decision: 打包装配复用已验证的插件依赖树

Status: proposed

中文 | [English](2026-09-22-packaging-plugin-reuse.en.md)

## Problem

`scripts/after-pack.js` 为内置插件准备运行期依赖时，`dsh-im` 走的是无条件重装：

```
restoreVendoredPluginNodeModules(projectDir, resources, 'dsh-im');
installPluginRuntimeDeps(path.join(resources, 'vendor', 'dsh-im'), { skipIfComplete: false });
```

`defaultNpmInstall()` 先 `fs.rmSync(node_modules, { recursive: true })`，再同步跑 `npm ci` 或
`npm install`。也就是说，上一步刚从 vendor 还原出来、本来可用的依赖树会被主动删掉，每次都重新装。

这个「宁可重装」的选择有真实原因：当时的完整性检查只向下走有限层嵌套依赖，所以一棵缺了孙级依赖
入口文件的半残树会被判成完整，运行时才在 Settings → Remote → Channels 上炸掉。问题是「防半残」
被实现成了「无条件重装」，健康树和半残树一起付了代价。

## Proposal

把「可否复用」交给真实解析位置的依赖闭包，而不是交给「是否强制安装」这个开关：

- `plugin-runtime-files.js` 新增 `auditRuntimeClosure(packageDir, { resolveRoot, maxPackages })`：
  按 Node 的**真实解析位置**做 BFS，而不是按目录深度递归。visited 与 queued 都按 realpath 归一，
  因此同一包被多个父级引用只访问一次，循环与符号链接环自然终止。
- `missingPluginRuntimeClosure()` 改为调用该 audit，`DEFAULT_CLOSURE_DEPTH` 删除。遍历预算默认
  20000 个包；预算耗尽时返回 `<closure-incomplete>` 并判为**不完整**（fail closed），
  绝不因为「没查完」而报告完整。
- `installPluginRuntimeDeps()` 的默认 verifier 就是该闭包，且在安装命令成功返回后用**同一个**
  verifier 复检；安装退出 0 但缺损仍在时抛错，不再有「检测到深层缺损 → 安装 → 浅检查放行」的通道。
- `restoreVendoredPluginNodeModules()` 在拷贝前查一次、拷贝后复检，未解析项作为 `unresolved`
  返回；`assertVendoredPluginRuntimeDeps()` 使用同一个闭包判定，装配期不再有两套深浅不一的谓词。
- `skipIfComplete` 保留原语义（浅检查通过即跳过），其余调用方行为不变。

这样「健康树零重装」与「半残树必须修复」同时成立：判据变成完整闭包，动作变轻。

## Alternatives considered

- **直接把 `skipIfComplete` 改成 `true`** — rejected：浅谓词正是当年放过半残树的原因；
  它用「更宽松的检查」换「更少的安装」，属于降低正确性而无对价的优化。
- **只加深 `missingRuntimeFiles()` 的默认 depth** — rejected（已实现并推翻）：该函数被多处调用
  （`dsh-im-desktop.js`、`dsh-remote-desktop.js`、`dsh-whale-desktop.js`、`dshbot-desktop.js`），
  改默认值会同时改变启动期 fail-closed 判定的成本与语义；而且**加深深度不是闭包**——超过该深度的
  缺失仍然漏过。因此新增按真实解析位置遍历的独立函数。
- **按 mtime 或安装时间戳缓存安装结果** — rejected：时间戳无法发现被删掉的入口文件，
  与上面同样的失败模式。完整性必须每次真查，只是查询要足够便宜且足够完整。
- **打包期只校验 vendor 源树，不校验装配后的目的树** — rejected：装配过程本身会丢文件
  （这正是 `restoreVendoredPluginNodeModules` 存在的原因），必须在真实目的树上判定。
- **安装命令返回 0 就认为修好了** — rejected（已实现并推翻）：npm 退出码只说明命令没失败，
  不说明目标闭包完整。安装后必须用同一 verifier 复检。

## Acceptance criteria

- `node --test src/main/after-pack.test.js`：健康树返回 `verified-complete` 且不调用安装器；
  「依赖目录存在但声明的入口文件缺失」的孙级负例仍然触发安装。
- 超过三层的深层缺失负例、循环依赖、符号链接环、遍历预算耗尽（返回 incomplete 而非完整）
  各有对应用例；「安装回调成功返回但完全没有修复」必须抛错。
- 复用路径下 `dsh-im` 在依赖完整时不再出现 `npm` 子进程，安装包内插件仍通过
  `assertVendoredPluginRuntimeDeps`。

## Risks

- 闭包检查有**包数**预算（默认 20000）而不是深度上限；预算耗尽被判为 incomplete 并 fail
  closed，代价是超大依赖树可能拒绝复用而回退安装，而不是漏检后放行。
- 复用依赖树意味着复用 vendor 里已有的 `node_modules`，它可能含与目标平台或 ABI 不匹配的原生模块。
  当前 `dsh-im` 的依赖是纯 JS（Tencent 连接器、dingtalk-stream、qrcode）；若将来引入原生依赖，
  必须先把平台与 ABI 纳入判定，再允许复用。
- 该检查在打包期增加了一次较深的目录遍历。相对被省掉的整次 `npm ci` 代价可忽略，
  但「复用」路径确实不再是零成本。
