/** Startup diagnostics through the shipped headless profile and real MCP stdio transport. */

import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const fixtureRoot = new URL('../../../../../../packages/mcp/mcp-client/tests/fixtures/', import.meta.url)
const configPath = fileURLToPath(new URL('repeated-cursor.patch.yml', fixtureRoot))
const expectedPath = fileURLToPath(new URL('./expected/mcp-pagination/stderr-cause.txt', import.meta.url))

it('reports a repeated MCP discovery cursor and exits before starting a turn', async () => {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'MCP discovery pagination cycle',
    tempDirPrefix: 'dsh-mcp-pagination-',
    binScript: fileURLToPath(new URL('../../../../src/bin.ts', import.meta.url)),
    libBinScript: fileURLToPath(new URL('../../../../lib/bin.js', import.meta.url)),
    configPath,
    binArgs: ['--profile', 'headless', '--patch', configPath, 'unreachable task'],
    tsconfigPath: fileURLToPath(new URL('../../../../../../tsconfig.json', import.meta.url)),
    expectedExitCode: 1,
    env: {
      DSH_MCP_PAGINATION_FIXTURE: fileURLToPath(new URL('repeated-cursor-server.ts', fixtureRoot)),
      DSH_TELEMETRY_DISABLED: '1',
    },
  })
  expect(stdout).toBe('')
  expect(stderr).toContain('initial connection or tool synchronization failed')
  const cause = stderr.split('\n').find(line => line.startsWith('Error: mcp-client(pagination-cycle):'))
  await expect(`${cause}\n`).toMatchFileSnapshot(expectedPath)
}, LOADER_SMOKE_TEST_TIMEOUT_MS)
