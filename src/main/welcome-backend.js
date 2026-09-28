'use strict';

/**
 * Native welcome operations using the shared Web authentication and RPC APIs.
 * Ported from upstream apps/desktop/welcome-backend.ts — the authenticated
 * send is plain fetch carrying our already-redeemed session cookie.
 */

const { randomUUID } = require('node:crypto');
const { desktopAccountBackend } = require('./account-backend');

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {string} origin - Host Web origin.
 * @param {() => string | Promise<string>} cookie - current session cookie.
 * @returns welcome backend: read/save credential ops + account backend.
 */
function connectWelcome(origin, cookie) {
  const originUrl = new URL(origin).origin;
  const cookieValue = async () => String(await cookie() || '');
  const send = async (input, init = {}) => fetch(input, {
    ...init,
    headers: { ...(init.headers || {}), ...(cookieValue !== undefined ? { Cookie: await cookieValue() } : {}) },
  });
  const invoke = async ({ namespace, method, args }) => {
    const rpcId = randomUUID();
    const rpcMethod = `${namespace}/${method}`;
    const response = await send(new URL(`/api/${rpcMethod}`, originUrl).href, {
      method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method: rpcMethod, payload: { args } }),
    });
    if (!response.ok) throw new Error('desktop welcome: Web request failed');
    const envelope = await response.json();
    if (!record(envelope) || envelope.type !== 'server-response' || envelope.rpcId !== rpcId
      || !record(envelope.result) || envelope.result.ok !== true) {
      throw new Error('desktop welcome: Web RPC failed');
    }
    return envelope.result.value;
  };
  const account = desktopAccountBackend(originUrl, invoke, cookieValue);
  const settingsAndReference = async () => {
    const settings = await invoke({ namespace: 'settings', method: 'describe', args: {} });
    if (!record(settings) || !Array.isArray(settings.namespaces)) throw new Error('desktop welcome: missing settings namespaces');
    const official = settings.namespaces.find((item) => record(item) && item.ns === 'llm-deepseek');
    if (official === undefined) return { settings: { namespaces: settings.namespaces }, ref: undefined };
    if (!record(official) || !record(official.value) || typeof official.value.apiKeyEnv !== 'string') {
      throw new Error('desktop welcome: missing official DeepSeek credential reference');
    }
    return { settings: { namespaces: settings.namespaces }, ref: official.value.apiKeyEnv };
  };
  const localePreference = (namespaces) => {
    const locale = namespaces.find((item) => record(item) && item.ns === 'locale');
    if (!record(locale) || !record(locale.value)
      || (locale.value.preference !== undefined && typeof locale.value.preference !== 'string')) {
      throw new Error('desktop welcome: invalid locale preference');
    }
    return locale.value.preference ?? null;
  };
  const read = async () => {
    const { settings, ref } = await settingsAndReference();
    const providers = await invoke({ namespace: 'llm', method: 'listConfigurableProviders', args: {} });
    if (!Array.isArray(providers)) throw new Error('desktop welcome: invalid provider directory');
    const namespaces = settings.namespaces;
    const refs = providers.flatMap((provider) => {
      if (!record(provider) || typeof provider.settingsNs !== 'string' || !Array.isArray(provider.settingsPath)) {
        throw new Error('desktop welcome: invalid provider settings address');
      }
      const namespace = namespaces.find((item) => record(item) && item.ns === provider.settingsNs);
      let value = record(namespace) ? namespace.value : undefined;
      for (const key of provider.settingsPath) {
        if (typeof key !== 'string') throw new Error('desktop welcome: invalid provider settings path');
        value = record(value) ? value[key] : undefined;
      }
      return record(value) && typeof value.apiKeyEnv === 'string' ? [value.apiKeyEnv] : [];
    });
    const unique = [...new Set([...(ref === undefined ? [] : [ref]), ...refs])];
    const states = {};
    for (let offset = 0; offset < unique.length; offset += 64) {
      const batch = await invoke({ namespace: 'credentials', method: 'describe', args: { refs: unique.slice(offset, offset + 64) } });
      if (!record(batch)) throw new Error('desktop welcome: invalid credential metadata');
      Object.assign(states, batch);
    }
    if (ref !== undefined && !record(states[ref])) throw new Error('desktop welcome: missing credential metadata');
    return {
      loggedIn: (await account.state()).status === 'credential-stored',
      hasApiKey: Object.values(states).some((value) => record(value) && value.configured === true),
      writable: ref !== undefined && record(states[ref]) && states[ref].writable === true,
      localePreference: localePreference(namespaces),
    };
  };
  return {
    account,
    read,
    async readLocalePreference() {
      const settings = await invoke({ namespace: 'settings', method: 'describe', args: {} });
      if (!record(settings) || !Array.isArray(settings.namespaces)) throw new Error('desktop welcome: missing settings namespaces');
      return localePreference(settings.namespaces);
    },
    async save(apiKey) {
      if (!/^[\x21-\x7e]+$/.test(apiKey)) return { ok: false };
      try {
        const { ref } = await settingsAndReference();
        if (ref === undefined) return { ok: false };
        await invoke({ namespace: 'credentials', method: 'set', args: { ref, value: apiKey } });
        return { ok: true };
      } catch {
        // Provider diagnostics may contain credentials; the native form owns failure copy.
        return { ok: false };
      }
    },
  };
}

module.exports = { connectWelcome };
