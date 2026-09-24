# Feature: Harness 上游同步

| Field | Value |
| --- | --- |
| **id** | `harness-upstream-sync` |
| **status** | `active` |
| **last verified** | 2026-09-25 — 将 `dsh-v0.1.7-rc.2`（`477b4f4`，alpha.2 是其祖先）三方合并至桌面树：快照提交后隔离 worktree 解冲突，`--continue` 落盘。官方构建（host tsc + tsdown + client vite）通过；client/host typecheck 零错误；client slot catalog 重新生成。合并回归修复：pwsh `sandbox_permissions` 审批理由的 description 兜底重新接入 execute 路径；durable-question 重入驱动移到 setup maintenance 结算之后（原序会被 maintenance finally 重置 running 相位）。桌面自有断言同步更新（caption 拖拽、面包屑 span、归档分组、模型选择 pending 语义、session-log-export configForms 注入）。广跑其余失败均为与上游 rc.2 逐字节相同的环境性用例（Windows 签名/真实 git/pnpm 子进程/网络/长迁移），非合并回归。治理门禁 6/6 通过。此前 2026-09-23 — 会话头部交互座位、通用交互元素与顶部固定浮层从 48px 拖拽带扣除；样式测试 11/11、源码构建、重启后顶部按钮命中区与 Agent Team / 打开方式 / Git 菜单点击复核通过。此前 2026-09-23 — 设置侧栏键盘焦点轮廓改用设计语言规定的中性描边；CDP 实测鼠标选中无轮廓、键盘聚焦为深色 2px 内描边，源码构建通过。此前 2026-09-23 — 设置侧栏选中底色恢复上游中性 token；源码构建和重启成功，治理门禁 6/6；设置页定向测试 27/29，另 2 例在侧栏入口测试处失败。此前 2026-09-23 — 同步后回归修复：会话 header 双层网格压缩使右栏顶部下移约 29px，合并为单层后 CDP 实测恢复；Host `Config` 漏登记会话偏好 volatile 导致输入框大小开关被 `settings/rejected` 回退，补齐所有字段后真实 RPC 成功，开/关两态均经页面重载持久。定向测试与官方构建通过。此前 2026-09-23 — 将 `dsh-v0.1.7-alpha.2` 三方合并至桌面树：原始本地修改已另行提交；官方构建通过；桌面 `npm test` 2215 通过/2 跳过；vendor `ui-primitives` 1226/1226、`ui-workspace` + `ui-files` 558/558、聊天与代理定向测试 577/577、设置定向测试 340/340、Web E2E 15/15；`smoke:source` 的 UI、标题栏及 PTY 探针通过；`check:governance` 6/6、`doc-sync` 8/8。`npm start` 预构建通过，但已安装版持有单实例锁，未替换其窗口；独立数据目录下的源码启动已由冒烟验证。 |

## User paths

1. 开发者同步官方 Harness 固定版本，保留桌面扩展和已有用户修改。
2. 完成冲突解决、构建和回归后从源码启动桌面应用。

## Invariants

- 使用以旧 pin 为共同祖先的三方合并，禁止整树覆盖桌面定制。
- 上游契约优先、桌面特性保真；不弱化断言或 fork 标记来掩盖回归。
- pin 仅在合并树成功应用后更新；未完成验证不得称为可发布版本。
- 不创建分支或发布；仅在用户明确要求时提交同步结果。保留任务开始时本地修改的原始快照及其他任务后续的独立更新。
- 设计语言、关闭按钮在标题右侧、独立桌面家目录和插件恢复契约保持。
- 新槽位拆出的常驻会话 header 与 Session header 共用一层网格和内边距，不能让右栏起点因重复标题容器而下移；`ui-conversation` 的所有浏览器可编辑设置字段须在 Host `Config` 中声明 volatile，以便 `ConfigForm` 写入真正持久化。

## Allowed touch

- `vendor/deepseek-harness/` — 官方更新、冲突解决与必要兼容修复。
- `vendor/harness-upstream.json`, `vendor/README.md` — pin 与桌面差异说明。
- `src/shared/harness-desktop-forks.js`, `src/shared/harness-desktop-forks.test.js` — 等价迁移不变量与版本检查。
- `src/main/dsh.test.js` — 随上游解析器变更验证桌面启动参数。
- `docs/design-language*`, `docs/handbook/modules/build-release.md`, `docs/features/`, `docs/decisions/` — 升级契约与兼容裁定记录。

## Do not touch

- 已有发布说明、desktop-pet 和 windows-installer 卡的未提交修改。
- 用户数据、凭据、其他 vendor 插件、发布或部署状态。

## Gates

| Kind | What |
| --- | --- |
| Automated | sync/upstream/forks 单测、vendor 构建和 GUI/核心契约测试、`npm test`、`npm run doc-sync` |
| Manual / QA | `npm run smoke:source` 与源码应用重启 |

## Sources

- Design: [设计语言](../design-language.md)
- Spec / plan: [上游同步方案](../superpowers/plans/2026-08-18-harness-rc7-vendor-pin.md)
- Decision: [alpha.2 桌面适配](../decisions/implemented/architecture/2026-09-18-harness-alpha2-desktop-adaptation.md)
- Decision: [0.1.7-alpha.2 桌面适配](../decisions/implemented/architecture/2026-09-23-harness-017-desktop-adaptation.md)
- Decision: [标题栏点击区域](../decisions/implemented/bug-fix/2026-09-23-titlebar-click-regions.md)
- Implementation entry: [harness-sync.js](../../src/shared/harness-sync.js)
