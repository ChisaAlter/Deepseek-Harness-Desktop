# Decision: Tool result images are visible through one shared gallery

Status: implemented

[中文](2026-09-22-tool-result-images.md) | English

## Problem

The user can see the model read an image only when the tool is `read_image`.
Browser screenshots and MCP tools can return the same durable image blocks, but
the generic Tool card flattens them into JSON, so the user cannot verify what
the model saw without asking the model to send the image again.

## Decision

The `tool-call` chat node owns the `tool.call.images` child slot and passes a
`renderToolImages` closure to every atomic Tool view. The generic Tool card
derives ordered durable references from a settled result's own image blocks and
renders them through that existing gallery. A compact localized image count
appears on the collapsed row, and the gallery opens with the existing
attachment lightbox.

The durable reference remains the only source of pixels. `ui-tool` neither
persists images nor resolves URLs; the chat node's session-authorized loader and
the attachment presentation plugin keep that ownership. The `read_image` card
keeps its path label and envelope text, and every generic result keeps its
existing text and error output.

## Alternatives considered

- **Render the gallery inside `GenericToolCard` and import the attachment
  package there.** This would make the generic card depend on a presentation
  plugin and duplicate session authorization; the existing slot exists exactly
  to avoid that coupling.

- **Keep the slot declared by the `read_image` keyed entry and add a second
  image-bearing toolview.** A child slot may be declared by only one entry, so a
  second declaration throws at load and a second persistence layer would create
  two durable copies of the same image.

- **Scrape image references from persisted `presentationMeta`.** A post-execute
  hook may replace result content, so metadata can go stale; the settled
  `content` blocks are the single source of truth for what the model received.

## Consequences

Users can inspect browser, MCP, and any future image-bearing tool result in
place, including historical sessions, because the gallery loads the durable
attachment rather than the original file path. A malformed image block declines
the whole gallery to the existing flattened text instead of showing a partial
or misleading set. The cost is a public owner-prop addition and a slot
declaration move from the `read_image` entry to the `tool-call` chat node.
