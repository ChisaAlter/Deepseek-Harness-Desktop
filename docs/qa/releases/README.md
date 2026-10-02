# 候选验收记录

唯一当前流程见 [发布操作流程](../../handbook/modules/release-process.md)。

先完成产品实现，再完成同版本本地必要测试和真实 QA，全部通过才手动触发最终 CI。候选前只复用 `.tmp/release/current-state.json`，累计 CI 未通过次数跨 SHA/版本/工作流/会话保留，第四次即停止。模板和 hook 状态核对不能证明观察真实性。\n\n每个候选的记录路径为 `v<version>/<candidate-run-id>.json`，由 `scripts/check-release-acceptance.mjs init` 生成。初始状态是 testing，所有用例为 not-run；禁止把模板或历史报告当成通过结果。审阅后提交到 main，以完整报告提交 SHA 晋级原始候选。

这里不预置 0.3.3 的通过记录。现有候选证据仍在 [历史推进记录](../results/2026-10-01-release-candidate/README.md)，不能代替新流程下尚未运行的 CI 和安装验收。
