# ChisaCode Skills

> Languages: [English](#english) | [简体中文](#简体中文)

## English

ChisaCode skills teach coding agents how to use ChisaCode itself. They are
instructions for agents, not commands for people to run directly.

Use them when you want an agent to hand off work, ask another model for advice,
run a long loop, create a committee, or execute a large task through a structured
multi-agent flow.

### Install

The desktop app can install or update the bundled skills from Settings >
Integrations. That is the recommended path because it syncs the same skill set
shipped with the app.

After installation, skills are available to supported agent runtimes such as
Codex, Claude Code, and compatible skill loaders.

If you install skills manually from GitHub, use the repository slug:

```bash
npx skills add ChisaAlter/ChisaCode
```

### Core Skills

`chisacode`

Reference skill for creating agents, managing worktrees, sending prompts,
discovering providers, and checking daemon state. Other ChisaCode skills build
on this one.

`chisacode-advisor`

Starts one separate agent for a second opinion. Use it when you want review,
pushback, or a focused answer without handing off implementation.

`chisacode-committee`

Starts two contrasting agents to analyze a problem from different angles. Use it
for unclear failures, architecture tradeoffs, or plans that need adversarial
review before implementation.

`chisacode-handoff`

Transfers work to another agent with the context needed to continue. Use it when
one provider is better suited for the next phase, such as planning with one model
and implementing with another.

`chisacode-loop`

Runs an agent repeatedly against an exit condition. Use it for long-running
repair loops, flaky checks, or tasks that need iteration until clear acceptance
criteria pass.

`chisacode-epic`

Runs a heavy, resumable orchestration flow for large work: research, planning,
review, implementation, audit, and delivery. Use it for work that spans many
files or packages and may run for hours.

`chisacode-orchestrate`

Compatibility alias for the epic flow. Prefer `chisacode-epic` in new prompts.

### Choosing A Skill

- Use `chisacode-advisor` for a single second opinion.
- Use `chisacode-committee` when disagreement and root-cause analysis are useful.
- Use `chisacode-handoff` when another agent should continue the work.
- Use `chisacode-loop` when the same task should repeat until a condition passes.
- Use `chisacode-epic` for large, multi-phase work that needs a persistent plan.

For small edits, you usually do not need a skill. Ask the active agent directly.

### Provider Preferences

Orchestration skills choose providers by role. A planning agent, implementation
agent, UI agent, research agent, and audit agent may use different providers.

Configure these preferences once in ChisaCode. After that, skills can dispatch
the right kind of agent without hardcoding provider names in every prompt.

### Example Prompts

Ask for advice:

```text
Use chisacode-advisor to review this migration plan.
```

Hand off implementation:

```text
Use chisacode-handoff and send this bugfix to a Codex implementation agent.
```

Run a loop:

```text
Use chisacode-loop until the changed test file passes.
```

Run a large task:

```text
Use chisacode-epic --worktree to build the new provider settings flow end to end.
```

### Operational Notes

Skills create real ChisaCode agents. Those agents may take minutes or hours and
may continue in the background.

When a skill creates a worktree, keep related implementation inside that
worktree. When a skill launches an audit agent, treat it as read-only unless the
skill says otherwise.

If a skill appears missing or stale, return to Settings > Integrations and update
the bundled skills.

## 简体中文

ChisaCode skills 是给 coding agent 读取的说明，用来教 agent 如何使用 ChisaCode 本身。
它们不是给人直接执行的命令。

当你希望 agent 交接工作、请另一个模型给建议、持续循环执行、组建委员会，或者用结构化
多 agent 流程完成大任务时，就可以使用这些技能。

### 安装

桌面端可以在 Settings > Integrations 里安装或更新内置技能。推荐使用这个入口，
因为它会同步桌面端随包发布的同一套技能。

安装后，技能会被支持的 agent 运行时读取，例如 Codex、Claude Code，以及兼容技能加载机制的工具。

如果你要从 GitHub 手动安装技能，使用仓库 slug：

```bash
npx skills add ChisaAlter/ChisaCode
```

### 核心技能

`chisacode`

基础参考技能，说明如何创建 agent、管理 worktree、发送提示、发现 provider、检查 daemon 状态。
其他 ChisaCode 技能都会基于它工作。

`chisacode-advisor`

启动一个独立 agent 给第二意见。适合需要评审、反驳、补充判断，但还不想把实现工作交出去的场景。

`chisacode-committee`

启动两个视角不同的 agent 一起分析问题。适合不清楚根因、架构取舍明显，或者计划需要先做对抗性评审的场景。

`chisacode-handoff`

把工作和必要上下文交给另一个 agent 继续。适合不同阶段使用不同 provider，
例如先让一个模型规划，再交给另一个模型实现。

`chisacode-loop`

围绕退出条件重复运行 agent。适合长时间修复、处理不稳定检查，或者需要不断迭代直到验收条件通过的任务。

`chisacode-epic`

用于大型任务的重流程编排：研究、计划、评审、实现、审计和交付。适合跨多个文件或包、
可能运行数小时的工作。

`chisacode-orchestrate`

兼容旧名称的入口，等价于 epic 流程。新提示里优先使用 `chisacode-epic`。

### 怎么选

- 只需要一个第二意见，用 `chisacode-advisor`。
- 希望不同视角互相挑战、找根因，用 `chisacode-committee`。
- 想让另一个 agent 接着做，用 `chisacode-handoff`。
- 希望同一任务循环直到条件通过，用 `chisacode-loop`。
- 面向大型、多阶段、需要持久计划的任务，用 `chisacode-epic`。

小改动通常不需要技能，直接让当前 agent 做即可。

### Provider 偏好

编排技能会按角色选择 provider。规划、实现、UI、研究和审计 agent 可以使用不同 provider。

你只需要在 ChisaCode 里配置一次这些偏好。之后技能就能按角色派发合适的 agent，
不用在每条提示里硬编码 provider 名称。

### 示例提示

请求建议：

```text
Use chisacode-advisor to review this migration plan.
```

交接实现：

```text
Use chisacode-handoff and send this bugfix to a Codex implementation agent.
```

运行循环：

```text
Use chisacode-loop until the changed test file passes.
```

执行大型任务：

```text
Use chisacode-epic --worktree to build the new provider settings flow end to end.
```

### 运行注意事项

技能会创建真实的 ChisaCode agent。这些 agent 可能运行几分钟，也可能运行数小时，
并且可能在后台继续执行。

如果技能创建了 worktree，相关实现应保持在该 worktree 内。如果技能启动的是审计 agent，
默认把它当成只读角色，除非技能明确要求它修改代码。

如果技能缺失或版本过旧，回到 Settings > Integrations 更新内置技能。
