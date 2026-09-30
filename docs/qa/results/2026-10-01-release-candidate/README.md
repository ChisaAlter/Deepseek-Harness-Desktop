# Windows 0.3.3 候选推进记录

## 范围与授权

用户要求准备 Windows 新版本，随后报告 Files 查看器把 `sidebar://desktop-file` 当成磁盘路径的 ENOENT，并指出「文件」与「文件查看器」入口重复。2026-10-01 用户明确要求修好后继续发布。版本保持 0.3.3，仅构建 Windows x64；此前候选 `36604949879` 不含本轮审查和 Files 修复，不可晋级为本轮产物。

本轮沿用 [发布手册](../../../handbook/modules/build-release.md) 和 [生产验收表](../../../qa/production-acceptance-test-cases.md) 的门禁，不把源码测试或 unpacked 演练写成正式安装版 Pass。

## 源码修复与预检

- 全面审查修复已提交为 `ddb966a20`，证据见 [审查报告](../2026-09-30-project-audit-fixes/README.md)。
- Files guide 只保留目录入口，具体文件继续进入编辑页；旧无文件查看器原位显示所属 Session 目录，不迁移布局、浮窗或有效文件草稿。决定见 [Files 地址恢复](../../../decisions/implemented/bug-fix/2026-10-01-sidebar-files-guide-address.md)。
- 使用 `.nvmrc` 钉定的 Node 24.21.0。新真实 Guide / registry / controller / keyed body / 恢复布局回归 9/9，独立复跑 9/9；既有 adapter / apply 16/16。窄 lint 无错误或警告，client aggregate `tsc -b tsconfig.client.json` exit 0，官方 client catalog 检查通过。
- `scripts/prestart-ensure.mjs` 官方 native / host / client / web 构建 exit 0，记录 372 个 client 产物；构建日志为本机 `%TEMP%/dshd-files-guide-build-final.log`。
- 本机全量 GUI 首轮仍在执行，已有若干原超时限制下的超时，未修改 timeout、断言或 skip；最终结果及串行复查待记录，不宣称全绿。
- 首次源码 QA 因 `ERR_NETWORK_IO_SUSPENDED` 后超过 600 秒而失败，未生成可通过的走查结果；保留 `%TEMP%/dshd-files-guide-source-qa.log` 和 `%TEMP%/dsh-source-qa-vlFYC8/` 供复查，不把该次启动写成通过。

## 候选身份与晋级

待本轮 `release.yml` 与同 SHA 的 `test.yml` 完成后，记录源提交、运行 URL、原始 artifact、Setup SHA256、离线资产校验和包内 Node / Harness 身份。不得沿用旧候选摘要。

正式生产安装版验收和 §16 签字尚未执行。晋级必须绑定同一 CI Setup SHA，使用 `publish.yml` 下载原始候选并验证；当前没有新增 tag 或正式发布证明。
