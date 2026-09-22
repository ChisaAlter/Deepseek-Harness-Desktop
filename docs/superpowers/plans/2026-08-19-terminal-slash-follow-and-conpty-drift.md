# Terminal slash-follow and ConPTY drift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do **not** commit unless the user asks.

**Goal:** Make CodeBuddy `/` menu selection follow Up/Down with a visible info-fill bar on the chosen command row (not the `> /mod` prompt, not a stuck first suggestion), without regressing wallpaper glass or flooding TUI bold.

**Architecture:** Stop inferring the selected row from SGR bold/dim/fg on a 2+ item menu. Match menu rows by text (`/model:lite` allowed; `> /mod` rejected). The selected index is the pane's arrow tracker, clamped to the current match count. Paint that one DomRenderer row plus the sibling overlay bar above glyph spans. Wallpaper glass and inverse-video CSS stay as they are. Align Windows `ptySpawnOptions` with the shipped ConPTY note (`useConptyDll` unset) so live SGR matches T3code; the overlay still exists because 12% frost washes Ink info-vs-secondary.

**Tech Stack:** `@xterm/xterm` 6 DomRenderer, Electron `src/main/pty.js` node-pty, vitest/jsdom `ui-user-terminal` tests, node:test `pty.test.js`.

**Spec:** User-visible contract from live screenshots plus [2026-08-19-terminal-tui-selected-row-bold-fill.md](../../vendor/deepseek-harness/.agents/notes/implemented/bug-fix/2026-08-19-terminal-tui-selected-row-bold-fill.md) and [2026-08-18-terminal-canvas-app-background.md](../../vendor/deepseek-harness/.agents/notes/implemented/bug-fix/2026-08-18-terminal-canvas-app-background.md). This plan supersedes heuristic-first selection in that TUI note.

## Global Constraints

- Tokens / `ui-primitives` only; do not copy `marketplace.css` hex.
- Do not import `xterm.css` (`.xterm-viewport { background-color: #000 }` recreates the gray slab).
- Do not restyle every `.xterm-bold`.
- Do not thicken wallpaper frost as a substitute for the selected bar.
- Do not paint CSS backgrounds onto `.xterm-screen canvas`.
- Appearance wallpaper row stays pick / browse / crop / frost / pixelate; this plan does not touch gallery.
- Windows PTY remains `powershell.exe -NoLogo -NoProfile`.
- TDD: failing test first; watch RED; minimal production code; GREEN.
- Work on the current workspace. Do not commit unless the user asks.
- After CSS/TS changes: `pnpm --filter @deepseek-ai/dsh-client-ui-user-terminal bundle`, then `Get-Process electron | Stop-Process -Force` and `npm start` from repo root (single-instance lock). User must open a **new PTY**.

## Out of scope

- Wallpaper gallery window, Bing/Wallhaven catalogs, Appearance source lists.
- GPU terminal embedding, worktree, turn-diff, PiP, jump-to-line.
- Caching xterm across remounts (deferred in the ConPTY note).
- Enabling `allowProposedApi` / `registerDecoration`.
- Restyling CodeBuddy itself.

## File map

- Modify: `vendor/deepseek-harness/packages/client/ui-user-terminal/src/client/tui-selected-row.ts` — matchers, `selectSlashMenuRows` index-first for 2+ when `fallbackIndex` is passed.
- Modify: `vendor/deepseek-harness/packages/client/ui-user-terminal/src/client/TerminalPane.tsx` — `keydown` (capture), clamp index, do not reset to 0 on every count flicker.
- Modify: `vendor/deepseek-harness/packages/client/ui-user-terminal/tests/tui-selected-row.client.spec.ts` — screenshot-replica tests.
- Modify: `vendor/deepseek-harness/packages/client/ui-user-terminal/tests/terminal-drawer.client.spec.tsx` — host `KeyboardEvent` moves the bar.
- Modify: `src/main/pty.js` + `src/main/pty.test.js` — drop `useConptyDll: true` to match the shipped note.
- Modify: TUI selected-row Agent Note pair (Decision currently still describes heuristic-first; code is drifting).
- Do not modify: `TerminalWorkspace.module.css` stacking (`isolation` / pane `z-index: 0` / overlay `z-index: 2`) unless a new test proves the bar is behind glyphs.

## Frozen (do not reopen)

- Alpha-0 `theme.background`, `--dsw-alias-terminal-pane` 12% frost, no canvas CSS fill.
- Inverse `.xterm-bg-257` / `.xterm-fg-257` info-fill.
- ConPTY DA1 one-shot handler in `conpty-da.ts` (keep even if the DLL is omitted; replay buffers still contain `CSI c`).

## Live evidence this plan is answering

Screenshot 2026-08-19: blue bar on `> /mod` or on the first suggestion `/model`; Down does not move it onto `/model:lite`. CodeBuddy `InputSuggestionsMenu` uses Ink `bold` + `colors.info`, `showIndicator: false`, labels like `/model:lite`. `src/main/pty.js` still sets `useConptyDll: true` while [2026-08-18-terminal-conpty-oneshot-no-dll.md](../../vendor/deepseek-harness/.agents/notes/implemented/bug-fix/2026-08-18-terminal-conpty-oneshot-no-dll.md) says omit it.

**Tick 1 (2026-08-19 13:06+08, vs tree):** Task 1 index-first is in `selectSlashMenuRows` (lines 81–84) and the screenshot test `uses the arrow index even when the first menu row is undimmed` exists. Task 2 is **not** done: `TerminalPane.tsx` still resets `slashIndex = 0` on any `slashCount` change (lines 116–121) and `keydown` is bubble-only (`addEventListener('keydown', onSlashArrow)` without `true`). Task 3 still has `useConptyDll: true`. Drawer test `moves the slash selected bar on ArrowDown` is absent. Do not mark Task 1 complete until Task 5 live fetch + new-PTY Down-arrow.

## Adversarial review (tick 0)

These attacks must stay true after implementation. Later `/loop` ticks re-run this list against git + the live files.

1. **Count-flicker pin (current code).** `paintSelected` sets `slashIndex = 0` on any `slashCount` change. A wrap that briefly matches 5 then 6 rows resets the bar to `/model` every frame. **Fix:** clamp `slashIndex`; reset to 0 only when the menu crosses the open threshold (`< 2` ↔ `>= 2`).
2. **Heuristic override (fixed in WIP, must not regress).** `paintTuiSelectedRows` always passes `fallbackIndex` for 2+ rows. `selectSlashMenuRows` must use that index *before* bold/dim/fg. The test `uses the arrow index even when the first menu row is undimmed` is the screenshot lock. If someone "helps" by painting undimmed rows again, the bar sticks on `/model`.
3. **Prompt vs menu.** `> /mod` must never match. `/model:lite` must match (`:` in the token). `MENU_COMMAND` can still match `lite  Set` inside a description; keep slash-token match primary so we count one row per command.
4. **Double-step.** Do not attach both `term.onKey` and `host keydown` for arrows. One listener. Use `keydown` on the pane host with `capture: true` so the xterm textarea cannot hide the event.
5. **Desync with CodeBuddy.** We paint our index; CodeBuddy paints its own. They stay aligned only if both start at 0 and both step once per ArrowDown. Missing a key leaves the bar one row off; double-step skips a row. No SGR sync to "correct" this — that is what pinned row 0.
6. **Mouse / Home / End.** Out of scope unless a later tick shows users need it. Do not pretend arrows cover click-to-select.
7. **jsdom ≠ Electron.** A passing `selectSlashMenuRows` test is not a live fix. Done means: bundled `lib/client.js` contains the index-first branch, `http://127.0.0.1:3080/plugins/@deepseek-ai/dsh-client-ui-user-terminal/client.js` matches, Electron was killed (not single-instance no-op), **new PTY**, Down moves the bar onto `/model:lite`.
8. **DLL drift.** Tests currently `assert.equal(options.useConptyDll, true)`. The Agent Note says unset. Shipping both is a lie. This plan omits the DLL (T3code). Do not "fix" highlight by turning the DLL back on and guessing SGR.
9. **Wallpaper.** Any import of `xterm.css` or canvas `background` fails the drawer CSS tests. Do not "help" by darkening frost.
10. **Stale Agent Note.** Decision text still says bold → undimmed → minority fg → fallback. After this plan it must say: 2+ menu + caller index wins.

---

### Task 1: Index wins over undimmed (screenshot lock)

**Files:**
- Modify: `vendor/deepseek-harness/packages/client/ui-user-terminal/src/client/tui-selected-row.ts`
- Test: `vendor/deepseek-harness/packages/client/ui-user-terminal/tests/tui-selected-row.client.spec.ts`

**Interfaces:**
- Consumes: `SlashRowProbe`, `isSlashCommandRow`
- Produces: `selectSlashMenuRows(rows, fallbackIndex?: number): boolean[]` — for `slash.length >= 2` and `fallbackIndex !== undefined`, exactly one `true` at `slash[clamped].index`.

- [ ] **Step 1: Confirm the screenshot test exists and would fail on heuristic-first code**

Lock this exact case (prompt ignored, first command undimmed, index `1` is `/model:lite`):

```ts
it('uses the arrow index even when the first menu row is undimmed', () => {
  expect(selectSlashMenuRows([
    { text: '> /mod', bold: false, dim: false, fgKey: 'fg:4' },
    { text: '/model  Set or list AI models', bold: false, dim: false, fgKey: 'fg:4' },
    { text: '/model:lite  Set or list the lite', bold: false, dim: true, fgKey: 'fg:7' },
    { text: '/model:reasoning  Set or list reasoning', bold: false, dim: true, fgKey: 'fg:7' },
  ], 1)).toEqual([false, false, true, false])
})
```

Also lock `isSlashCommandRow('> /mod') === false` and `isSlashCommandRow('/model:lite  Set or list the lite') === true`.

- [ ] **Step 2: Run RED if the index-first branch is missing**

Run: `pnpm exec vitest run packages/client/ui-user-terminal/tests/tui-selected-row.client.spec.ts -t "uses the arrow index even when the first menu row is undimmed"`

Expected if heuristics run first: `[false, true, false, false]` (paints `/model`). Expected after the fix: `[false, false, true, false]`.

- [ ] **Step 3: Keep index-first in `selectSlashMenuRows`**

Immediately after `slash.length === 1` handling:

```ts
if (fallbackIndex !== undefined) {
  const clamped = Math.min(Math.max(0, fallbackIndex), slash.length - 1)
  selected[slash[clamped].index] = true
  return selected
}
```

Bold/dim/fg stay only for callers that omit `fallbackIndex`. `paintTuiSelectedRows` already passes `fallbackIndex` when `slashCount >= 2`.

- [ ] **Step 4: GREEN for the whole selected-row spec**

Run: `pnpm exec vitest run packages/client/ui-user-terminal/tests/tui-selected-row.client.spec.ts`

Expected: all tests PASS. Update any `paintTuiSelectedRows(host)` 2-row cases to pass an explicit index (default `0` is first menu row, not "undimmed").

---

### Task 2: Host ArrowDown moves the painted row

**Files:**
- Modify: `vendor/deepseek-harness/packages/client/ui-user-terminal/src/client/TerminalPane.tsx`
- Test: `vendor/deepseek-harness/packages/client/ui-user-terminal/tests/terminal-drawer.client.spec.tsx`

**Interfaces:**
- Consumes: `paintTuiSelectedRows(host, overlay, slashIndex)`, `stepSlashIndex(count, index, delta)`
- Produces: pane host `keydown` listener (capture); `slashIndex` clamped; reset to `0` only when menu open-state flips.

- [ ] **Step 1: Write the failing drawer test**

After the existing "paints a bold slash-command row when xterm mutates the pane host" test, add one that plants two menu rows then dispatches `ArrowDown` on the pane `role=log` host:

```tsx
it('moves the slash selected bar on ArrowDown', async () => {
  mount({ cwd: '/work' })
  fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
  const log = await screen.findByRole('log', { name: 'pty-1' })
  log.style.setProperty('--dsw-alias-button-info-fill', 'rgb(65, 118, 230)')
  log.innerHTML = [
    '<div class="xterm-rows">',
    '<div><span>&gt; /mod</span></div>',
    '<div><span>/model  Set or list</span></div>',
    '<div><span>/model:lite  Set or list the lite</span></div>',
    '</div>',
  ].join('')
  await waitFor(() => {
    const rows = [...log.querySelectorAll('.xterm-rows > div')] as HTMLElement[]
    expect(rows[1]?.hasAttribute('data-dsh-tui-selected')).toBe(true)
  })
  fireEvent.keyDown(log, { key: 'ArrowDown' })
  await waitFor(() => {
    const rows = [...log.querySelectorAll('.xterm-rows > div')] as HTMLElement[]
    expect(rows[1]?.hasAttribute('data-dsh-tui-selected')).toBe(false)
    expect(rows[2]?.hasAttribute('data-dsh-tui-selected')).toBe(true)
  })
})
```

If the listener is not on `host` or capture is missing, this stays on `/model`.

- [ ] **Step 2: Run RED**

Run: `pnpm exec vitest run packages/client/ui-user-terminal/tests/terminal-drawer.client.spec.tsx -t "moves the slash selected bar on ArrowDown"`

Expected: FAIL — first row stays selected after `ArrowDown`, or the test times out.

- [ ] **Step 3: Wire capture `keydown` and clamp; do not reset on flicker**

Replace count-change reset with:

```ts
const paintSelected = (): void => {
  const painted = paintTuiSelectedRows(host, overlayRef.current, slashIndex)
  const wasOpen = slashCount >= 2
  const isOpen = painted.slashCount >= 2
  slashCount = painted.slashCount
  if (!wasOpen && isOpen) slashIndex = 0
  if (!isOpen) slashIndex = 0
  else if (slashIndex >= slashCount) slashIndex = slashCount - 1
  if (isOpen && painted.selectedIndex !== slashIndex) {
    paintTuiSelectedRows(host, overlayRef.current, slashIndex)
  }
}
host.addEventListener('keydown', onSlashArrow, true)
```

Cleanup must `removeEventListener('keydown', onSlashArrow, true)` (same capture flag). Do not also `term.onKey` for arrows.

- [ ] **Step 4: GREEN drawer + selected-row**

Run: `pnpm exec vitest run packages/client/ui-user-terminal/tests`

Expected: all PASS (currently ~114+).

---

### Task 3: Omit `useConptyDll` (note vs code drift)

**Files:**
- Modify: `src/main/pty.js` (`ptySpawnOptions`)
- Test: `src/main/pty.test.js`

**Interfaces:**
- Consumes: node-pty spawn options
- Produces: Windows `{ useConpty: true }` with `useConptyDll` **absent**

- [ ] **Step 1: Flip the existing assertion to the shipped note**

In `src/main/pty.test.js` the line that today is `assert.equal(options.useConptyDll, true)` becomes:

```js
assert.equal(options.useConpty, true)
assert.equal('useConptyDll' in options, false)
```

- [ ] **Step 2: Run RED**

Run: `node --test src/main/pty.test.js` from `C:\Ai\Deepseek-Harness-Desktop`

Expected: FAIL — `useConptyDll` is still `true`.

- [ ] **Step 3: Match T3code spawn**

```js
...(platform === 'win32' ? { useConpty: true } : {}),
```

Keep `attachConptyDeviceAttributes` (replayed `CSI c` still exists).

- [ ] **Step 4: GREEN**

Run: `node --test src/main/pty.test.js`

Expected: PASS.

---

### Task 4: Agent Note matches shipped selection rules

**Files:**
- Modify: `vendor/deepseek-harness/.agents/notes/implemented/bug-fix/2026-08-19-terminal-tui-selected-row-bold-fill.md`
- Modify: matching `.zh.md`
- Pairing: `pnpm run verify-translation-pairing --write .agents/notes/implemented/bug-fix/2026-08-19-terminal-tui-selected-row-bold-fill.md`

**Interfaces:** none.

- [ ] **Step 1: Rewrite Decision to present tense**

Replace heuristic-first wording with: a 2+ slash menu uses the caller index; prompt lines are excluded; colon command names match; overlay stacks above `backdrop-filter`; `keydown` capture on the pane host; wallpaper owned by the canvas note.

- [ ] **Step 2: Re-record pairing**

Run from `vendor/deepseek-harness`:

`pnpm run verify-translation-pairing --write .agents/notes/implemented/bug-fix/2026-08-19-terminal-tui-selected-row-bold-fill.md`

Then the same command without `--write`. Expected: consistent.

---

### Task 5: Bundle, restart, live proof (not optional)

**Files:** `lib/client.js` via tsdown only.

- [ ] **Step 1: Bundle**

Run: `pnpm --filter @deepseek-ai/dsh-client-ui-user-terminal bundle` from `vendor/deepseek-harness`

- [ ] **Step 2: Prove the served file, not just disk**

After `Get-Process electron | Stop-Process -Force` and `npm start` from repo root, fetch `http://127.0.0.1:3080/plugins/@deepseek-ai/dsh-client-ui-user-terminal/client.js` and require all of:

- `PROMPT_LINE`
- `fallbackIndex !== undefined` before `.xterm-dim` selection (index-first)
- `addEventListener("keydown"` (or `'keydown'`)

If 3080 still lacks them, the app is the old instance (single-instance lock) or a stale profile copy.

- [ ] **Step 3: Human check (the only completion gate for "arrows work")**

New PTY → `codebuddy` → `/mod` → Down. Pass: bar on `/model:lite` (or whichever item is second). Fail: bar still on `> /mod` or still on `/model`. On fail, dump `.xterm-rows > div` `textContent` via Electron CDP (`--remote-debugging-port=9229`); do not guess another CSS token.

---

## Self-review

- Spec coverage: prompt exclusion, colon names, index-over-heuristics, arrow listener, count-flicker, ConPTY DLL drift, wallpaper freeze, live bundle protocol — each has a task.
- Placeholder scan: no TBD; live proof is an explicit fetch + human Down-arrow.
- Type consistency: `fallbackIndex` is `number | undefined`; `stepSlashIndex(count, index, delta)` unchanged.
- Commit steps omitted on purpose (user must ask).
