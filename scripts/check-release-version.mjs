#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import semver from 'semver'

export function assertReleaseVersion(tag, version, latestTag) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag) || tag !== `v${version}`) {
    throw new Error(`Release tag ${tag} does not match stable package version ${version}`)
  }
  if (latestTag !== undefined && (!/^v\d+\.\d+\.\d+$/.test(latestTag) || !semver.gt(tag, latestTag))) {
    throw new Error(`Release ${tag} must be newer than current latest ${latestTag}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
    const tag = String(process.argv[2] || process.env.GITHUB_REF_NAME || '').trim()
    assertReleaseVersion(tag, packageJson.version, process.argv[3])
    console.log(`Release version verified: ${tag}`)
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
