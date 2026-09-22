#!/usr/bin/env node
// Wrap an esbuild CJS bundle into the DSH browser ModuleLoader factory shape:
//   window.__ModuleLoader__.load({ id, factory(require) { ... } })
// The factory provides `module`/`exports`/`React` to the bundle body; the
// bundle's own `require("react")` calls resolve through the loader registry.
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function wrapClient(inputPath, outputPath) {
  const body = readFileSync(inputPath, 'utf8')
  const wrapped = `// dsh-usage-panel · Client bundle (web plugin \`./client\` export)
// Built from src/client via esbuild + scripts/wrap-client.mjs. Registers the
// settings page "用量统计 / Usage stats" (settings.section) with KPI cards, activity
// heatmap, stacked daily bars, model donut, session ranking, provider
// breakdown and CSV/JSON export. Data arrives over the package's own RPC
// channel /usage-stats (loopback authority).
window.__ModuleLoader__.load({
  id: 'dsh-usage-panel',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
${indent(body, 4)}
    return module.exports
  }
})
`
  writeFileSync(outputPath, wrapped)
}

function indent(text, spaces) {
  const pad = ' '.repeat(spaces)
  return text
    .split('\n')
    .map((line) => (line.length ? pad + line : line))
    .join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , input, output] = process.argv
  if (!input || !output) {
    console.error('usage: node wrap-client.mjs <input.cjs> <output.js>')
    process.exit(1)
  }
  wrapClient(input, output)
  console.log('[wrap-client] done:', output)
}
