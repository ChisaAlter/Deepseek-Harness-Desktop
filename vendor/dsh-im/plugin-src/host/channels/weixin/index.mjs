import { createProductionController } from './production.mjs';
import { installWeixinRpc } from './rpc.mjs';

export const name = 'dsh-weixin-host';
export const inject = ['connection', 'credentials', 'webServer', 'typertGateway'];

export async function apply(ctx, config = {}) {
  if (config?.controller) {
    return installWeixinRpc(ctx, config.controller, config.rpcOptions, config.rpcAuthority);
  }

  const production = await createProductionController(ctx, config, config.internals);
  const disposeRpc = installWeixinRpc(
    ctx,
    production.controller,
    config.rpcOptions,
    config.rpcAuthority,
  );
  ctx.effect(() => async () => {
    await production.close();
  }, 'dsh-weixin: close account connections');
  return disposeRpc;
}

export function createWeixinHostPlugin(config) {
  return Object.freeze({ name, inject, apply: (ctx) => apply(ctx, config) });
}

export { createConnectionSupervisor, ConnectionSupervisor } from './connection-supervisor.mjs';
export { createProductionController } from './production.mjs';
export {
  WEIXIN_ENDPOINTS,
  WEIXIN_RPC_CHANNEL,
  WEIXIN_RPC_ENDPOINTS,
  createWeixinRpcHandler,
  installWeixinRpc,
} from './rpc.mjs';
export { WeixinController } from '../../../../src/channels/weixin/weixin-controller.mjs';
export { WeixinRuntime } from '../../../../src/channels/weixin/weixin-runtime.mjs';
