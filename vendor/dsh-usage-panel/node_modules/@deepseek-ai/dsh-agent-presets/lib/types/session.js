/**
 * The session-log record of which preset a session actually runs.
 *
 * The creation header names the preset a session STARTED with, and it is
 * deep-frozen because that is a creation fact. A session may still change
 * preset while it is blank, and the effect of that change outlives the blank
 * window: the first turn — and every turn after it — runs under the newly
 * mounted composition. Recording the change is what keeps the log honest, and
 * it is required outright by the repo's model-visible ⟺ logged rule, since the
 * preset decides the tool schemas and prompt sections the model sees.
 *
 * Reconstruction reads {@link resolveSessionPreset}, never the header alone.
 * @module @deepseek-ai/dsh-agent-presets/session
 */
/**
 * The preset a session actually runs, newest selection winning.
 *
 * The header supplies the creation-time value; every later selection is a
 * logged event, so the last one is the answer. Reading the header alone
 * rebuilds a switched session under the composition it was created with, not
 * the one its history was produced under.
 * @param session - the session's header and event log.
 * @returns the preset id, or `undefined` when the deployment composes none.
 */
export function resolveSessionPreset(session) {
    for (let index = session.events.length - 1; index >= 0; index -= 1) {
        const event = session.events[index];
        if (event?.type === 'agent-preset/selected')
            return event.data.agentPreset;
    }
    return session.header.agentPreset;
}
//# sourceMappingURL=session.js.map