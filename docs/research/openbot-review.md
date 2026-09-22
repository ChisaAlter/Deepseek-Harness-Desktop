# OpenBot (CopilotKit) — Research Review

Researched: 2026-09 (primary sources: GitHub README, `docs/*.md`, `.env.example`, release notes, CopilotKit blog). Repo: **https://github.com/CopilotKit/openbot** — MIT, alpha, created 2026-08-17, announced Aug 19 2026 by CEO Atai Barkai on X as "an open source Grok Bot that works with ANY agent harness, designed for real companies" (~438K views day one; ~1k stars/105 forks week one; 3,500+ stars by v0.0.5).
Sources: https://github.com/CopilotKit/openbot · https://github.com/CopilotKit/openbot/releases/tag/v0.0.1 · https://www.explainx.ai/blog/copilotkit-openbot-open-source-grok-bot-august-2026 · https://www.copilotkit.ai/blog/openbot-updates-v0.0.5

## 1. What a "Bot" is concretely

A Bot is **not** a CopilotKit agent class or a managed process — it is **any HTTP endpoint that speaks AG-UI** (the Agent–User Interaction Protocol CopilotKit wrote and maintains). Registration happens two ways: the `/agents` UI (name, title, role description, visibility, optional AG-UI URL, optional write-only auth header) or `agents.yaml` in a tenant package (`type: built-in` = system prompt executed via `MANAGED_AGENT_AG_UI_URL`; `type: remote-ag-ui` = external endpoint). Endpoint registration is validated with the same SSRF-style "target checks" as browser navigation — cloud metadata addresses are always refused; auth headers are stored write-only (never returned by APIs).
Sources: https://github.com/CopilotKit/openbot/blob/main/docs/coworkers.md · https://github.com/CopilotKit/openbot/blob/main/README.md · https://agentriot.com/news/ai-agents/copilotkit-openbot-alpha-gateway-computers

A **coworker** = Bot + durable profile + standing role sent with every run. Data model: `agents` (runtime identity, endpoint/key ref), `agent_profiles` (name, title, role, avatar seed, owner, visibility, soft-delete), `agent_preferences` (per-user roster/hidden state), `channels` + `channel_memberships` + `intelligence_channel_mappings` (channel→Intelligence thread). Visibility: `private` (owner+admins) / `public` (whole deployment). Package agents are public/ownerless and not editable in-product; user-created coworkers are owned by their creator.
Source: https://github.com/CopilotKit/openbot/blob/main/docs/coworkers.md

## 2. Architecture

| Component | Port | Responsibility |
|---|---|---|
| `app` | 3010 | React/Vite UI: channels, bot chat, live screen, settings, admin |
| `server` | 3001 | Hono API + CopilotKit runtime, auth, roles, tenant package, coworkers, channels, policy, audit, credentials, plugins, components, connectors |
| `agent-computer` | 4100 | Chromium, `/workspace`, browser profile, screenshots, DOM snapshots, file tools, shell `/exec` |
| `agent-bot` | 4200 | Proof-of-concept AG-UI bot (hand-written protocol; reference only — no own tool loop) |
| `agent-langgraph` | 4201 | LangGraph AG-UI bot (real framework, own tool loop) |
| `supervisor` | 4500 host / 4300 container | Creates/stops/resets/lists per-Bot computer containers (needs Docker socket) |
| PostgreSQL + pgvector | 5432 | Product data, audit rows, credentials, policy, grants, channels, components, connector state, knowledge records |
| CopilotKit Intelligence | external | Durable threads, memory, realtime gateway |
Source: https://github.com/CopilotKit/openbot/blob/main/docs/architecture.md

**Runtime flow:** app opens channel/direct session → server resolves actor + coworker → CopilotKit runtime sends turn to the AG-UI endpoint → surface registers frontend tools (browser, MCP, components granted to that bot) → acting browser/file/MCP calls loop back to server for authorization + audit → results stream to app and Intelligence thread. Each channel routes through a channel-local proxy agent id pinned to the thread id.
Source: https://github.com/CopilotKit/openbot/blob/main/docs/architecture.md

**Bot-to-bot:** v0.0.5 added delegation — a bot can hand a question to another bot (answers as itself, with its own tools/knowledge) or escalate to a person; admin-controlled allowlist, off by default. Also v0.0.5: **Routines** (scheduled bots, run with creator's permissions, auto-disable on repeated failure).
Source: https://www.copilotkit.ai/blog/openbot-updates-v0.0.5

**Deployment:** local = `scripts/start.sh` → Docker Compose (db, computer, both bots, supervisor) + `server`/`app` on host (Bun 1.3+). Also ships as **one container** (app+API+Chromium, port 3001; Chromium 4100 deliberately unpublished; optional `EMBEDDED_POSTGRES=on`). v0.0.5 added a **Helm chart** proven on AWS EKS (also GKE/AKS), per-bot computers that suspend when idle while keeping logins. A desktop app exists (CHANGELOG: fresh installs pin latest published release; older default was v0.0.8).
Sources: https://github.com/CopilotKit/OpenBot/blob/main/docs/deployment.md · https://www.copilotkit.ai/blog/openbot-updates-v0.0.5 · https://github.com/CopilotKit/OpenBot/blob/main/CHANGELOG.md

## 3. How bots are created/configured

- **UI:** `/agents` — create/edit/duplicate/hide/delete/launch; fields: name, title, role description, visibility, optional endpoint, optional write-only auth header. Coworkers created without an endpoint fall back to `MANAGED_AGENT_AG_UI_URL` (defaults to the LangGraph bot on :4201).
- **Tenant package** (config-as-code): `TENANT_PACKAGE_DIR`, default `../examples/fintech`. Five required YAMLs: `brand.yaml`, `agents.yaml`, `channels.yaml`, `model.yaml`, `knowledge.yaml`; optional `skills.yaml` (v0.0.4+, seeds skills at boot). Example coworkers shipped as YAML not code: **General Assistant, Knowledge, Risk Analyst**. Example `model.yaml`: `provider: openai`, `credential_secret_ref: openai-api-key`, `default_model: gpt-4.1`.
- **Env (validated at startup, refuses to boot if missing):** `DATABASE_URL`, `KEY_ENCRYPTION_KEY` (base64 32B, encrypts credential vault), `MANAGED_AGENT_AG_UI_URL`, `MANAGED_AGENT_TOKEN` (sent as `x-openbot-agent-token`), `INTELLIGENCE_API_URL`, `INTELLIGENCE_GATEWAY_WS_URL`, `INTELLIGENCE_API_KEY`, `COPILOTKIT_LICENSE_TOKEN`.
- v0.0.5-era CHANGELOG: a `bot-creator` skill granted to `general-assistant` can create coworkers conversationally; a `skill-creator` skill drafts skills via interview + confirmation card.
Sources: https://github.com/CopilotKit/openbot/blob/main/docs/configuration.md · https://github.com/CopilotKit/openbot/blob/main/.env.example · https://github.com/CopilotKit/openbot/blob/main/docs/coworkers.md · https://www.webkkk.net/CopilotKit/OpenBot/blob/main/CHANGELOG.md · https://www.scriptbyai.com/openbot-ai-coworkers/

## 4. Supported models/harnesses

Any AG-UI endpoint: README names **LangGraph, Mastra, CrewAI, Pydantic AI, Google ADK, hand-written**; launch post adds **Claude Agent SDK, AWS Strands, MS Agent Framework, LangChain** ("Powered by the newly released Channels SDK"). Governance rides the protocol, not the framework. Shipped bots: PoC (OpenAI) and LangGraph (OpenAI/Anthropic/Google via `BOT_PROVIDER`). `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` / `GOOGLE_GENERATIVE_AI_BASE_URL` redirect provider calls to proxies/gateways/local models. No model ships in the box; admin supplies the key, encrypted at rest, never logged.
Sources: https://github.com/CopilotKit/openbot/blob/main/README.md · https://eond.com/community/492923 (launch post mirror) · https://github.com/CopilotKit/openbot/blob/main/docs/configuration.md

## 5. The per-bot "computer"

A **Docker container per bot** created by the supervisor: Chromium with a **persistent browser profile** (its own real logins), its own `/workspace` volume, file tools, screenshots/snapshots — **plus a shell**: bots can run commands, install packages, process files; shell goes through the same policy gate (rules can refuse shell outright or specific commands; env inherits only PATH/locale/terminal/proxy vars). `COMPUTER_RUNTIME=runsc` → gVisor; `COMPUTER_SANDBOX=on` → Chromium's own sandbox. Without supervisor (`COMPUTER_SUPERVISOR_URL` unset), all bots share one computer = shared logins/files — OK for one trusted team, "not fine as a boundary between tenants." No bot can read another's files or reuse another's sign-ins (when per-bot computers are on).
Sources: https://github.com/CopilotKit/openbot/blob/main/README.md · https://github.com/CopilotKit/openbot/releases/tag/v0.0.1 · https://github.com/CopilotKit/OpenBot/blob/main/docs/deployment.md

## 6. Security / permission model

- **Gateway is the only way in:** resolves the target from a **server-held page snapshot** (doesn't trust the model's claim about what it's clicking) → evaluates policy → **writes the audit row BEFORE the action runs** → then calls the computer; a second row records computer-side failure. No code path acts before its record exists.
- **CEL policy, fail-closed:** inspectable fields: `tool.name`, `intent`, `bot.id`, `actor.id`, `page.url`, `page.host`, `element.ref/role/name/type`, `key`, `file.path/name/extension`, `mcp.server/tool/effect`. Deny before allow; missing/empty policy permits nothing; broken deny denies; broken allow does not permit; malformed `AGENT_COMPUTER_POLICY` stops startup. **Shipped default is permissive:** `deny: []`, `allow: ["true"]` — hardening is on the admin via `/admin/boundaries` (v0.0.5 added dry-run for rules).
- **Audit:** `/admin/audit` lists permitted/refused/failed; every refusal names its rule; sign-ins, admin grants, config changes also audited. `AGENT_STALL_TIMEOUT_MS` writes `agent.stream_stalled` for dead streams. `AGENT_TOOL_TOKEN` required for framework bots to call granted tools back through the deployment (grant+policy+audit stay server-side).
- **MCP governance:** `/admin/plugins`; curated catalogue (Atlassian, Box, Slack, Salesforce, ServiceNow); custom servers pass URL checks; **any tool not positively classified "read" is treated as "write."**
- **Knowledge connectors:** Google Drive + OneDrive (v0.0.5 added Notion read/write, Drive read-only); per-user OAuth — a bot only sees what the asker may see; permissions normalize to allow/deny principals, deny wins, ambiguous mapping → not returned (fail-closed retrieval). v0.0.2 deliberately deleted the local vector index — no stored copies.
- **AuthN/Z:** Better Auth; Google/Microsoft(OIDC Entra)/Okta; `INITIAL_ADMIN_EMAILS` is the only admin grant path (re-read each sign-in). With no IdP, `OPENBOT_SINGLE_USER=true` is **required** or startup refuses — it admits every request as one admin (ships on in `.env.example`). Earlier alpha used `OPENBOT_DEV_NO_AUTH`. Channel access = `channel_memberships` row required; `channels.allowed_groups` is stored but **not enforced** (`users.groups` never populated). IdP registration is admin-only because Better Auth's SSO plugin would otherwise let any signed-in user register a provider.
- **Take the wheel:** human grabs live control (v0.0.5: anytime, not just on request); bot page actions refused while held (`computer.help_requested`, `computer.control_taken` audit rows).
Sources: https://github.com/CopilotKit/openbot/blob/main/docs/architecture.md · https://github.com/CopilotKit/openbot/blob/main/README.md · https://www.copilotkit.ai/openbot · https://www.copilotkit.ai/blog/openbot-updates-v0.0.5 · https://zyvop.com/openbot-a-technical-architecture-review-of-copilotkit-s-governed-agent-runtime-rg1sa · https://moclaw.ai/blog/copilotkit-openbot

## 7. License & monetization

Code is **MIT** (LICENSE in repo). But a running instance **requires CopilotKit Intelligence** — `INTELLIGENCE_API_KEY` (`cpk-...`) + `COPILOTKIT_LICENSE_TOKEN`, obtained via `npx copilotkit@latest login / project select / license --write`. Free **Developer** plan exists (cloud-hosted); self-hosting Intelligence requires **Team self-hosted or Enterprise** plan. Threads/memory live in Intelligence — third-party review notes "there is no degraded mode." Plus your own model key. So: open-source shell, metered/proprietary memory layer.
Sources: https://github.com/CopilotKit/openbot/blob/main/README.md · https://docs.copilotkit.ai/intelligence/overview · https://docs.copilotkit.ai/premium/managed-intelligence-platform · https://agentriot.com/news/ai-agents/copilotkit-openbot-alpha-gateway-computers

## 8. Maturity & known limitations

- Releases: v0.0.1 (Aug 17) → v0.0.4 (Aug 22) → v0.0.5 (~early Sep, 3.5k★) → CHANGELOG references v0.0.8-era desktop app. Explicitly alpha: "rough edges and bugs, and expect things to move."
- **Single replica only:** gateway caches page snapshots in process memory; a second replica answers clicks with snapshots it never took (docs: "pin max instance count").
- Default `OPENBOT_SINGLE_USER=true` = every visitor is admin until an IdP is wired.
- **Open issue #246:** during human takeover, bot clicks are refused but **`/exec` shell and `/files/write` are NOT** — enforcement exists only in `assertBotMayAct` (`agent-computer/src/control.ts`), called from navigate + click/type/key/scroll handlers; `/exec` was added later with no guard. Bot can keep running commands while a human is mid-sign-in.
- No supervisor → one shared browser/filesystem for all bots.
- `allowed_groups` not enforced; SPIRE entries in compose are optional/not started; v0.0.1 was local-only (Helm arrived v0.0.5).
- Takeover requires being at/tunneled to the machine (third-party critique).
Sources: https://github.com/CopilotKit/openbot/releases/tag/v0.0.1 · https://github.com/CopilotKit/openbot/issues/246 · https://github.com/CopilotKit/OpenBot/blob/main/docs/deployment.md · https://www.explainx.ai/blog/copilotkit-openbot-open-source-grok-bot-august-2026 · https://moclaw.ai/blog/copilotkit-openbot

## 9. UI/UX shape

iMessage/roster-of-coworkers shape, not a single chat box: `/` = start/browse channels; `/channel/:id` = chat with one coworker + **its live screen opens beside the conversation** (watch it work; take the wheel in the same panel); `/agents` = roster CRUD; `/bot?agent=` = direct bot chat; `/skills` (personal skills, `/`-invoked from composer; deployment skills admin-owned); `/settings`; admin suite: `/admin/connectors`, `/admin/credentials` (write-only encrypted vault), `/admin/computers`, `/admin/boundaries` (policy rules + dry-run), `/admin/components` + `/admin/playground` (sandboxed component authoring, publish w/o rebuild), `/admin/plugins` (MCP), `/admin/audit`. Bots answer with **compiled React components**, not only prose (gallery in `app/src/components/gallery/`; per-component data-function grants; can be withheld per bot).
Sources: https://github.com/CopilotKit/openbot/blob/main/README.md · https://www.copilotkit.ai/openbot · https://www.explainx.ai/blog/copilotkit-openbot-open-source-grok-bot-august-2026

## 10. Competing "open-source Grok Bot" projects (disambiguation)

- **milind-soni/OpenMausBot** (~676★, MIT, created Aug 11 — actually predates OpenBot): closest in spirit for individuals. Bots run on locally installed `claude`/`codex`/`grok` CLIs using your existing subscriptions (stream-JSON/JSON-RPC/ACP drivers); local-first harness server on 127.0.0.1:8799, Electron/desktop `.dmg`; bots get a cloud Linux desktop (asciidotdev), local VM, or your Mac (trycua), + 500+ Composio apps; chat-app roster UI, routines on a calendar. Source: https://github.com/milind-soni/OpenMausBot
- **wolfqing/OpenGrokBot** (MIT, unofficial): self-hosted always-on teammates each with a private computer; BYOK any OpenAI-compatible endpoint (defaults to api.x.ai, `grok-4`, `stub` offline); SQLite + workspaces + screenshots under `gateway/data`; `OPENGROKBOT_A2A_ALLOW` peer handoffs. v0.1 was an OpenClaw distribution; v0.2 is its own core (private-computer-per-teammate conflicts with OpenClaw's shared-host model). Source: https://github.com/wolfqing/OpenGrokBot
- **ishandutta2007/open-grokbot**: "open source equivalent of grok bot by Cursor"; always-on 24/7 agents, multi-agent collaboration, learning from demonstrations, isolated sandboxes. Thin README; low maturity/signal. Source: https://github.com/ishandutta2007/open-grokbot
- **next-open-ai/openbot** (name collision, unrelated): Chinese desktop-first agent platform (OpenClaw-like), CLI + WebSocket gateway :38080 + Electron/Vue3 app, Feishu/DingTalk/Telegram channels, proxy mode to Coze/OpenCode/other OpenBot nodes (0 local tokens), pi-coding-agent + agent-browser + Vectra memory, "restricted MIT," npm `@next-open-ai/openbot` v0.6.66. Not a Grok Bot clone per se. Source: https://github.com/next-open-ai/openbot
- (Bonus) **OnlyTerp/opengrok** (~352★): not a clone — a tool that injects *other* models into the real Grok Bot, with wire-capture-verified provider mappings. Source: https://github.com/OnlyTerp/opengrok

## Assessment (one paragraph)

OpenBot's real product is the **fail-closed governance gateway + audit trail** wrapped around per-bot Dockerized Chromium computers, with the AG-UI protocol as the agent interface — framework-agnostic by design and self-hostable down to a laptop. The architecture is thoughtful (snapshot-based target resolution, write-ahead audit, conservative MCP classification, write-only credentials) and iterating fast (8 tags in ~3 weeks, Helm + SSO + delegation + routines by v0.0.5). Costs: hard dependency on CopilotKit Intelligence (the monetization hook — MIT code, proprietary memory plane), alpha security posture (default everyone-is-admin, permissive default policy, issue #246's shell-during-takeover gap, single-replica cap). For a desktop-harness comparison: OpenBot's "computer" is heavier (full container+browser per bot vs. workspace/PTY), its governance model (CEL + write-ahead audit) is the most transferable idea, and its channel/roster UX + generative-UI answers mirror what Grok Bot-style products are converging on.
