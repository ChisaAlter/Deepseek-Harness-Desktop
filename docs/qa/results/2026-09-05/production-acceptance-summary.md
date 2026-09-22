# Production Acceptance: Installed Desktop

Date: 2026-09-05. Status: **Not release-approved**.

## Artifact Under Test

- Installed Electron 0.2.9: `C:/软件/Deepseek-Harness-Desktop/Deepseek-Harness-Desktop.exe`.
- CI run: `33942243475`; source: `22b3820e1ff45e5009f129f3024a7b64526753cd`.
- Setup SHA256: `24d0755402a62912783b481bc3ed9b6acef61d5ba99a8edd1f43acec9274c8a6`.
- Tests drove this installed Electron renderer over local CDP, using the real application profile. They did not drive a standalone browser or source dev server.
- `ci-production-results.json` is the per-case ledger. Historical acceptance rows are not inherited. Not-run cases remain not run.
- Full-case ledger: 17 Pass, 1 Fail, 95 Not run. Additional per-model checks above and below are evidence, not extra passes in the 113-case ledger.

## Gateway Models

| Model | Text | Native image |
| --- | --- | --- |
| deepseek-v4-flash-0731-oc | Pass | Not declared; fallback tested |
| glm-5.3-0731-oc | Pass | Not declared |
| deepseek-v4-pro-0813-oc | Pass | Not declared |
| codely-core | Pass | Pass |
| GLM-5.3-FLASH | Pass | Pass |
| KIMI-K3 | Pass on retest; initial gateway 429 retained | Pass |
| moonshotai/kimi-k3 | Pass; approximately 136 seconds | Not declared |

Native image tests used a deterministic red square on the left and blue circle on the right. Prompts did not reveal the expected answer. These are connectivity and simple image-grounding checks, not a benchmark or a complete capability certification.

Evidence: `gateway-text-summary.json`, `gateway-text-kimi-retest.json`, `gateway-vision-summary.json` and their per-turn JSON files.

## Vision Fallback

- Replaced an invalid `opencode-go / kimi-k2.6` fallback route with `qa-gateway / codely-core` through the installed Settings UI.
- Text-only primary: `qa-gateway / deepseek-v4-flash-0731-oc`.
- Upload: correctly described the red square and blue circle.
- Actual `read_image` call: correctly described a different file containing a green square and yellow circle.
- Follow-up without further tools: correctly recalled first-image left color and second-image right color.
- Session log contains exactly two `vision/describe` events after three completed turns, one per distinct image, demonstrating reuse without repeat descriptions for the follow-up.
- A CDP polling timeout occurred after the follow-up was sent. Reconnection and the persisted session confirmed successful completion; this was not counted as an application crash.

Evidence: `gateway-fallback-log-after-reuse.json`, `gateway-fallback-upload.json`, `gateway-fallback-read-image.json`, `gateway-fallback-reuse-recovered.json`.

## Other Findings

- Verified multi-turn conversation, actual file/tool execution, workspace selection, approval allow/reject, branch creation, a commit limited to the owned QA marker, and adding selected file lines to chat.
- Initial README lookup failed because the model ignored a truncated tool result; targeted file reading and the repeated acceptance sequence succeeded. Original failed-turn evidence is retained.
- **Installed artifact failure:** Files search showed unrelated files. Source filtering was fixed in `9a22ba173a501732e7f975da48f912c0d298e82e`. Regression tests were red before the fix; all 172 ui-files tests and its typecheck then passed.
- New Desktop tests run `33951095701` and installer build run `33951140932` succeeded. Their artifact is **not** the installed artifact tested above. The search fix still requires installation and reacceptance before release approval.
- A configured MCP endpoint returned an authentication error; no unrelated credentials were modified.
- Model-generated session titles are not evidence of image accuracy; the actual assistant replies and persisted vision events are the evidence.

## Preservation And Remaining Gates

- Original default model restored to `ayase / grok-4.6`, reasoning `high`; the working vision route and added QA provider remain available.
- ChisaTerminal restored to `master`; original modified/untracked user files preserved. The QA-only commit remains on `codex/qa-ci-33942243475`; nothing was pushed from that workspace.
- Both generated workspace PNGs were removed only after matching their hashes to evidence copies. QA conversations and evidence remain local.
- Debug Electron was closed gracefully and the ordinary Start Menu shortcut relaunched. Startup succeeded at `2026-09-05T07:20:19.668Z` (15:20:19 local); no running process retained a remote-debugging flag and port 9334 had no listener.
- Secrets are not included in this report. Local screenshots and full session evidence may contain private context and must not be uploaded indiscriminately.
- Native installer interactions, tray/system-dialog behavior, destructive recovery scenarios, and real phone cellular remote pairing are not covered by renderer automation. Default-path clean installation is not covered by the custom-path overlay installation.
- Full production acceptance remains incomplete. No release tag, main-branch merge, or public release was made by this acceptance run.
