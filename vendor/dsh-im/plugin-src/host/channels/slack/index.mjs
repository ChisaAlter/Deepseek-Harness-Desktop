import { createProductionController } from './production.mjs';
import { installSlackRpc } from './rpc.mjs';

export const name = 'dsh-im-slack-host';
export const inject = ['connection', 'credentials', 'webServer', 'typertGateway'];

export async function apply(ctx, config = {}) {
  if (config?.controller) return installSlackRpc(ctx, config.controller, config.rpcAuthority);
  const production = await createProductionController(ctx, config, config.internals ?? {});
  const disposeRpc = installSlackRpc(ctx, production.controller, config.rpcAuthority);
  ctx.effect(() => async () => production.close(), 'dsh-im: close Slack bot connections');
  return disposeRpc;
}

export function createSlackHostPlugin(config) {
  return Object.freeze({ name, inject, apply: (ctx) => apply(ctx, config) });
}

export { createProductionController } from './production.mjs';
export {
  SLACK_ENDPOINTS,
  SLACK_RPC_CHANNEL,
  SLACK_RPC_ENDPOINTS,
  createSlackRpcHandler,
  installSlackRpc,
} from './rpc.mjs';
export { SlackController } from '../../../../src/channels/slack/slack-controller.mjs';
export { SlackRuntime } from '../../../../src/channels/slack/slack-runtime.mjs';
