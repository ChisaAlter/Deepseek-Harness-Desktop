'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { setDesktopDshHome, clearDesktopDshHome } = require('../shared/dsh-home');

function makeTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-import-'));
  const source = path.join(root, 'official');
  const dest = path.join(root, 'desktop');
  const userData = path.join(root, 'userData');
  fs.mkdirSync(path.join(source, 'sessions', 'proj', 'sess-a'), { recursive: true });
  fs.writeFileSync(path.join(source, 'sessions', 'proj', 'sess-a', 'session.jsonl'), '{"id":"a"}\n');
  fs.mkdirSync(path.join(source, 'sessions', 'proj', 'sess-b'), { recursive: true });
  fs.writeFileSync(path.join(source, 'sessions', 'proj', 'sess-b', 'session.jsonl'), '{"id":"b"}\n');
  fs.mkdirSync(path.join(source, 'sessions', 'legacy'), { recursive: true });
  fs.writeFileSync(path.join(source, 'sessions', 'legacy', 'chat.db'), 'sqlite');
  fs.mkdirSync(path.join(source, 'attachments'), { recursive: true });
  fs.writeFileSync(path.join(source, 'attachments', 'file.bin'), 'blob');
  fs.mkdirSync(path.join(source, 'profiles', 'web'), { recursive: true });
  fs.writeFileSync(path.join(source, 'profiles', 'web', 'package.json'), JSON.stringify({
    dependencies: {
      '@deepseek-ai/dsh-base': '1.0.0',
      'good-plugin': 'github:acme/good',
      'file-plugin': 'file:../local',
      'registry-plugin': '1.2.3',
      'caret-plugin': '^2.0.0',
      'tarball-plugin': 'https://example.test/x.tgz',
      'tag-plugin': 'latest',
    },
  }));
  fs.mkdirSync(userData, { recursive: true });
  setDesktopDshHome(dest);
  return { root, source, dest, userData };
}

function writeSkill(root, name, body = `# ${name}\n`) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), body);
  return dir;
}

const MCP_FIXTURE = `servers:
  - id: wiki
    enabled: true
    transport: streamable-http
    serverName: wiki
    url: https://example.test/mcp
  - id: secret-mcp
    enabled: true
    transport: streamable-http
    serverName: secret
    url: https://example.test/secure
    headers:
      Authorization: Bearer test-token-not-real
`;

test.afterEach(() => {
  clearDesktopDshHome();
});

test('scanImport lists sessions, skips sqlite, and flags dest conflicts', () => {
  const tree = makeTree();
  fs.mkdirSync(path.join(tree.dest, 'sessions', 'proj', 'sess-a'), { recursive: true });
  fs.writeFileSync(path.join(tree.dest, 'sessions', 'proj', 'sess-a', 'session.jsonl'), '{"id":"old"}\n');
  const { scanImport } = require('./data-import');
  const scan = scanImport({ sourceHome: tree.source, destHome: tree.dest });
  assert.equal(scan.sourceHasData, true);
  assert.equal(scan.destEmpty, false);
  const byRel = Object.fromEntries(scan.sessions.map((row) => [row.rel, row]));
  assert.equal(byRel['proj/sess-a'].conflict, true);
  assert.equal(byRel['proj/sess-b'].conflict, false);
  assert.equal(byRel.legacy.unsupported, true);
  const plugins = Object.fromEntries(scan.plugins.map((row) => [row.name, row]));
  assert.equal(plugins['@deepseek-ai/dsh-base'].skipped, true);
  assert.equal(plugins['file-plugin'].reason, 'local-spec');
  assert.equal(plugins['good-plugin'].skipped, false);
  assert.equal(plugins['registry-plugin'].skipped, false);
  assert.equal(plugins['caret-plugin'].skipped, false);
  assert.equal(plugins['tarball-plugin'].reason, 'unsupported');
  assert.equal(plugins['tag-plugin'].reason, 'unsupported');
  assert.equal(typeof scan.homeDir, 'string');
  assert.ok(scan.homeDir.length > 0);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('scanImport enriches session display meta from jsonl header and title, fail-soft on bad logs', () => {
  const tree = makeTree();
  const withMeta = path.join(tree.source, 'sessions', '_no-cwd', 'chat-1');
  fs.mkdirSync(withMeta, { recursive: true });
  fs.writeFileSync(path.join(withMeta, 'session.jsonl'), [
    JSON.stringify({
      type: 'session',
      version: 0,
      id: 'chat-1',
      createdAt: 1_700_000_000_000,
      cwd: 'C:\\Users\\demo\\project',
      delegationDepth: 0,
    }),
    JSON.stringify({ type: 'session/title', seq: 1, data: { title: 'First title' } }),
    JSON.stringify({ type: 'user/message', seq: 2, data: {} }),
    JSON.stringify({ type: 'session/title', seq: 3, data: { title: 'Latest title' } }),
    '',
  ].join('\n'));
  const withCwdOnly = path.join(tree.source, 'sessions', '--C-Users-demo-other--', 'uuid-9');
  fs.mkdirSync(withCwdOnly, { recursive: true });
  fs.writeFileSync(path.join(withCwdOnly, 'session.jsonl'), `${JSON.stringify({
    type: 'session',
    version: 0,
    id: 'uuid-9',
    createdAt: 1_700_000_000_100,
    cwd: 'C:\\Users\\demo\\other',
    delegationDepth: 0,
  })}\n`);
  const zstdOnly = path.join(tree.source, 'sessions', '_no-cwd', 'zstd-only');
  fs.mkdirSync(zstdOnly, { recursive: true });
  fs.writeFileSync(path.join(zstdOnly, 'session.jsonl.zstd'), Buffer.from([0x00, 0x01, 0x02]));
  const badPlain = path.join(tree.source, 'sessions', '_no-cwd', 'bad-plain');
  fs.mkdirSync(badPlain, { recursive: true });
  fs.writeFileSync(path.join(badPlain, 'session.jsonl'), 'not-json\n{bad\n');

  writeSkill(path.join(tree.source, 'skills'), 'named', '---\nname: Friendly Skill\n---\n# body\n');

  const { scanImport } = require('./data-import');
  const scan = scanImport({ sourceHome: tree.source, destHome: tree.dest });
  const byRel = Object.fromEntries(scan.sessions.map((row) => [row.rel, row]));
  assert.equal(byRel['_no-cwd/chat-1'].id, 'chat-1');
  assert.equal(byRel['_no-cwd/chat-1'].cwd, 'C:\\Users\\demo\\project');
  assert.equal(byRel['_no-cwd/chat-1'].title, 'Latest title');
  assert.equal(byRel['_no-cwd/chat-1'].createdAt, '1700000000000');
  assert.equal(byRel['_no-cwd/chat-1'].compressedLog, false);
  assert.equal(byRel['--C-Users-demo-other--/uuid-9'].cwd, 'C:\\Users\\demo\\other');
  assert.equal(byRel['--C-Users-demo-other--/uuid-9'].title, '');
  assert.equal(byRel['_no-cwd/zstd-only'].id, 'zstd-only');
  assert.equal(byRel['_no-cwd/zstd-only'].compressedLog, true);
  assert.equal(byRel['_no-cwd/bad-plain'].id, 'bad-plain');
  assert.equal(byRel['_no-cwd/bad-plain'].title, '');
  const named = scan.skills.find((row) => row.id === 'home:named');
  assert.ok(named);
  assert.equal(named.displayName, 'Friendly Skill');
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('scanImport reads display meta from session.jsonl.zstd via Node zlib', () => {
  const zlib = require('node:zlib');
  if (typeof zlib.zstdCompressSync !== 'function') {
    return;
  }
  const tree = makeTree();
  const dir = path.join(tree.source, 'sessions', '_no-cwd', 'zstd-ok');
  fs.mkdirSync(dir, { recursive: true });
  const plaintext = [
    JSON.stringify({
      type: 'session',
      version: 0,
      id: 'zstd-ok',
      createdAt: 1_700_000_000_200,
      cwd: 'D:\\work\\app',
      delegationDepth: 0,
    }),
    JSON.stringify({ type: 'session/title', seq: 1, data: { title: 'From zstd' } }),
    '',
  ].join('\n');
  const options = zlib.constants && zlib.constants.ZSTD_c_checksumFlag != null
    ? { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } }
    : undefined;
  fs.writeFileSync(path.join(dir, 'session.jsonl.zstd'), zlib.zstdCompressSync(Buffer.from(plaintext), options));
  const { scanImport } = require('./data-import');
  const scan = scanImport({ sourceHome: tree.source, destHome: tree.dest });
  const row = scan.sessions.find((item) => item.rel === '_no-cwd/zstd-ok');
  assert.ok(row);
  assert.equal(row.id, 'zstd-ok');
  assert.equal(row.cwd, 'D:\\work\\app');
  assert.equal(row.title, 'From zstd');
  assert.equal(row.compressedLog, false);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('scanImport omits harness preset fixture sessions under _no-cwd/preset-*', () => {
  const tree = makeTree();
  const preset = path.join(tree.source, 'sessions', '_no-cwd', 'preset-authored');
  const chat = path.join(tree.source, 'sessions', '_no-cwd', 'chat-1');
  fs.mkdirSync(preset, { recursive: true });
  fs.mkdirSync(chat, { recursive: true });
  fs.writeFileSync(path.join(preset, 'session.jsonl'), `${JSON.stringify({
    type: 'session',
    version: 0,
    id: 'preset-authored',
    createdAt: 1,
    delegationDepth: 0,
  })}\n`);
  fs.writeFileSync(path.join(chat, 'session.jsonl'), `${JSON.stringify({
    type: 'session',
    version: 0,
    id: 'chat-1',
    createdAt: 2,
    cwd: 'C:\\Users\\demo\\project',
    delegationDepth: 0,
  })}\n`);
  const { scanImport } = require('./data-import');
  const scan = scanImport({ sourceHome: tree.source, destHome: tree.dest });
  const rels = scan.sessions.map((row) => row.rel);
  assert.ok(rels.includes('_no-cwd/chat-1'));
  assert.ok(!rels.includes('_no-cwd/preset-authored'));
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('pluginReinstallSpec maps github and registry semver specs and rejects everything else', () => {
  const { pluginReinstallSpec } = require('./data-import');
  assert.equal(pluginReinstallSpec('x', 'github:acme/good'), 'github:acme/good');
  assert.equal(pluginReinstallSpec('x', 'github:acme/good#abc1234'), 'github:acme/good#abc1234');
  assert.equal(pluginReinstallSpec('registry-plugin', '1.2.3'), 'registry-plugin@1.2.3');
  assert.equal(pluginReinstallSpec('@scope/name', '^2.0.0'), '@scope/name@^2.0.0');
  assert.equal(pluginReinstallSpec('tilde', '~0.4.1-rc.1'), 'tilde@~0.4.1-rc.1');
  assert.equal(pluginReinstallSpec('x', 'https://example.test/x.tgz'), null);
  assert.equal(pluginReinstallSpec('x', 'latest'), null);
  assert.equal(pluginReinstallSpec('x', 'npm:alias@1.2.3'), null);
  assert.equal(pluginReinstallSpec('x', 'git+https://github.com/a/b.git'), null);
  assert.equal(pluginReinstallSpec('../escape', '1.2.3'), null);
  assert.equal(pluginReinstallSpec('x', ''), null);
});

test('shouldHoldForImport is true only when dest sessions are empty and source has data', () => {
  const { shouldHoldForImport } = require('./data-import');
  assert.equal(shouldHoldForImport({ destEmpty: true, sourceHasData: true }), true);
  assert.equal(shouldHoldForImport({ destEmpty: false, sourceHasData: true }), false);
  assert.equal(shouldHoldForImport({ destEmpty: true, sourceHasData: false }), false);
});

test('importSessions skips conflicts by default, overwrites when asked, and never writes the source', async () => {
  const tree = makeTree();
  fs.mkdirSync(path.join(tree.dest, 'sessions', 'proj', 'sess-a'), { recursive: true });
  fs.writeFileSync(path.join(tree.dest, 'sessions', 'proj', 'sess-a', 'session.jsonl'), 'OLD\n');
  const { importSessions } = require('./data-import');
  const skipped = await importSessions({
    sourceHome: tree.source,
    destHome: tree.dest,
    userDataDir: tree.userData,
  });
  assert.equal(skipped.sessions.find((row) => row.rel === 'proj/sess-a').status, 'skipped');
  assert.equal(fs.readFileSync(path.join(tree.dest, 'sessions', 'proj', 'sess-a', 'session.jsonl'), 'utf8'), 'OLD\n');
  assert.equal(skipped.sessions.find((row) => row.rel === 'proj/sess-b').status, 'copied');
  assert.equal(skipped.sessions.find((row) => row.rel === 'legacy').status, 'unsupported');
  assert.equal(fs.existsSync(path.join(tree.userData, 'import-journal.json')), true);
  assert.equal(fs.readFileSync(path.join(tree.source, 'sessions', 'proj', 'sess-a', 'session.jsonl'), 'utf8'), '{"id":"a"}\n');

  const overwritten = await importSessions({
    sourceHome: tree.source,
    destHome: tree.dest,
    overwrite: true,
    selectedRels: ['proj/sess-a'],
    userDataDir: tree.userData,
  });
  assert.equal(overwritten.sessions[0].status, 'copied');
  assert.equal(fs.readFileSync(path.join(tree.dest, 'sessions', 'proj', 'sess-a', 'session.jsonl'), 'utf8'), '{"id":"a"}\n');
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('importSessions rejects relative escape paths', async () => {
  const tree = makeTree();
  const { importSessions } = require('./data-import');
  const result = await importSessions({
    sourceHome: tree.source,
    destHome: tree.dest,
    selectedRels: ['../escape'],
    userDataDir: tree.userData,
  });
  assert.equal(result.sessions[0].status, 'rejected');
  assert.equal(fs.existsSync(path.join(tree.dest, 'escape')), false);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('recoverInterruptedImport consumes a copying journal and clears .import-tmp staging dirs', () => {
  const tree = makeTree();
  const { recoverInterruptedImport, readImportJournal, journalPath } = require('./data-import');
  fs.mkdirSync(path.join(tree.dest, 'sessions', 'proj', 'sess-a.import-tmp'), { recursive: true });
  fs.writeFileSync(path.join(tree.dest, 'sessions', 'proj', 'sess-a.import-tmp', 'session.jsonl'), 'partial');
  fs.mkdirSync(path.join(tree.dest, 'skills', 'alpha.import-tmp'), { recursive: true });
  fs.mkdirSync(path.join(tree.dest, 'attachments.import-tmp'), { recursive: true });
  fs.mkdirSync(path.join(tree.dest, 'sessions', 'proj', 'sess-keep'), { recursive: true });
  fs.writeFileSync(journalPath(tree.userData), `${JSON.stringify({
    phase: 'copying',
    sourceHome: tree.source,
    destHome: tree.dest,
    items: [],
  })}\n`);
  const result = recoverInterruptedImport({ userDataDir: tree.userData, destHome: tree.dest });
  assert.equal(result.recovered, true);
  assert.equal(result.removedTmp.length, 3);
  assert.equal(fs.existsSync(path.join(tree.dest, 'sessions', 'proj', 'sess-a.import-tmp')), false);
  assert.equal(fs.existsSync(path.join(tree.dest, 'skills', 'alpha.import-tmp')), false);
  assert.equal(fs.existsSync(path.join(tree.dest, 'attachments.import-tmp')), false);
  assert.equal(fs.existsSync(path.join(tree.dest, 'sessions', 'proj', 'sess-keep')), true);
  assert.equal(readImportJournal(tree.userData).phase, 'recovered');
  const again = recoverInterruptedImport({ userDataDir: tree.userData, destHome: tree.dest });
  assert.equal(again.recovered, false);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('recoverInterruptedImport ignores done journals and foreign destHome journals', () => {
  const tree = makeTree();
  const { recoverInterruptedImport, journalPath } = require('./data-import');
  fs.mkdirSync(path.join(tree.dest, 'sessions', 'stale.import-tmp'), { recursive: true });
  fs.writeFileSync(journalPath(tree.userData), `${JSON.stringify({
    phase: 'done',
    sourceHome: tree.source,
    destHome: tree.dest,
  })}\n`);
  assert.equal(
    recoverInterruptedImport({ userDataDir: tree.userData, destHome: tree.dest }).recovered,
    false,
  );
  assert.equal(fs.existsSync(path.join(tree.dest, 'sessions', 'stale.import-tmp')), true);

  fs.writeFileSync(journalPath(tree.userData), `${JSON.stringify({
    phase: 'copying',
    sourceHome: tree.source,
    destHome: path.join(tree.root, 'somewhere-else'),
  })}\n`);
  assert.equal(
    recoverInterruptedImport({ userDataDir: tree.userData, destHome: tree.dest }).recovered,
    false,
  );
  assert.equal(fs.existsSync(path.join(tree.dest, 'sessions', 'stale.import-tmp')), true);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('importPlugins skips templates and local specs, and reinstalls selected names', async () => {
  const tree = makeTree();
  const calls = [];
  const { importPlugins } = require('./data-import');
  const result = await importPlugins({
    sourceHome: tree.source,
    destHome: tree.dest,
    installPlugin: async (spec) => {
      calls.push(spec);
      return { ok: true };
    },
  });
  assert.deepEqual(calls.sort(), ['caret-plugin@^2.0.0', 'github:acme/good', 'registry-plugin@1.2.3']);
  assert.equal(result.plugins.find((row) => row.name === 'good-plugin').status, 'installed');
  assert.equal(result.plugins.find((row) => row.name === 'registry-plugin').status, 'installed');
  assert.equal(result.plugins.find((row) => row.name === 'tarball-plugin'), undefined);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('importPlugins never sends an unsupported spec to the installer, even when selected', async () => {
  const tree = makeTree();
  const calls = [];
  const { importPlugins } = require('./data-import');
  const result = await importPlugins({
    sourceHome: tree.source,
    destHome: tree.dest,
    selectedNames: ['tarball-plugin', 'tag-plugin', 'registry-plugin'],
    installPlugin: async (spec) => {
      calls.push(spec);
      return { ok: true };
    },
  });
  assert.deepEqual(calls, ['registry-plugin@1.2.3']);
  assert.equal(result.plugins.find((row) => row.name === 'tarball-plugin').status, 'skipped');
  assert.equal(result.plugins.find((row) => row.name === 'tarball-plugin').reason, 'unsupported');
  assert.equal(result.plugins.find((row) => row.name === 'tag-plugin').reason, 'unsupported');
  assert.equal(result.ok, true);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('scanImport lists skills and MCP without exposing secrets, and holds on skills-only homes', () => {
  const tree = makeTree();
  writeSkill(path.join(tree.source, 'skills'), 'alpha');
  fs.mkdirSync(path.join(tree.source, 'skills', '.system'), { recursive: true });
  fs.writeFileSync(path.join(tree.source, 'skills', '.system', 'SKILL.md'), '# hidden\n');
  fs.writeFileSync(path.join(tree.source, 'mcp-servers.yaml'), MCP_FIXTURE);
  const agentsRoot = path.join(tree.root, 'agents-skills');
  writeSkill(agentsRoot, 'beta');
  const extraRoot = path.join(tree.root, 'extra-skills');
  writeSkill(extraRoot, 'gamma');
  const { scanImport, shouldHoldForImport } = require('./data-import');
  const scan = scanImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    agentsSkillsRoot: agentsRoot,
    extraSkillDirs: [extraRoot],
  });
  const skillIds = scan.skills.map((row) => row.id).sort();
  assert.deepEqual(skillIds, ['agents:beta', 'extra:gamma', 'home:alpha']);
  assert.equal(scan.skills.some((row) => row.name === '.system' || row.id.includes('.system')), false);
  assert.equal(scan.mcp.length, 2);
  assert.equal(scan.mcp.find((row) => row.id === 'wiki').endpoint, 'https://example.test/mcp');
  const secret = JSON.stringify(scan.mcp);
  assert.equal(secret.includes('test-token-not-real'), false);
  assert.equal(secret.includes('Authorization'), false);
  assert.equal(scan.sourceHasData, true);

  const emptyDest = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-empty-dest-'));
  const skillsOnly = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-skills-only-'));
  writeSkill(path.join(skillsOnly, 'skills'), 'solo');
  const skillsScan = scanImport({
    sourceHome: skillsOnly,
    destHome: emptyDest,
    agentsSkillsRoot: path.join(tree.root, 'missing-agents'),
  });
  assert.equal(skillsScan.sessions.length, 0);
  assert.equal(skillsScan.skills.length, 1);
  assert.equal(skillsScan.sourceHasData, true);
  assert.equal(skillsScan.destEmpty, true);
  assert.equal(shouldHoldForImport(skillsScan), true);
  fs.rmSync(emptyDest, { recursive: true, force: true });
  fs.rmSync(skillsOnly, { recursive: true, force: true });
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('runImport copies only selected rows and never writes the source', async () => {
  const tree = makeTree();
  writeSkill(path.join(tree.source, 'skills'), 'alpha');
  writeSkill(path.join(tree.source, 'skills'), 'omega');
  fs.writeFileSync(path.join(tree.source, 'mcp-servers.yaml'), MCP_FIXTURE);
  const extraRoot = path.join(tree.root, 'extra-skills');
  writeSkill(extraRoot, 'gamma');
  const sourceSkill = fs.readFileSync(path.join(tree.source, 'skills', 'alpha', 'SKILL.md'));
  const sourceMcp = fs.readFileSync(path.join(tree.source, 'mcp-servers.yaml'));
  const sourceSess = fs.readFileSync(path.join(tree.source, 'sessions', 'proj', 'sess-b', 'session.jsonl'));
  const { runImport } = require('./data-import');
  const empty = await runImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    extraSkillDirs: [extraRoot],
    agentsSkillsRoot: path.join(tree.root, 'no-agents'),
    userDataDir: tree.userData,
    selectedRels: [],
    selectedSkillIds: [],
    selectedPluginNames: [],
    selectedMcpIds: [],
    importAttachments: false,
    installPlugin: async () => ({ ok: true }),
  });
  assert.equal(empty.empty, true);
  assert.equal(fs.existsSync(path.join(tree.dest, 'sessions')), false);
  assert.equal(fs.existsSync(path.join(tree.dest, 'skills')), false);
  assert.equal(fs.existsSync(path.join(tree.dest, 'mcp-servers.yaml')), false);

  const calls = [];
  const result = await runImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    extraSkillDirs: [extraRoot],
    agentsSkillsRoot: path.join(tree.root, 'no-agents'),
    userDataDir: tree.userData,
    selectedRels: ['proj/sess-a'],
    selectedSkillIds: ['home:alpha', 'extra:gamma'],
    selectedPluginNames: ['good-plugin'],
    selectedMcpIds: ['secret-mcp'],
    importAttachments: true,
    overwrite: false,
    installPlugin: async (spec) => {
      calls.push(spec);
      return { ok: true };
    },
  });
  assert.equal(result.empty, false);
  assert.equal(fs.existsSync(path.join(tree.dest, 'sessions', 'proj', 'sess-a', 'session.jsonl')), true);
  assert.equal(fs.existsSync(path.join(tree.dest, 'sessions', 'proj', 'sess-b', 'session.jsonl')), false);
  assert.equal(fs.existsSync(path.join(tree.dest, 'attachments', 'file.bin')), true);
  assert.equal(fs.existsSync(path.join(tree.dest, 'skills', 'alpha', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(tree.dest, 'skills', 'omega', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(tree.dest, 'skills', 'gamma', 'SKILL.md')), true);
  assert.deepEqual(calls, ['github:acme/good']);
  const destMcp = fs.readFileSync(path.join(tree.dest, 'mcp-servers.yaml'), 'utf8');
  assert.match(destMcp, /id: secret-mcp/);
  assert.match(destMcp, /Bearer test-token-not-real/);
  assert.equal(destMcp.includes('id: wiki'), false);
  assert.deepEqual(sourceSkill, fs.readFileSync(path.join(tree.source, 'skills', 'alpha', 'SKILL.md')));
  assert.deepEqual(sourceMcp, fs.readFileSync(path.join(tree.source, 'mcp-servers.yaml')));
  assert.deepEqual(sourceSess, fs.readFileSync(path.join(tree.source, 'sessions', 'proj', 'sess-b', 'session.jsonl')));
  fs.rmSync(tree.root, { recursive: true, force: true });
});

const SETTINGS_FIXTURE = `# global note
llm-deepseek:
  baseURL: https://gw.example.test/v1
  models:
    - id: deepseek-v4-pro
      name: Pro
ui-theme:
  preference: dark
  activeDarkThemeId: midnight
llm-pi-ai:
  providers:
    openai:
      apiKeyEnv: OPENAI_API_KEY
    acme:
      apiKeyEnv: "ACME_GATEWAY_KEY"
shell:
  historyLimit: 100
agent-default-model:
  provider: deepseek-official
  model: deepseek-v4-pro
`;

const CREDENTIALS_FIXTURE = `version: 1
refs:
  DEEPSEEK_API_KEY: sk-source-secret
  OPENAI_API_KEY: "sk-openai-secret"
  UNRELATED_KEY: sk-unrelated
records:
  deepseek-official/session:
    kind: api-key
    apiKey: sk-oauth-ish
`;

test('scanImport lists whitelisted settings sections, presets, and home AGENTS.md — never secrets', () => {
  const tree = makeTree();
  fs.writeFileSync(path.join(tree.source, 'settings.yaml'), SETTINGS_FIXTURE);
  fs.writeFileSync(path.join(tree.source, '.credentials.yaml'), CREDENTIALS_FIXTURE);
  fs.writeFileSync(path.join(tree.source, 'AGENTS.md'), '# global instructions\n');
  fs.mkdirSync(path.join(tree.source, '.agent-presets', 'research'), { recursive: true });
  fs.writeFileSync(path.join(tree.source, '.agent-presets', 'research', 'agent.cordis.yml'), '- name: dsh-agent\n');
  fs.mkdirSync(path.join(tree.source, '.agent-presets', 'broken-one'), { recursive: true });
  fs.mkdirSync(path.join(tree.source, '.agent-presets', 'Bad Name'), { recursive: true });
  const { scanImport } = require('./data-import');
  const scan = scanImport({ sourceHome: tree.source, destHome: tree.dest });
  const settingIds = scan.settings.map((row) => row.id);
  assert.deepEqual(settingIds, ['llm-deepseek', 'llm-pi-ai', 'agent-default-model', 'ui-theme', 'agents-md']);
  assert.equal(settingIds.includes('shell'), false, 'non-whitelist sections never listed');
  const deepseek = scan.settings.find((row) => row.id === 'llm-deepseek');
  assert.deepEqual(deepseek.credentialRefs, ['DEEPSEEK_API_KEY'], 'implicit default ref');
  const piAi = scan.settings.find((row) => row.id === 'llm-pi-ai');
  assert.deepEqual(piAi.credentialRefs.sort(), ['ACME_GATEWAY_KEY', 'OPENAI_API_KEY']);
  const serialized = JSON.stringify(scan);
  assert.equal(serialized.includes('sk-source-secret'), false);
  assert.equal(serialized.includes('sk-openai-secret'), false);
  const presetIds = scan.presets.map((row) => row.id);
  assert.deepEqual(presetIds, ['broken-one', 'research']);
  assert.equal(scan.presets.find((row) => row.id === 'broken-one').broken, true);
  assert.equal(scan.presets.find((row) => row.id === 'research').broken, false);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('runImport moves selected settings sections verbatim, syncs referenced refs only, and never writes the source', async () => {
  const tree = makeTree();
  fs.writeFileSync(path.join(tree.source, 'settings.yaml'), SETTINGS_FIXTURE);
  fs.writeFileSync(path.join(tree.source, '.credentials.yaml'), CREDENTIALS_FIXTURE);
  fs.writeFileSync(path.join(tree.source, 'AGENTS.md'), '# global instructions\n');
  fs.mkdirSync(tree.dest, { recursive: true });
  fs.writeFileSync(path.join(tree.dest, 'settings.yaml'), 'ui-titlebar:\n  action: copy\n');
  const sourceSettings = fs.readFileSync(path.join(tree.source, 'settings.yaml'), 'utf8');
  const sourceCreds = fs.readFileSync(path.join(tree.source, '.credentials.yaml'), 'utf8');
  const { runImport } = require('./data-import');
  const result = await runImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    agentsSkillsRoot: path.join(tree.root, 'no-agents'),
    userDataDir: tree.userData,
    selectedRels: [],
    selectedSkillIds: [],
    selectedPluginNames: [],
    selectedMcpIds: [],
    selectedSettingIds: ['llm-deepseek', 'ui-theme', 'agents-md', 'shell'],
    selectedPresetIds: [],
    importAttachments: false,
  });
  assert.equal(result.settings.find((row) => row.id === 'llm-deepseek').status, 'copied');
  assert.equal(result.settings.find((row) => row.id === 'ui-theme').status, 'copied');
  assert.equal(result.settings.find((row) => row.id === 'agents-md').status, 'copied');
  assert.equal(result.settings.find((row) => row.id === 'shell').status, 'rejected');
  const destSettings = fs.readFileSync(path.join(tree.dest, 'settings.yaml'), 'utf8');
  assert.match(destSettings, /ui-titlebar:\n {2}action: copy/, 'existing desktop sections preserved');
  assert.match(destSettings, /llm-deepseek:\n {2}baseURL: https:\/\/gw\.example\.test\/v1\n {2}models:\n {4}- id: deepseek-v4-pro\n {6}name: Pro/, 'nested block moved verbatim');
  assert.match(destSettings, /ui-theme:\n {2}preference: dark/);
  assert.equal(destSettings.includes('historyLimit'), false, 'non-whitelist section never written');
  assert.equal(fs.readFileSync(path.join(tree.dest, 'AGENTS.md'), 'utf8'), '# global instructions\n');
  assert.deepEqual(result.credentials, [{ ref: 'DEEPSEEK_API_KEY', status: 'copied' }]);
  const destCreds = fs.readFileSync(path.join(tree.dest, '.credentials.yaml'), 'utf8');
  assert.match(destCreds, /^version: 1$/m);
  assert.match(destCreds, /^ {2}DEEPSEEK_API_KEY: sk-source-secret$/m);
  assert.equal(destCreds.includes('UNRELATED_KEY'), false, 'unreferenced refs stay behind');
  assert.equal(destCreds.includes('records:'), false, 'OAuth records never migrate');
  const journal = fs.readFileSync(result.journal, 'utf8');
  assert.equal(journal.includes('sk-source-secret'), false, 'journal carries ref names only');
  assert.deepEqual(sourceSettings, fs.readFileSync(path.join(tree.source, 'settings.yaml'), 'utf8'));
  assert.deepEqual(sourceCreds, fs.readFileSync(path.join(tree.source, '.credentials.yaml'), 'utf8'));
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('settings and credential imports conflict-skip by default and replace on overwrite', async () => {
  const tree = makeTree();
  fs.writeFileSync(path.join(tree.source, 'settings.yaml'), SETTINGS_FIXTURE);
  fs.writeFileSync(path.join(tree.source, '.credentials.yaml'), CREDENTIALS_FIXTURE);
  fs.mkdirSync(tree.dest, { recursive: true });
  fs.writeFileSync(path.join(tree.dest, 'settings.yaml'), 'ui-theme:\n  preference: light\n');
  fs.writeFileSync(path.join(tree.dest, '.credentials.yaml'), 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: sk-dest-existing\n');
  const { runImport } = require('./data-import');
  const skipped = await runImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    agentsSkillsRoot: path.join(tree.root, 'no-agents'),
    userDataDir: tree.userData,
    selectedRels: [],
    selectedSkillIds: [],
    selectedPluginNames: [],
    selectedMcpIds: [],
    selectedSettingIds: ['ui-theme', 'llm-deepseek'],
    selectedPresetIds: [],
    importAttachments: false,
  });
  assert.equal(skipped.settings.find((row) => row.id === 'ui-theme').status, 'skipped');
  assert.equal(skipped.settings.find((row) => row.id === 'llm-deepseek').status, 'copied');
  assert.deepEqual(skipped.credentials, [{ ref: 'DEEPSEEK_API_KEY', status: 'skipped' }]);
  assert.match(fs.readFileSync(path.join(tree.dest, 'settings.yaml'), 'utf8'), /preference: light/);
  assert.match(fs.readFileSync(path.join(tree.dest, '.credentials.yaml'), 'utf8'), /sk-dest-existing/);

  const overwritten = await runImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    agentsSkillsRoot: path.join(tree.root, 'no-agents'),
    userDataDir: tree.userData,
    overwrite: true,
    selectedRels: [],
    selectedSkillIds: [],
    selectedPluginNames: [],
    selectedMcpIds: [],
    selectedSettingIds: ['ui-theme', 'llm-deepseek'],
    selectedPresetIds: [],
    importAttachments: false,
  });
  assert.equal(overwritten.settings.find((row) => row.id === 'ui-theme').status, 'copied');
  assert.deepEqual(overwritten.credentials, [{ ref: 'DEEPSEEK_API_KEY', status: 'copied' }]);
  const destSettings = fs.readFileSync(path.join(tree.dest, 'settings.yaml'), 'utf8');
  assert.match(destSettings, /preference: dark/);
  assert.equal(destSettings.includes('preference: light'), false);
  const destCreds = fs.readFileSync(path.join(tree.dest, '.credentials.yaml'), 'utf8');
  assert.match(destCreds, /sk-source-secret/);
  assert.equal(destCreds.includes('sk-dest-existing'), false);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('runImport copies selected presets by directory and rejects unsafe or broken ids', async () => {
  const tree = makeTree();
  fs.mkdirSync(path.join(tree.source, '.agent-presets', 'research'), { recursive: true });
  fs.writeFileSync(path.join(tree.source, '.agent-presets', 'research', 'agent.cordis.yml'), '- name: dsh-agent\n');
  fs.mkdirSync(path.join(tree.source, '.agent-presets', 'broken-one'), { recursive: true });
  const { runImport } = require('./data-import');
  const result = await runImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    agentsSkillsRoot: path.join(tree.root, 'no-agents'),
    userDataDir: tree.userData,
    selectedRels: [],
    selectedSkillIds: [],
    selectedPluginNames: [],
    selectedMcpIds: [],
    selectedSettingIds: [],
    selectedPresetIds: ['research', 'broken-one', '../escape', 'Bad Name'],
    importAttachments: false,
  });
  assert.equal(result.presets.find((row) => row.id === 'research').status, 'copied');
  assert.equal(result.presets.find((row) => row.id === 'broken-one').status, 'unsupported');
  assert.equal(result.presets.find((row) => row.id === '../escape').status, 'rejected');
  assert.equal(result.presets.find((row) => row.id === 'Bad Name').status, 'rejected');
  assert.equal(
    fs.readFileSync(path.join(tree.dest, '.agent-presets', 'research', 'agent.cordis.yml'), 'utf8'),
    '- name: dsh-agent\n',
  );
  assert.equal(fs.existsSync(path.join(tree.dest, 'escape')), false);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('probeImportHold matches shouldHoldForImport(scanImport()) without reading session meta', () => {
  const tree = makeTree();
  const { probeImportHold, scanImport, shouldHoldForImport } = require('./data-import');
  const probe = probeImportHold({ sourceHome: tree.source, destHome: tree.dest, agentsSkillsRoot: path.join(tree.root, 'no-agents') });
  assert.equal(probe.hold, true);
  assert.equal(probe.hold, shouldHoldForImport(scanImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    agentsSkillsRoot: path.join(tree.root, 'no-agents'),
  })));

  fs.mkdirSync(path.join(tree.dest, 'sessions', 'proj', 'existing'), { recursive: true });
  fs.writeFileSync(path.join(tree.dest, 'sessions', 'proj', 'existing', 'session.jsonl'), '{"id":"x"}\n');
  const nonEmpty = probeImportHold({ sourceHome: tree.source, destHome: tree.dest, agentsSkillsRoot: path.join(tree.root, 'no-agents') });
  assert.equal(nonEmpty.destEmpty, false);
  assert.equal(nonEmpty.hold, false);
  fs.rmSync(tree.root, { recursive: true, force: true });

  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-probe-bare-'));
  const emptySource = path.join(bare, 'official');
  const emptyDest = path.join(bare, 'desktop');
  fs.mkdirSync(emptySource, { recursive: true });
  setDesktopDshHome(emptyDest);
  const idle = probeImportHold({ sourceHome: emptySource, destHome: emptyDest, agentsSkillsRoot: path.join(bare, 'no-agents') });
  assert.equal(idle.destEmpty, true);
  assert.equal(idle.sourceHasData, false);
  assert.equal(idle.hold, false);

  fs.writeFileSync(path.join(emptySource, 'settings.yaml'), 'ui-theme:\n  preference: dark\n');
  const settingsOnly = probeImportHold({ sourceHome: emptySource, destHome: emptyDest, agentsSkillsRoot: path.join(bare, 'no-agents') });
  assert.equal(settingsOnly.hold, true, 'whitelisted settings alone hold the gate');
  fs.rmSync(bare, { recursive: true, force: true });
});

test('probeImportHold ignores preset fixture sessions and legacy-db-only sources', () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-probe-preset-'));
  const source = path.join(bare, 'official');
  const dest = path.join(bare, 'desktop');
  fs.mkdirSync(path.join(source, 'sessions', '_no-cwd', 'preset-demo'), { recursive: true });
  fs.writeFileSync(path.join(source, 'sessions', '_no-cwd', 'preset-demo', 'session.jsonl'), '{"id":"p"}\n');
  fs.mkdirSync(path.join(source, 'sessions', 'legacy'), { recursive: true });
  fs.writeFileSync(path.join(source, 'sessions', 'legacy', 'chat.db'), 'sqlite');
  setDesktopDshHome(dest);
  const { probeImportHold } = require('./data-import');
  const probe = probeImportHold({ sourceHome: source, destHome: dest, agentsSkillsRoot: path.join(bare, 'no-agents') });
  assert.equal(probe.sourceHasData, false);
  assert.equal(probe.hold, false);
  fs.rmSync(bare, { recursive: true, force: true });
});

test('runImport skips MCP/skill conflicts unless overwrite, and rejects paths outside roots', async () => {
  const tree = makeTree();
  writeSkill(path.join(tree.source, 'skills'), 'alpha');
  fs.writeFileSync(path.join(tree.source, 'mcp-servers.yaml'), MCP_FIXTURE);
  fs.mkdirSync(path.join(tree.dest, 'skills', 'alpha'), { recursive: true });
  fs.writeFileSync(path.join(tree.dest, 'skills', 'alpha', 'SKILL.md'), '# dest\n');
  fs.writeFileSync(path.join(tree.dest, 'mcp-servers.yaml'), `servers:
  - id: secret-mcp
    enabled: false
    url: https://dest.test
`);
  const { runImport } = require('./data-import');
  const skipped = await runImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    agentsSkillsRoot: path.join(tree.root, 'no-agents'),
    userDataDir: tree.userData,
    selectedRels: [],
    selectedSkillIds: ['home:alpha'],
    selectedPluginNames: [],
    selectedMcpIds: ['secret-mcp'],
    importAttachments: false,
  });
  assert.equal(skipped.skills.find((row) => row.id === 'home:alpha').status, 'skipped');
  assert.equal(fs.readFileSync(path.join(tree.dest, 'skills', 'alpha', 'SKILL.md'), 'utf8'), '# dest\n');
  assert.match(fs.readFileSync(path.join(tree.dest, 'mcp-servers.yaml'), 'utf8'), /https:\/\/dest\.test/);

  const overwritten = await runImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    agentsSkillsRoot: path.join(tree.root, 'no-agents'),
    userDataDir: tree.userData,
    overwrite: true,
    selectedRels: [],
    selectedSkillIds: ['home:alpha'],
    selectedPluginNames: [],
    selectedMcpIds: ['secret-mcp'],
    importAttachments: false,
  });
  assert.equal(overwritten.skills[0].status, 'copied');
  assert.match(fs.readFileSync(path.join(tree.dest, 'skills', 'alpha', 'SKILL.md'), 'utf8'), /# alpha/);
  assert.match(fs.readFileSync(path.join(tree.dest, 'mcp-servers.yaml'), 'utf8'), /example\.test\/secure/);

  const escaped = await runImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    extraSkillDirs: [path.join(tree.source, 'skills')],
    agentsSkillsRoot: path.join(tree.root, 'no-agents'),
    userDataDir: tree.userData,
    selectedRels: ['../escape'],
    selectedSkillIds: ['extra:..'],
    selectedPluginNames: [],
    selectedMcpIds: [],
    importAttachments: false,
  });
  assert.equal(escaped.sessions[0].status, 'rejected');
  assert.equal(escaped.skills[0].status, 'rejected');
  assert.equal(fs.existsSync(path.join(tree.dest, 'escape')), false);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('runImport reports per-phase progress through onProgress', async () => {
  const tree = makeTree();
  const events = [];
  const { runImport } = require('./data-import');
  const result = await runImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    agentsSkillsRoot: path.join(tree.root, 'no-agents'),
    userDataDir: tree.userData,
    selectedRels: ['proj/sess-a', 'proj/sess-b'],
    selectedSkillIds: [],
    selectedPluginNames: [],
    selectedMcpIds: [],
    selectedSettingIds: [],
    selectedPresetIds: [],
    importAttachments: true,
    onProgress: (event) => events.push(event),
  });
  assert.equal(result.ok, true);
  const phases = events.map((event) => event.phase);
  assert.ok(phases.includes('sessions'), 'expected a sessions phase event');
  const sessionEvents = events.filter((event) => event.phase === 'sessions' && event.total === 2);
  assert.ok(sessionEvents.length >= 2, 'expected per-item session progress');
  const doneEvents = sessionEvents.map((event) => event.done).sort();
  assert.deepEqual([...new Set(doneEvents)], [1, 2]);
  assert.equal(events.at(-1).phase, 'done');
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('runImport honours AbortSignal between session copies and stays resumable', async () => {
  const tree = makeTree();
  const controller = new AbortController();
  let copies = 0;
  const { runImport } = require('./data-import');
  const result = await runImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    agentsSkillsRoot: path.join(tree.root, 'no-agents'),
    userDataDir: tree.userData,
    selectedRels: ['proj/sess-a', 'proj/sess-b'],
    selectedSkillIds: [],
    selectedPluginNames: [],
    selectedMcpIds: [],
    selectedSettingIds: [],
    selectedPresetIds: [],
    importAttachments: true,
    signal: controller.signal,
    onProgress: (event) => {
      if (event.phase === 'sessions' && event.done === 1) {
        copies += 1;
        controller.abort();
      }
    },
  });
  assert.equal(copies, 1);
  assert.equal(result.cancelled, true);
  assert.equal(result.ok, false);
  assert.equal(fs.existsSync(path.join(tree.dest, 'sessions', 'proj', 'sess-a', 'session.jsonl')), true);
  assert.equal(fs.existsSync(path.join(tree.dest, 'sessions', 'proj', 'sess-b')), false);
  const { readImportJournal } = require('./data-import');
  const journal = readImportJournal(tree.userData);
  assert.equal(journal.phase, 'copying', 'a cancelled import must stay recoverable like an interrupted one');
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('importSessions reuses a provided scan instead of rescanning the source', async () => {
  const tree = makeTree();
  const { importSessions } = require('./data-import');
  const fakeScan = {
    sourceHome: tree.source,
    destHome: tree.dest,
    sessions: [
      {
        rel: 'proj/sess-a',
        abs: path.join(tree.source, 'sessions', 'proj', 'sess-a'),
        unsupported: false,
        conflict: false,
      },
    ],
  };
  const result = await importSessions({
    scan: fakeScan,
    sourceHome: path.join(tree.root, 'does-not-exist'),
    destHome: tree.dest,
    selectedRels: ['proj/sess-a'],
    userDataDir: tree.userData,
    importAttachments: false,
  });
  assert.equal(result.sessions[0].status, 'copied');
  assert.equal(fs.existsSync(path.join(tree.dest, 'sessions', 'proj', 'sess-a', 'session.jsonl')), true);
  fs.rmSync(tree.root, { recursive: true, force: true });
});
