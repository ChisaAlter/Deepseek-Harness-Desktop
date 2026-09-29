# Boot-to-desktop reveal verification

Date: 2026-09-29. Scope: source-only `boot-page` repair, not installer or release acceptance.

## Cause and repair

The old source-over transition faded both surfaces, exposing the underlying window color. Its fixed main-process timeout could hide boot independently of renderer readiness. The new reveal keeps boot opaque, awaits desktop chrome and full-size layout, then fades only the desktop with twice the baseline motion duration. Renderer completion precedes boot cover. Reduced motion cuts directly; cancellation and injection/animation failure must not hide the next boot page or leave a transparent desktop.

## Evidence

- `node --test src/main/window-harness-cover.test.js src/renderer/boot-recovery.test.js src/main/harness-controller.test.js`: 75 passed, 0 failed. Includes deferred chrome, renderer completion, CSS failure, cancellation before/during fade, and animation failure cleanup.
- `probe.cjs`: executes the production reveal snippet in real Electron with isolated light/dark/reduced-motion fixtures. Run the repository Electron binary with this file and `ELECTRON_RUN_AS_NODE` unset.
- `probe-result.json`: latest run light cover at 454ms (6 intermediate samples), dark at 420ms (8), reduced at 27ms (none). All finish at opacity 1 with the hold removed. Intermediate samples assert visible opaque boot plus partially transparent desktop surface pixels.
- `light-mid.png`, `dark-mid.png`, and the three `*-end.png` files capture the BrowserView surface only. They are not whole-window compositor screenshots. Boot opacity/visibility are separately sampled; this probe does not prove every native compositor frame or subjective smoothness of the installed app.
- `.omc/boot-reveal-source-smoke.log`: isolated fresh source launch passed. Workspace/frame, titlebar and side-panel hit tests, scoped bridge checks, and PTY echo passed; `pageErrors` empty. No installed user profile was used.
- `.omc/boot-reveal-doc-sync.log`: all 8 documentation gates passed.
- `.omc/boot-reveal-tests.log`: initial full `npm test` completed with 2782 passed, 4 failed, 2 skipped. All four failures were in `window-marketplace.test.js`: its Electron fake had `insertCSS` but no `removeInsertedCSS`, now called by reveal cleanup. After the user's scope approval the fake was completed without weakening production cleanup. `.omc/boot-reveal-tests-final.log`: 2788 passed, 0 failed, 2 skipped. The expanded targeted suite passed 83 tests.

## Taskbar icon investigation

The user identified the reported Electron atom as the bottom taskbar icon, not the tray. A failed Electron fixture had left a test window; that test process was closed. This is a possible explanation, not a confirmed diagnosis of the user's screenshot.

Read-only checks of the installed candidate found all six EXE icon resources (16/24/32/48/64/256) byte-identical to `assets/icon.ico`. Its packaged `assets/icon.png` also matches source, and both primary windows call `iconImage()`. The public desktop shortcut targets the installed Whale Isle EXE and has AppUserModelID `ai.deepseek.harness.gui`, matching the application. No matching pinned taskbar shortcut was found. A later window/process inventory contained no Whale Isle window or process, so the actual installed taskbar symptom could not be retested. Asked the user to reopen via the shortcut and confirm the current icon.

No icon assets, installed files, global icon cache, Explorer process, or security settings were changed. No installer was rebuilt or published; the installed candidate does not contain this source transition repair.

## Follow-up: installed failure remains

The user's subsequent screenshots confirm the taskbar atom remains and the installed app reports a task-control junction `EEXIST`. The current installed startup journal then records a successful task-control retry but `EEXIST` for platform-session and usage-panel. This is not a resolved installed-app issue.

`runtime-probe.cjs` performs read-only installed-path checks and isolated temporary junction stress. Both Node and Electron can currently read the reported junctions and targets; 200 isolated replace cycles passed. Packaged PNG decoding works (1024x1024), and the existing ICO decodes at 256x256. Both produce nonzero native `WM_SETICON` handles in a hidden fixture. These facts do not prove what Explorer renders for the user's live window. Electron v43.4.0's `NativeImage::GetHICON` converts a PNG bitmap without resizing but loads size-specific ICO representations; using ICO is a candidate correction, not yet verified on the affected window.

`installed-probe.mjs` launches the unchanged installed EXE with a separate temporary smoke profile and loopback inspector. Startup and UI/frame/titlebar checks succeeded, but PTY echo timed out; this is not a passing packaged smoke. The user's real profile and running instance were not altered. The probe process exited. Its temporary result path is recorded in `.omc/installed-probe-run.log`.

The existing link helpers swallow every `lstat` error as absence; subsequent creation can mask the original failure with `EEXIST`. A cross-plugin error-handling/idempotency repair and Windows icon-loader repair have been proposed for scope approval. No security-setting changes, manual profile link deletion, or claims of a reproduced root cause were made.

## Approved source repair

The user approved expanding the scope to built-in plugin links, common tests and Windows icon loading. Seven profile-link callers now use `desktop-plugin-link.js`: valid directory links are reused by identity, read errors propagate, and EEXIST is accepted only after verifying the correct target. Unknown ordinary content is not removed; usage-panel's recognized-copy quarantine/rollback remains. Windows `iconImage()` prefers the existing multi-size ICO with a bounded PNG fallback. No artwork or executable resource was changed.

- `.omc/installed-fixes-red.log`: four link regressions and the Windows ICO selection test failed before the implementation. These are fault-injected regressions for the identified code defects, not a claim that the user's environmental trigger was reproduced.
- `.omc/installed-fixes-targeted.log`: 95 passed, 0 failed, including wrong concurrent targets, dangling links, read errors, preserved content, Windows casing, ICO selection/fallback and existing plugin regressions.
- Updated `runtime-probe-result.json`: production helper ran 200 times in real Electron, reusing the link 199 times. Production `iconImage()` selected the installed ASAR's ICO (256px representation); both native icon messages had nonzero handles. This validates loading/assignment, not Explorer's final rendered taskbar pixels.
- `.omc/installed-fixes-source-smoke.log`: fresh isolated source startup passed with no page errors; scoped bridges, titlebar hit tests and PTY echo passed. This also restarted the changed source code without interrupting the installed user instance.
- `.omc/installed-fixes-tests.log`: full suite passed 2799 tests, skipped 2, failed 0. The later additional PNG-fallback/platform test is included in the separate 95-test run; after removal of the now-unused usage-panel deletion helper, all 29 link/usage-panel tests passed again. Final documentation gates passed 8/8 and `git diff --check` passed.

The installed app remains the old candidate. Its original startup failure and actual taskbar appearance still require a new candidate retest after the user resumes packaging; source success is not installed release acceptance.
