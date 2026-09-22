# 0.2.7 发版交接（2026-08-24 · 23:40 更新）

## 代码门禁

- [x] `npm test` — 876/876（本地，Windows）
- [x] `node scripts/check-release-version.mjs v0.2.7`
- [x] **Build installers** CI 绿（run [32735432340](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/32735432340)，SHA `47ad18710b`）
- [ ] GitHub `test.yml` 对 PR #23 变绿（macOS discoverWindowsInstall + vendor-gui — 本 push 修复中）

## CI 安装包（已装 `Program Files`）

| 项 | 值 |
| --- | --- |
| Setup SHA256 | `52EBFCF4B43214988750552A66FF0087B1A70CD43FB6C4430F241917F7C06666` |
| 自动化 | 见 `ci-installer/EXECUTION-REPORT.md` |
| Pass | 启动器 P0、reopen、shell 托盘 P0、附录 1–5 + reject |
| Fail | appendix.vision（同会话 read-only；源码已修，待下一 CI 包） |

## 合规发版顺序

**当前阶段：47ad187 包已装、P0 子集通过；仍不打 `v0.2.7` tag，直至 vision 在新 artifact 上 Pass + §16 勾同一 SHA。**

1. Push 本批 QA/CI 修复 → 新 `workflow_dispatch` Build installers。
2. 重装 → 仅重跑 `run-installed-appendix.mjs`。
3. 填 §16（`production-acceptance-test-cases.md`）勾「Release 将上传同一 SHA」。
4. 打 tag / 更新 draft Release。

## 脚本索引（`docs/qa/results/2026-08-24/ci-installer/`）

| 脚本 | 用途 |
| --- | --- |
| `install-p0-probe.mjs` | 冷启动 / stop-desktop / 版本 tab |
| `install-p0-continue.mjs` | 自动进桌面、单实例、TC-LAUNCH-006/007 |
| `run-installed-shell-p0.mjs` | TC-DESK-002（托盘 IPC 探针） |
| `run-installed-tray-quit.mjs` | TC-DESK-004 |
| `run-installed-appendix.mjs` | 附录 A + reject/vision |
