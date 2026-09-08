'use strict';

const { getMarketplacePlugin, readBodyCapped } = require('./marketplace-catalog');
const { githubIdentity } = require('./marketplace-spec');
const { isValidPackageName } = require('../host/install-dsh-plugin-client');
const cache = new Map();
const pending = new Map();

async function publicText(url, accept, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { Accept: accept, 'User-Agent': 'Deepseek-Harness-Desktop' },
    signal: AbortSignal.timeout(8000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return readBodyCapped(response, 256 * 1024);
}

/** Fetch public documentation only for a curated id; no renderer-supplied URL or credentials. */
async function getMarketplaceDetails(id, options = {}) {
  if (typeof id !== 'string' || id.length > 300) throw new Error('无效的插件 id');
  const plugin = getMarketplacePlugin(id);
  if (!plugin) throw new Error('未收录该插件');
  const key = `${id}:${plugin.installSpec}`;
  const prior = cache.get(key);
  if (!options.force && prior && Date.now() - prior.at < (prior.value.partial ? 30000 : 1800000)) return prior.value;
  if (pending.has(key)) return pending.get(key);
  if (pending.size >= 4) throw new Error('详情请求过多，请稍后重试');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const request = (async () => {
    const value = { ok: true, partial: false, readme: '', version: '', requirements: [] };
    const repository = githubIdentity(plugin.installSpec).split('#path:')[0]
      || `${plugin.owner}/${plugin.repo.split('#')[0]}`;
    const jobs = [];
    if (/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repository)) {
      jobs.push(publicText(`https://api.github.com/repos/${repository}/readme`, 'application/vnd.github.raw+json', fetchImpl)
        .then(text => { value.readme = text; }).catch(() => { value.partial = true; }));
    }
    if (plugin.installSpec === plugin.packageName && isValidPackageName(plugin.packageName)) {
      jobs.push(publicText(`https://registry.npmjs.org/${encodeURIComponent(plugin.packageName)}/latest`, 'application/json', fetchImpl)
        .then(text => {
          const manifest = JSON.parse(text);
          if (manifest.name !== plugin.packageName) throw new Error('manifest identity mismatch');
          value.version = typeof manifest.version === 'string' ? manifest.version.slice(0, 100) : '';
          if (typeof manifest.engines?.dsh === 'string') value.requirements.push(`dsh: ${manifest.engines.dsh.slice(0, 256)}`);
          for (const [name, range] of Object.entries(manifest.peerDependencies || {}).slice(0, 100)) {
            if (name.startsWith('@deepseek-ai/') && typeof range === 'string') value.requirements.push(`${name}: ${range.slice(0, 256)}`);
          }
        }).catch(() => { value.partial = true; }));
    }
    await Promise.all(jobs);
    if (cache.size >= 30) cache.delete(cache.keys().next().value);
    cache.set(key, { at: Date.now(), value });
    return value;
  })();
  pending.set(key, request);
  try { return await request; } finally { pending.delete(key); }
}

module.exports = { getMarketplaceDetails };
