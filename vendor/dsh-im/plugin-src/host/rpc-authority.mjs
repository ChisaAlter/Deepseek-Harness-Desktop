const RPC_AUTHORITIES = new Set(['loopback', 'trusted-host']);

/**
 * Resolve the browser authority accepted by an IM management RPC channel.
 * The default keeps credential and bot-management operations on loopback.
 */
export function resolveRpcAuthority(value) {
  if (value === undefined) return 'loopback';
  if (RPC_AUTHORITIES.has(value)) return value;
  throw new TypeError('dsh-im rpcAuthority must be "loopback" or "trusted-host"');
}
