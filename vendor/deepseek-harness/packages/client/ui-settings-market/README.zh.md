# @deepseek-ai/dsh-client-ui-settings-market

[English](README.md) | 中文

桌面自有的插件市场设置分区（`market`）。仅在 Electron 暴露完整市场 preload API 时注册。所有变更针对桌面 web profile，重启归 HarnessController；本包不运行第三方 dshmarket 运行时及其 HTTP / HMR 路由。

## User workflows

- 发现：精选目录、搜索、分类、星标 / 日期排序、时间范围和有界增量分页。
- 收藏：桌面持久化收藏 id，与发现页共用筛选。
- 详情：目录截图、经 MarkdownText 渲染且有大小上限的公共仓库 README，以及 npm 作者依赖声明。声明仅供参考，不是已验证的宿主兼容性结论。
- 已安装：分类分组、逐插件更新检查、更新 / 失败筛选，以及结束后仅重启一次的串行批量更新。安装 / 卸载和批量更新均需确认；构建授权始终显式且逐插件进行。
- 操作记录：近期脱敏桌面操作记录和日志导出。记录跨分区卸载和 Harness 重启保留；桌面进程中断的操作不会重放。

分区使用 DSHD 主题变量和基线 Modal、Menu、Tooltip、MarkdownText 原语。失败始终可见，包括回滚失败和重启失败。不带桌面 preload 的普通浏览器会话不注册该分区。

## Model Experience

无。本包不注册面向模型的工具或提示内容。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

## Limitations

不提供自动兼容性结论、Release 产物安装、共享评论或通用可取消操作队列。主题商店、云备份、热替换和多 registry 管理仍属于桌面产品裁剪。回滚不能恢复插件自行进行的数据迁移；分享日志前仍需复核自定义敏感内容。

不发布运行时 invariant companion：持久状态归桌面主进程，聚焦包测试覆盖注入的 UI 行为。
