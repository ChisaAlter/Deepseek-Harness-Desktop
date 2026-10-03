# 开发 CI 与自动发布

开发者在工作分支完成修改并提 PR，由用户确认合入 main。准备发布时在 PR 中更新 `package.json` 和锁文件的版本、更新 [.github/release-notes.md](../../../.github/release-notes.md) 及需要的译文。不修改版本的合并只产生开发反馈。

## 开发检查

[Development CI](../../../.github/workflows/test.yml) 在 PR 和 main 推送时运行。路径选择位于 `scripts/ci-scope.mjs`，只有产品、工具、上游、窗口四个固定分组，没有候选验收计划。

- 纯文档与规则说明不启动产品构建。
- Windows 产品检查构建官方 profile，执行桌面回归，生成 NSIS 安装包并启动 unpacked 应用。后者证明分发树能启动，不冒充已经验证所有安装和升级场景。
- 上游和窗口检查仅在相应改动时执行。
- 工具测试独立运行，不混入 `npm test`。
- 需要 macOS 时手动运行 Development CI，勾选 `include_macos`；默认只交付 Windows。
- 汇总检查名为 `CI`，失败或取消不会变成通过。分支保护可要求该检查；工作流文件本身不配置 GitHub 账号权限。

安装或升级行为发生变化时，在开发阶段验证相应实际操作，并在 PR 说明结果。没有固定的每版人工验收全表。

## 自动分发

[Release](../../../.github/workflows/release.yml) 在 main 的 Development CI 成功后自动运行，发布实现位于 `scripts/publish-release.mjs`。

它使用同一次 CI 的 `Whale-Isle-windows-x64`（及存在时的 macOS）资产，核对版本、Setup、blockmap 和 latest.yml，生成更新器需要的 `SHA512SUMS.txt`，上传至 draft release，上传完成后公开。tag 指向产生资产的源码提交。不会运行产品测试、重新构建或要求验收 JSON。

同版本已发布、版本不高于 latest、或该 CI 只有文档/工具而没有安装包时不发布。PR 和 fork 的构建不能进入自动分发。现有正式版本与 tag 不覆盖。

## 失败处理

开发检查失败时修复对应问题；需要重跑时使用 GitHub 的失败 job 重跑。发布上传失败保留 draft，手动运行 Release 并提供原 Development CI 的 `run_id`，复用原包完成分发。artifact 保留 30 天；过期后需要新的开发构建，不从另一个版本补包。

历史候选和验收报告保留原结果，不作为新流程的输入。没有人工签署、发布审批状态机或按文件路径扩张的人工检查表。

发布完成以实际 GitHub Release、资产和更新入口为准；仅修改配置不代表已发布。当前账号权限与 main 保护属于 GitHub 设置，不能从本文件推断已经生效。
