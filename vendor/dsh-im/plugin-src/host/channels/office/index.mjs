import { createProductionController } from './production.mjs';
import { installOfficeRpc } from './rpc.mjs';

export async function apply(ctx, config = {}) {
  if (config.controller) return installOfficeRpc(ctx, config.controller, config.rpcAuthority);
  const production = await createProductionController(ctx, config, config.internals ?? {});
  const dispose = installOfficeRpc(ctx, production.controller, config.rpcAuthority);
  ctx.effect(() => async () => production.close(), 'dsh-im: close AI Office connector');
  return dispose;
}
