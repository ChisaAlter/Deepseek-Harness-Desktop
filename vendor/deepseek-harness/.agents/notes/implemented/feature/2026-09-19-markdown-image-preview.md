# Agent Note: Markdown image preview

Status: implemented

English | [中文](2026-09-19-markdown-image-preview.zh.md)

## Problem

Model-authored Markdown renders images — [remote HTTP(S) destinations](2026-07-30-web-remote-markdown-images.md) and [local paths rewritten through the file API](2026-09-07-session-prose-local-media-display.md) — as inert `<img>` elements. The original-image lightbox opened only from durable-attachment galleries, so a screenshot the model cites inside an expanded Think row or in closing prose could be seen but never inspected at full size. Reasoning text also dropped local-path images entirely: the local-media vocabulary reached only the closing-prose `MarkdownText`, so a screenshot path inside a Think row degraded to italic alt text.

## Decision

[MarkdownDelegate](../../../../packages/client/ui-primitives/src/markdown/MarkdownDelegate.tsx) gains `openImage`, reporting the rendered image's resolved source plus its authored alt and destination. With the callback installed, [MarkdownImage](../../../../packages/client/ui-primitives/src/markdown/render.tsx) wraps the still frame in a button named by that alt or destination; without it the plain `<img>` stays. An image inside an anchor keeps the anchor's navigation and is never wrapped — a button cannot nest there.

Chat owns the preview state and the new single session-scope seat `conversation.image.preview`. [ChatView](../../../../packages/client/ui-chat/src/client/chat/ChatView.tsx) supplies `openImage` through the `MarkdownDelegateProvider` that already wraps the node list, and renders the seat at document level beside the other dialogs with the resolved source, alt, open flag, and a dismiss callback that flips `open` false so the occupant's exit hold can play. [ui-attachment](../../../../packages/client/ui-attachment/src/client/index.ts) registers the occupant, which mounts the same `ImageLightbox` the galleries open. [ReasoningRow](../../../../packages/client/ui-chat/src/client/chat/ReasoningRow.tsx) receives the closing prose's `pathImages` vocabulary, so local paths inside [compact thinking Markdown](../bug-fix/2026-09-17-thinking-markdown.md) rewrite through the same file-API gate.

## Alternatives considered

**Import the lightbox into ui-primitives.** The primitives package stays Cordis- and attachment-free; the delegate callback keeps preview ownership with the application and leaves non-chat `MarkdownText` consumers (file previews, docs pages, question cards) inert.

**Route through the `conversation.message.images` gallery slot.** Reasoning images live inside a Markdown string, not durable `ImageAttachmentRef` blocks; a second owner currency would force the renderer to mint attachment-like objects for authored destinations.

**Always render the preview button.** Without a delegate there is no preview surface, so an unconditional button would advertise a dead interaction in every consumer.

## Consequences

Every Markdown image in Chat — assistant prose and expanded Think rows, remote or file-API rewritten — opens one shared lightbox with the existing Escape, backdrop, and close-button dismissal. When no occupant registers the seat, activations render nothing while images still display inline. The interaction is keyboard-reachable through the button, and the alt or destination supplies its accessible name. Local-path screenshots inside reasoning now render at all, under the same settled-render streaming gate as prose.
