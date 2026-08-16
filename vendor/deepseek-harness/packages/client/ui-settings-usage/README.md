# @deepseek-ai/dsh-client-ui-settings-usage

English | [中文](README.zh.md)

Usage settings section: a trailing 7- or 30-day view of token volume, sessions, human prompts, activity, and model mix.

The section calls `usage.summary` on the host [`@deepseek-ai/dsh-usage-stats`](../../session/usage-stats) service. It renders six summary cards, a Sunday-leading activity heatmap, stacked daily bars, and a model donut. Charts are SVG and CSS Grid over `--dsw-alias-chart-*` tokens.

## Model Experience

None. The page is a client-facing read of already-logged usage and never reaches a model, prompt, schema, stream, or tool result.

#### KV Cache effect

None; the page never assembles or sends provider requests.

## Known Limitations and Deferred Work

- The page reports tokens, not estimated spend.
- Heatmap and charts follow the selected 7- or 30-day window; there is no year-long GitHub grid.
- A host without `usage-stats` shows the load-failure copy.
