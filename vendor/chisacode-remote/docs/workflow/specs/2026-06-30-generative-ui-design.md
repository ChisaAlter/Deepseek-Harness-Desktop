# 生成式 UI 设计规格

> 日期: 2026-06-30
> 状态: 设计完成，待审阅
> 目标: 建立完整 AI→UI 框架，使 AI agent 能通过结构化声明生成交互式 UI 组件

---

## 1. 概述

### 1.1 问题

ChisaCode 已有一个基础"生成式 HTML 预览"功能（`packages/app/src/components/generative-html-preview.tsx`），但它仅限于自动检测 Markdown 代码块中的 HTML，放入 iframe/WebView 沙箱渲染。存在以下局限：

- 仅支持 HTML，不支持 React 组件（图表、表格、表单等）
- 纯展示，无双向交互和数据绑定
- 无协议侧支持，检测和渲染全在 App 端完成
- 不支持流式渲染
- AI 不感知能力边界（不知道能产出什么 UI）

### 1.2 目标

建立一个完整的 **AI → UI 框架**：

1. AI 通过结构化声明（componentId + props）生成 UI 组件
2. App 端用预注册的安全组件白名单渲染
3. 用户与生成式 UI 的双向交互可回传给 AI，驱动后续对话轮次
4. 零 provider 适配——通过 System Prompt 注入实现，所有模型自动兼容
5. 保留现有 HTML 沙箱预览作为 fallback

### 1.3 非目标

- 不支持 AI 生成任意的自由格式 HTML/JS（安全白名单策略）
- 不修改或扩展 provider SDK/CLI 的工具注册
- 不替换现有 `GenerativeHtmlPreview`，而是并列为 fallback

---

## 2. 设计决策

| 维度          | 决策                  | 说明                                                                           |
| ------------- | --------------------- | ------------------------------------------------------------------------------ |
| 功能范围      | 完整 AI→UI 框架       | 结构化组件 + 双向交互 + HTML fallback                                          |
| 交互模式      | 双向交互 + 单向展示   | 同时支持，不区分 MVP 阶段                                                      |
| 安全模型      | 组件白名单 + 沙箱     | 结构化组件走注册表白名单；自由 HTML 走沙箱 + 标签标识                          |
| 触发机制      | Markdown Fence 主路径 | `chisacode-ui` fence → 服务端检测 + App 端检测 → `generative_ui` timeline item |
| Provider 适配 | System Prompt 注入    | 零适配，所有模型自动兼容                                                       |

---

## 3. 架构

```
┌──────────────┐                              ┌──────────────────────┐
│ AI Provider  │                              │      协议层          │
│              │                              │ protocol/generative-ui│
│ system prompt│◄──── component manifest ────│  ├ rpc-schemas.ts     │
│ 注入 gen_ui  │                              │  ├ component-manifest │
│              │                              │  └ agent-types 扩展   │
└──────┬───────┘                              └──────────┬───────────┘
       │ chisacode-ui fence (Markdown)                   │
       ▼                                                 ▼
┌──────────────┐                              ┌──────────────────────┐
│  Server 层   │                              │      App 层          │
│              │                              │                      │
│ session-     │ emit timeline                │ 组件注册表           │
│ handlers/    │─────────────────────────────►│ (白名单 + Zod 校验)  │
│ gen-ui-      │                              │                      │
│ handler.ts   │◄── gen_ui.action RPC ──────│ useGenUiAction Hook  │
│              │                              │ 错误处理 + 节流       │
│ 格式化为系统 │ inject as context            │                      │
│ 通知注入     │──────────────────────────────│ GenerativeUiRenderer │
│              │                              │ ErrorBoundary        │
└──────────────┘                              └──────────────────────┘
```

---

## 4. 协议定义

### 4.1 时间线条目（agent-types.ts）

`AgentTimelineItem` 新增 `generative_ui` 类型：

```typescript
export interface GenerativeUiTimelineItem {
  type: "generative_ui";
  instanceId: string; // 组件实例唯一 ID
  componentId: string; // 注册组件名
  props: Record<string, unknown>; // 组件 props
  title?: string; // 卡片标题
  source: "tool_call" | "fence"; // 检测来源
  status: "rendering" | "interactive" | "error";
}
```

### 4.2 生命周期事件（agent-types.ts）

`AgentStreamEvent` 新增两个事件：

```typescript
// 更新已有组件
| { type: "generative_ui_update"; instanceId: string; props: Record<string,unknown>; status?: GenerativeUiStatus }

// 移除已有组件
| { type: "generative_ui_remove"; instanceId: string }
```

### 4.3 回调 RPC（新增 rpc-schemas.ts）

```typescript
// App → Server
GenerativeUiActionRequestSchema = {
  type: "generative_ui.action",
  requestId: string,
  agentId: string,
  instanceId: string,
  action: string,
  payload: unknown,
  timestamp: number,
};

// Server → App
GenerativeUiActionResponseSchema = {
  type: "generative_ui.action.response",
  payload: { requestId, received: boolean, error: string | null },
};
```

### 4.4 组件清单（component-manifest.ts）

```typescript
export interface GenerativeUiComponentMeta {
  componentId: string;
  category: "chart" | "table" | "form" | "map" | "media" | "layout";
  description: string;
  propsDescription: string;
  actions?: { name: string; description: string }[];
}
```

### 4.5 System Prompt 注入

Server 通过 `composeSystemPromptParts` 将组件清单追加到每个 agent 的 system prompt：

```
agent-manager.ts applyDaemonAppendSystemPromptWithGenUi()
  → generateComponentPromptSection()   (component-manifest.ts)
    → card/table/form/chart 等组件的 props 描述 + 动作说明
  → composeSystemPromptParts(userPrompt, daemonAppend, genUiSection)
```

注入内容示例（AI 视角）：

````
## Generative UI Components

You can render interactive UI components by outputting a Markdown code fence
with the language identifier `chisacode-ui`. Format:

```chisacode-ui component=<componentId>
{"prop1": "value1", "prop2": "value2"}
````

### Charts

line_chart: 折线图...
Props: title, data, xAxis, yAxis, height, color
Actions: "point_click" (payload: { index, point })
bar_chart: 柱状图...
...

### Tables

table: 数据表格...
Props: title, columns, rows, pageSize
Actions: "row_click", "sort"
...

### Forms

form: 表单...
Props: title, fields, submitLabel
Actions: "change", "submit"

```

该注入在 agent 创建/恢复时触发，不持久化到 agent storage。如果未来新增组件，重启 daemon 后自动更新。

---

## 5. 组件安全模型

### 5.1 主路径：组件白名单

- App 端 `GenerativeUiRegistry` 单例管理 componentId → React 组件映射
- 每个注册组件附带 Zod schema，运行时校验 AI 传入的 props
- 未注册 componentId → 显示 "未知组件" 退化卡片
- Props 校验失败 → 显示 "配置异常" 退化卡片
- `GenerativeUiErrorBoundary` 包裹所有 gen_ui 组件，防止组件崩溃污染整个聊天流

### 5.2 Fallback：沙箱 HTML

- 现有 `GenerativeHtmlPreview` 不变，作为非结构化 HTML 的降级路径
- 始终带 "由 AI 生成" 标签，视觉上与原生 UI 区分
- Web 端 `<iframe sandbox>`，Native 端 `<WebView>`，限制 originWhitelist

---

## 6. 回调闭环

```

1. AI 产出 generative_ui timeline item
2. Server → App emit timeline 事件
3. App StreamReducer → GenerativeUiItem → AgentStreamView 渲染
4. 用户与组件交互（点击/输入/提交）
5. App sendRpc: generative_ui.action { instanceId, action, payload }
6. Server GenerativeUiHandler 校验 agent 状态
7. Server formatActionContext → <chisacode-system>...</chisacode-system>
8. Server sendPromptToAgent → 注入下一轮对话上下文
9. AI 下一轮看到上下文 → 可产出新文本/新 gen_ui/update 原组件
10. Server → App generative_ui_update / generative_ui_remove 生命周期事件

```

回调关键点：

- `instanceId` 贯穿全程，用于匹配创建、更新、移除、回调
- 交互回传是异步的——用户操作不打断当前 turn，在下一个 turn 被 AI 看到
- 多个交互合并为一个 context block

---

## 7. 错误处理

### 7.1 错误类型

| Code                | 可恢复 | 用户反馈           | 行为                 |
| ------------------- | ------ | ------------------ | -------------------- |
| CLIENT_UNAVAILABLE  | 是     | 静默               | 丢弃，等重连         |
| RPC_TIMEOUT         | 是     | 静默（前 3 次）    | 连续 ≥3 触发 onError |
| RPC_REJECTED        | 否     | Toast              | "操作未成功"         |
| COMPONENT_NOT_FOUND | 否     | ErrorBoundary 占位 | 显示退化卡片         |
| PROPS_VALIDATION    | 否     | ErrorBoundary 占位 | 显示退化卡片         |
| COMPONENT_CRASH     | 否     | ErrorBoundary 占位 | 显示 + 重试按钮      |
| SANDBOX_ERROR       | 否     | ErrorBoundary 占位 | 显示退化信息         |

### 7.2 分层

| 层            | 文件                               | 职责                         |
| ------------- | ---------------------------------- | ---------------------------- |
| 错误类型      | `generative-ui/errors.ts`          | 分类、用户消息、可恢复判断   |
| DaemonClient  | `daemon-client.ts`                 | 超时/拒绝 → DaemonRpcError   |
| Hook          | `use-generative-ui-action.ts`      | 节流、失败计数、onError 回调 |
| ErrorBoundary | `generative-ui-error-boundary.tsx` | 渲染崩溃捕获、重试           |
| 服务端        | `generative-ui-handler.ts`         | 校验并返回 received:false    |

---

## 8. 文件清单

### 新增文件

```

packages/protocol/src/generative-ui/
├── rpc-schemas.ts # Zod schema (RPC 对)
└── component-manifest.ts # 共享组件元数据清单 + prompt 生成

packages/app/src/generative-ui/
├── registry/
│ ├── types.ts # 组件注册条目类型
│ ├── registry.ts # GenerativeUiRegistry 单例
│ └── components.ts # 注册 entry（MVP: line_chart, bar_chart, table, form）
├── use-generative-ui-action.ts # useGenUiAction Hook
├── generative-ui-renderer.tsx # 通用渲染分发器
├── generative-ui-error-boundary.tsx
├── errors.ts # 错误类型
└── components/
├── line-chart.tsx
├── bar-chart.tsx
├── data-table.tsx
└── generative-form-card.tsx

packages/server/src/server/session-handlers/
└── generative-ui-handler.ts # RPC 处理 + 上下文注入

```

### 修改文件

```

packages/protocol/src/
├── agent-types.ts # +GenerativeUiTimelineItem, +AgentStreamEvent 事件
├── messages.ts # +Schema 注册到 union

packages/client/src/
└── daemon-client.ts # +sendGenerativeUiAction 方法

packages/app/src/
├── types/stream.ts # +GenerativeUiItem StreamItem 类型
├── components/message.tsx # fence 回调中新增 gen_ui fence 检测
└── utils/generative-ui-html.ts # +getGenerativeUiFence 结构化检测

packages/server/src/server/
├── session.ts # +generativeUiHandler 分发
├── session-handlers/index.ts # +export GenerativeUiHandler
└── session-handlers/session-context.ts # +GenerativeUiContext 接口

```

---

## 9. 测试计划

| 层           | 文件                               | 核心用例                                                             |
| ------------ | ---------------------------------- | -------------------------------------------------------------------- |
| 协议         | `rpc-schemas.test.ts`              | Request/Response 合法/非法 payload 校验                              |
| 注册表       | `registry.test.ts`                 | 注册/查找/校验/过滤/平台/generatePromptSection                       |
| Hook         | `use-generative-ui-action.test.ts` | 正常发送/null 防护/节流/失败计数/阈值触发/重置                       |
| 渲染器       | `generative-ui-renderer.test.tsx`  | 已注册组件渲染/未知组件退/props 错误退化/ErrorBoundary 包裹          |
| Fence 检测   | `generative-ui-html.test.ts`       | 结构化检测/非匹配返回 null/JSON 解析失败/HTML fallback               |
| DaemonClient | `daemon-client.test.ts`            | sendGenerativeUiAction 正常/超时/拒绝                                |
| 服务端       | `generative-ui-handler.test.ts`    | 有效请求/agent 不存在/非运行状态/上下文格式化/sendPromptToAgent 调用 |

---

## 10. MVP 组件清单

| componentId  | 类别  | 说明                       |
| ------------ | ----- | -------------------------- |
| `line_chart` | chart | 折线图，xAxis/yAxis + data |
| `bar_chart`  | chart | 柱状图，label/value + data |
| `table`      | table | 数据表格，columns + rows   |
| `form`       | form  | 表单，fields 定义          |

后续可扩展：`map`, `card`, `progress`, `kanban`, `gantt` 等。

---

## 11. 开放问题

1. **流式渲染**: 当前设计中等整个组件声明完成后才渲染。未来是否支持 incremental partial props 更新（类似 assistant_message 的流式追加）？—— 暂不处理，留作后续。
2. **组件版本管理**: 如果后续新增/移除组件，已渲染的历史消息中组件如何处理？—— MVP 中历史消息的 gen_ui 组件不保证持续可用，显示退化信息。
3. **非 tool-use 模型**: 通过 Markdown fence 检测（服务端 `AgentStreamCoalescer.onFlush` + App 端 `message.tsx` 渲染）已覆盖所有 provider 类型，结构化组件路径通用可用。
```
