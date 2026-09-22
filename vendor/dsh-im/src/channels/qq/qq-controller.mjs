import { randomUUID } from 'node:crypto';

import { connectionTestMessage } from '../shared/connection-test.mjs';
import { t } from '../shared/i18n.mjs';
import { publicMessageFailure } from '../shared/message-failure.mjs';
import { deriveQqBotIdentity, maskQqAppId } from './config-store.mjs';

const ACTIVE_ATTEMPT_STATES = new Set(['starting', 'pending', 'refreshing', 'connecting']);
const TERMINAL_ATTEMPT_STATES = new Set(['connected', 'failed', 'cancelled']);
const QR_TTL_MS = 5 * 60_000;

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeError(code, message) {
  return Object.freeze({ code, message });
}

function publicAttempt(record) {
  if (!record) return null;
  return {
    attemptId: record.id,
    status: record.state,
    qrRevision: record.qrRevision,
    pollIntervalMs: 1_000,
    ...(record.verificationUrl ? { verificationUrl: record.verificationUrl } : {}),
    ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
    ...(record.botId ? { botId: record.botId } : {}),
    ...(record.error ? { error: structuredClone(record.error) } : {}),
  };
}

export class QqController {
  #qrAuth;
  #credentials;
  #configStore;
  #createRuntime;
  #deleteState;
  #logger;
  #runtimes = new Map();
  #errors = new Map();
  #attempts = new Map();
  #activeAttemptId = null;
  #transitions = new Map();
  #revision = 0;
  #closed = false;

  constructor({
    qrAuth,
    credentials,
    configStore,
    createRuntime,
    deleteState = async () => {},
    logger = console,
  }) {
    if (!qrAuth || typeof qrAuth.start !== 'function') throw new TypeError('QQ QR auth is required');
    if (!credentials || typeof credentials.resolve !== 'function'
      || typeof credentials.set !== 'function' || typeof credentials.unset !== 'function') {
      throw new TypeError('QqController requires the DSH credential provider');
    }
    if (!configStore || typeof configStore.list !== 'function'
      || typeof configStore.save !== 'function' || typeof configStore.remove !== 'function') {
      throw new TypeError('QqController requires a config store');
    }
    if (typeof createRuntime !== 'function') throw new TypeError('createRuntime is required');
    this.#qrAuth = qrAuth;
    this.#credentials = credentials;
    this.#configStore = configStore;
    this.#createRuntime = createRuntime;
    this.#deleteState = deleteState;
    this.#logger = logger;
  }

  async initialize() {
    if (this.#closed) return this.status();
    for (const config of this.#configStore.list()) {
      await this.#withBotTransition(config.botId, async () => {
        if (this.#closed || this.#runtimes.get(config.botId)?.status?.ready) return;
        const appSecret = await this.#resolveSecret(config.secretRef);
        if (!appSecret) {
          this.#errors.set(config.botId, safeError('missing-secret', t('QQ 机器人凭据缺失，请移除后重新扫码。')));
          return;
        }
        try {
          await this.#startRuntime(config, appSecret);
          this.#errors.delete(config.botId);
        } catch (error) {
          this.#errors.set(config.botId, safeError('connection-failed', t('QQ 连接未就绪，插件会自动重试。')));
          this.#logger.warn?.(`[dsh-im:qq] bot ${config.botId} failed to initialize:`, error);
        } finally {
          this.#touch();
        }
      });
    }
    return this.status();
  }

  async startProvisioning() {
    if (this.#closed) throw new Error('QQ controller is closed');
    if (this.#activeAttemptId) await this.cancelProvisioning(this.#activeAttemptId);
    let firstQrResolve;
    let firstQrReject;
    const firstQr = new Promise((resolve, reject) => {
      firstQrResolve = resolve;
      firstQrReject = reject;
    });
    const record = {
      id: randomUUID(),
      state: 'starting',
      createdAt: Date.now(),
      expiresAt: null,
      qrRevision: 0,
      verificationUrl: null,
      controller: new AbortController(),
      dispose: null,
      task: null,
      error: null,
      botId: null,
    };
    this.#attempts.set(record.id, record);
    this.#activeAttemptId = record.id;
    this.#touch();

    try {
      record.dispose = this.#qrAuth.start({
        onQrDisplayed: (url) => {
          if (record.controller.signal.aborted || TERMINAL_ATTEMPT_STATES.has(record.state)) return;
          const verificationUrl = cleanString(url);
          if (!verificationUrl) return;
          record.verificationUrl = verificationUrl;
          record.qrRevision += 1;
          record.expiresAt = Date.now() + QR_TTL_MS;
          record.state = 'pending';
          this.#touch();
          firstQrResolve();
        },
        onQrExpired: () => {
          if (record.controller.signal.aborted || TERMINAL_ATTEMPT_STATES.has(record.state)) return;
          record.state = 'refreshing';
          record.verificationUrl = null;
          record.expiresAt = null;
          this.#touch();
        },
        onSuccess: (credentials) => {
          if (record.controller.signal.aborted || TERMINAL_ATTEMPT_STATES.has(record.state)) return;
          record.task = this.#completeProvisioning(record, credentials);
        },
        onFailure: (error) => {
          if (record.controller.signal.aborted || TERMINAL_ATTEMPT_STATES.has(record.state)) return;
          record.state = 'failed';
          record.error = safeError('qr-connect-failed', t('QQ 扫码服务暂时不可用，请重新生成二维码。'));
          if (this.#activeAttemptId === record.id) this.#activeAttemptId = null;
          this.#touch();
          firstQrReject(error);
        },
      }, { signal: record.controller.signal });
      await firstQr;
      return publicAttempt(record);
    } catch (error) {
      if (record.controller.signal.aborted) {
        record.state = 'cancelled';
        record.error = safeError('cancelled', t('扫码绑定已取消。'));
      } else if (!TERMINAL_ATTEMPT_STATES.has(record.state)) {
        record.state = 'failed';
        record.error = safeError('qr-start-failed', t('无法生成 QQ 二维码，请稍后重试。'));
      }
      if (this.#activeAttemptId === record.id) this.#activeAttemptId = null;
      this.#touch();
      throw error;
    }
  }

  registrationStatus(attemptId) {
    return publicAttempt(this.#attempts.get(attemptId));
  }

  async bindCredentials({ appId, appSecret } = {}) {
    if (this.#closed) throw new Error('QQ controller is closed');
    const normalizedAppId = cleanString(appId);
    const normalizedSecret = cleanString(appSecret);
    if (!normalizedAppId || !normalizedSecret) {
      throw new TypeError('QQ AppID and AppSecret are required');
    }
    if (this.#activeAttemptId) await this.cancelProvisioning(this.#activeAttemptId);
    if (this.#closed) throw new Error('QQ controller is closed');
    const identity = deriveQqBotIdentity(normalizedAppId);
    await this.#withBotTransition(identity.botId, async () => {
      if (this.#closed) throw new Error('QQ controller is closed');
      const previousConfig = this.#configStore.getByAppId(normalizedAppId);
      const previousSecret = await this.#credentials.resolve(identity.secretRef).catch(() => undefined);
      if (this.#closed) throw new Error('QQ controller is closed');
      const config = {
        botId: identity.botId,
        appId: normalizedAppId,
        secretRef: identity.secretRef,
        ownerUserOpenid: previousConfig?.ownerUserOpenid ?? '*',
        createdAt: previousConfig?.createdAt ?? new Date().toISOString(),
        connectedAt: new Date().toISOString(),
      };
      await this.#credentials.set(identity.secretRef, normalizedSecret);
      try {
        await this.#configStore.save(config);
      } catch (error) {
        await this.#restoreCredential(identity.secretRef, previousSecret);
        throw error;
      }
      try {
        await this.#startRuntime(config, normalizedSecret);
        this.#errors.delete(identity.botId);
      } catch (error) {
        this.#errors.set(identity.botId, safeError('connection-failed', t('QQ 机器人已绑定，消息连接暂未就绪。')));
        this.#logger.warn?.(`[dsh-im:qq] bot ${identity.botId} credential connection failed:`, error);
      }
      this.#touch();
    });
    return this.status();
  }

  async cancelProvisioning(attemptId) {
    const record = this.#attempts.get(attemptId);
    if (!record) return null;
    if (!TERMINAL_ATTEMPT_STATES.has(record.state)) {
      record.controller.abort();
      record.dispose?.();
      await record.task?.catch(() => undefined);
      if (!TERMINAL_ATTEMPT_STATES.has(record.state)) record.state = 'cancelled';
      record.error ??= safeError('cancelled', t('扫码绑定已取消。'));
    }
    if (this.#activeAttemptId === record.id) this.#activeAttemptId = null;
    this.#touch();
    return publicAttempt(record);
  }

  async reconnectBot(botId) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown QQ bot');
    await this.#withBotTransition(botId, async () => {
      const secret = await this.#resolveSecret(config.secretRef);
      if (!secret) throw new Error('QQ bot secret is missing');
      try {
        await this.#startRuntime(config, secret);
        this.#errors.delete(botId);
      } catch (error) {
        this.#errors.set(botId, safeError('connection-failed', t('QQ 连接仍未就绪，请稍后重试。')));
        throw error;
      } finally {
        this.#touch();
      }
    });
    return this.status();
  }

  async sendConnectionTest(botId) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown QQ bot');
    return this.#withBotTransition(botId, async () => {
      const runtime = this.#runtimes.get(botId);
      if (!runtime?.status?.ready || typeof runtime.sendConnectionTest !== 'function') {
        const error = new Error(t('QQ机器人尚未连接'));
        error.code = 'test-target-unavailable';
        throw error;
      }
      await runtime.sendConnectionTest(connectionTestMessage(
        t('QQ 机器人（{appId}）', { appId: maskQqAppId(config.appId) }),
      ));
      return { sent: true };
    });
  }

  async deleteBot(botId) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown QQ bot');
    await this.#withBotTransition(botId, async () => {
      const previous = await this.#credentials.resolve(config.secretRef).catch(() => undefined);
      await this.#stopRuntime(botId);
      try {
        await this.#credentials.unset(config.secretRef);
        await this.#configStore.remove(botId);
      } catch (error) {
        if (previous?.value) {
          await this.#credentials.set(config.secretRef, previous.value).catch(() => undefined);
          await this.#startRuntime(config, previous.value).catch(() => undefined);
        }
        throw new Error('Unable to remove the QQ bot safely.', { cause: error });
      }
      await this.#deleteState({ botId, config }).catch((error) => {
        this.#logger.warn?.(`[dsh-im:qq] bot ${botId} state cleanup failed:`, error);
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
        && runtimeStatus.qqConnectionState === 'connected'
        && runtimeStatus.harnessReachable === true;
      const state = connected ? 'connected'
        : runtimeStatus?.qqConnectionState === 'connecting' ? 'connecting'
          : this.#errors.has(config.botId) || runtimeStatus?.qqConnectionState === 'failed'
            ? 'error' : 'offline';
      return {
        botId: config.botId,
        state,
        connected,
        configured: true,
        bot: { name: t('QQ机器人'), appIdMasked: maskQqAppId(config.appId) },
        health: {
          status: connected ? 'healthy' : state === 'error' ? 'error' : 'offline',
          summary: connected ? t('QQ WebSocket 长连接运行正常')
            : state === 'error' ? t('QQ 连接未就绪，插件会自动重试') : t('QQ 连接当前离线'),
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
    const active = this.#activeAttemptId ? this.#attempts.get(this.#activeAttemptId) : null;
    return {
      schemaVersion: 1,
      revision: this.#revision,
      state: active && ACTIVE_ATTEMPT_STATES.has(active.state) ? 'provisioning'
        : bots.length === 0 ? 'disconnected'
          : connectedCount === bots.length ? 'connected'
            : connectedCount > 0 ? 'degraded' : 'offline',
      bots,
      totals: { configured: bots.length, connected: connectedCount },
      ...(active && ACTIVE_ATTEMPT_STATES.has(active.state)
        ? { provisioning: publicAttempt(active) } : {}),
    };
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#activeAttemptId) await this.cancelProvisioning(this.#activeAttemptId);
    await Promise.allSettled([...this.#transitions.values()]);
    await Promise.allSettled([...this.#runtimes.keys()].map((botId) => this.#stopRuntime(botId)));
  }

  async #completeProvisioning(record, credentials) {
    try {
      record.state = 'connecting';
      record.verificationUrl = null;
      record.expiresAt = null;
      this.#touch();
      const credential = Array.isArray(credentials) ? credentials[0] : null;
      const appId = cleanString(credential?.appId);
      const appSecret = cleanString(credential?.appSecret);
      const ownerUserOpenid = cleanString(credential?.userOpenid);
      if (!appId || !appSecret || !ownerUserOpenid) {
        throw new Error('QQ authorization returned incomplete credentials');
      }
      record.botId = await this.#activateBot(record, { appId, appSecret, ownerUserOpenid });
      record.state = 'connected';
      record.error = null;
    } catch (error) {
      if (record.controller.signal.aborted) {
        record.state = 'cancelled';
        record.error = safeError('cancelled', t('扫码绑定已取消。'));
      } else {
        record.state = 'failed';
        record.error = safeError('activation-failed', t('QQ 已授权，但无法安全保存接入配置。'));
        this.#logger.error?.('[dsh-im:qq] provisioning failed:', error);
      }
    } finally {
      record.dispose?.();
      if (this.#activeAttemptId === record.id) this.#activeAttemptId = null;
      this.#touch();
    }
  }

  async #activateBot(record, { appId, appSecret, ownerUserOpenid }) {
    const identity = deriveQqBotIdentity(appId);
    const previousConfig = this.#configStore.getByAppId(appId);
    const previousSecret = await this.#credentials.resolve(identity.secretRef).catch(() => undefined);
    const config = {
      botId: identity.botId,
      appId,
      secretRef: identity.secretRef,
      ownerUserOpenid,
      createdAt: previousConfig?.createdAt ?? new Date().toISOString(),
      connectedAt: new Date().toISOString(),
    };
    return this.#withBotTransition(identity.botId, async () => {
      await this.#credentials.set(identity.secretRef, appSecret);
      try {
        if (record.controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        await this.#configStore.save(config);
      } catch (error) {
        await this.#restoreCredential(identity.secretRef, previousSecret);
        throw error;
      }
      try {
        if (record.controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        await this.#startRuntime(config, appSecret);
        this.#errors.delete(identity.botId);
      } catch (error) {
        if (record.controller.signal.aborted) {
          await this.#stopRuntime(identity.botId);
          if (previousConfig) await this.#configStore.save(previousConfig).catch(() => undefined);
          else {
            const removed = await this.#configStore.remove(identity.botId).catch(() => null);
            if (removed) {
              await this.#deleteState({ botId: identity.botId, config }).catch((cleanupError) => {
                this.#logger.warn?.('[dsh-im:qq] cancelled bot state cleanup failed:', cleanupError);
              });
            }
          }
          await this.#restoreCredential(identity.secretRef, previousSecret);
          throw error;
        }
        this.#errors.set(identity.botId, safeError('connection-failed', t('QQ 机器人已绑定，消息连接暂未就绪。')));
        this.#logger.warn?.(`[dsh-im:qq] bot ${identity.botId} activation connection failed:`, error);
      }
      this.#touch();
      return identity.botId;
    });
  }

  async #startRuntime(config, appSecret) {
    if (this.#closed) throw new Error('QQ controller is closed');
    await this.#stopRuntime(config.botId);
    if (this.#closed) throw new Error('QQ controller is closed');
    const runtime = await this.#createRuntime({ botId: config.botId, config, appSecret });
    if (!runtime || typeof runtime.start !== 'function' || typeof runtime.stop !== 'function') {
      throw new TypeError('createRuntime returned an invalid QQ runtime');
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
      this.#logger.warn?.(`[dsh-im:qq] bot ${botId} failed to stop cleanly:`, error);
    });
  }

  async #resolveSecret(ref) {
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
