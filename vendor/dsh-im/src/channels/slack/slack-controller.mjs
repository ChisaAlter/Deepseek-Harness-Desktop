import { connectionTestMessage } from '../shared/connection-test.mjs';
import { publicMessageFailure } from '../shared/message-failure.mjs';
import { t } from '../shared/i18n.mjs';
import { deriveSlackBotIdentity, maskSlackBotId } from './config-store.mjs';
import { inspectSlackCredentials } from './slack-api.mjs';
import { SLACK_DESCRIPTOR } from './slack-bridge.mjs';

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeError(code, message) {
  return Object.freeze({ code, message });
}

export class SlackController {
  #credentials;
  #configStore;
  #inspectCredentials;
  #createRuntime;
  #deleteState;
  #logger;
  #runtimes = new Map();
  #errors = new Map();
  #transitions = new Map();
  #revision = 0;
  #closed = false;

  constructor({
    credentials,
    configStore,
    inspectCredentials = inspectSlackCredentials,
    createRuntime,
    deleteState = async () => {},
    logger = console,
  }) {
    if (!credentials || typeof credentials.resolve !== 'function'
      || typeof credentials.set !== 'function' || typeof credentials.unset !== 'function') {
      throw new TypeError('Slack requires the DSH credential provider');
    }
    if (!configStore || typeof configStore.list !== 'function'
      || typeof configStore.save !== 'function' || typeof configStore.remove !== 'function') {
      throw new TypeError('Slack requires a config store');
    }
    if (typeof inspectCredentials !== 'function' || typeof createRuntime !== 'function') {
      throw new TypeError('Slack controller dependencies are incomplete');
    }
    this.#credentials = credentials;
    this.#configStore = configStore;
    this.#inspectCredentials = inspectCredentials;
    this.#createRuntime = createRuntime;
    this.#deleteState = deleteState;
    this.#logger = logger;
  }

  async initialize() {
    if (this.#closed) return this.status();
    for (const config of this.#configStore.list()) {
      await this.#withBotTransition(config.botId, async () => {
        if (this.#closed || this.#runtimes.get(config.botId)?.status?.ready) return;
        const resolved = await this.#resolveCredentials(config);
        if (!resolved) {
          this.#errors.set(config.botId, safeError(
            'missing-token',
            t('Slack机器人凭据缺失，请移除后重新接入。'),
          ));
          return;
        }
        try {
          await this.#startRuntime(config, resolved);
          this.#errors.delete(config.botId);
        } catch (error) {
          this.#errors.set(config.botId, safeError(
            'connection-failed',
            t('Slack Socket Mode 连接未就绪，插件会自动重试。'),
          ));
          this.#logger.warn?.(
            `[dsh-im:slack] bot ${config.botId} failed to initialize:`,
            error,
          );
        } finally {
          this.#touch();
        }
      });
    }
    return this.status();
  }

  async bindCredentials({ botToken, appToken } = {}) {
    if (this.#closed) throw new Error('Slack controller is closed');
    const normalizedBotToken = cleanString(botToken);
    const normalizedAppToken = cleanString(appToken);
    if (!normalizedBotToken || !normalizedAppToken) {
      throw new TypeError('Slack Bot Token and App Token are required');
    }
    const inspected = await this.#inspectCredentials({
      botToken: normalizedBotToken,
      appToken: normalizedAppToken,
    });
    const platformId = cleanString(inspected?.platformId);
    const name = cleanString(inspected?.name);
    if (!platformId || !name) throw new Error('Slack returned an invalid bot identity');
    const identity = deriveSlackBotIdentity(platformId);

    await this.#withBotTransition(identity.botId, async () => {
      if (this.#closed) throw new Error('Slack controller is closed');
      const previousConfig = this.#configStore.getByPlatformId(platformId);
      const previousBotToken = await this.#credentials.resolve(identity.botTokenRef).catch(() => undefined);
      const previousAppToken = await this.#credentials.resolve(identity.appTokenRef).catch(() => undefined);
      const config = {
        ...identity,
        platformId,
        name,
        username: cleanString(inspected.username),
        teamId: cleanString(inspected.teamId),
        teamName: cleanString(inspected.teamName),
        createdAt: previousConfig?.createdAt ?? new Date().toISOString(),
        connectedAt: new Date().toISOString(),
      };
      try {
        await this.#credentials.set(identity.botTokenRef, normalizedBotToken);
        await this.#credentials.set(identity.appTokenRef, normalizedAppToken);
        await this.#configStore.save(config);
      } catch (error) {
        await Promise.all([
          this.#restoreCredential(identity.botTokenRef, previousBotToken),
          this.#restoreCredential(identity.appTokenRef, previousAppToken),
        ]);
        throw error;
      }
      try {
        await this.#startRuntime(config, {
          botToken: normalizedBotToken,
          appToken: normalizedAppToken,
        });
        this.#errors.delete(identity.botId);
      } catch (error) {
        this.#errors.set(identity.botId, safeError(
          'connection-failed',
          t('Slack机器人已接入，Socket Mode 连接暂未就绪。'),
        ));
        this.#logger.warn?.(
          `[dsh-im:slack] bot ${identity.botId} credential connection failed:`,
          error,
        );
      }
      this.#touch();
    });
    return this.status();
  }

  async reconnectBot(botId) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown Slack bot');
    await this.#withBotTransition(botId, async () => {
      const resolved = await this.#resolveCredentials(config);
      if (!resolved) throw new Error('Slack bot credentials are missing');
      try {
        await this.#startRuntime(config, resolved);
        this.#errors.delete(botId);
      } catch (error) {
        this.#errors.set(botId, safeError(
          'connection-failed',
          t('Slack Socket Mode 连接仍未就绪，请检查两个 Token。'),
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
    if (!config) throw new Error('Unknown Slack bot');
    return this.#withBotTransition(botId, async () => {
      const runtime = this.#runtimes.get(botId);
      if (!runtime?.status?.ready || typeof runtime.sendConnectionTest !== 'function') {
        const error = new Error(t('Slack机器人尚未连接'));
        error.code = 'test-target-unavailable';
        throw error;
      }
      await runtime.sendConnectionTest(connectionTestMessage(
        `${config.name}（${maskSlackBotId(config.platformId)}）`,
        t('Slack机器人'),
      ));
      return { sent: true };
    });
  }

  async deleteBot(botId) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown Slack bot');
    await this.#withBotTransition(botId, async () => {
      const previousBotToken = await this.#credentials.resolve(config.botTokenRef).catch(() => undefined);
      const previousAppToken = await this.#credentials.resolve(config.appTokenRef).catch(() => undefined);
      await this.#stopRuntime(botId);
      try {
        await this.#credentials.unset(config.botTokenRef);
        await this.#credentials.unset(config.appTokenRef);
        await this.#configStore.remove(botId);
      } catch (error) {
        await Promise.all([
          this.#restoreCredential(config.botTokenRef, previousBotToken),
          this.#restoreCredential(config.appTokenRef, previousAppToken),
        ]);
        if (previousBotToken?.value && previousAppToken?.value) {
          await this.#startRuntime(config, {
            botToken: previousBotToken.value,
            appToken: previousAppToken.value,
          }).catch(() => undefined);
        }
        throw new Error('Unable to remove the Slack bot safely.', { cause: error });
      }
      await this.#deleteState({ botId, config }).catch((error) => {
        this.#logger.warn?.(`[dsh-im:slack] bot ${botId} state cleanup failed:`, error);
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
          teamName: config.teamName,
          idMasked: maskSlackBotId(config.platformId),
        },
        health: {
          status: connected ? 'healthy' : state === 'error' ? 'error' : 'offline',
          summary: connected ? t(`Slack${SLACK_DESCRIPTOR.connectionLabel}运行正常`)
            : state === 'error' ? t('Slack连接未就绪，插件会自动重试')
              : t('Slack连接当前离线'),
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
    const connected = bots.filter((bot) => bot.connected).length;
    return {
      schemaVersion: 1,
      revision: this.#revision,
      state: bots.length === 0 ? 'disconnected'
        : connected === bots.length ? 'connected'
          : connected > 0 ? 'degraded' : 'offline',
      bots,
      totals: { configured: bots.length, connected },
    };
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    await Promise.allSettled([...this.#transitions.values()]);
    await Promise.allSettled([...this.#runtimes.keys()].map((botId) => this.#stopRuntime(botId)));
  }

  async #startRuntime(config, { botToken, appToken }) {
    if (this.#closed) throw new Error('Slack controller is closed');
    await this.#stopRuntime(config.botId);
    if (this.#closed) throw new Error('Slack controller is closed');
    const runtime = await this.#createRuntime({
      botId: config.botId,
      config,
      botToken,
      appToken,
    });
    if (!runtime || typeof runtime.start !== 'function' || typeof runtime.stop !== 'function') {
      throw new TypeError('createRuntime returned an invalid Slack runtime');
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
      this.#logger.warn?.(`[dsh-im:slack] bot ${botId} failed to stop cleanly:`, error);
    });
  }

  async #resolveCredentials(config) {
    const [bot, app] = await Promise.all([
      this.#credentials.resolve(config.botTokenRef).catch(() => undefined),
      this.#credentials.resolve(config.appTokenRef).catch(() => undefined),
    ]);
    const botToken = cleanString(bot?.value);
    const appToken = cleanString(app?.value);
    return botToken && appToken ? { botToken, appToken } : null;
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
