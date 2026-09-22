# Remote gate QA — 2026-08-25（解禁后，不含扫码链接）

**命令：** `node scripts/run-remote-gate-qa.mjs`  
**范围：** TC-NEG-001 + TC-REM-001。不打开配对 URL / 手机 SPA（TC-REM-002/003 留给真机扫码）。

## 结果

| Step | 结果 | 细节 |
| --- | --- | --- |
| neg.available | Pass | `available=true` |
| neg.notEnabled | Pass | `enabled=false` |
| neg.notListening | Pass | `listening=false`；3180 未开 |
| neg.footerPresent | Pass | `data-dsh-remote-trigger` |
| rem.enabledListening | Pass | 开 LAN 后 `listening=true`；3180 开 |
| rem.pairingOffer | Pass | 有 `#offer=`（未 fetch） |
| rem.qrVisible | Pass | 弹窗 SVG QR |
| rem.disabledStopped | Pass | 关后停听；3180 关 |

**Verdict：** 门禁脚本 exit 0；`remoteGateQa.ok === true`。
