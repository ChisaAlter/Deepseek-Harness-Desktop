# 0.3.3 发布准备与打包门禁审查

日期：2026-09-28。状态：**全面修复及本地验证通过，CI 候选与正式生产验收尚未完成，未发布**。用户要求推进发布准备，并在发布前停下；未创建 tag、Release，也未运行 `publish.yml`。

## 全面修复最终结果

第二轮提交 `01b8acacaf8370e143b342fba9d79b80176563d7`：Desktop tests `36458450417` 仍有 Windows 7 项、macOS 1 项失败，不晋级候选 `36458463741`。Windows 暴露预览入口的旧 realpath 与编辑器夹具短名差异；macOS 暴露原生登记事件漏报。已补两条确定性反例（先红后绿），统一预览原生路径，并为登记文件增加 2 秒元数据核对与事件去重。相关 200 项通过，最终同 SHA CI 仍待重验。

远端首轮候选提交为 `89850d10de026f508a28f3ae64c0c2275e9bb957`。Desktop tests `36454451908` 的 vendor-gui 全部通过，但桌面矩阵暴露干净构建依赖缺失和平台路径差异；Windows-only 候选构建 `36454591440` 与 packaged smoke 成功，因同 SHA 桌面测试失败，未晋级。对应修复见[干净 CI 可移植性决定](../../../decisions/implemented/bug-fix/2026-09-28-clean-ci-portability.md)：声明桥接库构建前提，统一物理路径，修复 drain timer，并保留导入与工作区安全边界。定向 162 项、Node 22 路径/任务相关 127 项及 Node 22 桌面全量 2770 项通过（2 跳过，0 失败）；新的远端轮次尚待记录，不能把首轮红项记为已通过。

用户随后授权“进行全面修复”。实例布局现在按源 realpath 建立唯一目录及依赖链接，真实 747 个包、3602 条边验证通过，原 send 合并问题已解决；tar 搬迁、循环、共享与隔离回归通过。新增相对清单在提取后恢复 junction/symlink，不以豁免放行错误布局。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 桌面全量（预览与监听修复后，Node 22.22.2） | 2772 通过，2 跳过，0 失败 | `.omc/release-complete-desktop22.log` |
| GUI 全量 | 745 文件，11049 通过，1 跳过 | `.omc/release-complete-gui.log` |
| 核心集合 | 215 文件，5009 通过，5 跳过 | `.omc/release-complete-core.log` |
| 目录生成器 | 23/23，LF/CRLF 回归及 freshness 通过 | `.omc/release-catalog-tests.log`、`.omc/release-client-catalog-final.log` |
| 无密钥回放 | 默认只读回放通过 | `.omc/release-malformed-replay-verified.log` |
| 官方构建 | 成功，记录 374 个 client 产物 | `.omc/release-official-final.log` |
| 第三方声明 | up to date | `.omc/release-notices.log` |
| 源码与安装树冒烟 | frame、标题栏三类点击、preload 隔离、PTY 回显全部通过，pageErrors 为空 | `.omc/release-complete-source.log`、`.omc/release-complete-smoke.log` |
| 出包与资产校验 | NSIS、blockmap、latest.yml 通过 | `.omc/release-complete-package.log`、`.omc/release-fullrepair-artifact.json` |

本地演练资产为 `dist/rc-v033-fullrepair/Whale-Isle-Setup-0.3.3.exe`，`601493269` 字节，SHA256 `803b73ba4965845ace22b5ae7f7dba0f8c3fb557123cc4211a045fbd814b8b41`。包内 pin 为 `dsh-v0.1.7-rc.2` / `477b4f420553e8a52c2fbccc464d7561b239c443`，发布说明和手册已校正。该包验证了实例图、ws、平台会话资源和原生欢迎页进入工作区的实际路径。客户端目录随后完成最终 freshness/官方构建，正式 CI 候选仍须从最终固定提交重新构建，不能将此本地包当作 CI 验收。

回放配置已改用现行 api-key 插件名。只刷新请求头副本，录制输入 `session.v3.jsonl` 的 SHA256 前后均为 `CD3400D2DA903812AB76B47EF5A57C9BEC51CDB54DC763D5C9127D9F443CF34C`，未改写历史代际。GUI 修复保留退场动效、实际像素几何和严格非法响应拒绝；异步高亮与真实 ACP 冷启动仅调整有界等待，不取消内容断言。

构建归档从约 2245MB 降为约 1119MB，不声称 GPU/CPU 性能收益。自动审批拒绝清理旧诊断产物后，保留文件并对旧 tar 作 NTFS 无损压缩；压缩前后 SHA256 均为 `A7A640B7E9515965A5AD162970BF39ECE3DA8D4F92A76EA7E4EFD23AE86F8E86`。旧 `rc-v033-preflight` / `rc-v033-gatefix` 不得发布。

剩余发布边界：取得固定提交的绿色 Desktop tests 和 Windows-only `release.yml` 原始 artifact，绑定 run ID / candidate SHA / Setup SHA256 后完成生产验收表；未测项不得填 Pass。继续停在 `publish.yml` 之前。

本轮决定：[运行时实例布局](../../../decisions/implemented/architecture/2026-09-28-runtime-instance-layout.md)、[GUI 与核心契约对齐](../../../decisions/implemented/bug-fix/2026-09-28-release-gui-contract-reconciliation.md)。下文保留先前诊断与窄范围修复证据，不代表当前仍有相同阻断。

## 前一轮门禁修复（历史）

用户在审查后回复“修复”，已授权并完成三个门禁缺陷及 ws 生产依赖、锁文件的修复。相关决定见[修复记录](../../../decisions/implemented/bug-fix/2026-09-28-packaging-identity-gates-and-ws.md)。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 修复前反例 | 四项均失败，分别对应合并、拆分、收敛与 ws 缺失 | `.omc/release-fix-red.log` |
| 定向测试 | 65/65 通过 | `.omc/release-fix-focused.log` |
| 全量桌面测试 | 2759 通过，2 跳过，0 失败 | `.omc/release-fix-full-tests.log` |
| 文档同步 | 8/8 通过 | `.omc/release-fix-doc-sync.log` |
| 独立状态反例 | 拒绝 split、拒绝 merge、接受 consolidate | `.omc/release-gate-probes-fixed.log` |
| 新 asar 依赖 | 生产声明和锁记录均有 ws@8.21.3，asar 内 19 个包文件 | `.omc/release-packaged-ws-fixed.log` |
| 真实打包 | 失败；严格门禁阻断 send 的异源合并，未生成新 Setup | `.omc/release-fix-dist.log` |
| 源码重启 | prestart ready，Whale Isle Launcher 正常响应 | `.omc/release-fix-start.stdout.log` |

此次打包使用 `node scripts/run-electron-builder.cjs --win --publish never --config.directories.output=dist/rc-v033-gatefix`，复用上轮已验证的远程和 Office 准备产物，完整执行 electron-builder 与修复后的 afterPack。未使用绕过门禁的打包入口。

当前首个真实阻断：源树 `.pnpm/send@1.2.1_supports-color@9.4.0/node_modules/send` 和 `.pnpm/send@1.2.1/node_modules/send` 被装配到同一 `@modelcontextprotocol/sdk/node_modules/express/node_modules/send`。两者来源不同，现已按契约失败关闭。修复门禁不等于修复整个依赖布局；需要单独保持源实例关系的装配工作，不能恢复字节相同豁免。

新安装树只完成到失败的 afterPack 中间阶段，不对其运行或宣称正式 packaged smoke。ws 缺失已通过锁记录与实际 asar 文件确认修复，完整安装包启动尚待依赖布局修复后重新验证。上轮 19 项 GUI 红项仍未处理，本轮未重复执行未改动的 GUI 全量检查。源码最初的合并停止/启动命令被自动审批拒绝；随后确认没有旧 Electron 进程，用不含停止操作的普通启动成功完成验证。

## 候选身份

- 已发布版本：GitHub 最新仍为 `v0.3.2`。
- 拟发布版本：`package.json` 与中英发布说明均为 `0.3.3`；`check-release-version v0.3.3` 通过。
- 本地基线：`ff093456592`，另有用户尚未提交的启动器、导入、右栏、主题和恢复修改。这是工作区预检，不是固定 SHA 的 CI 候选验收。
- 正式候选 run ID、Setup SHA256、同 SHA 的绿色 Desktop tests：尚未取得。
- 发布说明已补单一右栏、导入数据保全、插件恢复与小窗口操作说明，并重录双语 sidecar。

## 修复前预检

| 检查 | 结果 | 本地日志 |
| --- | --- | --- |
| 桌面 `npm test` | 2756 通过，2 跳过，0 失败，2758 项 | `.omc/release-preflight-tests.log` |
| `npm run doc-sync` | 发布说明修改前后均 8/8 通过 | `.omc/release-preflight-doc-sync.log`、`.omc/release-preflight-doc-sync-final.log` |
| vendored `test:gui` | 11028 通过，19 失败，1 跳过；15 个失败文件 / 745 个文件 | `.omc/release-preflight-gui.log` |
| 既有实例身份定向测试 | 4/4 通过，但其中一条明确接受本应阻断的实例拆分 | `.omc/release-gate-existing-identity-tests.log` |
| 独立门禁反例 | 两次错误放行、一次误拒绝，均已复现 | `.omc/release-gate-probes.log` |
| 本地 `dist` 预演 | 成功，输出 `dist/rc-v033-preflight`；不代表可发布 | `.omc/release-preflight-dist.log` |
| 本地资产校验 | Setup / blockmap / latest.yml 校验通过，Setup 860171033 字节 | 下文 SHA256 |
| 安装树冒烟 | 未通过；两次均未生成结果，发现隐藏的主进程 Error 对话框后人工终止隔离进程 | `.omc/release-preflight-packaged-smoke.log`、`.omc/release-preflight-packaged-smoke-clean-env.log` |
| 包内启动依赖核对 | `account-backend.js` 引用 ws，但生产清单、锁文件及 asar 都没有该包 | `.omc/release-packaged-ws-audit.log` |

本机 Node 为 `v26.7.0`，CI 钉 `.nvmrc` 的 `22.22.2`。即使本地 dist 成功，也不能替代 CI 安装包验收。远程运行时 SQLite ABI、daemon 启停探针及 Office 文档往返检查已在预演中通过。

本地 Setup SHA256：`48e5f452c463ae9074c48bf9e0d681e75aefd268d0669752b6bcd5e4e5b984be`。该文件仅是诊断产物，不安装、不发布、不作为正式生产验收对象。安装树冒烟在 afterPack 完成后、NSIS 压缩期间开始；并非 CI 顺序执行的正式候选流程。

启动证据的限制：第二次显式移除 `ELECTRON_RUN_AS_NODE` 后仍出现同样现象，原进程环境检查未发现该变量；最初的环境变量解释不成立。已观察到进程没有主窗或冒烟结果，存在隐藏 Error 对话框；未取得对话框中的完整异常文本。两轮退出码均来自人工停止本轮隔离进程，不记作自然超时。调试端口启动命令被自动审批以 `blocked by policy` 拒绝，未执行；后续使用只读 asar 检查得到依赖缺失证据，不将推断冒充调试器捕获的堆栈。

## 修复前发布阻断：缺少 ws 运行时依赖

位置：`src/main/account-backend.js:11`、根 `package.json` 的 `dependencies`。

启动链 `index.js -> welcome-backend.js -> account-backend.js` 在顶层执行 `require('ws')`。源码机上存在 `node_modules/ws`，但它未进入根锁文件；根 manifest 的生产依赖仅有 `electron-updater`，最终 asar 也没有 `node_modules/ws`。运行 `node .omc/release-packaged-ws-audit.cjs` 可只读复核。这说明源码机偶然存在的模块掩盖了安装包启动依赖缺口；需补明确的运行时依赖及锁记录、重建后再运行冒烟，不能仅把文件临时拷进已生成包。

此项是 P1 级明确的安装包缺陷。当前隐藏对话框的完整文本未取得，因此不声称已经排除其他启动错误。

## 打包门禁发现（已修复）

### P1：无法收拢时放行同源实例拆分

位置：`scripts/after-pack.js:1148`，现有回归 `src/main/after-pack-workspace.test.js:356`。

`!collapsible` 分支仅记录日志并继续，最终返回成功。复现中源码 a/b 共用一个 r，打包后各有 r 副本；a 修改 `count` 后 b 仍为 0。版本、字节和每条解析链正确不能证明模块缓存、注册表、类身份或共享状态保持一致。现有测试以 `assert.notStrictEqual(a, b)` 接受这一变化，与现行局部回退决定及 build-release 手册相反。

建议：没有证明安全的包级政策时，恢复身份拆分阻断；不能因为扁平布局难以表达原图而把改变语义的布局视为通过。修复布局是后续工作，不以豁免代替。

本地实际装配日志也记录了放行的重复实例，包括 `@opentelemetry/core` 七份、`@opentelemetry/resources` 六份等。该记录证明放行分支进入了本轮真实装配；不单凭副本数量宣称某条用户路径已经发生状态错误。

### P1：字节相同的不同源实例被允许合并

位置：`scripts/after-pack.js:1052`。

只有两个来源的发布文件不同才抛错。独立传递依赖反例中，源码的两个 r 文件完全相同但实例隔离；打包后都指向同一路径，a 写入 99 后 b 也读到 99。字节相同不等于隔离语义相同，递归文件比较无法识别这类状态串通。

建议：保留源实例到目标实例的一对一关系检查，不以文件相同豁免合并；增加真实加载和状态变化的反例。

### P2：仅删除重复副本的成功收拢被误判为未收敛

位置：`scripts/after-pack.js:1185`。

循环只用 `copied` 判断进展。若根副本已经正确，删除 a 下的冗余副本不增加 `copied`，于是收拢已经成功、a/b 也已指向同一实例，却抛出“合并/拆分后未收敛”。独立 `consolidate` 用例复现此误报。

建议：把复制和删除都算作图变化，收拢后清除相关缓存并重新验证；保持最大轮数与失败关闭语义。

### 复现

运行 `node .omc/release-gate-probes.cjs`。脚本在临时目录生成独立模块、真实 `require` 加载并检查可变对象身份，不修改产品源码或用户数据；生成结果：

| 模式 | 门禁接受 | 源码共用实例 | 安装树共用实例 | 第二消费者读取值 |
| --- | --- | --- | --- | --- |
| split | true | true | false | 0 |
| merge | true | false | true | 99 |
| consolidate | false | true | true | 99 |

## 门禁合理性

- 保留运行时闭包、原生 ABI、真实 CLI skip/full、安装树启动和资产哈希检查；这些检查观察不同层面的故障，不能互相替代。
- 保留同一候选 SHA 的 Desktop tests 与原候选资产晋级；`publish.yml` 不重建是合理边界。
- packaged smoke 证明 `win-unpacked` 可运行，不证明 NSIS 安装、升级、卸载或全部产品路径。仍需对相同 CI Setup SHA256 做生产验收。
- 两次 smoke 尝试可吸收一次偶发失败，但成功重试不能证明首轮失败没有真实问题；应保留两轮日志供判断。
- `.blockmap` 当前只验证存在与文件名，不证明内容对应 Setup。校验器已明确说明此限制，本轮不把它当作完整的差分更新验收。
- 最主要问题是实例门禁的错误放行与收敛误报并存，而不是应该整体取消门禁。三个反例修复前，打包成功也不能消除本记录的阻断。

审查范围为 `after-pack.js`、`check-release-assets.mjs`、`run-packaged-smoke.mjs`、`release.yml`、`publish.yml`，并核对相关测试、prepare 脚本和维护契约；未把本次审查宣称为整个产品代码审计。

## GUI 剩余失败

- `ui-chat` reasoning-row / system-prompt-row 与 `ui-tool` read-card / tool-call-tree / tool-row：关闭后内容保留与既有即时卸载断言不一致。
- `ui-schedule` 三项及 `ui-shortcuts` 一项：焦点恢复断言失败。
- `ui-settings-general` 两项：测试未找到桌面关闭行为行和宠物 section。
- `ui-settings-account` 与 `ui-sidebar`：两份输出快照不一致。
- `ui-theme`：菜单填充与 backdrop、中性边框、焦点 token、圆角和滚动条契约失败。
- `web/base-styles`：macOS no-drag 样式契约匹配失败。

这些是待逐项判断的真实失败记录，不据此直接改快照或放宽断言。客户端 AGENTS 明确要求未触及区域的红项进入交接；本轮未自动修改这些产品区域。

## 当时的剩余步骤（由上方结果取代）

1. 三项门禁和 ws 依赖修复已完成；继续解决真实依赖树中的异源合并和同源拆分，保持身份门禁。
2. 清理上述 GUI 红项及实际构建中的其余阻断；重新验证完整安装树启动，不绕过测试。
3. 对预定发行改动完成提交审查，再推送固定候选 SHA；取得同 SHA 的绿色 Desktop tests。
4. 运行 Windows-only `release.yml` 候选构建，下载原始 artifact，记录 run ID、commit SHA、Setup SHA256，执行资产校验。
5. 对同一 CI Setup 完成生产验收并记录未测项或合法豁免。
6. 停在 `publish.yml` 之前。未经用户后续发布指令，不创建 tag 或 Release。

范围确认已由用户“修复”回复完成，`desktop-build-runtime` 卡记录了本次窄范围授权。该授权用于三个已复现的门禁缺陷和 ws 锁记录补齐，没有把实际依赖布局仍然失败写成可发布，也没有执行发布。
