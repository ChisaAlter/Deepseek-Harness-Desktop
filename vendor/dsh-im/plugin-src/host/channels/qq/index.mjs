import { createProductionController } from './production.mjs';
import { installQqRpc } from './rpc.mjs';

export const name = 'dsh-im-qq-host';
export const inject = ['connection', 'credentials', 'webServer', 'typertGateway'];

export async function apply(ctx, config = {}) {
  if (config?.controller) {
    return installQqRpc(ctx, config.controller, config.rpcOptions, config.rpcAuthority);
  }
  const production = await createProductionController(ctx, config, config.internals);
  const disposeRpc = installQqRpc(
    ctx,
    production.controller,
    config.rpcOptions,
    config.rpcAuthority,
  );
  ctx.effect(() => async () => production.close(), 'dsh-im: close QQ bot connections');
  return disposeRpc;
}

export function createQqHostPlugin(config) {
  return Object.freeze({ name, inject, apply: (ctx) => apply(ctx, config) });
}

export { createConnectionSupervisor, ConnectionSupervisor } from './connection-supervisor.mjs';
export { createProductionController } from './production.mjs';
export { QQ_ENDPOINTS, QQ_RPC_CHANNEL, QQ_RPC_ENDPOINTS, createQqRpcHandler, installQqRpc } from './rpc.mjs';
export { QqController } from '../../../../src/channels/qq/qq-controller.mjs';
export { QqRuntime } from '../../../../src/channels/qq/qq-runtime.mjs';
