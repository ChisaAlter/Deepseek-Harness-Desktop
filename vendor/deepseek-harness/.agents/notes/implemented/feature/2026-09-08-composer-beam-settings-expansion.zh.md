# Agent Note: Composer 思考炫光设置扩展

Status: implemented

[English](2026-09-08-composer-beam-settings-expansion.md) | 中文

## 问题

第一批 Composer 思考炫光设置只暴露了方向、周期、强度、bloom 和色相。参考实现还展示了有边界的运动 profile、配色、夜间调暗和可复用预设，但它的状态灯系统不属于 DSHD 单一思考炫光合同。

## 决策

扩展现有 `ComposerBeamStyle`，继续让 `ComposerBeam` 作为运行态 InputBar 与设置预览的唯一渲染器。第一批增加往返运动、`0.8-60s` 周期范围、可选呼吸和可配置色相循环。第二批增加 legacy/lounge/aurora/reactive/custom 视觉模式、8 套内置配色、经过校验的 `2-6` 色自定义渐变、`0.5-4px` 光轨宽度、`0-12px` bloom 模糊、本地时钟夜间调暗、白名单缓动和最多 5 个命名预设。

`legacy` 保留现有视觉基线：1.5px bloom 光源、4px 外扩壳、22px 圆角、mask、强度窗口和默认时序均不变。track width 只改变 stroke ring padding；blur 只改变 bloom 容器。模式只是视觉 profile，不是业务状态机；不增加聚焦、输入、发送、完成或失败状态灯。

active style 与预设通过同一个 `SettingsScope.mutate()` revision fence 一起持久化。JSON 交换使用带版本的 `dsh-composer-beam` envelope，拒绝错误 core/version、不安全颜色、非法预设名称/数量和超过 64 KiB 的输入，未知字段忽略。导入在点击 Save 前只改变草稿；写入失败时保留草稿并显示本地化错误。

## 备选方案

**移植参考实现的状态灯矩阵。** 否决，因为聚焦、输入、发送、完成与失败状态灯重复了 InputBar 与 footer 已经渲染的业务状态，第二套灯光词汇会让同一个胶囊同时表达两种含义。

**为新模式另加一个渲染器。** 否决，因为两个渲染器会让运行态 InputBar 与设置预览漂移；`ComposerBeam` 对两者读取同一份 CSS 变量合同。

**把预设持久化到独立命名空间或独立文档。** 否决，因为分离写入可能只落盘预设选择而丢掉对应 style；一次 namespace mutation 让两者原子提交。

**允许 JSON envelope 携带任意 CSS。** 否决，因为不受限的颜色、缓动和尺寸等于未校验的样式注入；envelope 对每个字段做边界校验并忽略未知键。

## 后果

旧五字段 style 文档仍可加载，因为 Host schema 默认值与 client 归一化会补齐新增字段。减弱动效仍隐藏完整 beam。桌面自定义不改变 mobile/web 默认值、InputBar 激活条件、指针命中、composer stack gap、toolbar/Stop 行为或静止 rim。

## 测试

focused beam/settings suite 跨 7 个文件通过 116/116，覆盖旧形状 Host 迁移、归一化、夜间区间、JSON 边界、renderer 变量、原子持久化和 CSS 行为。ui-conversation TypeScript no-emit、完整 client build-mode、package-mode 校验与 official profile build 均通过。完整 GUI suite 通过 420 个文件、5496 个测试通过且 1 项跳过；桌面直接 Node tests 通过 1447 项，另有 2 项 Windows 专属跳过。fork marker 测试通过 10/10。直接 Electron Chromium 四角门禁在默认几何与配置极值下通过；8 套配色均可见，没有圆角失败或越界像素。

仓库级 UI i18n 扫描仍报告本功能之外的 25 条既有硬编码字符串；仓库级翻译配对检查也报告无关文档的既有漂移。计划中的 web replay 在 chat、settings、image、catalog 和 HMR 等无关 suite 大范围出现 fixture/连接失败后停止；没有观察到 beam 专属失败。

## 范围边界

本 Note 只在有边界的配色自定义与夜间调暗方面取代 2026-09-07 Note。参考实现的 focus/typing/blur/send/working/done/error 状态灯矩阵仍明确不在本次范围内。
