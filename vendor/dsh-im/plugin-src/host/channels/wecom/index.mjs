import { createProductionController } from './production.mjs';
import { installWecomRpc } from './rpc.mjs';

export const name = 'dsh-im-wecom-host';
export const inject = ['connection', 'credentials', 'webServer', 'typertGateway'];

export async function apply(ctx, config = {}) {
  if (config?.controller) {
    return installWecomRpc(ctx, config.controller, config.rpcOptions, config.rpcAuthority);
  }
  const production = await createProductionController(ctx, config, config.internals);
  const disposeRpc = installWecomRpc(
    ctx,
    production.controller,
    config.rpcOptions,
    config.rpcAuthority,
  );
  ctx.effect(() => async () => production.close(), 'dsh-im: close Enterprise WeChat bot connections');
  return disposeRpc;
}

export function createWecomHostPlugin(config) {
  return Object.freeze({ name, inject, apply: (ctx) => apply(ctx, config) });
}

export { createConnectionSupervisor, ConnectionSupervisor } from './connection-supervisor.mjs';
export { createProductionController } from './production.mjs';
export {
  WECOM_ENDPOINTS,
  WECOM_RPC_CHANNEL,
  WECOM_RPC_ENDPOINTS,
  createWecomRpcHandler,
  installWecomRpc,
} from './rpc.mjs';
export { WecomController } from '../../../../src/channels/wecom/wecom-controller.mjs';
export { WecomRuntime } from '../../../../src/channels/wecom/wecom-runtime.mjs';
