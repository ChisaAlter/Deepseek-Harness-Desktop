#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const tag = String(process.argv[2] || process.env.GITHUB_REF_NAME || '').trim()
const expected = `v${packageJson.version}`

if (!tag) {
  console.error('Release tag is required (argument or GITHUB_REF_NAME).')
  process.exit(1)
}

if (tag !== expected) {
  console.error(`Release tag ${tag} does not match package version ${packageJson.version}; expected ${expected}.`)
  process.exit(1)
}

console.log(`Release version verified: ${tag}`)
