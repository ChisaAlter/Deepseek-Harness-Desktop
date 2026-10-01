# Windows 0.3.3 候选推进记录

## 范围与授权

用户要求准备 Windows 新版本，随后报告 Files 查看器把 `sidebar://desktop-file` 当成磁盘路径的 ENOENT，并指出「文件」与「文件查看器」入口重复。2026-10-01 用户明确要求修好后继续发布。版本保持 0.3.3，仅构建 Windows x64；此前候选 `36604949879` 不含本轮审查和 Files 修复，不可晋级为本轮产物。

本轮沿用 [发布手册](../../../handbook/modules/build-release.md) 和 [生产验收表](../../../qa/production-acceptance-test-cases.md) 的门禁，不把源码测试或 unpacked 演练写成正式安装版 Pass。

## 源码修复与预检

- 全面审查修复已提交为 `ddb966a20`，证据见 [审查报告](../2026-09-30-project-audit-fixes/README.md)。
- Files guide 只保留目录入口，具体文件继续进入编辑页；旧无文件查看器原位显示所属 Session 目录，不迁移布局、浮窗或有效文件草稿。决定见 [Files 地址恢复](../../../decisions/implemented/bug-fix/2026-10-01-sidebar-files-guide-address.md)。
- 使用 `.nvmrc` 钉定的 Node 24.21.0。新真实 Guide / registry / controller / keyed body / 恢复布局回归 9/9，独立复跑 9/9；既有 adapter / apply 16/16。窄 lint 无错误或警告，client aggregate `tsc -b tsconfig.client.json` exit 0，官方 client catalog 检查通过。
- `scripts/prestart-ensure.mjs` 官方 native / host / client / web 构建 exit 0，记录 372 个 client 产物；构建日志为本机 `%TEMP%/dshd-files-guide-build-final.log`。
- 本机全量 GUI 首轮受待机恢复影响出现多条超时和 worker 终止异常，未取得有效全组汇总，另有文件 symlink 夹具权限失败；未修改 timeout、断言或 skip，不宣称本机全组通过。该提交在 CI 的完整 GUI 结果见下节。
- 首次源码 QA 因 `ERR_NETWORK_IO_SUSPENDED` 后超过 600 秒而失败，未生成可通过的走查结果；保留 `%TEMP%/dshd-files-guide-source-qa.log` 和 `%TEMP%/dsh-source-qa-vlFYC8/` 供复查，不把该次启动写成通过。
- 第二次源码 QA 执行 77 步：68 通过、8 必需项失败、1 可选项跳过；Files 工作环 8/8 通过。隔离仓缺本地 Git author、账户/远程旧入口与文案、未解析 `aria-labelledby`、模型确认与页面等待等夹具问题正在修正；推理停止后的输入状态与技能装配仍须复跑排除，未将静态诊断记为 Pass。证据为 `%TEMP%/dsh-source-qa-DLnGCu/`，不得将含隔离会话 token 的原始结果全文发布。
- 隔离 Git fixture 已写入仅该仓库的 author，`smoke-workspace.test.mjs` 7/7 通过，既有真实 workspace 模式仍不做 Git 修改。未改全局 Git 身份。
- 用户随后指出右栏关闭按钮偏低；24px 桌面 tab 仍使用共享 28px tab 的固定顶部定位，导致下偏 2 CSS px。已改为随标题 cross-axis 居中，保持关闭在标题右侧及原命中区。隔离真实 Electron 12 组宽度/字号/缩放下盒中心差不超过 0.006 CSS px，关闭一次、未触发拖拽；既有 DockKit 组件 87/87。证据 `%TEMP%/dshd-tab-close-alignment/`，新候选须包含该修复。
- 源码 UI 走查接线已按现行账户入口、可访问名称和保存凭据状态修正，并严格等待停止后输入与技能页内容就绪；原 required 项和超时保留。VM 反例/正例 12/12 通过，真实 UI 重跑待执行；见 [走查契约](../../../decisions/implemented/process/2026-10-01-release-ui-walk-contract.md)。

## 候选身份与晋级

首轮源提交 `c28101455f5cdbccf6dcc2463e466ed3d9553954`：

- [Desktop tests 36793951096](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/36793951096) 整体失败。Windows 2886 项：2880 通过、6 跳过、0 失败；原生窗控契约通过，本机 EPERM 的 symlink 用例在该 CI 真实执行通过。macOS 2886 项：2857 通过、13 失败、16 跳过。
- 同运行 vendor GUI 748 文件：11089 通过、1 跳过；新 Files 注册 9/9；核心 215 文件：5009 通过、5 跳过；无密钥 malformed-tool 恢复 1 通过、134 个未选用例跳过；catalog / notices 最新。
- [Windows 候选 36794053414](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/36794053414) 已取消。该 SHA 整体测试未绿且随后出现关闭按钮对齐修复，不生成可晋级身份，不使用其二进制。
- macOS 的 13 条失败来自旧 Windows `.exe` 夹具未声明目标平台；仅修正 `runtime-install.test.js` / `update.test.js` 的逐测试平台与三个直接安装参数，保留所有断言，新增 2 条默认 API 的 arm64 DMG 回归。定向四文件原生 Windows 86/86、模拟 darwin/arm64 86/86，均无跳过；实际 macOS CI 必须由新 SHA 重新证明。

待新候选 `release.yml` 与同 SHA 的 `test.yml` 完成后，记录源提交、运行 URL、原始 artifact、Setup SHA256、离线资产校验和包内 Node / Harness 身份。不得沿用旧候选摘要。

正式生产安装版验收和 §16 签字尚未执行。晋级必须绑定同一 CI Setup SHA，使用 `publish.yml` 下载原始候选并验证；当前没有新增 tag 或正式发布证明。
