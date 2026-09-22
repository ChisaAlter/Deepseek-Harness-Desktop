# Grok Bot (SpaceXAI / xAI) — Behavior Research

**Compiled:** from public sources indexed up to ~Sept 2026. Product launched **August 11, 2026** (beta).
**Verification legend:** ✅ official source (x.ai / docs.x.ai / cursor.com/help / GitHub) · 🔍 third-party observed · ❓ not documented / unknown · ⚠️ conflicting sources.

---

## 0. Source-availability check: github.com/xai-org

### Org repo inventory
Observed public repos (via org page + mirrors): `grok-1` (open weights), `x-algorithm` (For You feed), `grok-build` (CLI/TUI), `grok-prompts`, `xai-sdk-python`, `xai-cookbook`, `xai-proto`, and a Claude-Code-plugin repo that delegates reviews to the Grok Build CLI. **No `grok-bot` repo exists.** (https://github.com/xai-org?tab=repositories, https://eezz4.github.io/zzop/)

### `xai-org/grok-prompts` — does it contain Grok Bot (teammate) prompts? **No.** ✅
Repo description: *"Prompts for our Grok chat assistant and the `@grok` bot on X"* — the `@grok` bot here is the **X mention-reply bot**, NOT the Grok Bot teammates product. Full file list (~12 files, per README + DeepWiki):

| File | Purpose |
|---|---|
| `grok4_system_turn_prompt_v8.j2` | Grok 4 chat system prompt (grok.com / X) |
| `grok4p1_thinking_system_turn_prompt_v2.j2`, `grok4p1_non_thinking_system_turn_prompt.j2`, `grok4p1_non_thinking_no_tool_system_turn_prompt.j2` | Grok 4.1 variants (thinking / tools / no-tools) |
| `grok3_official0330_p1.j2` | Grok 3 chat prompt (includes memory-management instructions: book-icon forget UI, Data Controls toggle) |
| `ask_grok_system_prompt.j2` | `@grok` mention bot on X — "You are @grok, a version of Grok built by xAI"; 550-char limit, neutral tone, no markdown |
| `default_deepsearch_final_summarizer_prompt.j2` | DeepSearch feature |
| `grok_analyze_button.j2` | "Grok Explain" on X |
| `grok_4_safety_prompt.txt`, `grok_4_mini_system_prompt.txt`, `grok_4_code_rc1_safety_prompt.txt` | Immutable API safety prefixes for `grok-4-0709`, `grok-4-fast`, `grok-code-fast-1` |

Nothing for Bots/teammates/routines/computer-use. Sources: https://github.com/xai-org/grok-prompts, https://deepwiki.com/xai-org/grok-prompts

### `xai-org/grok-build` — schedule/routine/heartbeat/idle mechanics in the CLI ✅ (exists, but it's the CLI's own feature set)
Rust monorepo sync of the `grok` coding agent (`xai-grok-pager` binary). Relevant internals found in `crates/codegen/xai-grok-pager/docs/user-guide/20-background-tasks.md` and DeepWiki:

- **Scheduler**: `scheduler_create` tool — params `interval` ("60s"/"5m"/"2h"/"1d"), `prompt`, `fire_immediately`, `recurring`, **`durable` (persist across sessions, default false)**. `scheduler_list` shows IDs/intervals/next-fire. `/loop [interval] <prompt>` is a wrapper: fires immediately, each firing = a new agent turn, **auto-expires after 7 days, max 50 active scheduled tasks**.
- **Monitor tool**: streams a long-running script's stdout lines as conversation notifications ("real-time event streams").
- **Background tasks**: `wait_commands_or_subagents` (max 20 task IDs, wait_any/wait_all, 30s default timeout), `kill_command_or_subagent` (SIGTERM→SIGKILL; Cancel/Shutdown to subagents). *"Any of them can wake the agent for a new turn."*
- **Subagents**: `task` tool spawns child agents (`SubagentCoordinator`, park/wake lifecycle, `AgentActivity` busy-tracking); shared-workspace or isolated-git-worktree isolation modes.
- **Computer Hub / remote workspace**: `xai-computer-hub-core` + `xai-workspace-server` daemon; JSON-RPC-style proxied RPCs (`fs.*`, `git.*`, `worktree.*`, `session.*`) so tool calls can execute on a remote machine; `session_bind_task` spins up workspace sessions on demand; `status_publisher_task` pushes status. Kernel sandboxing via Landlock/Seatbelt (`nono` crate).
- **No** bot roster, group chat, teammate-messaging, or memory-store code found — that layer lives in the closed Grok Bot app/backend. ⚠️ Inference only: the remote-workspace + durable-scheduler + subagent primitives in `grok-build` look like plausible substrate for Grok Bot's shared cloud computer, but nothing in the repo says so.

Sources: https://github.com/xai-org/grok-build, https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/20-background-tasks.md, https://deepwiki.com/xai-org/grok-build/6.3-computer-hub-and-remote-workspace, https://deepwiki.com/xai-org/grok-build/4-agent-system

---

## 1. Corporate context (needed to read the docs correctly)
- Publisher is "**SpaceXAI**" — the merged SpaceX/xAI entity; SpaceX agreed a ~$60B all-stock deal for Cursor's parent Anysphere in June 2026, and Grok Bot is a joint SpaceXAI × Cursor product (sign-in is via **Cursor account**; billing/retention per Cursor terms). 🔍 https://thenextweb.com/news/spacexai-grok-bot-ai-agents-cursor, https://www.usatoday.com/press-release/story/39819/
- **Launch gating** (Aug 11): SuperGrok Heavy (~$300/mo), Cursor Ultra ($200/mo), Cursor Teams Premium (~$120/seat/mo) — matches the "~$120–300" range. Expanded Aug 21 (Cursor Pro+ $60 floor + limited free trial) and Aug 26 (all paid tiers incl. Cursor Pro $20 and SuperGrok $30). 🔍 https://cellcog.ai/blog/grok-bot-pricing/, https://www.eesel.ai/blog/grok-bot-pricing
- Billing: weekly Grok Bot usage allowance included per plan; overage billed on-demand from model+token cost; **no spend cap, no model picker**. ✅ https://cursor.com/help/grok-bot/plans, 🔍 https://www.eesel.ai/blog/grok-bot-pricing

## 2. Continuous / proactive work

**Verified mechanics (all from official docs/guides):**
- Work executes on the cloud VM; closing the app/laptop/phone **does not stop a background turn or routine**. ✅ https://docs.x.ai/grok-bot/faq
- A user DM **takes priority over background work and can redirect the current turn**; "Stop now" ends work (does not undo completed actions). ✅ https://docs.x.ai/grok-bot/chat-and-collaboration
- Bot-initiated activity happens through **triggers, not a free-running idle loop**:
  1. **Routines** on schedules (see §4)
  2. **Event triggers**: Slack-message listeners, GitHub notifications via Cursor account integrations, and **webhooks** ✅ https://cursor.com/help/grok-bot/routines.md, https://docs.x.ai/grok-bot/skills-routines-and-automations
  3. **Bot→bot async messages**: "The receiving Bot wakes, handles the request, and can reply later"; bots can "trigger each other" ✅ https://docs.x.ai/grok-bot/chat-and-collaboration, https://x.ai/bot/guides/grok-bot-101
  4. **Approval / secret / computer-takeover requests** and completion notifications back to the user ✅
- **Bots can self-schedule**: *"A bot can set its own schedule or listen for events from other apps. It can watch a Slack thread or a GitHub PR."* ✅ https://x.ai/bot/guides/grok-bot-101
- **Unattended-usage governor**: "Grok Bot may ask whether to keep routines running after a long period away and pause them if there is no response." ✅ https://docs.x.ai/grok-bot/skills-routines-and-automations
- Observed bot-initiated user contact: mid-task "iMessage-style" progress updates, completion alerts, approval requests, "needs input" notifications. 🔍 https://brianlovin.com/writing/grok-bot-first-impressions-kcJun01, https://cursor.com/help/grok-bot/mobile
- Official internal pattern: chief-of-staff bot "Jenny" runs a **5 a.m. daily 1:1 routine with every bot** (playbook review, blockers), does postmortems, and **creates new bots** to scale the team. ✅ https://x.ai/bot/guides/grok-bot-for-engineering
- ❓ **No documented heartbeat / idle self-reflection / goal-pursuit loop.** "Keep working 24/7" = persistent VM + running turns + triggers. Whether a Bot spontaneously starts unprompted work with no routine/message is **not documented**. Launch-week bug reports describe Bots **looping in conversation with each other** 🔍 https://continuumcode.ai/guides/grok-bot-review/

## 3. Memory
- Per-Bot durable state: *"stable working preferences, important facts, and summaries from its work… keep a role over time without replaying every prior message."* Conversation + learned role are **separate per Bot**. ✅ https://docs.x.ai/grok-bot/bots, https://docs.x.ai/grok-bot/faq
- Sept-3 design post's object model confirms **memory and Routines stay with one Bot**; Tools and Skills are account-level. ✅ (via https://superpowerdaily.com/posts/xai-explains-how-grok-bot-is-built-to-keep-agents-working-between-chats, https://x.ai/news/designing-grok-bot)
- Duplicating/sharing a Bot copies profile, settings, skills, routines, avatar — **not** conversation history, learned memory, or attachments. ✅ https://docs.x.ai/grok-bot/bots
- Docs steer users away from treating memory as source-of-truth: keep durable rules in the **Bot description**, correct stale assumptions explicitly, ask the Bot to re-check current data. ✅
- ❓ **No documented memory tools, commands, viewer, or edit UI.** Implementation (memory files vs semantic store), per-session persistence mechanics on the VM, and any compaction are undisclosed. 🔍 Brian Lovin found the layer "quite opaque" and redirected his bots to a Notion DB as an external memory store (~20–30 pages written): https://brianlovin.com/writing/grok-bot-first-impressions-kcJun01

## 4. Routines / scheduled work ✅ (fully documented)
- **Create**: ask the owning Bot in natural language (docs give a verbatim example); the Bot creates the routine and shows its next run. Or **"Teach a task"**: record one browser workflow from the computer view → Bot produces a draft skill (recording ≤10 min, gradual rollout). https://docs.x.ai/grok-bot/skills-routines-and-automations, https://docs.x.ai/grok-bot/faq
- **Routine object**: name, instruction, *When to run*, Active toggle, Run history (**last 20 runs**; right-click → Copy request ID). **Max 50 routines per Bot.** https://cursor.com/help/grok-bot/routines.md
- **Trigger types**: (a) schedule + time zone; (b) **Slack listener** — channel + optional case-insensitive `containing` phrase; only messages *after* save count; thread replies ignored unless a phrase is set; (c) **webhook** — after save, routine shows `POST to` URL, `key`, and a ready `Authorization: Bearer <key>` header; JSON body is delivered to the Bot with the routine instruction; HTTP 200 = run accepted, not finished; (d) **Test run** (performs real actions); (e) Cursor account event integrations (e.g., GitHub).
- **A run** executes on the cloud computer (laptop can be closed), posts results into the conversation, and records success/failure in Run history. Manage via Bot → *View conversation details* → *Routines* (enable/pause/edit/test/delete). Failure checklist: enabled, schedule/TZ, owning Bot exists, plugins authed, source reachable, usage not paused. https://docs.x.ai/grok-bot/troubleshooting
- Recommended design: draft/reconcile first, keep send/purchase/delete/publish/production changes behind approval, define no-data/stale-data policy, idempotent retries.

## 5. The "computer" ✅
- **One persistent cloud VM per user account** (managed Linux per teams docs), shared by ALL Bots: shared `/workspace` dir, browser cookies/sessions, CLI credentials. *"Do not use separate Bots as a security boundary."* https://docs.x.ai/grok-bot/computer-and-apps, https://docs.x.ai/grok-bot/teams-and-enterprises
- Each Bot gets its own **screen** on that machine → parallel computer-use; **one computer-use task per screen at a time**. Screens are work surfaces, not security boundaries.
- Marketing says "each Bot has their own computer" — docs correct this to one shared account computer. ⚠️ resolved contradiction (https://www.digitalapplied.com/blog/grok-bot-ai-teammates-launch-cloud-computer-2026)
- **Watching**: *Agent Computer* from a conversation shows the shared desktop — clicks, typing, navigation, status. Design post describes 3 access levels: purple activity indicator → pinned preview → full-screen takeover. https://x.ai/news/designing-grok-bot
- **Takeover**: Bot hands control back for password/passkey, 2FA, CAPTCHA, payment/identity check, or human-only sites. Secrets go through a **masked secret card** — write-only, "never shown to your Bot," not written into chat; per-Bot *Secrets* section stores env-var name + description (value unreadable, "Filled into the page" status). https://cursor.com/help/grok-bot/secrets
- **Persistence/maintenance**: files, browser state, supported sign-ins survive updates/recovery; Settings → Beta has *Update Agent Computer* (rebuild, keeps durable state), *Recover Agent Computer* (replaces unreachable machine), *Reset Agent Computer* (last durable snapshot, may lose unsynced work).
- **Local computer** is a separate, opt-in capability: Settings → General → Agent → Execution on Local Computer = Ask every time (default) / Always / Never. https://docs.x.ai/grok-bot/approvals-security-and-privacy
- Teams: static egress IPs available; requires cloud storage (no Legacy Privacy Mode); org-wide audit view listed as "coming." https://docs.x.ai/grok-bot/teams-and-enterprises, 🔍 https://www.eesel.ai/blog/grok-bot-pricing
- Runtime capability: Bots can **create and supervise Cursor cloud agents** (read transcripts, check PR proofs, queue messages/interrupt runs). ✅ https://x.ai/bot/guides/grok-bot-for-engineering

## 6. Group chats / bot-to-bot ✅
- Group = **2–6 Bots**; create via New → select Bots (desktop) or + → New Group Chat (mobile); generated name/membership editable. https://docs.x.ai/grok-bot/chat-and-collaboration
- Turn-taking: write normally and **participating Bots decide who responds**; `@mention` to direct; `@everyone` for group-wide updates (use sparingly).
- Handoffs: Bot→Bot async DM wakes the receiver; Bots post into the group, pass work, assign ownership; all handoffs visible in the transcript. **Bot→group handoff messages are currently text-only** (images must go Bot→Bot). https://docs.x.ai/grok-bot/chat-and-collaboration
- Account cap: **50 Bots + group chats combined**. Docs advise a single owner per stage; "too many parallel handoffs create duplicate work and noisy updates." https://docs.x.ai/grok-bot/bots
- Patterns are user conventions, not built-ins: chief-of-staff + specialists (launch post), pods/task-file/approval-packet conventions (third-party). https://x.ai/news/introducing-grok-bot, 🔍 https://vismountain.com/how-to-make-ai-agents-work-together/
- ❓ "Talking circle": **no such term found** in official sources — the mechanism is the group chat above. The underlying turn-taking protocol/message-bus is **not publicly documented**.

## 7. Tasks / delegation
- Assignment = natural-language message with outcome, sources, constraints, deliverable, and **approval boundary** (docs give verbatim task templates). Bot description holds standing rules; messages hold task-specific instructions. https://docs.x.ai/grok-bot/bots
- Transcript shows **tool activity, computer use, created files, questions, approval requests** inline; threads keep feedback scoped; reactions = lightweight ack only. https://docs.x.ai/grok-bot/chat-and-collaboration
- Completion reporting = messages in the conversation + per-Bot notification ("finishes or needs input") + routine Run history. ❓ No dedicated task object/kanban/queue UI documented — users improvise with Notion boards/task files (guides).

## 8. UX shape ✅
- **Roster, not thread list**: sidebar of named Bots (name, avatar, title); pin/hide; `Cmd/Ctrl+N`; new Bots default to "New Agent"; Edit Profile = name/title/description/avatar. https://docs.x.ai/grok-bot/bots, https://x.ai/news/designing-grok-bot
- **Avatar = state indicator**: idle, thinking, working, waiting, blocked, done — conveyed by motion; hover reveals current action. Tool calls/thinking deliberately hidden (design decision; Lovin confirms). Officially three attention states: **needs attention** (question/approval/handoff), **unread**, **working/typing**; sidebar + dock badges; mark read/unread manually. 🔍 https://dennisyu.com/grok-bot-sidebar-icons/
- **Composer**: paste text/links/images, attach files, `/` = skills, `@` = Bots/groups/routines/connectors, reply-to, threads, reactions, send-while-working (queued/redirects), "Stop now."
- **Notifications**: per-Bot toggle ("Get notified when this Bot finishes or needs input"); suppressed while app focused (badges still show); iOS push "rolling out… may not yet be enabled for every account"; no group-chat-level switch. https://docs.x.ai/grok-bot/settings-and-notifications. Launch bugs: pushes not arriving, foreground silencing of other Bots' completions — acknowledged/fixed by staff. 🔍 https://forum.cursor.com/t/168245
- **Proactive first-messages**: Bots initiate contact via progress updates, approval/secret requests, routine results, completion alerts — always tied to a turn or trigger. ❓ No documented "bot spontaneously says hi" idle behavior.
- **Share links**: public link → preview on x.ai → "Add to Grok Bot" copies config only (no computer/logins/history/memory); shared Bots are third-party under separate terms. https://docs.x.ai/grok-bot/bots
- **Platforms**: desktop macOS + Windows, iOS; Android listed on Google Play in Cursor help and "coming soon" elsewhere; ⚠️ press claims Linux but official docs describe no Linux desktop app. Sync across devices; same thread on all surfaces. https://docs.x.ai/grok-bot/faq, https://cursor.com/help/grok-bot/mobile

## 9. Model / runtime
- **No model picker — by design**, for users or admins; "a fixed, published set of models" per surface with **automatic failover**; usage analytics show the actual serving model; billing follows it. ✅ https://docs.x.ai/grok-bot/teams-and-enterprises
- Frontier model in this window = **Grok 4.6** (x.ai/bot plan bullets list "Grok 4.6 model"; Musk said the beta would scale "after… releasing Grok 4.6 later this week" at launch). 🔍 500k-token context / Feb-1-2026 cutoff claims are third-party only. https://x.ai/bot, https://eu.36kr.com/en/p/3935913445784713, https://medium.com/@roanmonteiro/grok-bot-in-depth…
- ❓ Context-window/compaction behavior for Bot conversations is **undocumented**. (The grok-build CLI changelog mentions "recap and compaction," but that's the CLI, not Grok Bot.) https://x.ai/build/changelog

## 10. Key gaps (do NOT guess past these)
- Bot system prompt / orchestration prompts: **not published** (not in grok-prompts or anywhere public).
- Heartbeat/idle-loop existence, memory internals, group turn-taking protocol, per-Bot context/compaction, audit log: **undocumented**.
- Whether grok-build's scheduler/Computer Hub actually powers Grok Bot: plausible, **unverified**.

## 11. Actionable takeaways for a harness clone
1. Wake model = **trigger-driven** (schedule / Slack-phrase listener / webhook+Bearer / bot-DM / user DM), not a heartbeat — with an **inactivity governor** that pauses routines.
2. Durable unit = **named agent** (profile + memory + routines + conversation), separate from the **shared machine** (one VM/account, per-agent *screens* — surfaces, not security boundaries).
3. Routines as first-class objects: name, instruction, trigger spec, Active flag, 20-run history; bots can create their own.
4. Approval architecture: per-request boundaries in prompts + Auto-Review rules (Require-Approval beats Always-Allow) + masked write-only secret card + human-takeover for CAPTCHA/2FA/payment.
5. Presence UX: avatar-motion states (idle/thinking/working/waiting/blocked/done), 3 badge states (needs-attention/unread/working), hidden tool calls with hover-for-current-action, mid-task progress messages.
6. Group mechanics: ≤6 agents, self-selecting responder, @-routing, async wake-on-DM handoffs, text-only group handoffs, single-owner-per-stage guidance.
