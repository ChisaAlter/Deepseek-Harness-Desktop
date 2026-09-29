# 0.3.3 候选推进记录

## 范围

将 2026-09-29 工作区已有的安装恢复、异步运行时链接、透明圆角与原生窗口动画、桌宠区域与密度、统计计数与开关、Android 原生聊天改动纳入新候选。版本保持 0.3.3；仅构建 Windows x64。Android APK 不属于本次发布资产，既有部分真机结果不代表完整 Android 验收。

双语发布说明已补齐桌面修复；生产验收表的 artifact 名和 Node 基线同步到现行工作流。这是发布资料整理，不改变产品行为或门禁。

## 本地预检

使用仓库 `.nvmrc` 钉定的 Node 24.21.0：

| 检查 | 结果 |
| --- | --- |
| `npm test` | 2865 项，2863 通过、2 跳过、0 失败 |
| 用量插件 `npm test` | 191/191 |
| ui-chat apply / submission-policy 定向 Vitest | 45/45 |
| `check:governance` | 6/6 |
| `doc-sync` | 7/7 |
| `run-window-motion-qa.mjs --composed` | 主窗和启动器的 active / inactive / resized / restored 四角合成检查与原生窗口状态通过 |

本轮日志与截图保留在本机 `.tmp/release-20260929/`。窗口状态与角部采像不单独认证可见 DWM 插值；已有逐帧证据见[窗口报告](../2026-09-29-corner-motion/README.md)。Vitest 首次从错误工作目录调用未发现测试，改在 vendor 根运行后得到上述 45/45 结果，没有修改测试配置。

## 晋级门槛

新候选必须绑定源提交、成功的 `release.yml` run、同 SHA 成功的 `test.yml` run、原始 Setup SHA256 与资产校验结果。全部生产安装包验收仍须按[验收表](../../production-acceptance-test-cases.md)在同一 CI Setup 上完成；本地测试不能替代该表。未执行 `publish.yml`，公开 latest 仍为 v0.3.2。
