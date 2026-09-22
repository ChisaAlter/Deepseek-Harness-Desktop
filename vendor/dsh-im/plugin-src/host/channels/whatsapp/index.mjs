import { createProductionController } from './production.mjs';
import { installWhatsappRpc } from './rpc.mjs';

export const name = 'dsh-im-whatsapp-host';
export const inject = ['connection', 'webServer', 'typertGateway'];

export async function apply(ctx, config = {}) {
  if (config?.controller) {
    return installWhatsappRpc(ctx, config.controller, config.rpcOptions, config.rpcAuthority);
  }
  const production = await createProductionController(ctx, config, config.internals ?? {});
  const disposeRpc = installWhatsappRpc(
    ctx,
    production.controller,
    config.rpcOptions,
    config.rpcAuthority,
  );
  ctx.effect(() => async () => production.close(), 'dsh-im: close WhatsApp Web connections');
  return disposeRpc;
}

export function createWhatsappHostPlugin(config) {
  return Object.freeze({ name, inject, apply: (ctx) => apply(ctx, config) });
}

export { createProductionController } from './production.mjs';
export {
  WHATSAPP_ENDPOINTS,
  WHATSAPP_RPC_CHANNEL,
  WHATSAPP_RPC_ENDPOINTS,
  createWhatsappRpcHandler,
  installWhatsappRpc,
} from './rpc.mjs';
export { WhatsappController } from '../../../../src/channels/whatsapp/whatsapp-controller.mjs';
export { WhatsappRuntime } from '../../../../src/channels/whatsapp/whatsapp-runtime.mjs';
