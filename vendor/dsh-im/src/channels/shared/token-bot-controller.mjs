import { connectionTestMessage } from './connection-test.mjs';
import { t } from './i18n.mjs';
import { publicMessageFailure } from './message-failure.mjs';

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeError(code, message) {
  return Object.freeze({ code, message });
}

export class TokenBotController {
  #descriptor;
  #credentials;
  #configStore;
  #inspectToken;
  #deriveIdentity;
  #maskPlatformId;
  #createRuntime;
  #deleteState;
  #logger;
  #runtimes = new Map();
  #errors = new Map();
  #transitions = new Map();
  #revision = 0;
  #closed = false;

  constructor({
    descriptor,
    credentials,
    configStore,
    inspectToken,
    deriveIdentity,
    maskPlatformId,
    createRuntime,
    deleteState = async () => {},
    logger = console,
  }) {
    if (!descriptor?.key || !descriptor?.label || !descriptor?.connectionLabel) {
      throw new TypeError('TokenBotController requires a channel descriptor');
    }
    if (!credentials || typeof credentials.resolve !== 'function'
      || typeof credentials.set !== 'function' || typeof credentials.unset !== 'function') {
      throw new TypeError(`${descriptor.label} requires the DSH credential provider`);
    }
    if (!configStore || typeof configStore.list !== 'function'
      || typeof configStore.save !== 'function' || typeof configStore.remove !== 'function') {
      throw new TypeError(`${descriptor.label} requires a config store`);
    }
    if (typeof inspectToken !== 'function' || typeof deriveIdentity !== 'function'
      || typeof maskPlatformId !== 'function' || typeof createRuntime !== 'function') {
      throw new TypeError(`${descriptor.label} controller dependencies are incomplete`);
    }
    this.#descriptor = descriptor;
    this.#credentials = credentials;
    this.#configStore = configStore;
    this.#inspectToken = inspectToken;
    this.#deriveIdentity = deriveIdentity;
    this.#maskPlatformId = maskPlatformId;
    this.#createRuntime = createRuntime;
    this.#deleteState = deleteState;
    this.#logger = logger;
  }

  async initialize() {
    if (this.#closed) return this.status();
    for (const config of this.#configStore.list()) {
      await this.#withBotTransition(config.botId, async () => {
        if (this.#closed || this.#runtimes.get(config.botId)?.status?.ready) return;
        const token = await this.#resolveToken(config.tokenRef);
        if (!token) {
          this.#errors.set(config.botId, safeError(
            'missing-token',
            t('{label}机器人凭据缺失，请移除后重新接入。', {
              label: this.#descriptor.label,
            }),
          ));
          return;
        }
        try {
          await this.#startRuntime(config, token);
          this.#errors.delete(config.botId);
        } catch (error) {
          this.#errors.set(config.botId, safeError(
            'connection-failed',
            t('{label}连接未就绪，插件会自动重试。', {
              label: this.#descriptor.label,
            }),
          ));
          this.#logger.warn?.(
            `[dsh-im:${this.#descriptor.key}] bot ${config.botId} failed to initialize:`,
            error,
          );
        } finally {
          this.#touch();
        }
      });
    }
    return this.status();
  }

  async bindCredentials({ token } = {}) {
    if (this.#closed) throw new Error(`${this.#descriptor.label} controller is closed`);
    const normalizedToken = cleanString(token);
    if (!normalizedToken) throw new TypeError(`${this.#descriptor.label} Bot Token is required`);
    const inspected = await this.#inspectToken(normalizedToken);
    const platformId = cleanString(inspected?.platformId);
    const name = cleanString(inspected?.name);
    if (!platformId || !name) throw new Error(`${this.#descriptor.label} returned an invalid bot identity`);
    const identity = this.#deriveIdentity(platformId);
    await this.#withBotTransition(identity.botId, async () => {
      if (this.#closed) throw new Error(`${this.#descriptor.label} controller is closed`);
      const previousConfig = this.#configStore.getByPlatformId(platformId);
      const previousToken = await this.#credentials.resolve(identity.tokenRef).catch(() => undefined);
      const config = {
        botId: identity.botId,
        platformId,
        tokenRef: identity.tokenRef,
        name,
        username: cleanString(inspected.username),
        createdAt: previousConfig?.createdAt ?? new Date().toISOString(),
        connectedAt: new Date().toISOString(),
      };
      await this.#credentials.set(identity.tokenRef, normalizedToken);
      try {
        await this.#configStore.save(config);
      } catch (error) {
        await this.#restoreCredential(identity.tokenRef, previousToken);
        throw error;
      }
      try {
        await this.#startRuntime(config, normalizedToken);
        this.#errors.delete(identity.botId);
      } catch (error) {
        this.#errors.set(identity.botId, safeError(
          'connection-failed',
          t('{label}机器人已接入，消息连接暂未就绪。', {
            label: this.#descriptor.label,
          }),
        ));
        this.#logger.warn?.(
          `[dsh-im:${this.#descriptor.key}] bot ${identity.botId} credential connection failed:`,
          error,
        );
      }
      this.#touch();
    });
    return this.status();
  }

  async reconnectBot(botId) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error(`Unknown ${this.#descriptor.label} bot`);
    await this.#withBotTransition(botId, async () => {
      const token = await this.#resolveToken(config.tokenRef);
      if (!token) throw new Error(`${this.#descriptor.label} bot token is missing`);
      try {
        await this.#startRuntime(config, token);
        this.#errors.delete(botId);
      } catch (error) {
        this.#errors.set(botId, safeError(
          'connection-failed',
          t('{label}连接仍未就绪，请稍后重试。', {
            label: this.#descriptor.label,
          }),
        ));
        throw error;
      } finally {
        this.#touch();
      }
    });
    return this.status();
  }

  async updateBotConfig(botId, update) {
    if (this.#closed) throw new Error(`${this.#descriptor.label} controller is closed`);
    if (typeof update !== 'function') throw new TypeError('Bot config update must be a function');
    await this.#withBotTransition(botId, async () => {
      if (this.#closed) throw new Error(`${this.#descriptor.label} controller is closed`);
      const config = this.#configStore.get(botId);
      if (!config) throw new Error(`Unknown ${this.#descriptor.label} bot`);
      const token = await this.#resolveToken(config.tokenRef);
      if (!token) throw new Error(`${this.#descriptor.label} bot token is missing`);
      if (this.#closed) throw new Error(`${this.#descriptor.label} controller is closed`);
      const nextConfig = update(config);
      const savedConfig = await this.#configStore.save(nextConfig);
      try {
        await this.#startRuntime(savedConfig, token);
        this.#errors.delete(botId);
      } catch (error) {
        this.#errors.set(botId, safeError(
          'connection-failed',
          t('{label}连接仍未就绪，请稍后重试。', {
            label: this.#descriptor.label,
          }),
        ));
        throw error;
      } finally {
        this.#touch();
      }
    });
    return this.status();
  }

  async sendConnectionTest(botId) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error(`Unknown ${this.#descriptor.label} bot`);
    return this.#withBotTransition(botId, async () => {
      const runtime = this.#runtimes.get(botId);
      if (!runtime?.status?.ready || typeof runtime.sendConnectionTest !== 'function') {
        const error = new Error(t('{label}机器人尚未连接', {
          label: this.#descriptor.label,
        }));
        error.code = 'test-target-unavailable';
        throw error;
      }
      const cardLabel = t('{name}（{id}）', {
        name: config.name,
        id: this.#maskPlatformId(config.platformId),
      });
      await runtime.sendConnectionTest(connectionTestMessage(
        cardLabel,
        t('{label}机器人', { label: this.#descriptor.label }),
      ));
      return { sent: true };
    });
  }

  async deleteBot(botId) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error(`Unknown ${this.#descriptor.label} bot`);
    await this.#withBotTransition(botId, async () => {
      const previous = await this.#credentials.resolve(config.tokenRef).catch(() => undefined);
      await this.#stopRuntime(botId);
      try {
        await this.#credentials.unset(config.tokenRef);
        await this.#configStore.remove(botId);
      } catch (error) {
        if (previous?.value) {
          await this.#credentials.set(config.tokenRef, previous.value).catch(() => undefined);
          await this.#startRuntime(config, previous.value).catch(() => undefined);
        }
        throw new Error(`Unable to remove the ${this.#descriptor.label} bot safely.`, { cause: error });
      }
      await this.#deleteState({ botId, config }).catch((error) => {
        this.#logger.warn?.(
          `[dsh-im:${this.#descriptor.key}] bot ${botId} state cleanup failed:`,
          error,
        );
      });
      this.#errors.delete(botId);
      this.#touch();
    });
    return this.status();
  }

  status() {
    const bots = this.#configStore.list().map((config) => {
      const runtimeStatus = this.#runtimes.get(config.botId)?.status ?? null;
      const connected = runtimeStatus?.ready === true
        && runtimeStatus.connectionState === 'connected'
        && runtimeStatus.harnessReachable === true;
      const state = connected ? 'connected'
        : runtimeStatus?.connectionState === 'connecting' ? 'connecting'
          : this.#errors.has(config.botId) || runtimeStatus?.connectionState === 'failed'
            ? 'error' : 'offline';
      return {
        botId: config.botId,
        state,
        connected,
        configured: true,
        bot: {
          name: config.name,
          username: config.username,
          idMasked: this.#maskPlatformId(config.platformId),
        },
        health: {
          status: connected ? 'healthy' : state === 'error' ? 'error' : 'offline',
          summary: connected ? t('{label}{connectionLabel}运行正常', {
            label: this.#descriptor.label,
            connectionLabel: t(this.#descriptor.connectionLabel),
          })
            : state === 'error' ? t('{label}连接未就绪，插件会自动重试', {
              label: this.#descriptor.label,
            })
              : t('{label}连接当前离线', { label: this.#descriptor.label }),
          lastCheckedAt: runtimeStatus?.lastCheckedAt ?? null,
          lastConnectedAt: runtimeStatus?.lastConnectedAt ?? null,
        },
        stats: {
          messagesReceived: runtimeStatus?.messagesReceived ?? 0,
          messagesReplied: runtimeStatus?.messagesReplied ?? 0,
        },
        lastMessageError: publicMessageFailure(runtimeStatus?.lastMessageError),
        error: structuredClone(this.#errors.get(config.botId) ?? null),
      };
    });
    const connectedCount = bots.filter((bot) => bot.connected).length;
    return {
      schemaVersion: 1,
      revision: this.#revision,
      state: bots.length === 0 ? 'disconnected'
        : connectedCount === bots.length ? 'connected'
          : connectedCount > 0 ? 'degraded' : 'offline',
      bots,
      totals: { configured: bots.length, connected: connectedCount },
    };
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    await Promise.allSettled([...this.#transitions.values()]);
    await Promise.allSettled([...this.#runtimes.keys()].map((botId) => this.#stopRuntime(botId)));
  }

  async #startRuntime(config, token) {
    if (this.#closed) throw new Error(`${this.#descriptor.label} controller is closed`);
    await this.#stopRuntime(config.botId);
    if (this.#closed) throw new Error(`${this.#descriptor.label} controller is closed`);
    const runtime = await this.#createRuntime({ botId: config.botId, config, token });
    if (!runtime || typeof runtime.start !== 'function' || typeof runtime.stop !== 'function') {
      throw new TypeError(`createRuntime returned an invalid ${this.#descriptor.label} runtime`);
    }
    this.#runtimes.set(config.botId, runtime);
    try {
      await runtime.start();
    } catch (error) {
      await runtime.stop().catch(() => undefined);
      this.#runtimes.delete(config.botId);
      throw error;
    }
  }

  async #stopRuntime(botId) {
    const runtime = this.#runtimes.get(botId);
    this.#runtimes.delete(botId);
    await runtime?.stop().catch((error) => {
      this.#logger.warn?.(
        `[dsh-im:${this.#descriptor.key}] bot ${botId} failed to stop cleanly:`,
        error,
      );
    });
  }

  async #resolveToken(ref) {
    const result = await this.#credentials.resolve(ref).catch(() => undefined);
    return cleanString(result?.value);
  }

  async #restoreCredential(ref, previous) {
    if (previous?.value) await this.#credentials.set(ref, previous.value).catch(() => undefined);
    else await this.#credentials.unset(ref).catch(() => undefined);
  }

  #withBotTransition(botId, operation) {
    const previous = this.#transitions.get(botId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    const settled = current.finally(() => {
      if (this.#transitions.get(botId) === settled) this.#transitions.delete(botId);
    });
    this.#transitions.set(botId, settled);
    return settled;
  }

  #touch() {
    this.#revision += 1;
  }
}
