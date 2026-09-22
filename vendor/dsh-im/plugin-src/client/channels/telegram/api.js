import { TOKEN_BOT_ENDPOINTS, createTokenChannelApi } from '../shared/token-api.js';

export const TELEGRAM_RPC_CHANNEL = '/telegram';
export const TELEGRAM_ENDPOINTS = Object.freeze({
  ...TOKEN_BOT_ENDPOINTS,
  setAccessPolicy: 'bot.access-policy.set',
});

const api = createTokenChannelApi('Telegram', ' Bot API 长轮询', {
  normalizeBotExtension: (value) => {
    const source = value?.accessPolicy;
    const accessMode = source?.accessMode === 'private-allowlist'
      ? 'private-allowlist' : 'compatible';
    const allowedUsers = Array.isArray(source?.allowedUsers)
      ? [...new Set(source.allowedUsers.filter((entry) => (
          typeof entry === 'string' && /^[1-9]\d{0,15}$/.test(entry)
        )))]
      : [];
    return { accessPolicy: { accessMode, allowedUsers } };
  },
});

export const unwrapRpcResult = api.unwrapRpcResult;
export const normalizeSnapshot = api.normalizeSnapshot;
export const presentError = api.presentError;
export { api as telegramClientApi };
