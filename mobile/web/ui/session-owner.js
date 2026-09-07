/** Capture the view generation as well as its session, including A -> B -> A. */
export function sessionOwner(state) {
  const client = state.chisacode?.client;
  const sessionId = state.sessionId;
  const epoch = state.sessionEpoch;
  return { client, sessionId, owns: () => state.chisacode?.client === client
    && state.sessionId === sessionId && state.sessionEpoch === epoch };
}
