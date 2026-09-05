# @deepseek-ai/dsh-llm-vision-fallback
English | [中文](README.zh.md)

A user-designated vision-capable model describes image attachments so a text-only main model (e.g. DeepSeek) can act on them.

The Models settings page stores the designated route in the `vision-fallback` settings namespace (`provider` + `model`; both absent disables the feature). The session-controller and local subagent admission gates admits image prompts for text-only main models whenever `ctx.visionFallback.configured()` is true, and the agent loop calls `ctx.visionFallback.rewriteMessages()` before dispatching each request: image blocks bound for a model whose `inputModalities` excludes `'image'` are replaced with description text generated once by the designated vision model. The `read_image` tool's route gate ([`@deepseek-ai/dsh-tool-fs`](../../fs/tool-fs)) likewise admits text-only routes while the service is configured, so tool-read images flow through the same substitution.

Each generated description is appended to the session log as a `vision/describe` event before the main request dispatches, so rewritten requests remain reconstructable from the log and later steps reuse logged descriptions instead of re-describing. The request invariant calls `replayMessages()`, which refuses missing descriptions without invoking a model. The generated durable vocabulary includes this event for history reloads.

## Config

- `maxOutputTokens` — vision-call output-token cap.
- `timeoutMs` — end-to-end vision-call deadline in milliseconds.

## Model Experience

### Vision description substitution

#### What the model sees

The main text-only model receives framed `【图片…】…【图片描述结束】` description text in place of each image block. The designated vision model receives one auxiliary request per new image with a fixed Chinese system prompt demanding faithful transcription and layout description.

#### Token effect

One auxiliary vision call per new attachment per session, plus the description text carried in every subsequent main request. Later steps replay logged `vision/describe` events instead of re-describing.

#### KV Cache effect

Substituted description text becomes part of the assembled prefix; a new description or a change in which images are rewritten can break cache reuse from that token.

## Known Limitations and Deferred Work

- Descriptions are substituted whole; there is no per-image size cap beyond `maxOutputTokens`.
- A failed vision call fails the main request as an `LlmError` (the provider code, or `INVALID_REQUEST`) instead of flattening to `UNKNOWN`.
- The Models page picker lists only catalog rows whose `inputModalities` include `'image'`. A stored designation missing from that list stays selected. Hand-written `settings.yaml` can still name a text-only route, and `configured()` stays true regardless of that route's advertised modalities.
