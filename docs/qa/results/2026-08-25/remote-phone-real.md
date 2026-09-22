# Remote phone real-device QA — 2026-08-25

Honest split from desktop-only `run-remote-gate-qa.mjs` (NEG/REM-001).

## Setup

| Item | Detail |
| --- | --- |
| Device | Xiaomi `23124RN87C` / serial `9TUCYX87BI6DLRMZ` (USB) |
| APK | `ai.deepseek.harness.mobile` debug `0.1.0` installed |
| Desktop host | `node scripts/run-remote-phone-host.mjs` (`DSH_REMOTE_PHONE_HOST=1`) |
| LAN | Phone `192.168.53.232` **cannot** reach PC `192.168.53.182:3180` (AP isolation) |
| Workaround | `adb reverse tcp:3180 tcp:3180` → pair via `http://127.0.0.1:3180/#offer=…` |

## Results

| Path | Result | Evidence |
| --- | --- | --- |
| Browser SPA pair + chat shell | **Pass** | `phone-browser-pair2.png` — 新会话 / `workspace master · 0` / 作曲栏 |
| Android native pair | **Pass** | `phone-android-connected.png` — same shell after paste `#offer=` +「用链接连接」 |
| Android send message | **Pass** | `phone-android-after-send.png` — title + bubble `phone-native-qa-ping` |
| Pure Wi‑Fi LAN (no USB reverse) | **Blocked** | Phone cannot route to PC `:3180` on this AP |

## Not claimed

- Desktop gate script ≠ phone install / pairing.
- QR camera scan not exercised (paste + adb reverse used).
- HTTPS relay path not exercised.
