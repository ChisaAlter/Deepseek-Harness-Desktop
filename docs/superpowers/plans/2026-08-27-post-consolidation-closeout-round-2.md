# 合并收口第二轮（Post-consolidation closeout, round 2）：#51–#62 十二 PR 合并后的卫生、验证与文档收口

> **For agentic workers:** 本计划同时是设计文档与执行记录。基线 `main@6874270c`（consolidation 合并 + DER INTEGER 修复），CI run 33075872577 全绿。执行分支 `cursor/post-consolidation-closeout-aebd`。复核时用 checkbox 对账。

**Goal:** 把 12 个开放 PR（#51–#62）合并进 main 之后的残余收口做完：孤儿 draft PR 与分支卫生、#53 市场快照/契约门跟进、环境 Node 钉版、全量测试复验、合并面代码复审、实机缺口诚实记录、feature card `last verified` 刷新与 dshbot 发布链路核对。

**Non-goals:**

- 不实现任何新产品行为（无新 UI、无新 IPC、无新插件能力）。
- 不在云端 Linux 伪造 Windows 安装包 / Android 实机 / 真机扫码结论。
- 不动 vendor pin、不改官方 `~/.dsh` 语义。
- 不翻 `REMOTE_FEATURE_ENABLED` 等停放开关。

**Touching:** desktop-launcher、marketplace-settings、mobile-remote、remote-settings、transparent-theme、dsh-tools、dshbot、settings-nav（仅复审与 `last verified` 刷新；如复审发现回归才进对应卡的 Allowed touch 改代码）。本文件与 QA 结果为 docs 落盘。

---

## 现状核对（先于一切执行，已完成 ✅）

- [x] `main@6874270c` 干净、与 origin 同步；远端**只剩 `main`** —— 任务书里「验证无 stale `cursor/*` 分支」经 `git ls-remote --heads origin` 证实：14 支合并来源分支已全部在 GitHub 侧删除（本地 remote-tracking 引用 `fetch --prune` 后清空）。
- [x] 六个 draft PR（#55、#57、#58、#60、#61、#62）确实仍 OPEN 且 head 分支已删——它们经 content-merge（非 fast-forward ancestry）并入 #52 链，GitHub 不会自动标 MERGED。本环境 `gh` 为只读凭证，无法 close，落手册（见 Phase A）。
- [x] VM Node 22.14.0（`/exec-daemon/node`）遮蔽 nvm 22.22.2；`.nvmrc`=22.22.2、engines `^22.19.0 || >=24`。上一轮收口计划已证明 22.14 会让 vendor build 直接炸（tsdown/unrun engine 不满足）。CI 三个 workflow 均已 `node-version-file: .nvmrc`，**CI 无缺口**；缺口只在云 VM/新开发机。见 Phase C1。

## Phase A — 仓库卫生（部分需人工）

- [x] A2 分支卫生：已核实远端只剩 `main`，无须删除动作。
- [ ] A1 孤儿 PR 关闭：**需要有写权限的人执行**（本环境 gh 只读）。一键命令：

  ```bash
  for n in 55 57 58 60 61 62; do gh pr close "$n" -R chisaalter/deepseek-harness-desktop \
    -c "Superseded: content merged into main via consolidation merge 7624bdd0 (PR #52 chain); head branch deleted."; done
  ```

  验收：`gh pr list --state open` 为空。

## Phase B — #53 跟进（marketplace-settings / desktop-launcher）

- [x] B1 `npm run refresh:marketplace-snapshot` 对 live registry 刷新快照；若 diff 非空且回归测试（快照无退役家族行）仍绿则提交。
- [x] B2 `install_dsh_plugin` 治理边界收进 feature card。判定：该边界（Host `installPlugin` 通道 github-only、`#path:` 只走 curated 通道、DROPPED 家族拒绝）分散在 `marketplace-settings` 卡 Invariants 与 `dshbot` 卡里已有表述——按 Feature Spine「不做第二套 Wiki」原则**扩写 `marketplace-settings` 卡**为一段显式「安装通道治理」小节，不另立新卡；`.cursor/rules/marketplace-settings-product.mdc` 若需同步则同步。
- [x] B3 市场面若有代码/快照改动，对真实构建 CLI 重跑 `scripts/check-skip-compose-contract.js`。

## Phase C — 环境与全量测试

- [x] C1 Node 钉版：本仓库无 `.cursor/environment.json`（本 run 为 just-in-time VM）。落一份 repo-file `.cursor/environment.json`，install 阶段用 nvm 按 `.nvmrc` 对齐，使未来云代理不再踩 22.14；handbook 开发环境说明同步一句。
- [x] C2 全量测试（顺序敏感，Node 22.22.2）：
  1. 根 `npm test`（期望 ≥1124 pass / 0 fail 量级，以实际为准）；
  2. vendor `pnpm install --frozen-lockfile`（已绿）→ `pnpm run build:lib` → `pnpm run test:gui` → `node scripts/gen-client-catalog.mjs --check` / `gen-notices --check`（以 test.yml 的 vendor-gui job 为准面）；
  3. `check-skip-compose-contract.js` 对真实构建 CLI。
- [x] C3 `node tools/mobile-web-qa/run-qa.mjs` 假守护进程 QA，目标 41/41。

## Phase D — 合并面严格复审（静态 + 测试证据）

逐项复审、结论落执行记录；发现回归按对应卡 Allowed touch 修复并以 `feature(<id>): …` 提交：

- [x] D1 `src/main/ipc.js`：desktop-builtin（DSH_IM_ALIASES）禁用拒绝与 `shell:rotate-remote-token` 的 parked 语义共存无串扰。
- [x] D2 `src/main/remote-tls.js` DER 完备性：全零 serial、0x00+高位保留、长 length 编码、UTCTime 2050 边界（notAfter≈2036 安全）、`dsaEncoding:'der'` 签名。初步结论：修复完备（见执行记录）。
- [x] D3 mobile/web XSS：无 `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write` sink；markdown 链接 scheme 白名单有测试锁。
- [x] D4 透明主题壁纸门控：无壁纸时 flag 惰性、`data-dsh-transparent` 只在「flag 开 + 壁纸活」置上（vendor specs 为准）。
- [x] D5 dshbot 协议改动：可见投递计数 / 群投递成员鉴权 / 闲置群诚实失败的单测在合并树上仍绿。

## Phase E — 实机 / 打包缺口（诚实记录）

- [x] E1 桌面 GUI：云 Linux 无显示器 → `xvfb-run -a npm run smoke:source` 做源码级冒烟（launcher→desktop、设置导航、外观）。
- [x] E2 mobile-web：C3 假守护进程 QA 即本相证据，报告落 `docs/qa/results/2026-08-27/`。
- [x] E3 Android：VM 无 Android SDK → BLOCKED，落文档（不尝试伪造 gradle 结果）。
- [x] E4 Windows 打包（`qa:packaged` NSIS 相）：云 Linux 无法执行 → BLOCKED，沿用 TC-EXT-007 手册。

## Phase F — 文档收口

- [x] F1 有新证据的卡刷 `last verified`（只刷有本轮证据的：desktop-launcher、marketplace-settings、mobile-remote、remote-settings、transparent-theme、dsh-tools、dshbot、settings-nav——settings-nav 若无独立卡则并入实际承载卡）。
- [x] F2 本计划 + 执行记录（即本文件持续回填）。
- [x] F3 QA 证据落 `docs/qa/results/2026-08-27/`（JSON 报告 + markdown 摘要）。
- [x] F4 复核 `2026-08-27-dsh-tools-upstream-handoff.md` 合并后仍准确。

## Phase G — dshbot 发布链路

- [x] 核对 `publish-dshbot.yml` + `check-dshbot-publish.mjs` + manifest 测试就绪；`NPM_TOKEN` secret 是否存在无法从 VM 验证 → 在 dshbot 卡 / handbook 落发布 checklist，不阻塞本轮。

## 风险

- **R1 误报回归：** 复审只信合并树上的测试证据与源码，不信 PR 描述。
- **R2 快照刷新引入退役行：** B1 后必跑快照回归测试，红则不提交快照。
- **R3 长测抖动：** test:gui 5000+ 用例，macOS FSEvents 抖动已在上一轮修复；Linux 跑本轮，任何红灯先与 main 头对照再定性。

## Rollout / rollback

- 全部改动落 `cursor/post-consolidation-closeout-aebd`，独立可并；docs 为主，代码改动（若有）逐 commit 可单独 revert。不动 main，不 force-push。

---

## 执行记录（2026-08-27，云 Linux VM，Node 22.22.2）

全部证据的机读/人读汇总落在
[docs/qa/results/2026-08-27/post-consolidation-closeout.md](../../qa/results/2026-08-27/post-consolidation-closeout.md)
（+ 同名 `.json`）。要点：

- **测试全绿**：desktop `npm test` 1224/1219/0 红/5 skip；vendor `pnpm install`→`build:lib`→skip-compose 契约（真实构建 CLI）→`test:gui` 412 文件 / 5409 pass / 1 skip→gen 双 check，全部 exit 0；mobile-web fake-daemon QA **41/41**；`smoke:source` 空载连续 3 次 PASS（并发负载下 2 次 branch-menu flake，consolidation 区间对 ui-git/titlebar/git.js 零改动，判定环境性）。
- **B1/B3**：快照 6→200 行（退役行 0）；status-rotator 行 npm 化导致 7 个快照内容锚点断言过期——github 通道安装测试改钉 github-only disk-registry fixture（未来快照刷新免疫），锚点断言更新注释说明。skip-compose 契约在快照刷新后的树上通过。
- **B2**：`install_dsh_plugin` 治理边界收进 `marketplace-settings` 卡独立小节（回环控制端点、github-only 双侧同源校验、allowBuilds 白名单、主进程复验 + 退役家族拒绝、flush 后重启），`.cursor/rules/marketplace-settings-product.mdc` 同步一句；未另立新卡（Feature Spine「不做第二套 Wiki」）。
- **C1**：`.cursor/environment.json` + `.cursor/install.sh` 落地（nvm 按 `.nvmrc` 对齐 + npm ci + vendor pnpm install），`.gitignore` 精确放行这两个文件；CI 本就 `node-version-file` 无缺口。
- **D 复审**：五项全过，一项测试面缺口补齐（remote-tls DER 边界 2 形态补测 6/6）。详见 QA 汇总「复审结论」。
- **E**：Android `:protocol:test` 5/5（装 JDK 17 后，纯 JVM 模块）；`:app:testDebugUnitTest`、Windows `qa:packaged`、真机 relay、npm 发布均 BLOCKED 且如实记录（见 QA 汇总 BLOCKED 表）。
- **F4**：handoff 文档改为从 merge commit `cac4f790` 提取 diff（原分支已删）。
- **G**：`check-dshbot-publish.mjs dshbot-v0.2.0` PASS；剩余缺口仅 `NPM_TOKEN` secret（dshbot 卡 P1 行与 last verified 已更新）。
- **A1（唯一遗留人工项）**：六个孤儿 draft PR 关闭需写权限，命令见 Phase A。
