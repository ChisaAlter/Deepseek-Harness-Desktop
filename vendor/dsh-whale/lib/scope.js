/** Persistent, revision-checked settings for the desktop-managed whale plugin.
 * Harness SettingsForms cannot edit a plugin inserted by the desktop's
 * --patch overlay. Keep editable values in the whale data directory.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parse } from 'yaml';

const defaults = {
  name: '鲸鱼娘', personality: 'natural', userTitle: '', personaText: '',
  modelProvider: '', modelModel: '', modelReasoningEffort: '',
  imDefault: true, sessionId: '',
};

function values(source) {
  const result = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (typeof source?.[key] === typeof defaults[key]) result[key] = source[key];
  }
  return result;
}

export function createWhaleScope(home) {
  const file = path.join(home, 'data', 'whale', 'settings.json');
  const legacy = path.join(home, 'settings.yaml.imported');
  const snapshots = new WeakMap();

  function read() {
    if (fs.existsSync(file)) return values(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (!fs.existsSync(legacy)) return values();
    const old = parse(fs.readFileSync(legacy, 'utf8'))?.['dsh-whale'];
    // Old sessions may use a replay format the current Harness cannot open.
    // Preserve the legacy file, but start a new reusable session.
    return values({ ...old, sessionId: '' });
  }

  return {
    get() {
      const snapshot = structuredClone(read());
      snapshots.set(snapshot, structuredClone(snapshot));
      return snapshot;
    },
    async set(next, previous) {
      const baseline = snapshots.get(previous);
      if (!baseline) throw new Error('Whale settings writes require their original snapshot');
      if (!isDeepStrictEqual(read(), baseline)) throw new Error('Whale settings changed during update');
      const result = values(next);
      if (isDeepStrictEqual(result, baseline)) return;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temporary, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
        fs.renameSync(temporary, file);
      } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      }
    },
  };
}
