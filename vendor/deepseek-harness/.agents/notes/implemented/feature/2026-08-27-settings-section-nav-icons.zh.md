# Agent Note: 设置分区使用互异的导航图标

Status: implemented

[English](2026-08-27-settings-section-nav-icons.md) | 中文

## 问题

设置侧栏只有模型、Agent presets 与插件使用专属图标，其余分区都绘制设置齿轮。无关页面因此无法通过图标区分，桌面自有的新分区也会继承这个重复图标。

## 决策

`SettingsRoot` 为每个桌面可见的 `settings.section` id 选择一个 16px、`currentColor` 的线框组件：

| 分区 id | 图标组件 |
| --- | --- |
| `general` | `IconSettingsOutline16` |
| `interface` | `IconPanelLeftOutline16` |
| `appearance` | `IconLightOutline16` |
| `models` | `IconDataOutline16` |
| `agent-presets` | `IconAgentPresetOutline16` |
| `plugins` | `IconPersonalizationOutline16` |
| `skills` | `IconSkillOutline16` |
| `mcp` | `IconServerOutline16` |
| `market` | `IconBrowseOutline16` |
| `remote` | `IconDeviceOutline16` |
| `about` | `IconInfoOutline16` |
| `usage-stats` | `IconChartOutline16` |

图标表留在设置 shell，因为分区注册只携带标识、顺序与文案，不携带展示元数据。未知分区 id 继续回退到设置齿轮。`ui-primitives` 提供原先缺少合适 16px 同族图标的服务器、设备、信息与图表图标。这四个图标使用带圆润转折、符合官方图标族视觉重量的 `currentColor` 描边展开路径，不再采用类似 CSS 细矩形的几何；路径均为原生 16×16 正坐标数据，不带 `transform` 属性。

## 考虑过的方案

**没有专属原语的分区继续共用齿轮。** 否决：重复图标会消除侧栏的分区视觉线索。

**把 14px API 或插件图标缩放到 16px。** 否决：导航使用原生 16px 线框系列，缩放会改变视觉重量。

**给 `settings.section` 注册增加图标元数据。** 否决：分区标识已经能让 shell 稳定映射图标；展示元数据会扩大所有注册和 slot API。

## 后果

已知设置行在明暗主题中都使用互异的单色图标，未来未知行仍通过齿轮回退正常渲染。设置组件测试固定完整的已知 id 集合并比较渲染后的 SVG 几何；原语测试固定扩展后的公开图标集、其 `currentColor` 规则，以及四个导航图标不带 transform 的原生几何。
