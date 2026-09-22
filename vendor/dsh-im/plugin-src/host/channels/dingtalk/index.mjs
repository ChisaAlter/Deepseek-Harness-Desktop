import { createProductionController } from './production.mjs';
import { installDingtalkRpc } from './rpc.mjs';

export const name = 'dsh-dingtalk-host';
export const inject = ['connection', 'credentials', 'webServer', 'typertGateway'];

export async function apply(ctx, config = {}) {
  if (config?.controller) {
    return installDingtalkRpc(ctx, config.controller, config.rpcOptions, config.rpcAuthority);
  }

  const production = await createProductionController(ctx, config, config.internals);
  const disposeRpc = installDingtalkRpc(
    ctx,
    production.controller,
    config.rpcOptions,
    config.rpcAuthority,
  );
  ctx.effect(() => async () => {
    await production.close();
  }, 'dsh-dingtalk: close bot connections');
  return disposeRpc;
}

export function createDingtalkHostPlugin(config) {
  return Object.freeze({ name, inject, apply: (ctx) => apply(ctx, config) });
}

export { createConnectionSupervisor, ConnectionSupervisor } from './connection-supervisor.mjs';
export { createProductionController } from './production.mjs';
export {
  DINGTALK_ENDPOINTS,
  DINGTALK_RPC_CHANNEL,
  DINGTALK_RPC_ENDPOINTS,
  createDingtalkRpcHandler,
  installDingtalkRpc,
} from './rpc.mjs';
export { DingtalkController } from '../../../../src/channels/dingtalk/dingtalk-controller.mjs';
export { DingtalkRuntime } from '../../../../src/channels/dingtalk/dingtalk-runtime.mjs';
