# Decision: 远端 CLI 身份文件回落到绝对 home

Status: proposed

中文 | [English](2026-09-19-remote-home-identity-isolation.en.md)

## Problem

`packages/cli/src/utils/client-id.ts` 用 `process.env.CHISACODE_HOME ?? join(homedir(), ".chisacode")` 计算会话身份文件路径。`??` 只把 `null` / `undefined` 视为缺省，因此 `CHISACODE_HOME=''` 会把 `cli-client-id` 写到当前工作目录；相对值虽然不会直接落到 CWD 根，但仍把身份状态绑到进程 cwd，同一环境在不同目录会得到不同身份。当前仓库根已经出现一个未跟踪的 `cli-client-id`，证明该路径真的能写入 checkout。

## Proposal

把 home 解析抽成可从模块导出的纯函数 `resolveCliClientIdDirectory(env)`，在每次读取或创建身份文件时惰性调用。`CHISACODE_HOME` 经 `trim()` 后为空或不是绝对路径时，一律回落到 `join(homedir(), ".chisacode")`；语法有效的绝对路径原样保留，不规范化、不限制内容。`getOrCreateCliClientId()` 的公开 API 与缓存语义保持不变。根目录 `.gitignore` 增加 `/cli-client-id` 作为防御，避免再次误写后污染工作区。

## Alternatives considered

- **只把 `??` 改成 `||`** — rejected：空值会回落，但相对路径仍会把身份状态绑到进程 cwd，无法满足“绝不写 checkout/CWD”的要求。
- **统一调用 `@chisacode/server` 的 `resolveChisaCodeHome()`** — rejected：该函数还会立即创建并收紧目录权限，CLI 身份模块只需要路径解析；在本模块内显式处理空值和相对值更小、更易测试。
- **导入时缓存常量路径** — rejected：既无法在测试里注入非进程环境，也让读取/写入共享同一陈旧路径；YAGNI。

## Acceptance criteria

`packages/cli/src/utils/client-id.test.ts` 覆盖 unset / 空串 / 纯空白 / 相对路径 / 绝对路径五类输入，并断言前者都落到 `join(homedir(), ".chisacode")`、后者原样返回。另有两个写盘用例把 `HOME` / `USERPROFILE` 指向临时目录：绝对 `CHISACODE_HOME` 下身份文件确实落在该目录、且在新模块实例中复用同一身份；空串与相对路径都写入回落的 `~/.chisacode`。这些用例不读写真实用户目录，也不在 checkout 内产生身份文件。仓库根原有未跟踪的 `cli-client-id` 不被删除、移动或纳入版本控制。

## Risks

绝对路径仍按用户输入原样使用，如果路径本身指向仓库目录，CLI 仍会把身份写进该目录；本决策只拒绝空值和相对值。Windows 上“绝对”遵循 `node:path.isAbsolute`（盘符或 UNC），带前导 `~` 的字符串会被当作相对路径并回落，和当前 token 展开式行为不同。
