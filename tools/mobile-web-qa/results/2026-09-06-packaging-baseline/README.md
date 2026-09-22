# Android Packaging Baseline, 2026-09-06

Status: local intermediate candidate, not final Web/Android acceptance. Android and Web workers were editing concurrently; rebuild after the parent confirms the final source revision. This evidence must not be relabeled as a production upgrade or real-device pass.

## Verified

- `node --test tools/mobile-web-qa/server.test.mjs tools/mobile-web-qa/runtime-assets.test.mjs`: 20 passed, zero failures/skips on the final worker run. Runner syntax (`node --check`) and scoped `git diff --check` also passed.
- JDK: Microsoft OpenJDK 17.0.18.8; SDK: `C:/Users/48818/AppData/Local/Android/Sdk`.
- `:protocol:test :app:testDebugUnitTest :app:assembleDebug`: BUILD SUCCESSFUL, 38 seconds on the successful baseline run. Protocol reports: 10 tests; app reports: 21 tests; zero failures/skips. Protocol tasks were up-to-date; app tests executed on this run.
- Gradle executed `stageMobileWebAssets` before `preBuild` and `mergeDebugAssets`. `builtBy` alone did not schedule staging under the existing AGP, so an explicit `preBuild` dependency is retained.
- APK: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`, generated at 22:17:36 Asia/Shanghai, 35,262,836 bytes.
- Package: `ai.deepseek.harness.mobile`, versionCode `2`, versionName `0.1.1`; no root desktop version change.
- APK SHA-256: `bac5f89577e9a2813fbae117929ff10fbceb732b7c241387db97df5ca30893c0`.
- Signing certificate: `C=US, O=Android, CN=Android Debug`; SHA-256 `d309640f2dd361550038a172b81a294cb8a7f847cf569eca3d5f650840b7db52`. `apksigner verify --print-certs` succeeded. This matches only the previous local debug APK (`1` / `0.1.0`).
- [APK resource audit](apk-audit.json): 43 runtime files, 1,057,071 source bytes, exact byte/hash match plus exact embedded manifest match. No missing, changed, or unexpected assets. Three MLKit native model assets are separately listed, not counted as Web resources.
- Fixture server tests use loopback HTTP only: dynamic port, root/default compatibility, `/dshd/`, MIME, prefixed fake-client override, redirects, port conflicts, and path traversal rejection. No standalone browser was launched.

The first simultaneous integration build reported `ClassNotFoundException` for newly added Kotlin test classes. A later on-disk test report and the subsequent independent successful build passed those tests. No Kotlin changes were made by the packaging worker.

## Remaining Gates

The APK output path is mutable; later builds can replace it. The recorded hash identifies this baseline. After final source edits, rebuild, verify signing/version metadata, and generate a new audit report instead of overwriting this historical result.

T3 preview interaction validation belongs to the parent. Device WebView/IME/camera, public origin deployment, production certificate comparison, authorized same-signature upgrade, and pairing/draft retention were not run here. No deploy/install/uninstall/data clearing, production key use, dependency upgrades, CI or root-script changes occurred.

Feature card `last verified` is owned by the parent and must describe local build/audit evidence separately from unverified T1/T2/T3 manual gates.
