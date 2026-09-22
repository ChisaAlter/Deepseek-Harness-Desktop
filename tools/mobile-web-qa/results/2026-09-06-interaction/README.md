# Mobile Interaction Candidate, 2026-09-06

Status: local Web and Android candidate; overall acceptance remains incomplete.
Feature: `mobile-remote`. The user approved implementation, not production
deployment, installation, uninstall, data clearing, signing-key use or network changes.

## Local Verification

| Gate | Result | Evidence scope |
| --- | --- | --- |
| `node --test mobile/web/**/*.test.js` | 287 passed, 0 failed/skipped | Current source; pure behavior and existing source-contract tests |
| Host tunnel and Git dispatch tests | 23 passed, 0 failed/skipped | Existing allowlists; no protocol/privilege expansion |
| Runtime assets and QA server tests | 20 passed, 0 failed/skipped | Runtime graph, APK comparison, mount prefix, MIME, traversal and port handling |
| `node --check mobile/web/app.js` | Passed | Syntax only |
| Android JVM, build, certificate and resource audit | See [packaging.md](packaging.md) and [apk-audit.json](apk-audit.json) | Local debug candidate, not device/upgrade acceptance |

Commands for the first three rows:

```powershell
node --test "mobile/web/**/*.test.js"
node --test src/shared/dshd-host-tunnel.test.js src/main/dshd-git-dispatch.test.js
node --test tools/mobile-web-qa/runtime-assets.test.mjs tools/mobile-web-qa/server.test.mjs
```

## Collaborative Browser

T3 preview used the real SPA and the existing fake daemon served from an unused
loopback port with `/dshd/`. No real session, repository, relay or device was mutated.
The QA fixture is not included in the APK runtime graph.

The earlier candidate passed these ten controlled DOM cases at each size:

| CSS viewport | Passed |
| --- | --- |
| 320 x 568 | 10/10 |
| 360 x 640 | 10/10 |
| 390 x 844 | 10/10 |
| 430 x 932 | 10/10 |
| 768 x 1024 | 10/10 |
| 1280 x 800 | 10/10 |

Cases: session selection/drawer closure; model search and effort; failed model
rollback; Tab confinement; settings detail Back; directory task footer and Back;
A/B text drafts; branch/create Back without writes; twenty drawer open/close
cycles plus stale Forward barrier cleanup; visible composer target geometry and
document horizontal overflow.

Evidence level is **controlled DOM**, not native pointer, IME or device testing.
The preview did not tick compositor animations reliably between tool calls;
finite animations were snapped to their final state. The T3 recording is scaled
and soft, so it is not pixel-perfect visual or motion acceptance.
Recording: [early-candidate-scaled.webm](early-candidate-scaled.webm).

After that matrix, review fixes changed queued navigation, focus restoration,
session-create recovery and Git continuation. Final reruns, including the two
new recovery cases in `interaction-cases.mjs`, timed out in T3 evaluate/snapshot/
navigate despite reopening the preview. **The earlier 60 checks do not certify
the final revision.** No alternate browser was launched to bypass the product
preview rules. Final browser rerun remains a gate, not a Pass.

## Review And Recovery

Read-only review identified and the implementation addressed: logout leaving
surfaces mounted; queued Back dismissing a replacement; stale Forward barriers;
focus landing on the mask after rerender; Push/PR ordering; branch continuation
unlocking early; stale confirmation continuation; workspace-ID reuse after a
directory change. Follow-up review and final build bind to the files on disk.

Final bounded read-only review found no remaining confirmed P1/P2 in those
reviewed paths. An in-memory harness of the actual current functions verified
the original branch dialog retry: Push failure resumes Push -> PR; PR failure
resumes only PR; neither creates the branch again. This is not a browser test.
The parent independently re-audited the final APK against current source with
`pass=true`; APK SHA-256 is
`67f176677e2daadd4248563d2d1615c44662cd97f3324cff4421b6612f553bcb`.

Git sequences now retain completed steps and skip them on explicit retry,
including branch -> push -> PR. This does not claim exactly-once writes after an
ambiguous remote failure. Session creation stores the returned ID so a failed
catalog refresh offers opening that session instead of creating another.

Android Back timeout/invalid responses use recoverable UI without discarding
the WebView or live draft. Only a trusted current document reporting root can
leave. Picker/capture use controlled URIs and request ownership; no arbitrary
JavaScript/native privilege bridge was added.

## Remaining Acceptance

- T1 public origin and applicable T2 actual LAN were not deployed or tested.
- T3 physical Android WebView, keyboard-first Back, camera/gallery cancellation,
  denial, rotation, background/resume and reconnection remain unverified.
- No connected authorized Android device was available. JVM tests are not
  WebView/IME instrumentation; connected instrumentation was not run.
- No production certificate comparison or same-signature in-place upgrade was
  performed. Debug certificate continuity is only a local build fact.
- Five-turn chat, real approvals/attachments, 200% text/zoom, dark mode, horizontal
  layouts, reduced motion and gesture/selection conflicts need final acceptance.
- Text drafts use existing persistent storage. Attachments remain memory-only;
  no attachment survival across process death or upgrades is promised.

The existing desktop ModelSelect edits were left untouched. No commit, public
deployment, install/uninstall or user-data clearing was performed.
