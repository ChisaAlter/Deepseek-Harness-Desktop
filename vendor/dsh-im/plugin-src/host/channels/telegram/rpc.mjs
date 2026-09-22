import {
  TOKEN_BOT_ENDPOINTS,
  createTokenBotRpcHandler,
} from '../shared/rpc.mjs';
import { resolveRpcAuthority } from '../../rpc-authority.mjs';
import { normalizeTelegramAccessPolicy } from '../../../../src/channels/telegram/config-store.mjs';

export const TELEGRAM_RPC_CHANNEL = '/telegram';
export const TELEGRAM_ENDPOINTS = Object.freeze({
  ...TOKEN_BOT_ENDPOINTS,
  setAccessPolicy: 'bot.access-policy.set',
});
export const TELEGRAM_RPC_ENDPOINTS = Object.freeze(Object.values(TELEGRAM_ENDPOINTS));

export function createTelegramRpcHandler(controller) {
  if (typeof controller?.setAccessPolicy !== 'function') {
    throw new TypeError('A complete Telegram controller is required (setAccessPolicy)');
  }
  const sharedHandler = createTokenBotRpcHandler(controller, { channel: 'Telegram' });
  return async (endpoint, payload, signal) => {
    if (endpoint !== TELEGRAM_ENDPOINTS.setAccessPolicy) {
      return sharedHandler(endpoint, payload, signal);
    }
    if (signal?.aborted) {
      return { ok: false, error: { code: 'cancelled', message: 'The request was cancelled.' } };
    }
    const keys = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? Object.keys(payload) : [];
    if (keys.length !== 3 || !keys.every((key) => (
      ['botId', 'accessMode', 'allowedUsers'].includes(key)
    )) || typeof payload.botId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.botId)) {
      return {
        ok: false,
        error: { code: 'bad-request', message: 'bot.access-policy.set requires a valid policy.' },
      };
    }
    let accessPolicy;
    try {
      accessPolicy = normalizeTelegramAccessPolicy(payload);
    } catch {
      return {
        ok: false,
        error: { code: 'bad-request', message: '请输入有效的 Telegram 访问模式和数字 User ID。' },
      };
    }
    try {
      const value = await controller.setAccessPolicy(payload.botId, accessPolicy);
      return signal?.aborted
        ? { ok: false, error: { code: 'cancelled', message: 'The request was cancelled.' } }
        : { ok: true, value };
    } catch {
      return signal?.aborted
        ? { ok: false, error: { code: 'cancelled', message: 'The request was cancelled.' } }
        : {
            ok: false,
            error: { code: 'telegram-operation-failed', message: 'Telegram 操作失败，请稍后重试。' },
          };
    }
  };
}

export function installTelegramRpc(ctx, controller, authority) {
  if (!ctx?.connection?.rpc || typeof ctx.connection.rpc.handle !== 'function') {
    throw new TypeError('DSH Host Connection RPC is required');
  }
  return ctx.connection.rpc.handle(
    TELEGRAM_RPC_CHANNEL,
    createTelegramRpcHandler(controller),
    { authority: resolveRpcAuthority(authority) },
  );
}
