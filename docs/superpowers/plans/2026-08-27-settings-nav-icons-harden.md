# 设置导航图标加固计划

## 目标
- [x] 四个新增图标达到官方 16px `currentColor` 线框族的约 1.1–1.3px 光学重量。
- [x] 12 个已知 section id 保持互异图形，未知 id 回退齿轮。

## 非目标
- [x] 不改 slot API、设置文案、市场/用量统计安装边界、启动器、启动页或壁纸图源。
- [x] 不处理 mainline `doc-sync` 漂移与 Skills e2e 的 “Open directory” 债务。

## 图标重量标准
- [x] 与 `IconSkillOutline16`、`IconBrowseOutline16`、`IconSettingsOutline16` 同尺寸并排审视：轮廓厚度、圆角与视觉密度一致。
- [x] 根 SVG 保持 `16×16`、`fill="none"`；图形只用 `fill="currentColor"` 的展开路径，不引入外部图标库或颜色。
- [x] 保留 server/rack、phone/device、圆圈 i、柱状图语义。

## 现有代码审查
- [x] `general`、`interface`、`appearance`、`models`、`agent-presets`、`plugins`、`skills`、`mcp`、`market`、`remote`、`about`、`usage-stats` 均有映射；未知 id 回退 `IconSettingsOutline16`。
- [x] 12 个已知 id 未共享组件；测试通过 SVG 几何固定互异性与未知回退。
- [x] 四个新增公开导出均有 `@param` / `@returns` JSDoc。
- [x] 映射留在 `SettingsRoot`，未扩大 slot API。
- [x] diff 未改 market / usage-stats 的 fork、预置或安装边界。
- [x] 修正四个新增图标过度几何化、视觉偏轻的问题。

## 测试门槛
- [x] `settings-root.client.spec.tsx`（触及源文件 statements / branches / functions / lines 均 100%）。
- [x] `icons.client.spec.tsx`（触及源文件 statements / branches / functions / lines 均 100%）。
- [x] `pnpm run test:gui`（411 files passed、1 skipped；5393 tests passed、4 skipped）。
- [x] 客户端库构建与真实 `apps/web` 组装页通过；仅出现既有 Node 版本提示与测试预期 stderr。
- [x] 文档检查与 `git diff --check`。

## 文档
- [x] `docs/handbook/appendix/settings-sections.md` 是完整 id → 图标映射的唯一手册表。
- [x] `docs/handbook/modules/settings.md` 只记录互异 16px 图标与未知回退不变量，并链接附录。
- [x] 中英文 Agent Note 同步记录最终图标实现事实；不新增 Feature Card 或 `.cursor/rules`。

## 验证
- [x] 在真实组装 `dsh web` 设置页逐项查看 9 个已注册可见 section；其余 3 个桌面插件 section 由映射测试覆盖。
- [x] 浅色、深色导航栏截图分别保存为 `/opt/cursor/artifacts/settings_nav_light_final_20260827.png` 与 `/opt/cursor/artifacts/settings_nav_dark_final_20260827.png`。
- [x] 成功短录屏已复核：`/opt/cursor/artifacts/settings_nav_assembled_walk_final_20260827.webm`。
- [x] 最终 review 无新增阻断项，提交并推送 PR #51 分支。
