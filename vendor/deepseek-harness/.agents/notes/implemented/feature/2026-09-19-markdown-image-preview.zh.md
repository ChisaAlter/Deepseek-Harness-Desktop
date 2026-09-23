# Agent Note: Markdown 图片预览

Status: implemented

[English](2026-09-19-markdown-image-preview.md) | 中文

## Problem

模型撰写的 Markdown 渲染出的图片——[远程 HTTP(S) 目标](2026-07-30-web-remote-markdown-images.md)与[经文件 API 重写的本地路径](2026-09-07-session-prose-local-media-display.md)——都是无交互的 `<img>` 元素。原图灯箱此前只能从持久附件 gallery 打开，因此模型在展开的思考行或收尾正文里引用的截图可以看见却无法放大查看。思考文本里的本地路径图片更是完全丢失：本地媒体词表只传给了收尾正文的 `MarkdownText`，思考行内的截图路径退化为斜体 alt 文本。

## Decision

[MarkdownDelegate](../../../../packages/client/ui-primitives/src/markdown/MarkdownDelegate.tsx) 新增 `openImage`，上抛已渲染图片的解析图源以及作者的 alt 与 destination。装上回调后，[MarkdownImage](../../../../packages/client/ui-primitives/src/markdown/render.tsx) 把静帧包装为以 alt 或 destination 命名的按钮；未装时保持普通 `<img>`。锚点内的图片保留锚点导航、绝不包装——按钮无法嵌套在那里。

Chat 持有预览状态与新的 single session 域座位 `conversation.image.preview`。[ChatView](../../../../packages/client/ui-chat/src/client/chat/ChatView.tsx) 通过已包裹节点列表的 `MarkdownDelegateProvider` 提供 `openImage`，并在文档层级（与其他对话框并列）渲染该座位，传入解析图源、alt、open 标志，以及把 `open` 置 false 的关闭回调，让 occupant 的退出保持得以播放。[ui-attachment](../../../../packages/client/ui-attachment/src/client/index.ts) 注册该 occupant，它挂载与 gallery 相同的 `ImageLightbox`。[ReasoningRow](../../../../packages/client/ui-chat/src/client/chat/ReasoningRow.tsx) 接收收尾正文的 `pathImages` 词表，使[紧凑思考 Markdown](../bug-fix/2026-09-17-thinking-markdown.md) 内的本地路径经同一文件 API 门重写。

## Alternatives considered

**把灯箱直接 import 进 ui-primitives。** primitives 包保持不依赖 Cordis 与 attachment；delegate 回调把预览所有权留给应用，也让非 chat 的 `MarkdownText` 消费方（文件预览、文档页、问题卡片）保持惰性。

**走 `conversation.message.images` gallery 插槽。** 思考图片位于 Markdown 字符串内，不是持久的 `ImageAttachmentRef` 块；第二种 owner 货币会迫使渲染器为撰写目标伪造附件式对象。

**无条件渲染预览按钮。** 没有 delegate 就没有预览面，无条件按钮会在每个消费方里宣传一个不存在的交互。

## Consequences

Chat 中每张 Markdown 图片——助手正文与展开的思考行，远程或经文件 API 重写——都打开同一个共享灯箱，沿用既有的 Escape、backdrop 与关闭按钮退出方式。座位无 occupant 注册时，激活不产生任何输出，图片仍内联显示。交互经按钮可键盘到达，alt 或 destination 提供可访问名称。思考内的本地路径截图现在也能渲染，受与正文相同的落定渲染流式门约束。
