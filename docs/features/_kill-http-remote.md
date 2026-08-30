# HTTP RemoteGateway kill list (ChisaCode single-stack)

Product pairing is **dshd offer (vendored ChisaCode offer v2) + createChisaCodeDaemon + same-protocol phone**. The old HTTP path is retired as the main path. Dual-stack is **not** in scope unless explicitly re-opened.

## Vocabulary

| Use | Avoid |
| --- | --- |
| 配对 / 扫码配对 / 已配对设备 / 解除配对 | 宿主令牌墙、烤令牌、服务器中继凭据齐套 |
| 局域网 \| 外出 | 「中继」宣传文案 |
| 正在重新连接（sticky deviceSecret） | 关远程即丢设备 |

## Code / surfaces to stop treating as product

| Item | Notes |
| --- | --- |
| `RemoteGateway` HTTP listener / `#offer=` v1 | Class may remain for legacy unit tests; **not** constructed in `index.js` |
| `src/shared/offer.js` v1 encode | Desktop QR now from `generateLocalPairingOffer` |
| Default HTTP relay `http://125.124.85.212:8411` | Allowed as **transport** default only. **Never** as QR / `appBaseUrl` SPA landing |
| Public nginx SPA `http://125.124.85.212/dshd` | Away-mode QR landing path — separate from relay `:8411` transport port |
| Host token / `remoteRelayToken` wall in gateway UI | Removed; field may linger for migration clear |
| `mobile/web` HTTP Host SPA login + mux over `:3180` | Replaced by `chisacode/daemon-client.bundle.js` + `session.js` |
| Android Offer v1 JSON login | Must move to same protocol client (tracked; web done first) |
| QA TC-REM / `remote-gate-qa` hash-offer assumptions | Update to chisacode-v2 / `#offer=` serverId |
| Feature cards `remote-settings` / `mobile-remote` HTTP LAN:3180 story | Rewritten for ChisaCode |

## Sticky pairing

`deviceSecret` lives until user **解除配对** / revoke on daemon store. Offer TTL only covers bootstrap registration.
