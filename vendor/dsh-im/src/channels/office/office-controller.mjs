import { createHash } from 'node:crypto';

import { normalizeOfficeBaseUrl, officeHookUrls } from './protocol.mjs';
import { normalizeOfficeConfig } from './config-store.mjs';
import { OfficeRuntime } from './office-runtime.mjs';

function clean(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }

export function officeTokenRef(baseUrl, deviceId) {
  const digest = createHash('sha256').update(`${baseUrl}\n${deviceId}`).digest('hex').slice(0, 24).toUpperCase();
  return `DSH_OFFICE_DEVICE_TOKEN_${digest}`;
}

export class OfficeController {
  #credentials;
  #store;
  #logger;
  #createRuntime;
  #runtime = null;
  #transition = Promise.resolve();

  constructor({ credentials, configStore, logger = console, createRuntime }) {
    if (!credentials?.resolve || !credentials?.set || !credentials?.unset) {
      throw new TypeError('AI Office requires the Harness credential provider');
    }
    if (!configStore?.get || !configStore?.save || !configStore?.clear) {
      throw new TypeError('AI Office requires a config store');
    }
    this.#credentials = credentials;
    this.#store = configStore;
    this.#logger = logger;
    this.#createRuntime = createRuntime ?? ((options) => new OfficeRuntime(options));
  }

  async initialize() {
    const config = this.#store.get();
    if (config) {
      const credential = await this.#credentials.resolve(config.deviceTokenRef).catch(() => undefined);
      if (credential?.value) await this.#start(config, credential.value);
    }
    return this.status();
  }

  async configure(input = {}) {
    return this.#serial(async () => {
      const previous = this.#store.get();
      const requestedBaseUrl = clean(input.baseUrl);
      const deviceId = clean(input.deviceId);
      if (!requestedBaseUrl || !deviceId) throw new TypeError('Office URL and Device ID are required');
      const baseUrl = normalizeOfficeBaseUrl(requestedBaseUrl).origin;
      const tokenRef = officeTokenRef(baseUrl, deviceId);
      const suppliedToken = clean(input.deviceToken);
      const priorCredential = await this.#credentials.resolve(tokenRef).catch(() => undefined);
      const token = suppliedToken ?? priorCredential?.value;
      if (!token || token.length < 32) throw new TypeError('Device Token must contain at least 32 characters');
      const now = new Date().toISOString();
      const config = normalizeOfficeConfig({
        version: 1,
        baseUrl,
        deviceId,
        deviceTokenRef: tokenRef,
        maxConcurrency: input.maxConcurrency,
        heartbeatSeconds: input.heartbeatSeconds,
        workspaces: input.workspaces,
        instructionPresets: input.instructionPresets,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      });
      if (!config) throw new TypeError('AI Office connector configuration is invalid');

      await this.#credentials.set(tokenRef, token);
      try {
        await this.#store.save(config);
      } catch (error) {
        if (priorCredential?.value) await this.#credentials.set(tokenRef, priorCredential.value).catch(() => undefined);
        else await this.#credentials.unset(tokenRef).catch(() => undefined);
        throw error;
      }
      if (previous?.deviceTokenRef && previous.deviceTokenRef !== tokenRef) {
        await this.#credentials.unset(previous.deviceTokenRef).catch(() => undefined);
      }
      await this.#start(config, token);
      return this.status();
    });
  }

  async reconnect() {
    return this.#serial(async () => {
      const config = this.#store.get();
      if (!config) throw new Error('AI Office connector is not configured');
      await this.#start(config);
      return this.status();
    });
  }

  async test() {
    const config = this.#store.get();
    if (!config) throw new Error('AI Office connector is not configured');
    const token = await this.#resolveToken(config);
    const runtime = this.#createRuntime({ config, token, logger: this.#logger });
    try { await runtime.testConnection(AbortSignal.timeout(10_000)); } finally { await runtime.stop().catch(() => undefined); }
    return { tested: true, snapshot: await this.status() };
  }

  async remove() {
    return this.#serial(async () => {
      const config = this.#store.get();
      await this.#stop();
      if (config?.deviceTokenRef) await this.#credentials.unset(config.deviceTokenRef).catch(() => undefined);
      await this.#store.clear();
      return this.status();
    });
  }

  async status() {
    const config = this.#store.get();
    if (!config) return { schemaVersion: 1, configured: false, connected: false, state: 'unconfigured' };
    const credential = await this.#credentials.resolve(config.deviceTokenRef).catch(() => undefined);
    const runtime = this.#runtime?.status ?? null;
    return {
      schemaVersion: 1,
      configured: true,
      connected: runtime?.connected === true,
      state: runtime?.state ?? (credential?.value ? 'idle' : 'missing-token'),
      config: {
        protocolVersion: config.protocolVersion,
        baseUrl: config.baseUrl,
        deviceId: config.deviceId,
        maxConcurrency: config.maxConcurrency,
        heartbeatSeconds: config.heartbeatSeconds,
        workspaces: config.workspaces,
        instructionPresets: config.instructionPresets,
        hooks: officeHookUrls(config.baseUrl),
      },
      health: runtime,
      tokenConfigured: Boolean(credential?.value),
    };
  }

  async close() { await this.#transition.catch(() => undefined); await this.#stop(); }

  async #resolveToken(config) {
    const credential = await this.#credentials.resolve(config.deviceTokenRef).catch(() => undefined);
    if (!credential?.value) throw new Error('AI Office Device Token is missing');
    return credential.value;
  }

  async #start(config, knownToken) {
    await this.#stop();
    const token = knownToken ?? await this.#resolveToken(config);
    const runtime = this.#createRuntime({ config, token, logger: this.#logger });
    this.#runtime = runtime;
    runtime.start();
  }

  async #stop() {
    const runtime = this.#runtime;
    this.#runtime = null;
    if (runtime) await runtime.stop();
  }

  #serial(operation) {
    const run = this.#transition.then(operation, operation);
    this.#transition = run.then(() => undefined, () => undefined);
    return run;
  }
}
