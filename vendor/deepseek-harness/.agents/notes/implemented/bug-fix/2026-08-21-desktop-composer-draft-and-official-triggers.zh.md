# Agent Note: 桌面输入框草稿查找与官方触发器

Status: implemented

[English](2026-08-21-desktop-composer-draft-and-official-triggers.md) | 中文

## 问题

Files 的「引用到输入框」、终端的加入对话、Browser 的保存进对话都经 `appendToDraft` 写输入框。这些插件的 `inject` 只有 `slots`／`locale`（终端还有 `layout`），没有 `sessions`。在该 fiber 上读 `ctx.sessions` 会抛 `cannot get property "sessions" without inject`，写入崩溃。桌面还在官方 ui-reference 之外注册了第二套 `@` 来源（`name: 'path'`），InputBar 也在官方 `/` 之外打开本地 `$` 技能菜单。

## 决策

ui-files、ui-preview、ui-user-terminal 的 `appendToDraft` 读 `ctx.get('sessions')`，没有该服务就返回 false。插件顶层 `inject` 不加 `sessions`，没有会话时面板仍能挂载。

ui-files 不注册 `path` input-trigger 来源。输入框 `@` 是官方 ui-reference（`name: 'reference'`）。Files 的 Mention 按钮和 `application/x-dshd-composer-mention` 拖拽保留。dshbot 的 `@` 成员来源（`name: 'dshbot'`）不变。

InputBar 没有 `listSkillNames`，也没有本地 `$` 菜单。技能只用官方 `/`（ui-skill）。

## 曾考虑的替代方案

**把 `sessions` 加进插件 `inject`。** 否决：Files／preview／terminal 面板必须在没有会话时也能挂载；inject 会推迟或弄挂这些 fiber。

**保留桌面 `@` path 菜单与 ui-reference 并存。** 否决：两套 `@` 来源。

**保留 InputBar 的 `$` 菜单与官方 `/` 并存。** 否决：两个技能入口。

## 后果

Mention、拖拽、加入对话能在 session-maybe fiber 上写入草稿。键入 `@` 不再把工作区当作第二套来源遍历。键入 `$` 不会打开技能菜单。

## 测试

三包 `draft.client.spec.ts`：`ctx.sessions` 无 inject 即抛，`ctx.get('sessions')` 仍能写入；缺少 `get('sessions')` 返回 false。ui-files apply 钉住没有 `name: 'path'` 来源。InputBar 钉住 `$fo` 打不出 menuitem。`post-merge-desktop-ui.e2e.ts` 对 `note.md` 点 Mention，断言输入框有 `[note.md](note.md)` 且控制台 tripwire 为空，并断言键入 `@` 后没有 `[data-source="path"]`。release-ui-walk 把 `files.mentionAppended` 列为必过。

## 相关

[右边栏与终端工作环](../feature/2026-08-16-surfaces-terminal-work-loops.zh.md)。[远程配对放在设置旁边的手机控件上](../feature/2026-08-14-settings-remote-section.zh.md)。[桌面组装手机 Remote 网关](../feature/2026-08-22-desktop-phone-remote.zh.md)。[Web 文件与会话引用](../feature/2026-07-27-web-file-and-session-references.md)。
