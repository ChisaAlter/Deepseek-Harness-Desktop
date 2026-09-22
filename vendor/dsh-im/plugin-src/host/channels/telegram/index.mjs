import { createProductionController } from './production.mjs';
import { installTelegramRpc } from './rpc.mjs';

export const name = 'dsh-im-telegram-host';
export const inject = ['connection', 'credentials', 'webServer', 'typertGateway'];

export async function apply(ctx, config = {}) {
  if (config?.controller) {
    return installTelegramRpc(ctx, config.controller, config.rpcAuthority);
  }
  const production = await createProductionController(ctx, config, config.internals ?? {});
  const disposeRpc = installTelegramRpc(ctx, production.controller, config.rpcAuthority);
  ctx.effect(() => async () => production.close(), 'dsh-im: close Telegram bot connections');
  return disposeRpc;
}

export function createTelegramHostPlugin(config) {
  return Object.freeze({ name, inject, apply: (ctx) => apply(ctx, config) });
}

export { createProductionController } from './production.mjs';
export {
  TELEGRAM_ENDPOINTS,
  TELEGRAM_RPC_CHANNEL,
  TELEGRAM_RPC_ENDPOINTS,
  createTelegramRpcHandler,
  installTelegramRpc,
} from './rpc.mjs';
export { TelegramController } from '../../../../src/channels/telegram/telegram-controller.mjs';
export { TelegramRuntime } from '../../../../src/channels/telegram/telegram-runtime.mjs';
