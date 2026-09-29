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

首轮源提交：`ef501689388b1aac1fb57a4de609fd4f1a78a89c`。Windows 构建：[36602013284](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/36602013284)失败，未生成 Setup；同提交 Desktop tests：[36601994891](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/36601994891)的 Windows 任务失败，macOS 任务通过。此候选拒绝晋级。126 项[安装版验收清单](ACCEPTANCE.md)已创建，全部未执行，须绑定修复后的新候选。

## 首轮 CI 修复

- 构建失败于 `prepare-dshd-remote.mjs` 的干净 `npm ci`：ChisaCode workspace 的根 `@types/node` override 解析到 22.20.4，锁文件仍为 22.20.1。本机 Node 24.21.0 / npm 11.19.0 在隔离 workspace 同样复现。仅同步该条目到 22.20.4 并补官方 registry 的 resolved/integrity；其它锁定包不变，不改 `npm ci` 或跳过校验。
- Windows 的两项失败来自 `TEMP` 使用 `RUNNER~1`，而 junction 解析为 `runneradmin`；普通 `fs.realpathSync` 在非链接侧保留短名。两条断言均改用 `fs.realpathSync.native` 解析两侧，仍严格比较实际目标身份；运行时代码未变。定向提取与链接测试 30/30 通过。
- 这是依赖补丁与测试路径规范化，不改变产品契约或测试策略；依照维护规则不新增机械修复决策记录。新 CI 必须重新验证全部门禁。
- 修复后的同一份锁文件在空目录执行真实 `npm ci --ignore-scripts --no-audit --no-fund` 成功，安装 1900 个包（约三分钟）；非仅 dry-run。日志保留在 `.tmp/release-20260929/remote-clean-install.log`。
- 首轮 vendor-gui 的 GUI、核心回归、无密钥工具恢复均通过，但最后的 `gen-client-catalog --check` 发现统计 dock 注入未同步。运行官方生成器补齐 `slot-catalog.ts`，再验证 client catalog 与 third-party notices 均通过；不手改生成器或放宽门禁。

## 替换候选

- 源提交：`0a828d5dcabcd3ee560e98def49a810d3d57959b`。
- Windows 构建：[36604075860](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/36604075860)，已取消；发现仍缺生成目录后避免继续浪费构建。
- 同提交 Desktop tests：[36604044587](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/36604044587)，同步取消，等待补齐生成产物后的新 SHA。
- Setup SHA256：待原始 CI artifact 生成后下载校验；安装版验收未执行。

新候选必须绑定源提交、成功的 `release.yml` run、同 SHA 成功的 `test.yml` run、原始 Setup SHA256 与资产校验结果。全部生产安装包验收仍须按[验收表](../../production-acceptance-test-cases.md)在同一 CI Setup 上完成；本地测试不能替代该表。未执行 `publish.yml`，公开 latest 仍为 v0.3.2。
