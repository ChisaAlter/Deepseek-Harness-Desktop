# Right Panel Below Topbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the desktop workspace topbar spanning app-content while the right panel is open, start the panel below that bar, and close it only with the same topbar toggle.

**Architecture:** Lift `WorkspaceDesktopSoftTopbar` from `WorkspaceCenterColumn` to `workspace-screen.tsx` so it sits above the center/right `threePaneRow`. Strip the right panel's caption header and delete the `rightPanelHeader` window-controls padding role that existed only to share ─ □ × with that header.

**Tech Stack:** TypeScript, React Native / Expo, Electron, Vitest, oxfmt, oxlint, npm workspaces.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-13-right-panel-below-topbar-design.md`
- Desktop only. Do not change compact `ExplorerSidebar` or `WorkspaceScreenGateShell`.
- Left session rail stays full-height to the window top.
- Do not overlay the right panel with `top: 48` or any other caption-offset hack.
- Keep `visible ? rail : null` mount. Do not add overlay positioning or a new animation system.
- Keep rail width (`DEFAULT_EXPLORER_SIDEBAR_WIDTH` / `minWidth: 280` / `maxWidth: "42%"`), left border, background, and box shadow.
- Keep `SOFT_TOPBAR_ELECTRON_RIGHT_PAD` on the desktop topbar. Do not move caption reserve onto the right panel.
- Keep `workspace.rightPanel.close` as the toggle accessibility label when open. Do not delete i18n keys.
- Do not change browser / terminal / files / diff surface behavior, floating inspector exclusivity, or topbar actions other than remaining in the spanning strip.
- Run only changed Vitest files: `npx vitest run <path> --bail=1`. Never run the full suite locally.
- After code changes: `npm run typecheck`, `npm run lint -- <paths>`, `npm run format:files -- <paths>`.
- Real acceptance is Windows Electron only. Web preview is not desktop verification.
- Do not change `packages/app/e2e/helpers/file-explorer.ts`; it already opens the panel with `workspace-right-panel-toggle`.
- Do not commit unless the user explicitly asks. Skip every Commit step until then. Preserve unrelated dirty-worktree files.

---

## File Structure

- `prototypes/right-panel-below-topbar.html` — visual gate: closed vs open Windows chrome.
- `packages/app/src/utils/desktop-window.ts` — window-controls padding roles. Delete `rightPanelHeader`.
- `packages/app/src/utils/desktop-window.test.ts` — padding-role tests.
- `packages/app/src/screens/workspace/workspace-screen.tsx` — owns the lifted desktop topbar above `threePaneRow`.
- `packages/app/src/screens/workspace/workspace-center-column.tsx` — mobile `ScreenHeader` only; no desktop topbar.
- `packages/app/src/screens/workspace/workspace-right-panel.tsx` — rail + empty/surface body; no header row, no `onClose`.
- `packages/app/src/screens/workspace/workspace-header.tsx` — unchanged except it remains the topbar implementation (`SOFT_TOPBAR_ELECTRON_RIGHT_PAD` stays).
- `packages/app/src/screens/workspace/workbench-fidelity-style-boundaries.test.ts` — source-boundary lock for the new tree.

No new React components. `WorkspaceDesktopSoftTopbar` stays in `workspace-header.tsx`.

---

### Task 1: Land The HTML Prototype And Stop For Approval

**Files:**

- Create: `prototypes/right-panel-below-topbar.html`

**Interfaces:**

- Consumes: approved spec layout (topbar spans center + right; left rail full-height; panel has no header/close)
- Produces: a two-state Windows chrome prototype the user must approve before any app code changes

- [ ] **Step 1: Write the prototype file**

Create `prototypes/right-panel-below-topbar.html` with this exact content:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>右边栏在顶栏下方</title>
    <style>
      :root {
        --bg: #f6f7f9;
        --workspace: #fbfbfc;
        --surface: #ffffff;
        --text: #1e232b;
        --muted: #657081;
        --border: #dfe3e8;
        --surface-2: #e8eaee;
        --topbar-h: 48px;
        --caption-w: 138px;
        --left-w: 220px;
        --right-w: 320px;
        font-family: ui-sans-serif, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--text);
      }
      h1 {
        font-size: 16px;
        font-weight: 600;
        margin: 20px 24px 8px;
      }
      p {
        margin: 0 24px 16px;
        color: var(--muted);
        font-size: 13px;
      }
      .frames {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
        padding: 0 24px 24px;
      }
      .label {
        font-size: 12px;
        font-weight: 600;
        margin-bottom: 8px;
        color: var(--muted);
      }
      .window {
        height: 420px;
        border: 1px solid var(--border);
        background: var(--workspace);
        display: flex;
        overflow: hidden;
      }
      .left {
        width: var(--left-w);
        background: #f3f4f6;
        border-right: 1px solid var(--border);
        padding: 12px;
        font-size: 12px;
        color: var(--muted);
      }
      .main {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
      }
      .topbar {
        height: var(--topbar-h);
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 12px 0 16px;
        border-bottom: 1px solid var(--surface-2);
        flex-shrink: 0;
      }
      .title {
        flex: 1;
        font-size: 13.5px;
        font-weight: 500;
      }
      .tools {
        display: flex;
        gap: 4px;
        margin-right: 4px;
      }
      .icon {
        width: 28px;
        height: 28px;
        border-radius: 8px;
        display: grid;
        place-items: center;
        border: 1px solid transparent;
        color: var(--muted);
        font-size: 14px;
      }
      .icon.active {
        color: var(--text);
        background: #eceef1;
      }
      .caption {
        width: var(--caption-w);
        height: var(--topbar-h);
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        margin: -0px -12px 0 0;
        flex-shrink: 0;
      }
      .caption span {
        display: grid;
        place-items: center;
        font-size: 12px;
        color: #3b3f45;
      }
      .caption .close:hover {
        background: #e81123;
        color: #fff;
      }
      .body {
        flex: 1;
        min-height: 0;
        display: flex;
      }
      .center {
        flex: 1;
        min-width: 0;
        display: grid;
        place-items: center;
        color: var(--muted);
        font-size: 13px;
      }
      .rail {
        width: var(--right-w);
        border-left: 1px solid var(--border);
        background: var(--workspace);
        padding: 28px 16px 20px;
      }
      .rail h2 {
        margin: 0;
        font-size: 16px;
        text-align: center;
      }
      .rail p {
        margin: 6px 0 16px;
        text-align: center;
        font-size: 12.5px;
      }
      .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .card {
        border: 1px solid var(--border);
        background: var(--surface);
        border-radius: 14px;
        padding: 12px 12px 14px;
        font-size: 13.5px;
        font-weight: 500;
      }
      .card small {
        display: block;
        margin-top: 6px;
        font-size: 12px;
        font-weight: 400;
        color: var(--muted);
      }
    </style>
  </head>
  <body>
    <h1>右边栏在顶栏下方</h1>
    <p>
      左栏仍通到窗口顶。顶栏横跨中间区 + 右边栏，─ □ ×
      留在顶栏。右边栏没有「右侧面板」标题，也没有关闭按钮。
    </p>
    <div class="frames">
      <div>
        <div class="label">关闭</div>
        <div class="window">
          <div class="left">会话栏（通高）</div>
          <div class="main">
            <div class="topbar">
              <div class="title">ChisaCode / 新会话</div>
              <div class="tools">
                <div class="icon">&gt;_</div>
                <div class="icon">▣</div>
              </div>
              <div class="caption"><span>─</span><span>□</span><span class="close">×</span></div>
            </div>
            <div class="body"><div class="center">中间内容</div></div>
          </div>
        </div>
      </div>
      <div>
        <div class="label">打开</div>
        <div class="window">
          <div class="left">会话栏（通高）</div>
          <div class="main">
            <div class="topbar">
              <div class="title">ChisaCode / 新会话</div>
              <div class="tools">
                <div class="icon">&gt;_</div>
                <div class="icon active">▣</div>
              </div>
              <div class="caption"><span>─</span><span>□</span><span class="close">×</span></div>
            </div>
            <div class="body">
              <div class="center">中间内容</div>
              <aside class="rail">
                <h2>选择要打开的面板</h2>
                <p>选择面板</p>
                <div class="grid">
                  <div class="card">浏览器<small>在浏览器中打开工作区页面</small></div>
                  <div class="card">终端<small>打开工作区终端会话</small></div>
                  <div class="card">文件<small>浏览工作区文件</small></div>
                  <div class="card">变更<small>查看工作区变更与 PR</small></div>
                </div>
              </aside>
            </div>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>
```

- [ ] **Step 2: Open the prototype and wait**

Open `prototypes/right-panel-below-topbar.html` in a browser (file URL is enough). Show the user both frames. **Do not start Task 2 until the user approves this prototype.** If they want pixel tweaks, edit this file only and re-show it.

- [ ] **Step 3: Commit (only if the user asked to commit)**

```bash
git add prototypes/right-panel-below-topbar.html
git commit -m "$(cat <<'EOF'
Add a prototype for the right panel sitting below the desktop topbar.

EOF
)"
```

On Windows PowerShell, if heredoc is unavailable, use:

```powershell
git add prototypes/right-panel-below-topbar.html
git commit -m "Add a prototype for the right panel sitting below the desktop topbar."
```

---

### Task 2: Lock Source Boundaries With Failing Tests

**Files:**

- Modify: `packages/app/src/utils/desktop-window.test.ts`
- Modify: `packages/app/src/screens/workspace/workbench-fidelity-style-boundaries.test.ts`

**Interfaces:**

- Consumes: current `rightPanelHeader` role and `workspace-right-panel-close` header (still present until Task 3)
- Produces: failing tests that describe the approved tree: no `rightPanelHeader`, no panel close control, desktop topbar owned by `workspace-screen.tsx`

- [ ] **Step 1: Replace the rightPanelHeader tests**

In `packages/app/src/utils/desktop-window.test.ts`, delete the two tests:

- `"reserves caption width on the docked right-panel header only"`
- `"clears right-panel header padding when raw caption inset is zero"`

Add this test at the end of the `describe("resolveWindowControlsPadding"` block:

```typescript
it("does not expose a caption-sharing role for the right panel", () => {
  expect(
    resolveWindowControlsPadding({
      role: "titlebar",
      rawPadding,
      sidebarClosed: false,
      explorerOpen: false,
      focusModeEnabled: false,
    }),
  ).toEqual(rawPadding);

  const roles = ["sidebar", "header", "detailHeader", "tabRow", "explorerSidebar"] as const;
  for (const role of roles) {
    expect(
      resolveWindowControlsPadding({
        role,
        rawPadding,
        sidebarClosed: false,
        explorerOpen: true,
        focusModeEnabled: false,
      }),
    ).toEqual({ left: 0, right: 0, top: 0 });
  }
});
```

Do not pass `"rightPanelHeader"` as a `role` in this file. After Task 3 that member is gone and TypeScript would reject it.

- [ ] **Step 2: Assert the lifted topbar and headerless rail**

In `packages/app/src/screens/workspace/workbench-fidelity-style-boundaries.test.ts`, inside `"hosts production right panel surfaces and terminal drawer"`, add these assertions after the existing `workspace-right-panel-empty` check:

```typescript
expect(rightPanelSource).not.toContain('testID="workspace-right-panel-close"');
expect(rightPanelSource).not.toContain("rightPanelHeader");
expect(rightPanelSource).not.toContain("onClose");
expect(screenSource).toContain("WorkspaceDesktopSoftTopbar");
expect(centerSource).not.toContain("WorkspaceDesktopSoftTopbar");
expect(centerSource).toContain('testID="workspace-mobile-header-actions"');
```

Keep the existing `WorkspaceGitActions` / mobile header assertions. Do not remove `testID="workspace-right-panel-toggle"` from the header-chrome test; that toggle stays in `workspace-header.tsx`.

- [ ] **Step 3: Run the two test files and confirm they fail for the new assertions**

Run from the repo root:

```bash
npx vitest run packages/app/src/utils/desktop-window.test.ts --bail=1
npx vitest run packages/app/src/screens/workspace/workbench-fidelity-style-boundaries.test.ts --bail=1
```

Expected: `desktop-window.test.ts` still passes (the replacement test only uses existing roles). `workbench-fidelity-style-boundaries.test.ts` FAIL because `workspace-right-panel.tsx` still contains `workspace-right-panel-close` / `rightPanelHeader` / `onClose`, and `workspace-screen.tsx` does not yet contain `WorkspaceDesktopSoftTopbar`.

If the fidelity file is not picked up, run it from `packages/app`:

```bash
npx vitest run src/screens/workspace/workbench-fidelity-style-boundaries.test.ts --bail=1
```

- [ ] **Step 4: Commit (only if the user asked to commit)**

```bash
git add packages/app/src/utils/desktop-window.test.ts packages/app/src/screens/workspace/workbench-fidelity-style-boundaries.test.ts
git commit -m "test: lock right panel below the desktop topbar"
```

---

### Task 3: Lift The Topbar And Strip The Panel Header

**Files:**

- Modify: `packages/app/src/utils/desktop-window.ts`
- Modify: `packages/app/src/screens/workspace/workspace-right-panel.tsx`
- Modify: `packages/app/src/screens/workspace/workspace-center-column.tsx`
- Modify: `packages/app/src/screens/workspace/workspace-screen.tsx`

**Interfaces:**

- Consumes: `WorkspaceDesktopSoftTopbar` props already assembled as `workspaceCenterHeaderTitleBar` + `workspaceCenterHeaderRightControls` in `workspace-screen.tsx`
- Produces:
  - `resolveWindowControlsPadding` roles: `"titlebar" | "sidebar" | "header" | "detailHeader" | "tabRow" | "explorerSidebar"`
  - `WorkspaceRightPanelProps` with no `onClose`
  - Desktop tree: topbar sibling above `threePaneRow`; center column has no `WorkspaceDesktopSoftTopbar`

- [ ] **Step 1: Delete the rightPanelHeader role**

In `packages/app/src/utils/desktop-window.ts`:

1. Remove `"rightPanelHeader"` from `WindowControlsPaddingRole` and its JSDoc line.
2. Change the `resolveWindowControlsPadding` JSDoc `@returns` from `titlebar uses full raw insets, right-panel header uses right only` to `titlebar uses full raw insets; every other role gets zero`.
3. Delete this branch:

```typescript
// Docked right rail is full-height to the window edge; its 48px header shares the
// caption strip with DesktopWindowControls. Reserve raw.right (Win/Linux 138, else 0).
if (input.role === "rightPanelHeader") {
  return { left: 0, right: input.rawPadding.right, top: 0 };
}
```

The function must remain:

```typescript
export function resolveWindowControlsPadding(input: {
  role: WindowControlsPaddingRole;
  rawPadding: RawWindowControlsPadding;
  sidebarClosed: boolean;
  explorerOpen: boolean;
  focusModeEnabled: boolean;
}): RawWindowControlsPadding {
  if (input.role === "titlebar") {
    return input.rawPadding;
  }

  return { left: 0, right: 0, top: 0 };
}
```

- [ ] **Step 2: Strip the right panel header**

In `packages/app/src/screens/workspace/workspace-right-panel.tsx`:

1. Remove `onClose` from `WorkspaceRightPanelProps` and from the function parameters.
2. Remove `useWindowControlsPadding` import and the `windowControlsPadding` / `headerStyle` memos.
3. Remove `X` / `ThemedX` (keep `Pressable` for surface cards).
4. Replace the rail return with:

```tsx
return (
  <View style={styles.rail} testID="workspace-right-panel">
    {activeSurface == null ? (
      <RightPanelEmptyState cards={cards} onOpenSurface={onOpenSurface} />
    ) : (
      <RightPanelSurfaceBody
        activeSurface={activeSurface}
        serverId={serverId}
        workspaceId={workspaceId}
        workspaceRoot={workspaceRoot}
        showBrowserSurface={showBrowserSurface}
        terminalId={terminalId}
        browserId={browserId}
        isWorkspaceFocused={isWorkspaceFocused}
        visible={visible}
        onOpenFile={onOpenFile}
        onOpenFileExplorer={onOpenFileExplorer}
        onOpenWorkspaceFile={onOpenWorkspaceFile}
      />
    )}
  </View>
);
```

5. Keep `if (!visible) return null;`.
6. Delete `styles.header`, `styles.headerTitle`, and `styles.closeButton`.
7. Do not change `styles.rail`, empty-state, cards, or surface bodies.

- [ ] **Step 3: Stop rendering the desktop topbar inside the center column**

In `packages/app/src/screens/workspace/workspace-center-column.tsx`:

1. Remove `WorkspaceDesktopSoftTopbar` from the import from `@/screens/workspace/workspace-header`. Keep `WorkspaceHeaderRightControls` and `WorkspaceHeaderTitleBar`.
2. Delete the `desktopSoftTopbar` `useMemo` (the block that starts with `// Desktop topbar owns T3-style breadcrumb` and returns `<WorkspaceDesktopSoftTopbar ... />`).
3. In the returned JSX, delete `{desktopSoftTopbar}`. The desktop return stays `centerColumn` → optional mobile `ScreenHeader` → `centerContent` → environment rail.
4. Narrow `headerRight` so it only builds the mobile cluster. Replace the `isMobile` / desktop split with:

```tsx
const headerRight = useMemo(() => {
  if (!isMobile) {
    return null;
  }
  const openInCwd = isAbsolutePath(normalizedWorkspaceId) ? normalizedWorkspaceId : "";
  return (
    <View style={styles.mobileHeaderRight} testID="workspace-mobile-header-actions">
      {headerRightControls.isGitCheckout && openInCwd.length > 0 ? (
        <WorkspaceGitActions serverId={normalizedServerId} cwd={openInCwd} hideLabels />
      ) : null}
      <WorkspaceHeaderRightControls
        {...headerRightControls}
        isMobile
        isEnvironmentPanelVisible={isEnvironmentPanelVisible}
        createTerminalDisabled={isCreateTerminalPending}
        onCreateTerminal={headerTitleBar.onCreateTerminal}
      />
    </View>
  );
}, [
  headerRightControls,
  headerTitleBar.onCreateTerminal,
  isCreateTerminalPending,
  isEnvironmentPanelVisible,
  isMobile,
  normalizedServerId,
  normalizedWorkspaceId,
]);
```

Do not change `WorkspaceScreenGateShell`.

- [ ] **Step 4: Mount the desktop topbar above threePaneRow**

In `packages/app/src/screens/workspace/workspace-screen.tsx`:

1. Add this import next to the existing workspace screen imports:

```typescript
import { WorkspaceDesktopSoftTopbar } from "@/screens/workspace/workspace-header";
```

`getIsElectron` is already imported from `@/constants/platform`.

2. After `workspaceCenterHeaderRightControls`, add:

```tsx
const desktopSoftTopbar = !isMobile ? (
  <WorkspaceDesktopSoftTopbar
    {...workspaceCenterHeaderTitleBar}
    {...workspaceCenterHeaderRightControls}
    activeTarget={activeTarget}
    normalizedServerId={normalizedServerId}
    normalizedWorkspaceId={normalizedWorkspaceId}
    showCreateBrowserTab={getIsElectron()}
    createTerminalDisabled={isCreateTerminalPending}
    browserContextDockDisabled={!hasEnvironmentBrowserContext}
    isEnvironmentPanelVisible={isEnvironmentPanelVisible}
  />
) : null;
```

3. In `readyContent`, place it after `WorkspaceDocumentTitleEffectSlot` and before `threePaneRow`:

```tsx
          <WorkspaceDocumentTitleEffectSlot
            target={activeTarget}
            serverId={normalizedServerId}
            workspaceId={normalizedWorkspaceId}
            isRouteFocused={isRouteFocused}
          />
          {desktopSoftTopbar}
          <View style={styles.threePaneRow}>
```

4. Remove `onClose={handleCloseRightPanel}` from `<WorkspaceRightPanel>`. Keep `handleCloseRightPanel` in `useWorkspaceLayoutChrome` — the topbar toggle still closes through `onToggleRightPanel`.
5. Do not wrap the topbar inside `threePaneRow`. Do not put it inside `FloatingPanelPortalHostNameProvider`.

- [ ] **Step 5: Re-run the Task 2 tests**

```bash
npx vitest run packages/app/src/utils/desktop-window.test.ts --bail=1
npx vitest run packages/app/src/screens/workspace/workbench-fidelity-style-boundaries.test.ts --bail=1
```

Expected: both PASS.

- [ ] **Step 6: Typecheck, lint, and format the touched files**

```bash
npm run typecheck
npm run lint -- packages/app/src/utils/desktop-window.ts packages/app/src/utils/desktop-window.test.ts packages/app/src/screens/workspace/workspace-right-panel.tsx packages/app/src/screens/workspace/workspace-center-column.tsx packages/app/src/screens/workspace/workspace-screen.tsx packages/app/src/screens/workspace/workbench-fidelity-style-boundaries.test.ts
npm run format:files -- packages/app/src/utils/desktop-window.ts packages/app/src/utils/desktop-window.test.ts packages/app/src/screens/workspace/workspace-right-panel.tsx packages/app/src/screens/workspace/workspace-center-column.tsx packages/app/src/screens/workspace/workspace-screen.tsx packages/app/src/screens/workspace/workbench-fidelity-style-boundaries.test.ts prototypes/right-panel-below-topbar.html
```

Fix any errors in these files. Do not silence unused `handleCloseRightPanel` by deleting it from the chrome hook; it is still returned for callers. If `workspace-screen.tsx` now has an unused `handleCloseRightPanel` binding, stop destructuring it there and leave it on the hook.

- [ ] **Step 7: Commit (only if the user asked to commit)**

```bash
git add packages/app/src/utils/desktop-window.ts packages/app/src/screens/workspace/workspace-right-panel.tsx packages/app/src/screens/workspace/workspace-center-column.tsx packages/app/src/screens/workspace/workspace-screen.tsx
git commit -m "fix: keep the desktop topbar above the right panel"
```

---

### Task 4: Verify On Windows Electron

**Files:**

- None, unless verification finds a regression. Then fix in the files from Task 3 and re-run Task 3 Step 5–6.

**Interfaces:**

- Consumes: packaged or `npm run dev:desktop` Electron window on Windows
- Produces: a pass/fail list against the spec acceptance bullets. Label anything not run on Electron as unverified.

- [ ] **Step 1: Launch the real desktop app**

Use the Windows Electron app, not the web preview. After app/desktop source changes, if testing a packaged build, rebuild app dist then desktop `tsc` before launching. For local desktop dev, `npm run dev:desktop` is enough.

- [ ] **Step 2: Check the four acceptance bullets**

1. Panel closed: topbar toggle sits left of ─ □ ×. No right panel.
2. Panel open on empty state: topbar still full-width across the panel; toggle does not jump; panel content starts below the 48px bar; no「右侧面板」row; no × in the panel. Empty copy is still「选择要打开的面板」.
3. Open Files (or any surface), click the same topbar toggle: panel closes.
4. Drag the window from the topbar, including the strip above the open panel. ─ □ × still click.

- [ ] **Step 3: Record the result**

If all four pass on Electron, the plan is done. If any fail, fix Task 3 files, re-run the Vitest files, and re-check Electron. Do not report web-browser screenshots as desktop verification.

- [ ] **Step 4: Commit (only if the user asked to commit)**

No extra files expected. If fixes landed, commit them with a message that names the verification bug, for example `fix: keep topbar drag above the open right panel`.
