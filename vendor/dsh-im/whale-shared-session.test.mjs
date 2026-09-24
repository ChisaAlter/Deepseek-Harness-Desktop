import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { askInWorkspaceSession } from './src/channels/shared/workspace-session.mjs';
import { sharedWhaleSessionId } from './src/channels/shared/whale-session.mjs';

const homes = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function whaleHome(imDefault = true) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-im-whale-'));
  homes.push(home);
  const dir = join(home, 'data', 'whale');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'settings.json'), JSON.stringify({
    imDefault,
    sessionId: 'session-whale-one',
  }));
  return home;
}

test('shared whale resolution honors the default and an explicit bot preset', async () => {
  const home = await whaleHome();
  assert.equal(await sharedWhaleSessionId({ agentPresetSettings: async () => ({ agentPreset: null }) }, { home }), 'session-whale-one');
  assert.equal(await sharedWhaleSessionId({ agentPresetSettings: async () => ({ agentPreset: 'standard' }) }, { home }), null);
  const off = await whaleHome(false);
  assert.equal(await sharedWhaleSessionId({ agentPresetSettings: async () => ({ agentPreset: null }) }, { home: off }), null);
  await assert.rejects(
    sharedWhaleSessionId({ agentPresetSettings: async () => ({ agentPreset: 'whale-girl' }) }, { home: off }),
    { code: 'whale-im-disabled' },
  );
});

test('two IM chats enter the one resident session without creating another', async () => {
  const home = await whaleHome();
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const sessions = new Map();
    const asked = [];
    const harness = {
      agentPresetSettings: async () => ({ agentPreset: null }),
      workspaceSession: (sessionId) => ({
        sessionExists: async () => sessionId === 'session-whale-one',
        ask: async (text) => {
          asked.push({ sessionId, text });
          return `reply:${text}`;
        },
      }),
      createSession: async () => { throw new Error('created an unwanted IM session'); },
    };
    const state = {
      sessionFor: (key) => sessions.get(key) ?? null,
      setSession: async (key, sessionId) => { sessions.set(key, sessionId); },
    };
    const first = await askInWorkspaceSession({ harness, state, key: 'chat-a', text: 'one' });
    const second = await askInWorkspaceSession({ harness, state, key: 'chat-b', text: 'two' });
    assert.equal(first.sessionId, 'session-whale-one');
    assert.equal(second.sessionId, 'session-whale-one');
    // /new clears a chat mapping; its next message must still enter the
    // resident session rather than producing another whale conversation.
    sessions.delete('chat-a');
    const afterNew = await askInWorkspaceSession({ harness, state, key: 'chat-a', text: 'three' });
    assert.equal(afterNew.sessionId, 'session-whale-one');
    assert.deepEqual([...sessions.values()], ['session-whale-one', 'session-whale-one']);
    assert.deepEqual(asked.map((entry) => entry.text), ['one', 'two', 'three']);
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
  }
});

test('missing resident session never falls through to per-chat creation', async () => {
  const home = await whaleHome();
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    await assert.rejects(askInWorkspaceSession({
      harness: {
        agentPresetSettings: async () => ({ agentPreset: null }),
        workspaceSession: () => ({ sessionExists: async () => false }),
        createSession: async () => { throw new Error('unexpected create'); },
      },
      state: { sessionFor: () => null, setSession: async () => {} },
      key: 'chat-a',
      text: 'hello',
    }), { code: 'whale-session-unavailable' });
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
  }
});
