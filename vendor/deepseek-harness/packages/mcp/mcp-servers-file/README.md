# @deepseek-ai/dsh-mcp-servers-file

English | [中文](README.zh.md)

Owns `$DSH_HOME/mcp-servers.yaml` (or an explicit `path`) and mounts one [`@deepseek-ai/dsh-mcp-client`](../mcp-client/README.md) child for each enabled record. The document is a YAML object with a `servers` array; each record carries a unique `id`, `serverName`, `enabled`, and either stdio (`command`, `args`, `env`, `cwd`) or Streamable HTTP (`url`, `headers`) fields that match the mcp-client Config. Writes use the atomic-write lock; a watcher remounts children after an external edit. The `mcpServersFile` service exposes `listManaged`, `upsert`, `remove`, `setEnabled`, `remount`, and `authorize`. `authorize` runs MCP HTTP OAuth (PKCE) in the system browser, writes `Authorization: Bearer …` on that record, and remounts so the child's tools are live. Secret-looking env and header keys are masked on `listManaged`; a blank or `********` upsert keeps the stored value. An omitted or empty env/headers map keeps those secret keys; an explicit new map that omits a key deletes it.

## Model Experience

None, as this package only mounts already-defined mcp-client instances and never assembles prompts, tools, or provider requests itself.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **No import from Cursor or Claude `.mcp.json`** — the document format is reserved for a later importer; this package only reads its own YAML.
- **Composition-owned mcp-client rows stay outside this file** — hand-written `cordis.patch.yml` instances are not rewritten here.
- **OAuth access tokens expire** — there is no refresh-token renewal; sign in again from Settings when the server returns 401.

No runtime invariant companion is published; this package owns no independent durable event relationship, and focused package tests cover its UI or service behavior.
