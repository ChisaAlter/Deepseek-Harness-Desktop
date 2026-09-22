/**
 * Adapt the Host's Typert command gateway to the channel Harness client.
 * Programmatic production fixtures may omit the gateway and exercise other assembly paths.
 */
export function createHarnessCommandExecutor(ctx, provided) {
  if (provided !== undefined) {
    if (typeof provided !== 'function') throw new TypeError('commandExecutor must be a function');
    return provided;
  }
  const gateway = ctx?.typertGateway;
  if (!gateway) return undefined;
  if (typeof gateway.invoke !== 'function') {
    throw new TypeError('dsh-im requires a callable ctx.typertGateway');
  }
  return (sessionId, line, options = {}) => gateway.invoke({
    namespace: 'commands',
    method: 'execute',
    args: { agentId: sessionId, line },
    signal: options.signal,
  });
}
