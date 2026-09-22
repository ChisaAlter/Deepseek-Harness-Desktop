/**
 * Live probe: DeepSeek listing + models.dev enrich. Key from env only.
 *   DEEPSEEK_API_KEY=… pnpm exec tsx packages/client/ui-settings-models/scripts/live-fetch-enrich-probe.ts
 */
import {
  enrichDiscoveredModelsBestEffort,
  setModelsDevEnrichmentDisabledForTests,
} from '../src/client/models-dev-metadata.ts'

const key = process.env.DEEPSEEK_API_KEY?.trim()
if (!key) {
  console.error('DEEPSEEK_API_KEY is required')
  process.exit(2)
}

setModelsDevEnrichmentDisabledForTests(false)

const listing = await fetch('https://api.deepseek.com/models', {
  headers: { Authorization: `Bearer ${key}` },
})
if (!listing.ok) {
  console.error(`DeepSeek /models HTTP ${listing.status}`)
  process.exit(1)
}

const body = await listing.json() as { data?: unknown }
const discovered = (Array.isArray(body.data) ? body.data : [])
  .map((row) => {
    const record = row as { id?: unknown; name?: unknown }
    const id = typeof record.id === 'string' ? record.id : ''
    return {
      id,
      ...typeof record.name === 'string' ? { name: record.name } : {},
    }
  })
  .filter((row) => row.id !== '')

console.log(JSON.stringify({
  step: 'discover',
  count: discovered.length,
  ids: discovered.map(model => model.id),
}, null, 2))

if (discovered.length === 0) {
  console.error('No models returned')
  process.exit(1)
}

const enriched = await enrichDiscoveredModelsBestEffort(discovered)
const summary = enriched.map(model => ({
  id: model.id,
  name: model.name,
  contextWindow: model.contextWindow,
  maxTokens: model.maxTokens,
  reasoningEfforts: model.reasoningEfforts,
}))

const withContext = summary.filter(model => typeof model.contextWindow === 'number')
const withEfforts = summary.filter(model => model.reasoningEfforts !== undefined)

console.log(JSON.stringify({
  step: 'enrich',
  withContext: withContext.length,
  withEfforts: withEfforts.length,
  models: summary,
}, null, 2))

process.exit(withContext.length > 0 || withEfforts.length > 0 ? 0 : 1)
