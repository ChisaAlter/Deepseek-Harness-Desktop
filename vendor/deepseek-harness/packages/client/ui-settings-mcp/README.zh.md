# @deepseek-ai/dsh-client-ui-settings-mcp

[English](README.md) | 中文

Web Settings 栏目 `mcp`（order 18）。页面把 `ctx.remote.mcpServers` 中的受管 MCP 服务器与只读组成配置行呈现为可搜索目录，带一个启用筛选和发丝行。Host fiber 阶段与配置启用状态分离。可写行使用 Switch 以及编辑/删除图标动作。`lastError` 匹配有边界的鉴权挑战（HTTP 401/403、Unauthorized、Forbidden、invalid_token、missing bearer）的已启用可写 HTTP 行显示「登录」，调用 `mcpServers.authorize`，打开系统浏览器，并在 Host 写入 Bearer、重新挂载后重新 list。其他 HTTP 失败只保留错误文本，不显示登录。已连接行只显示已注册工具数量，不列出公开工具名。编辑弹窗在表单与 JSON 对象之间切换，分别保留 stdio 与 HTTP 草稿，校验 HTTP(S) URL 和每一行 `KEY=value`，再通过 `upsert` / `delete` / `setEnabled` 编辑受管文档。刷新会重新挂载连接监督器已放弃的受管行，然后重新 list。栏目就绪期间页面每两秒轮询一次 `list`，因此在本页之外连接的服务器（直接组成配置行、刚完成初始工具同步的子进程）无需重启应用即可显示健康状态与工具数量；本地变更进行中时暂停轮询。行显示实时连接健康和最近一次尝试错误。持久化由 Host Remote 负责。

受管行与组成配置行都提供一次性的「测试」操作。它展示真实隔离探测发现的工具数量和简短名称摘要，防止重复点击，并显示可行动的 Remote 错误；不会改变重试、OAuth、编辑、删除或启用状态语义。

## 模型体验

无，因为这个浏览器 Settings 页不注册提示词、工具、消息或提供方请求。

#### KV Cache 影响

无；本包从不组装模型输入。

## 已知限制与暂缓事项

- **没有市场或 `.mcp.json` 导入** — 添加只是本地表单或 JSON 对象。

不发布运行时 invariant companion；本包不拥有独立的持久事件关系，UI 或服务行为由聚焦的包测试覆盖。
