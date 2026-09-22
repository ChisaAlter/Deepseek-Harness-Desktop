# 合并收口第二轮 QA 汇总（2026-08-27）

基线 `main@6874270c`（12 PR consolidation + DER INTEGER 修复），执行分支
`cursor/post-consolidation-closeout-aebd`。机器：云 Linux VM（X :1 真显示），
Node v22.22.2（nvm，按 `.nvmrc`；VM 默认 22.14 已被 `.cursor/environment.json` 钉版修复）。
机读明细：[post-consolidation-closeout.json](post-consolidation-closeout.json)。
计划与执行记录：[../../superpowers/plans/2026-08-27-post-consolidation-closeout-round-2.md](../../superpowers/plans/2026-08-27-post-consolidation-closeout-round-2.md)。

## 通过的门

| 门 | 结果 |
| --- | --- |
| desktop `npm test` | **1224 用例 / 1219 pass / 0 fail / 5 skip** |
| vendor `pnpm install --frozen-lockfile` | exit 0 |
| vendor `build:lib` | exit 0 |
| skip compose 契约（真实构建 CLI） | PASS（skip+full 双轮、canary、迁移回放、install+dsh-im 行各恰好一次） |
| vendor `test:gui` | **412 文件 / 5409 pass / 1 skip / 0 fail**（120.6s） |
| `gen-client-catalog --check` / `gen-third-party-notices --check` | 均 up to date |
| mobile-web fake-daemon 浏览器 QA | **41/41**（headless Chrome；截图刷新于本目录 `mobile-web-phase2-*.png`） |
| `smoke:source`（真 Electron + 真 dsh web） | PASS（详见下方 flake 记录） |
| 市场快照刷新（live registry） | 6→200 行，退役家族行 0，快照回归测试绿 |
| `remote-tls` DER 边界补测 | 6/6（新增 multi-zero 剥除 + 0x00 高位保留） |
| Android `:protocol:test`（纯 JVM，JDK 17） | **5/5**（OfferTest） |
| dshbot 发布预检 `check-dshbot-publish.mjs dshbot-v0.2.0` | PASS |

## smoke:source flake 记录（诚实口径）

前两次运行（与 vendor test:gui/构建并发，VM 高负载）在「branch menu did not open」
失败；空载后连续 **3 次 PASS**（surfaces/branch/git 命中全绿、PTY 回显 ok、pageErrors 空）。
consolidation 区间 diff 对 `ui-git` / `ui-titlebar` / `src/main/git*.js` 零改动，
2026-08-26 D 系列在合并前树同门 PASS —— 判定为负载性 flake，非回归。
若该步在 CI/后续环境再次稳定复现，按 `git-titlebar` 卡排查菜单打开路径。

## BLOCKED（本环境无法执行，不伪造）

| 项 | 原因 | 解锁条件 |
| --- | --- | --- |
| Android `:app:testDebugUnitTest` 与 APK 构建 | VM 无 Android SDK（`SDK location not found`） | 配 `ANDROID_HOME` 或带 SDK 的 runner |
| `qa:packaged` / Windows NSIS 三相（TC-EXT-007 等） | 云 Linux 跑不了 Windows 安装包/打包 GUI | Windows x64 实机 + CI artifact（手册：[../tc-ext-007-dshbot-install-smoke.md](../tc-ext-007-dshbot-install-smoke.md)） |
| 真机 relay 配对（TC-REM-002） | 无真机/局域网对端 | 真机 + 桌面同 LAN |
| dshbot npm 发布 | 仓库缺 `NPM_TOKEN` secret（VM 无法验证/配置） | 配 secret 后推 `dshbot-v0.2.0` tag |
| 孤儿 draft PR 关闭（#55/57/58/60/61/62） | 本环境 gh 凭证只读 | 维护者执行计划 Phase A 的一键命令 |

## 复审结论（Phase D）

- `ipc.js`：desktop-builtin（dsh-im 别名）禁用拒绝发生在任何 config 写之前（单测锁 `saveConfigCalls===0`）；`shell:rotate-remote-token`（HARNESS_ONLY → `ChisaCodeRemote.rotateToken`）与禁用（LAUNCHER_ONLY）不同表面、不同 config 键，`saveConfig` 读改写合并 + 主进程单线程，无串扰。
- `remote-tls.js`：DER 修复完备——全零 serial 收敛为 INTEGER 0、`0x00`+高位字节保留、长 length 正确、UTCTime 在 notAfter≈2036 下安全（2050 边界不触发）、签名 `dsaEncoding:'der'`；新增两个边界回归测试。
- mobile/web XSS：`mobile/` 全树零 `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`/`eval` sink；markdown 链接 scheme 白名单（拒 `javascript:`/`data:`）有测试。
- 透明主题门控：`TRANSPARENT_ATTR` 仅在 flag 开 + `isWallpaperDataUrl` 真时置上（`appearance-apply.ts:96-99`），vendor specs 全绿。
- dshbot 协议：可见投递计数 / 群投递成员鉴权 / 闲置群诚实失败等单测全部含在 desktop 1219 绿内。
- 发现并修复：市场快照刷新使 `01Virex/dsh-status-rotator` 行转为 npm 发布，7 个依赖随包快照内容的测试断言过期——github 通道测试改钉 github-only fixture（防未来快照刷新再翻转），快照锚点断言更新。
