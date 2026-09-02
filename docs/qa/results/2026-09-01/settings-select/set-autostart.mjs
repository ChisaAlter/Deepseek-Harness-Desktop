import { readFileSync, writeFileSync } from 'node:fs'

const file = process.env.APPDATA
  ? `${process.env.APPDATA}\\Deepseek-Harness-Desktop\\config.json`
  : ''
if (!file) throw new Error('APPDATA missing')
const want = process.argv[2]
if (want !== 'true' && want !== 'false') throw new Error('pass true|false')
const config = JSON.parse(readFileSync(file, 'utf8'))
const prev = config.autoStartDesktop !== false
config.autoStartDesktop = want === 'true'
writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`)
console.log(JSON.stringify({ prev, next: config.autoStartDesktop }))
