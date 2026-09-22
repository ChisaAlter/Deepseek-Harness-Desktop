# Security Policy

## Reporting a vulnerability

Please use this repository's private vulnerability-reporting form under the GitHub **Security** tab when it is available. If it is unavailable, open a minimal issue asking the maintainer for a private contact channel; do not include exploit details in that issue.

请优先通过 GitHub **Security** 页面中的私密漏洞报告功能联系维护者。如果该入口不可用，请只创建一个不含利用细节的简短 issue，请求私下沟通渠道。

Never include DeepSeek API keys, session contents, raw logs, or unredacted usage data in a report.

报告中不要附带 DeepSeek API key、会话内容、原始日志或未脱敏用量数据。

## Scope

Security fixes target the latest version on the default branch.

The plugin is read-only by design: it scans persisted session logs to
aggregate token usage statistics and never writes back. It does not
make outbound network calls. The local RPC endpoint is bound to
loopback only (`{ authority: 'loopback' }`).

If you find a way to make the plugin write back to session logs,
leak session content beyond the user's browser, or escape the
loopback RPC boundary, please report it as a security issue rather
than a regular bug.

## Supported versions

Only the latest released version on npm (`dsh-usage-panel@latest`)
receives security fixes. Older versions may receive fixes at the
maintainer's discretion.

仅最新发布的 npm 版本（`dsh-usage-panel@latest`）接收安全修复。旧版本是否修复由维护者酌情决定。
