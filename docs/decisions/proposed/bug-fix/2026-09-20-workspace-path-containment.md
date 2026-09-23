# Decision: 工作区路径包含判定按段解析，`.git` 按解析后路径判定

Status: proposed

中文 | [English](2026-09-20-workspace-path-containment.en.md)

## Problem

桌面工作区把「路径是否在授权根内」交给 `path.relative()` 的结果做前缀判断，并在多处写成 `rel.startsWith('..')`。该判断把两类完全不同的输入混为一谈：

- **真穿越**：`..`、`../outside.txt`、`sub/../../outside.txt`，`path.relative()` 返回 `..` 或 `..\\…`。
- **普通名字**：工作区里真实存在的 `..notes`、`sub/..cache`、`..dir/inner.txt`，`path.relative()` 同样返回以 `..` 开头的字符串。

于是 `resolveInside`（`src/main/workspace-authority.js`）、`containedIn` 与 `resolveGitPath`（`src/main/git.js`）会把合法名字误判为越界：Files 打不开、文件不能暂存、Git 路径操作报「Path is outside the workspace.」。这是**可用性缺陷**，与安全无关——拒绝本身是 fail-closed 的。同类写法还散落在 `src/main/preview.js`、`src/main/data-import.js`、`tools/mobile-web-qa/server.mjs` 与 `scripts/after-pack.js`。

第二个缺陷方向相反，是**真实的越权写入**。`.git` 保护只在**传入的路径字符串**上做段匹配：`writeFile` 拒绝任何含 `.git` 段的路径，`listDir` 隐藏 `.git`。但工作区里一个**名字无害的链接**（例如 `notes` 这个目录联接/junction，指向 `.git`）请求里不含 `.git` 段，`resolveInside` 又只校验「realpath 仍在根内」——链接指向根内的 `.git`，判为在根内——检查通过。实测 `workspaceFs.writeFile(cwd, 'notes/hooks/pre-commit', 'EVIL')` 返回 `{ ok: true }`，`.git/hooks/pre-commit` 被改写。仓库元数据里的 hooks 会在下一次 git 调用时执行，这是一条从「保存文件」升级到「执行代码」的路径。`listDir`/`readFile` 同样可以经该链接读到 `.git` 内容。

第三，`resolveInside` 返回的是**词法**目标，调用方在检查后才执行特权操作。`workspace-fs.js` 的 `writeFile` 在 `resolveInside` 与 `mkdir`/`writeFile` 之间存在检查-使用间隙：在 `mkdir` 被调用的时点把目标目录换成指向 `.git` 的链接，写入仍会成功落到 `.git` 内（已用确定性交错复现：patch `fs.promises.mkdir`，在首次调用时把 `victim` 换成 `victim`→`.git` 的联接，断言保存必须失败且哨兵字节不变——修复前失败）。

三个问题的共同根因是：**包含关系与 `.git` 判定都只用了字符串前缀/段匹配，而没有用解析后的真实路径**，且判定与特权效果之间存在未复检的时间窗。

第四、第五个缺口是上述修复**没有覆盖到的两个反向绕过**，都在复审时被反例复现：

- **调用方自选 cwd 可洗白 `.git`**：`.git` 规则只看「相对于传入 cwd 的路径」。`resolveAuthorizedCwd` 接受授权根下任意真实子目录，所以 `writeFile(<root>/.git, 'hooks/pre-commit')` 的相对路径是 `hooks/pre-commit`，其中不含 `.git` 段；`<root>/.git/hooks` 与「名字无害、解析到 `.git` 的链接」同样如此。实测三种形态都返回 `{ ok: true }` 并改写 `.git/hooks/pre-commit`。
- **悬空链接被当成「尚未创建的路径」**：`resolveInside` 在 realpath 失败时向父目录回退，而 realpath 对**悬空链接**同样失败。请求 `note-link`（`note-link` → 根外某个**尚不存在**的文件）时，整条链被判为「还没建」，`writeFile` 只校验父目录就写入，结果是根外文件被创建；`canonicalInside` 有同样的回退。实测根外 `new-file.txt` 被创建。

这两个缺口的共同根因是：**`.git` 规则没有锚定到受信任根，realpath 失败没有区分「真的不存在」与「存在但解析不了」**。

## Proposal

在 `workspace-authority.js` 收敛出两个单一事实来源，并由各调用方复用：

1. `escapesBase(fromBase)` 只把「绝对路径」「恰好是 `..`」「以 `..` + 分隔符开头」判为逃逸，取代 `startsWith('..')`；`containedIn` 与 `resolveInside` 都改用它，因此 `..notes` 这类合法名字恢复可用，真穿越仍然拒绝。
2. `hasGitDirSegment(relativePath)` 按 `[\\/]` 分段、大小写不敏感地判定 `.git`；`workspace-fs.js` 的 `touchesGitDir` 直接复用同一函数，避免两份实现漂移。
3. `resolveInside` 在词法检查之后，对**最深已存在节点**的 realpath 结果再跑一次 `hasGitDirSegment(path.relative(base, nodeReal))`。命名无害但解析进 `.git` 的链接因此被拒绝；`.gitignore`、`.github/**`、`git.txt` 等普通名字不受影响。
4. 新增 `isPathInside(root, candidate)` 供「已解析绝对路径」使用；`git.js` 的 `resolveGitPath` 改用它，不再手工写 `rel.startsWith('..')`。
5. `workspace-fs.js` 新增 `canonicalInside(cwd, target)`：在特权操作前把目标 realpath 化，并**再次**校验 `isPathInside` 与 `.git` 段；`listDir`、`readFile`、`readFileMedia`、`writeFile` 全部走它，且后续实际读写的都是解析后的路径，而不是被请求的词法路径。
6. `resolveAuthorizedCwd` 在返回前，按**受信任根**而不是调用方的 cwd 复检 `hasGitDirSegment(path.relative(root, real))`。cwd 落在 `.git` 内（直接、子目录、或经无害链接）一律返回 null，因此任何调用方都无法通过移动基准目录把受限目录变成合法目录。
7. 新增 `isAbsentNode(node)`（`lstat` 成功即视为存在）：`resolveInside` 与 `canonicalInside` 在 realpath 失败时，只有**确实不存在**的节点才允许向上回退；已存在但解析不了的节点（悬空链接、不可读项）直接拒绝。`writeFile` 改为对**完整目标**（含最后一段）做 `canonicalInside`，并写入该规范化路径，而不是只校验父目录再拼回原文件名。

`.git` 的拒绝文案保持 `Saving inside .git is not allowed.`（显式段命中时），经解析路径命中的情况归入 `Path is outside the workspace.`，两者都 fail closed。

## Alternatives considered

- **只在 `workspace-fs.js` 补链接检查** — rejected：`resolveInside` 是所有文件/Git/预览/编辑器能力的共同入口，只补一处会让 Git 与预览路径继续把 `.git` 当作可寻址目标。
- **在 `writeFile` 里用 `startsWith` 做前后缀二次比较** — rejected：正是这个写法造成了 `..notes` 误判；拒绝要按**段**判定，包含要按**解析后路径**判定。
- **把 `.git` 当作普通的 gitignored 目录隐藏即可** — rejected：隐藏不等于不可寻址。调用方可以直接请求 `.git/hooks/pre-commit`，而 hooks 是可执行代码。
- **用 `lstat` 禁掉所有链接** — rejected：工作区依赖 pnpm store 之类的**根内**链接（现有用例 `resolveInside keeps directory links that stay inside the workspace` 覆盖），一律禁链接会破坏正常装载。正确边界是「解析后仍须在根内且不得落在 `.git`」。
- **声称 realpath 复检消除了全部竞态** — rejected：复检只收窄窗口，不能把「检查 → 使用」变成原子操作；该限制写进 Risks。
- **只把 `.git` 规则锚定到调用方 cwd** — rejected：调用方选的 cwd 本身就是不可信输入；规则必须锚定到授权根，否则「把基准目录移进 `.git`」即可绕过。
- **把 realpath 失败一律当作「路径尚未创建」** — rejected：悬空链接与真缺失在 realpath 层面不可区分，必须先用 `lstat` 区分；否则一个静态存在的链接即可把写入导向根外。

## Acceptance criteria

`node --test src/main/workspace-authority.test.js src/main/workspace-fs.test.js` 全绿（35/35），其中包含：

- `resolveInside allows real names that merely begin with two dots`：`..notes`、`sub/..cache`、`..dir/inner.txt` 被接受，`..`、`../outside.txt`、`sub/../../outside.txt` 被拒绝。
- `resolveInside refuses .git reached through an innocuously named link`：`notes`→`.git` 目录联接与 `config-link`→`.git/config` 文件链接均被拒绝，且链接本身不被当成可寻址目标。
- `resolveInside refuses .git spelled with mixed case and separators`：`.git`、`.GIT`、`.Git/hooks/pre-commit`、`sub/.git/config`、`.git\config` 全部拒绝；`.gitignore`、`src/git.txt` 仍可用。
- `L-4b`：经无害链接写 `.git` 被拒绝，`.git/hooks/pre-commit` 与 `.git/config` 的哨兵字节不变，`listDir` 不列出 `.git`。
- `L-4c`：在特权调用点确定性换入链接后保存必须失败，哨兵字节不变，`.git/target.txt` 不存在。把 `canonicalInside` 的 realpath 换回词法父路径即失败（已做变异验证）。
- `resolveAuthorizedCwd refuses a cwd anchored inside .git`：`<root>/.git`、`<root>/.git/hooks`、以及经无害链接解析到 `.git` 的 cwd 全部返回 null；普通嵌套项目 cwd（`src/nested`）仍被接受。
- `resolveInside refuses a dangling link instead of treating it as absent`：指向根外**不存在**文件的链接被拒绝，同时真正不存在的名字（`brand-new.txt`）仍是合法创建目标。
- `L-4d`：经悬空链接写入被拒绝且根外目标文件不被创建；同一用例随后证明普通缺失文件仍可正常创建。`L-4b` / `L-4c` 的链接夹具各自独立创建并自证（断言 realpath 落在预期目标），fixture 失败不再被计作「拒绝成功」。

变异验证（`.tmp/audit-iteration7-b1-mutation.txt`）：去掉受信任根锚定检查 → `resolveAuthorizedCwd` 返回 `<root>/.git`，对应用例失败；去掉 `isAbsentNode` 判别 → 35 项中 1 项失败。两者都是独立回归保护。

`node --test src/main/git.test.js src/main/git-exec.test.js src/main/git-ipc-guard.test.js` 全绿，其中 `gitStage stages real names that merely begin with two dots` 断言 `..notes` 与 `sub/..cache` 可暂存（`git diff --cached --name-only` 可见），且真穿越仍被拒绝。

## Risks

`canonicalInside` 在每次读写前多一次 realpath，属于可接受的系统调用成本，但在大量小文件批读时会累积；若将来出现性能问题，应按目录批量缓存而不能退回词法判定。复检把「检查 → 使用」的窗口收窄到 realpath 与最终 read/write 之间，**不是原子操作**：攻击者若能在该瞬时窗口内换入链接，仍有理论上的 TOCTOU 空间，真正根治需要 `openat`/句柄式 API 或对父目录加锁，本轮不做。`hasGitDirSegment` 按名字判定 `.git`，因此一个大写不敏感文件系统上的 `.GIT` 目录会被拒——这是刻意的，因为 Windows/macOS 会把它解析到同一个节点。经链接命中的拒绝文案（`Path is outside the workspace.`）与真越界共用一句，用户无法从文案区分二者；如需区分应另加字段，本轮不改协议。
