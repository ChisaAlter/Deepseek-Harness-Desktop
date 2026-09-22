import { createProductionController } from './production.mjs';
import { installDiscordRpc } from './rpc.mjs';

export const name = 'dsh-im-discord-host';
export const inject = ['connection', 'credentials', 'webServer', 'typertGateway'];

export async function apply(ctx, config = {}) {
  if (config?.controller) {
    return installDiscordRpc(ctx, config.controller, config.rpcAuthority);
  }
  const production = await createProductionController(ctx, config, config.internals ?? {});
  const disposeRpc = installDiscordRpc(ctx, production.controller, config.rpcAuthority);
  ctx.effect(() => async () => production.close(), 'dsh-im: close Discord bot connections');
  return disposeRpc;
}

export function createDiscordHostPlugin(config) {
  return Object.freeze({ name, inject, apply: (ctx) => apply(ctx, config) });
}

export { createProductionController } from './production.mjs';
export {
  DISCORD_ENDPOINTS,
  DISCORD_RPC_CHANNEL,
  DISCORD_RPC_ENDPOINTS,
  createDiscordRpcHandler,
  installDiscordRpc,
} from './rpc.mjs';
export { DiscordController } from '../../../../src/channels/discord/discord-controller.mjs';
export { DiscordRuntime } from '../../../../src/channels/discord/discord-runtime.mjs';
