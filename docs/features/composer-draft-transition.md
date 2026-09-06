# Feature: 草稿发送布局过渡

| Field | Value |
| --- | --- |
| **id** | `composer-draft-transition` |
| **status** | `active` |
| **last verified** | 2026-09-06：官方构建、Host/Client `tsc -b` 通过；GUI 411 文件、5349 项通过（1 跳过），最终定向 35 项通过；最终真实浏览器回放 6 项通过（过渡 4 项 + 消息编辑 2 项）。 |

## User paths

1. 草稿页输入消息并点击发送或按 Enter，常驻输入框平稳进入会话布局。
2. 减少动态效果时直接落位；后续发送、切换会话和手动输入框尺寸保持现有行为。

## Invariants

- 不先贴底再回弹，不用隐藏输入框或重挂载编辑器遮掩跳动。
- 最终尺寸、统计行和 Dock 对齐遵循现有设计语言；不改变消息发送或会话身份。
- 动效只属于首次草稿发送，不影响滚动、浮层定位和持久化尺寸。
- 普通输入框的底部预留统计行高度，准入、运行状态和统计投影分别更新时不得折叠；首次发送使用共享慢速 token，相对 `top` 不改变 fixed 浮层的包含块。

## Allowed touch

- `vendor/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/` 及本包定向测试、README 对。
- `vendor/deepseek-harness/apps/web/tests/composer-draft-transition.e2e.ts` 及对应 geometry golden；`apps/web/tsconfig.json` 与 `tsconfig.host.json` 仅登记该测试所属编译面。
- 本卡、功能索引、设计语言与动效文档、对应 Harness Agent Note。

## Gates

- 定向组件测试、Host/Client 类型检查、真实 Web 首次发送逐帧几何回归（含减少动态效果）。
- 真实浏览器检查输入框未重挂载、没有超出终点后回弹；发送内容与回复可见。

本次复现记录：输入卡先从 y=496 跳到 y=900，随后在 y=900 / y=876 间回弹；修复后各帧单向到达终点，统计行不再导致 24px 跳动。桌面点击、减少动态效果、390px 窄视口 Enter、多行草稿与第二次发送均覆盖。新增过渡逻辑和测试的定向 lint 通过；包含 `InputBar.tsx` 的检查仍报其未改动区域原有缩进问题。本次未生成安装包，未运行全量 Web、覆盖率或 doc-sync。
