# Built-in Away relay

Hardcoded in **`src/shared/lan.js`** (ships inside the app asar / Setup.exe):

| Constant | Value |
| --- | --- |
| `DEFAULT_RELAY_ENDPOINT` | `125.124.85.212:8411` |
| `DEFAULT_RELAY_USE_TLS` | `false` |
| `DEFAULT_APP_BASE_URL` | `http://125.124.85.212:8411` |

Empty user config and「使用默认中继」both resolve here. `defaults.json` is docs-only and is **not** read at runtime.

Optional Cloudflare Worker (`packages/relay`) is unrelated to this built-in host.
