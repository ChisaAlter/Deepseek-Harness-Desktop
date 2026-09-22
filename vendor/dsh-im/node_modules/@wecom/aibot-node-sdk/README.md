# @wecom/aibot-node-sdk

企业微信智能机器人 Node.js SDK —— 基于 WebSocket 长连接通道，提供消息收发、流式回复、模板卡片、事件回调、文件下载解密、媒体素材上传等核心能力。

## ✨ 特性

- 🔗 **WebSocket 长连接** — 基于 `wss://openws.work.weixin.qq.com` 内置默认地址，开箱即用【注： 私有部署企业需要在企业管理端查看该长连接地址】
- 🔐 **自动认证** — 连接建立后自动发送认证帧（botId + secret）
- 💓 **心跳保活** — 自动维护心跳，连续未收到 ack 时自动判定连接异常
- 🔄 **断线重连** — 指数退避重连策略（1s → 2s → 4s → ... → 30s 上限），支持自定义最大重连次数
- 📨 **消息分发** — 自动解析消息类型并触发对应事件（text / image / mixed / voice / file）
- 🌊 **流式回复** — 内置流式回复方法，支持 Markdown 和图文混排
- 🃏 **模板卡片** — 支持回复模板卡片消息、流式+卡片组合回复、更新卡片
- 📤 **主动推送** — 支持向指定会话主动发送 Markdown、模板卡片或媒体消息，无需依赖回调帧
- 📡 **事件回调** — 支持进入会话、模板卡片按钮点击、用户反馈等事件
- ⏩ **串行回复队列** — 同一 req_id 的回复消息串行发送，自动等待回执
- 🔒 **文件下载解密** — 内置 AES-256-CBC 文件解密，每个图片/文件消息自带独立的 aeskey
- 📎 **媒体素材上传** — 支持分片上传临时素材（file/image/voice/video），自动管理并发与重试
- 🪵 **可插拔日志** — 支持自定义 Logger，内置带时间戳的 DefaultLogger
- 📦 **双模块格式** — 同时输出 CJS / ESM，附带完整 TypeScript 类型声明

## 📦 安装

```bash
npm install @wecom/aibot-node-sdk
# 或
yarn add @wecom/aibot-node-sdk
```

## 🚀 快速开始

```ts
import AiBot from '@wecom/aibot-node-sdk';
import type { WsFrame } from '@wecom/aibot-node-sdk';
import { generateReqId } from '@wecom/aibot-node-sdk';

// 1. 创建客户端实例
const wsClient = new AiBot.WSClient({
  botId: 'your-bot-id',       // 企业微信后台获取的机器人 ID
  secret: 'your-bot-secret',  // 企业微信后台获取的机器人 Secret
});

// 2. 建立连接（支持链式调用）
wsClient.connect();

// 3. 监听认证成功
wsClient.on('authenticated', () => {
  console.log('🔐 认证成功');
});

// 4. 监听文本消息并进行流式回复
wsClient.on('message.text', (frame: WsFrame) => {
  const content = frame.body.text?.content;
  console.log(`收到文本: ${content}`);

  const streamId = generateReqId('stream');

  // 发送流式中间内容
  wsClient.replyStream(frame, streamId, '正在思考中...', false);

  // 发送最终结果
  setTimeout(() => {
    wsClient.replyStream(frame, streamId, `你好！你说的是: "${content}"`, true);
  }, 1000);
});

// 5. 监听进入会话事件（发送欢迎语）
wsClient.on('event.enter_chat', (frame: WsFrame) => {
  wsClient.replyWelcome(frame, {
    msgtype: 'text',
    text: { content: '您好！我是智能助手，有什么可以帮您的吗？' },
  });
});

// 6. 优雅退出
process.on('SIGINT', () => {
  wsClient.disconnect();
  process.exit(0);
});
```

---

## 📖 API 文档

### `WSClient`

核心客户端类，继承自 `EventEmitter`，提供连接管理、消息收发等功能。

#### 构造函数

```ts
const wsClient = new WSClient(options: WSClientOptions);
```

#### 方法一览

| 方法                                                                  | 说明                                                   | 返回值                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------ |
| `connect()`                                                           | 建立 WebSocket 连接，连接后自动认证                    | `this`（支持链式调用）                           |
| `disconnect()`                                                        | 主动断开连接                                           | `void`                                           |
| `reply(frame, body, cmd?)`                                            | 通过 WebSocket 通道发送回复消息（通用方法）            | `Promise<WsFrame>`                               |
| `replyStream(frame, streamId, content, finish?, msgItem?, feedback?)` | 发送流式文本回复（支持 Markdown）                      | `Promise<WsFrame>`                               |
| `replyWelcome(frame, body)`                                           | 发送欢迎语回复（文本或模板卡片），需 5s 内调用         | `Promise<WsFrame>`                               |
| `replyTemplateCard(frame, templateCard, feedback?)`                   | 回复模板卡片消息                                       | `Promise<WsFrame>`                               |
| `replyStreamWithCard(frame, streamId, content, finish?, options?)`    | 流式消息 + 模板卡片组合回复                            | `Promise<WsFrame>`                               |
| `updateTemplateCard(frame, templateCard, userids?)`                   | 更新模板卡片（响应 template_card_event），需 5s 内调用 | `Promise<WsFrame>`                               |
| `sendMessage(chatid, body)`                                           | 主动发送消息（Markdown / 模板卡片 / 媒体），无需回调帧 | `Promise<WsFrame>`                               |
| `uploadMedia(fileBuffer, options)`                                    | 上传临时素材（三步分片上传），返回 `media_id`          | `Promise<UploadMediaFinishResult>`               |
| `replyMedia(frame, mediaType, mediaId, videoOptions?)`                | 被动回复媒体消息（file/image/voice/video）             | `Promise<WsFrame>`                               |
| `sendMediaMessage(chatid, mediaType, mediaId, videoOptions?)`         | 主动发送媒体消息                                       | `Promise<WsFrame>`                               |
| `downloadFile(url, aesKey)`                                           | 下载文件并 AES 解密，返回 Buffer 及文件名              | `Promise<{ buffer: Buffer; filename?: string }>` |

#### 属性

| 属性          | 说明                            | 类型             |
| ------------- | ------------------------------- | ---------------- |
| `isConnected` | 当前 WebSocket 连接状态         | `boolean`        |
| `api`         | 内部 API 客户端实例（高级用途） | `WeComApiClient` |

---

### `replyStream` 详细说明

发送流式文本回复（便捷方法，支持 Markdown）。

```ts
wsClient.replyStream(
  frame: WsFrameHeaders, // 收到的原始 WebSocket 帧（透传 req_id），也可直接传完整 WsFrame 对象
  streamId: string,      // 流式消息 ID（使用 generateReqId('stream') 生成）
  content: string,       // 回复内容（支持 Markdown），最长 20480 字节
  finish?: boolean,      // 是否结束流式消息，默认 false
  msgItem?: ReplyMsgItem[], // 图文混排项（仅 finish=true 时有效，最多 10 个）
  feedback?: ReplyFeedback, // 反馈信息（仅首次回复时设置）
);
```

使用示例：

```ts
const streamId = generateReqId('stream');

// 发送流式中间内容
await wsClient.replyStream(frame, streamId, '正在处理中...', false);

// 发送最终结果（finish=true 表示结束流）
await wsClient.replyStream(frame, streamId, '处理完成！结果是...', true);
```

---

### `replyWelcome` 详细说明

发送欢迎语回复，需在收到 `event.enter_chat` 事件 **5 秒内**调用，超时将无法发送。

```ts
// 文本欢迎语
wsClient.replyWelcome(frame, {
  msgtype: 'text',
  text: { content: '欢迎！' },
});

// 模板卡片欢迎语
wsClient.replyWelcome(frame, {
  msgtype: 'template_card',
  template_card: { card_type: 'text_notice', main_title: { title: '欢迎' } },
});
```

---

### `replyTemplateCard` 详细说明

回复模板卡片消息。收到消息回调或进入会话事件后使用。

```ts
wsClient.replyTemplateCard(
  frame: WsFrameHeaders,     // 收到的原始 WebSocket 帧
  templateCard: TemplateCard, // 模板卡片内容
  feedback?: ReplyFeedback,   // 反馈信息（可选）
);
```

---

### `replyStreamWithCard` 详细说明

发送流式消息 + 模板卡片组合回复。首次回复时必须返回 stream 的 id；`template_card` 同一消息只能回复一次。

```ts
wsClient.replyStreamWithCard(
  frame: WsFrameHeaders,   // 收到的原始 WebSocket 帧
  streamId: string,         // 流式消息 ID
  content: string,          // 回复内容（支持 Markdown）
  finish?: boolean,         // 是否结束流式消息，默认 false
  options?: {
    msgItem?: ReplyMsgItem[];       // 图文混排项（仅 finish=true 时有效）
    streamFeedback?: ReplyFeedback; // 流式消息反馈信息（首次回复时设置）
    templateCard?: TemplateCard;    // 模板卡片内容（同一消息只能回复一次）
    cardFeedback?: ReplyFeedback;   // 模板卡片反馈信息
  },
);
```

使用示例：

```ts
const streamId = generateReqId('stream');

// 首次回复：带卡片
await wsClient.replyStreamWithCard(frame, streamId, '正在处理...', false, {
  templateCard: {
    card_type: 'button_interaction',
    main_title: { title: '操作面板' },
    button_list: [{ text: '确认', key: 'confirm' }],
    task_id: `task_${Date.now()}`,
  },
});

// 流式结束
await wsClient.replyStreamWithCard(frame, streamId, '处理完成！', true);
```

---

### `updateTemplateCard` 详细说明

更新模板卡片，需在收到 `event.template_card_event` 事件 **5 秒内**调用。

```ts
wsClient.updateTemplateCard(
  frame: WsFrameHeaders,     // 对应事件的 WebSocket 帧（需包含该事件的 req_id）
  templateCard: TemplateCard, // 模板卡片内容（task_id 需与回调收到的 task_id 一致）
  userids?: string[],         // 要替换模版卡片消息的 userid 列表，不填则替换所有用户
);
```

---

### `sendMessage` 详细说明

主动向指定会话推送消息，无需依赖收到的回调帧。

```ts
wsClient.sendMessage(
  chatid: string,  // 会话 ID，单聊填用户的 userid，群聊填对应群聊的 chatid
  body: SendMarkdownMsgBody | SendTemplateCardMsgBody | SendMediaMsgBody,
);
```

使用示例：

```ts
// 发送 Markdown 消息
await wsClient.sendMessage('userid_or_chatid', {
  msgtype: 'markdown',
  markdown: { content: '这是一条**主动推送**的消息' },
});

// 发送模板卡片消息
await wsClient.sendMessage('userid_or_chatid', {
  msgtype: 'template_card',
  template_card: { card_type: 'text_notice', main_title: { title: '通知' } },
});
```

---

### `uploadMedia` 详细说明

通过 WebSocket 长连接执行三步分片上传：`init → chunk × N → finish`。

- 单个分片不超过 **512KB**（Base64 编码前），最多 **100 个**分片（约 50MB 上限）
- 自动根据分片数调整并发数（1\~4 分片全并发；5\~10 分片并发 3；>10 分片并发 2）
- 单分片上传失败自动重试（最多 2 次）

```ts
wsClient.uploadMedia(
  fileBuffer: Buffer,          // 文件 Buffer
  options: UploadMediaOptions, // { type: WeComMediaType, filename: string }
): Promise<UploadMediaFinishResult>;  // { type, media_id, created_at }
```

使用示例：

```ts
import fs from 'fs';

// 上传图片
const imageBuffer = fs.readFileSync('/path/to/image.png');
const result = await wsClient.uploadMedia(imageBuffer, {
  type: 'image',
  filename: 'image.png',
});
console.log(`上传成功，media_id: ${result.media_id}`);

// 使用 media_id 回复图片消息
await wsClient.replyMedia(frame, 'image', result.media_id);
```

---

### `replyMedia` 详细说明

被动回复媒体消息（通过 `aibot_respond_msg` 通道）。

```ts
wsClient.replyMedia(
  frame: WsFrameHeaders,    // 收到的原始 WebSocket 帧
  mediaType: WeComMediaType, // 媒体类型：'file' | 'image' | 'voice' | 'video'
  mediaId: string,           // 临时素材 media_id（通过 uploadMedia 获取）
  videoOptions?: {           // 视频消息可选参数（仅 mediaType='video' 时生效）
    title?: string;
    description?: string;
  },
);
```

---

### `sendMediaMessage` 详细说明

主动发送媒体消息（通过 `aibot_send_msg` 通道推送）。

```ts
wsClient.sendMediaMessage(
  chatid: string,            // 会话 ID
  mediaType: WeComMediaType, // 媒体类型：'file' | 'image' | 'voice' | 'video'
  mediaId: string,           // 临时素材 media_id
  videoOptions?: {           // 视频消息可选参数（仅 mediaType='video' 时生效）
    title?: string;
    description?: string;
  },
);
```

---

### `downloadFile` 使用示例

```ts
// aesKey 取自消息体中的 image.aeskey 或 file.aeskey
wsClient.on('message.image', async (frame: WsFrame) => {
  const body = frame.body;
  const { buffer, filename } = await wsClient.downloadFile(body.image?.url, body.image?.aeskey);
  console.log(`文件名: ${filename}, 大小: ${buffer.length} bytes`);
});
```

---

## ⚙️ 配置选项

`WSClientOptions` 完整配置：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `botId` | `string` | ✅ | — | 机器人 ID（企业微信后台获取） |
| `secret` | `string` | ✅ | — | 机器人 Secret（企业微信后台获取） |
| `reconnectInterval` | `number` | — | `1000` | 重连基础延迟（毫秒），实际延迟按指数退避递增（1s → 2s → 4s → ... → 30s 上限） |
| `maxReconnectAttempts` | `number` | — | `10` | 最大重连次数（`-1` 表示无限重连） |
| `heartbeatInterval` | `number` | — | `30000` | 心跳间隔（毫秒） |
| `requestTimeout` | `number` | — | `10000` | HTTP 请求超时时间（毫秒） |
| `wsUrl` | `string` | — | `wss://openws.work.weixin.qq.com` | 自定义 WebSocket 连接地址 |
| `wsOptions` | `string` | — | `string` | 自签证书地址 |
| `logger` | `Logger` | — | `DefaultLogger` | 自定义日志实例 |

---

## 📡 事件列表

所有事件均通过 `wsClient.on(event, handler)` 监听：

| 事件                        | 回调参数                       | 说明                                         |
| --------------------------- | ------------------------------ | -------------------------------------------- |
| `connected`                 | —                              | WebSocket 连接建立                           |
| `authenticated`             | —                              | 认证成功                                     |
| `disconnected`              | `reason: string`               | 连接断开                                     |
| `reconnecting`              | `attempt: number`              | 正在重连（第 N 次）                          |
| `error`                     | `error: Error`                 | 发生错误                                     |
| `message`                   | `frame: WsFrame<BaseMessage>`  | 收到消息（所有类型）                         |
| `message.text`              | `frame: WsFrame<TextMessage>`  | 收到文本消息                                 |
| `message.image`             | `frame: WsFrame<ImageMessage>` | 收到图片消息                                 |
| `message.mixed`             | `frame: WsFrame<MixedMessage>` | 收到图文混排消息                             |
| `message.voice`             | `frame: WsFrame<VoiceMessage>` | 收到语音消息                                 |
| `message.file`              | `frame: WsFrame<FileMessage>`  | 收到文件消息                                 |
| `message.video`             | `frame: WsFrame<VideoMessage>` | 收到视频消息                                 |
| `event`                     | `frame: WsFrame<EventMessage>` | 收到事件回调（所有事件类型）                 |
| `event.enter_chat`          | `frame: WsFrame<EventMessage>` | 收到进入会话事件（用户当天首次进入单聊会话） |
| `event.template_card_event` | `frame: WsFrame<EventMessage>` | 收到模板卡片事件（用户点击卡片按钮）         |
| `event.feedback_event`      | `frame: WsFrame<EventMessage>` | 收到用户反馈事件                             |

---

## 📋 消息类型

SDK 支持以下消息类型（`MessageType` 枚举）：

| 类型    | 值        | 说明                                                     |
| ------- | --------- | -------------------------------------------------------- |
| `Text`  | `'text'`  | 文本消息                                                 |
| `Image` | `'image'` | 图片消息（URL 已加密，使用消息中的 `image.aeskey` 解密） |
| `Mixed` | `'mixed'` | 图文混排消息（包含 text / image 子项）                   |
| `Voice` | `'voice'` | 语音消息（已转文本）                                     |
| `File`  | `'file'`  | 文件消息（URL 已加密，使用消息中的 `file.aeskey` 解密）  |
| `Video` | `'video'` | 视频消息（URL 已加密，使用消息中的 `video.aeskey` 解密） |

SDK 支持以下事件类型（`EventType` 枚举）：

| 类型                | 值                      | 说明                                         |
| ------------------- | ----------------------- | -------------------------------------------- |
| `EnterChat`         | `'enter_chat'`          | 进入会话事件：用户当天首次进入机器人单聊会话 |
| `TemplateCardEvent` | `'template_card_event'` | 模板卡片事件：用户点击模板卡片按钮           |
| `FeedbackEvent`     | `'feedback_event'`      | 用户反馈事件：用户对机器人回复进行反馈       |

SDK 支持以下媒体类型（`WeComMediaType` 类型）：

| 类型 | 值        | 说明 |
| ---- | --------- | ---- |
| —    | `'file'`  | 文件 |
| —    | `'image'` | 图片 |
| —    | `'voice'` | 语音 |
| —    | `'video'` | 视频 |

---

## 🃏 模板卡片类型

SDK 支持以下模板卡片类型（`TemplateCardType` 枚举）：

| 类型                  | 值                       | 说明             |
| --------------------- | ------------------------ | ---------------- |
| `TextNotice`          | `'text_notice'`          | 文本通知模版卡片 |
| `NewsNotice`          | `'news_notice'`          | 图文展示模版卡片 |
| `ButtonInteraction`   | `'button_interaction'`   | 按钮交互模版卡片 |
| `VoteInteraction`     | `'vote_interaction'`     | 投票选择模版卡片 |
| `MultipleInteraction` | `'multiple_interaction'` | 多项选择模版卡片 |

---

## 🔀 消息帧结构

### `WsFrame<T>`

```ts
interface WsFrame<T = any> {
  cmd?: string;              // 命令类型
  headers: {
    req_id: string;          // 请求 ID（回复时需透传）
    [key: string]: any;
  };
  body?: T;                  // 消息体（泛型，默认 any）
  errcode?: number;          // 响应错误码
  errmsg?: string;           // 响应错误信息
}
```

### `BaseMessage`（消息体基础结构）

```ts
interface BaseMessage {
  msgid: string;             // 消息唯一标识
  aibotid: string;           // 机器人 ID
  chatid?: string;           // 群聊 ID（群聊时返回）
  chattype: 'single' | 'group';  // 会话类型
  from: { userid: string };  // 发送者信息
  create_time?: number;      // 事件产生的时间戳
  response_url?: string;     // 支持主动回复消息的临时 url
  msgtype: string;           // 消息类型
  quote?: QuoteContent;      // 引用消息内容
}
```

### `EventMessage`（事件消息结构）

```ts
interface EventMessage {
  msgid: string;             // 本次回调的唯一性标志
  create_time: number;       // 事件产生的时间戳
  aibotid: string;           // 智能机器人 ID
  chatid?: string;           // 会话 ID（仅群聊时返回）
  chattype?: 'single' | 'group';  // 会话类型
  from: EventFrom;           // 事件触发者信息（含 userid、corpid?）
  msgtype: 'event';          // 消息类型，固定为 event
  event: EventContent;       // 事件内容
}
```

---

## 🪵 自定义日志

实现 `Logger` 接口即可自定义日志输出：

```ts
interface Logger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}
```

使用示例：

```ts
const wsClient = new AiBot.WSClient({
  botId: 'your-bot-id',
  secret: 'your-bot-secret',
  logger: {
    debug: () => {},  // 静默 debug 日志
    info: console.log,
    warn: console.warn,
    error: console.error,
  },
});
```

私有部署企业使用示例：
```ts
const wsClient = new AiBot.WSClient({
  botId: 'your-bot-id',
  secret: 'your-bot-secret',
  wsUrl: 'your-wsUrl',
  wsOptions: {
    ca: fs.readFileSync('your-ca-path'),
  },
  logger: {
    debug: () => {},  // 静默 debug 日志
    info: console.log,
    warn: console.warn,
    error: console.error,
  },
});
```

---

## 🔧 WebSocket 命令协议

以下为 SDK 内部使用的 WebSocket 命令常量（`WsCmd`），了解底层协议有助于高级调试：

| 方向          | 常量                  | 值                          | 说明              |
| ------------- | --------------------- | --------------------------- | ----------------- |
| 开发者 → 企微 | `SUBSCRIBE`           | `aibot_subscribe`           | 认证订阅          |
| 开发者 → 企微 | `HEARTBEAT`           | `ping`                      | 心跳              |
| 开发者 → 企微 | `RESPONSE`            | `aibot_respond_msg`         | 回复消息          |
| 开发者 → 企微 | `RESPONSE_WELCOME`    | `aibot_respond_welcome_msg` | 回复欢迎语        |
| 开发者 → 企微 | `RESPONSE_UPDATE`     | `aibot_respond_update_msg`  | 更新模板卡片      |
| 开发者 → 企微 | `SEND_MSG`            | `aibot_send_msg`            | 主动发送消息      |
| 开发者 → 企微 | `UPLOAD_MEDIA_INIT`   | `aibot_upload_media_init`   | 上传素材 - 初始化 |
| 开发者 → 企微 | `UPLOAD_MEDIA_CHUNK`  | `aibot_upload_media_chunk`  | 上传素材 - 分片   |
| 开发者 → 企微 | `UPLOAD_MEDIA_FINISH` | `aibot_upload_media_finish` | 上传素材 - 完成   |
| 企微 → 开发者 | `CALLBACK`            | `aibot_msg_callback`        | 消息推送回调      |
| 企微 → 开发者 | `EVENT_CALLBACK`      | `aibot_event_callback`      | 事件推送回调      |

---

## 📂 项目结构

```
aibot-node-sdk/
├── src/
│   ├── index.ts             # 入口文件，统一导出
│   ├── client.ts            # WSClient 核心客户端
│   ├── ws.ts                # WebSocket 长连接管理器
│   ├── message-handler.ts   # 消息解析与事件分发
│   ├── api.ts               # HTTP API 客户端（文件下载）
│   ├── crypto.ts            # AES-256-CBC 文件解密
│   ├── logger.ts            # 默认日志实现
│   ├── utils.ts             # 工具方法（generateReqId 等）
│   └── types/
│       ├── index.ts          # 类型统一导出
│       ├── config.ts         # 配置选项类型
│       ├── event.ts          # 事件映射类型
│       ├── message.ts        # 消息相关类型
│       ├── api.ts            # API/WebSocket 帧/模板卡片类型
│       └── common.ts         # 通用类型（Logger）
├── examples/
│   └── basic.ts             # 基础使用示例
├── package.json
├── tsconfig.json
├── rollup.config.mjs        # Rollup 构建配置
└── yarn.lock
```

---

## 🧩 完整使用示例

### 流式回复 + 图文混排

```ts
import AiBot from '@wecom/aibot-node-sdk';
import type { WsFrame, ReplyMsgItem } from '@wecom/aibot-node-sdk';
import { generateReqId } from '@wecom/aibot-node-sdk';
import { createHash } from 'crypto';
import fs from 'fs';

const wsClient = new AiBot.WSClient({
  botId: 'your-bot-id',
  secret: 'your-bot-secret',
});

wsClient.connect();

wsClient.on('message.text', async (frame: WsFrame) => {
  const streamId = generateReqId('stream');

  // 流式中间内容
  await wsClient.replyStream(frame, streamId, '正在生成图文内容...', false);

  // 准备图文混排项（仅 finish=true 时有效）
  const imageData = fs.readFileSync('/path/to/image.jpg');
  const base64 = imageData.toString('base64');
  const md5 = createHash('md5').update(imageData).digest('hex');

  const msgItem: ReplyMsgItem[] = [
    { msgtype: 'image', image: { base64, md5 } },
  ];

  // 流式结束，附带图片
  await wsClient.replyStream(frame, streamId, '这是最终结果', true, msgItem);
});
```

### 上传素材 + 回复媒体消息

```ts
import AiBot from '@wecom/aibot-node-sdk';
import type { WsFrame } from '@wecom/aibot-node-sdk';
import fs from 'fs';

const wsClient = new AiBot.WSClient({
  botId: 'your-bot-id',
  secret: 'your-bot-secret',
});

wsClient.connect();

wsClient.on('message.text', async (frame: WsFrame) => {
  // 上传文件
  const fileBuffer = fs.readFileSync('/path/to/document.pdf');
  const result = await wsClient.uploadMedia(fileBuffer, {
    type: 'file',
    filename: 'document.pdf',
  });

  // 使用 media_id 被动回复文件消息
  await wsClient.replyMedia(frame, 'file', result.media_id);
});
```

### 主动推送消息

```ts
// 在认证成功后，可以随时主动推送消息
wsClient.on('authenticated', async () => {
  // 向指定用户推送 Markdown 消息
  await wsClient.sendMessage('target_userid', {
    msgtype: 'markdown',
    markdown: { content: '# 通知\n\n这是一条**主动推送**的消息。' },
  });

  // 主动推送媒体消息
  const imageBuffer = fs.readFileSync('/path/to/photo.jpg');
  const result = await wsClient.uploadMedia(imageBuffer, {
    type: 'image',
    filename: 'photo.jpg',
  });
  await wsClient.sendMediaMessage('target_userid', 'image', result.media_id);
});
```

### 模板卡片交互

```ts
// 回复带按钮的模板卡片
wsClient.on('message.text', async (frame: WsFrame) => {
  await wsClient.replyTemplateCard(frame, {
    card_type: 'button_interaction',
    main_title: { title: '请选择操作', desc: '点击下方按钮进行操作' },
    button_list: [
      { text: '确认', key: 'btn_confirm', style: 1 },
      { text: '取消', key: 'btn_cancel', style: 2 },
    ],
    task_id: `task_${Date.now()}`,
  });
});

// 监听卡片按钮点击事件并更新卡片
wsClient.on('event.template_card_event', async (frame: WsFrame) => {
  const eventKey = frame.body.event?.event_key;
  const taskId = frame.body.event?.task_id;

  await wsClient.updateTemplateCard(frame, {
    card_type: 'text_notice',
    main_title: { title: eventKey === 'btn_confirm' ? '已确认 ✅' : '已取消 ❌' },
    task_id: taskId,
  });
});
```

### 文件下载解密

```ts
import fs from 'fs';
import path from 'path';

// 处理图片消息
wsClient.on('message.image', async (frame: WsFrame) => {
  const body = frame.body;
  const imageUrl = body.image?.url;
  if (!imageUrl) return;

  // 使用消息中独立的 aeskey 下载并解密
  const { buffer, filename } = await wsClient.downloadFile(imageUrl, body.image?.aeskey);
  const savePath = path.join(__dirname, filename || `image_${Date.now()}.jpg`);
  fs.writeFileSync(savePath, buffer);
  console.log(`图片已保存: ${savePath} (${buffer.length} bytes)`);
});

// 处理文件消息
wsClient.on('message.file', async (frame: WsFrame) => {
  const body = frame.body;
  const fileUrl = body.file?.url;
  if (!fileUrl) return;

  const { buffer, filename } = await wsClient.downloadFile(fileUrl, body.file?.aeskey);
  const savePath = path.join(__dirname, filename || `file_${Date.now()}`);
  fs.writeFileSync(savePath, buffer);
  console.log(`文件已保存: ${savePath} (${buffer.length} bytes)`);
});
```

---

## 🔧 开发

```bash
# 安装依赖
yarn install

# 开发模式（监听文件变化）
yarn dev

# 构建
yarn build

# 运行示例
yarn example
```

---

## 🔗 导出说明

SDK 同时支持默认导出和具名导出：

```ts
// 默认导出
import AiBot from '@wecom/aibot-node-sdk';
const wsClient = new AiBot.WSClient({ ... });

// 具名导出
import { WSClient, generateReqId } from '@wecom/aibot-node-sdk';
const wsClient = new WSClient({ ... });

// 类型导入
import type { WsFrame, BaseMessage, TextMessage, TemplateCard } from '@wecom/aibot-node-sdk';
```

完整导出列表：

| 类别     | 导出项                                                                                                                                                                                                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **类**   | `WSClient`、`WeComApiClient`、`WsConnectionManager`、`MessageHandler`、`DefaultLogger`                                                                                                                                                                                           |
| **函数** | `generateReqId`、`generateRandomString`、`decryptFile`                                                                                                                                                                                                                           |
| **枚举** | `MessageType`、`EventType`、`TemplateCardType`、`WsCmd`                                                                                                                                                                                                                          |
| **类型** | `WSClientOptions`、`WSClientEventMap`、`WsFrame`、`WsFrameHeaders`、`BaseMessage`、`TextMessage`、`ImageMessage`、`MixedMessage`、`VoiceMessage`、`FileMessage`、`VideoMessage`、`EventMessage`、`TemplateCard`、`StreamReplyBody`、`ReplyMsgItem`、`ReplyFeedback`、`Logger` 等 |

---

## 📄 License

MIT
