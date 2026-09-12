'use strict';

/**
 * Skip compose contract plumbing (scripts/check-skip-compose-contract.js).
 * These tests cover the pure verdict + the spawn plumbing with an injected
 * runner; the REAL-CLI execution lives in after-pack (dist path) and the
 * standalone script — a mocked spawn here proves wiring, never CLI semantics.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CANARY_ID,
  INSTALL_ID,
  IM_ID,
  USAGE_ID,
  MARKET_ID,
  BOT_ID,
  SESSION_SEARCH_ID,
  composeContractProblems,
  composeContractRounds,
  runSkipComposeContract,
} = require('../../scripts/check-skip-compose-contract');

const DESKTOP_ROWS = `- id: ${INSTALL_ID}\n- id: ${USAGE_ID}\n- id: ${IM_ID}\n- id: ${MARKET_ID}\n- id: ${BOT_ID}\n`;
const FULL_ONLY_ROWS = `- id: ${SESSION_SEARCH_ID}\n  config:\n    openAt: first-search\n`;

test('composeContractProblems demands positive evidence before canary absence', () => {
  // Healthy skip dump: desktop rows present, canary gone.
  assert.deepEqual(composeContractProblems('skip', DESKTOP_ROWS), []);
  // Healthy full dump: all present.
  assert.deepEqual(
    composeContractProblems('full', `- id: ${CANARY_ID}\n${DESKTOP_ROWS}${FULL_ONLY_ROWS}`),
    [],
  );
  // Empty/truncated dump must fail on the missing desktop rows, not pass
  // because the canary vanished with everything else.
  const empty = composeContractProblems('skip', '');
  assert.equal(empty.length, 5);
  assert.match(empty[0], new RegExp(INSTALL_ID));
  assert.match(empty[1], new RegExp(USAGE_ID));
  assert.match(empty[2], new RegExp(IM_ID));
  assert.match(empty[3], new RegExp(MARKET_ID));
  assert.match(empty[4], new RegExp(BOT_ID));
  // Skip round that still composes the user layer is the core violation.
  const resurrect = composeContractProblems('skip', `${DESKTOP_ROWS}- id: ${CANARY_ID}\n`);
  assert.equal(resurrect.length, 1);
  assert.match(resurrect[0], /--skip-user-plugins 未生效/);
  // Full round without the canary means the canary probe itself is broken.
  const brokenProbe = composeContractProblems('full', `${DESKTOP_ROWS}${FULL_ONLY_ROWS}`);
  assert.equal(brokenProbe.length, 1);
  assert.match(brokenProbe[0], /canary/);
  // A second desktop row means a stale managed block composed next to the
  // overlay — the CLI's insert does not dedupe by id.
  const doubledInstall = composeContractProblems('full', `- id: ${CANARY_ID}\n${DESKTOP_ROWS}${FULL_ONLY_ROWS}- id: ${INSTALL_ID}\n`);
  assert.equal(doubledInstall.length, 1);
  assert.match(doubledInstall[0], /双挂载/);
  const doubledIm = composeContractProblems('full', `- id: ${CANARY_ID}\n${DESKTOP_ROWS}${FULL_ONLY_ROWS}- id: ${IM_ID}\n`);
  assert.equal(doubledIm.length, 1);
  assert.match(doubledIm[0], /dsh-im/);
  assert.match(doubledIm[0], /双挂载/);
  // Missing dsh-im alone is a violation too (built-in must ride every start).
  const missingIm = composeContractProblems('skip', `- id: ${INSTALL_ID}\n- id: ${USAGE_ID}\n- id: ${MARKET_ID}\n- id: ${BOT_ID}\n`);
  assert.equal(missingIm.length, 1);
  assert.match(missingIm[0], new RegExp(IM_ID));
  // Missing dshbot alone is a violation too (built-in must ride every start).
  const missingBot = composeContractProblems('skip', `- id: ${INSTALL_ID}\n- id: ${USAGE_ID}\n- id: ${IM_ID}\n- id: ${MARKET_ID}\n`);
  assert.equal(missingBot.length, 1);
  assert.match(missingBot[0], new RegExp(BOT_ID));
  const doubledBot = composeContractProblems('full', `- id: ${CANARY_ID}\n${DESKTOP_ROWS}${FULL_ONLY_ROWS}- id: ${BOT_ID}\n`);
  assert.equal(doubledBot.length, 1);
  assert.match(doubledBot[0], /dshbot/);
  assert.match(doubledBot[0], /双挂载/);
  const searchOnSkip = composeContractProblems('skip', `${DESKTOP_ROWS}${FULL_ONLY_ROWS}`);
  assert.equal(searchOnSkip.length, 1);
  assert.match(searchOnSkip[0], /session-search/);
  assert.deepEqual(composeContractProblems('full', `${CANARY_ID}\n${DESKTOP_ROWS}${FULL_ONLY_ROWS}`), []);
});

test('composeContractRounds mirrors production overlay order on skip and full starts', () => {
  const rounds = composeContractRounds('/h/apps/cli/lib/bin.js', [
    '/p/desktop-install.patch.yml',
    '/p/desktop-usage.patch.yml',
    '/p/desktop-dsh-im.patch.yml',
    '/p/desktop-market.patch.yml',
    '/p/desktop-dshbot.patch.yml',
  ], [
    '/p/desktop-install.patch.yml',
    '/p/desktop-usage.patch.yml',
    '/p/session-search.patch.yml',
    '/p/desktop-dsh-im.patch.yml',
    '/p/desktop-market.patch.yml',
    '/p/desktop-dshbot.patch.yml',
  ]);
  assert.deepEqual(rounds.map((row) => row.round), ['skip', 'full']);
  assert.deepEqual(rounds[0].args, [
    '/h/apps/cli/lib/bin.js', 'web', '--skip-user-plugins',
    '--patch', '/p/desktop-install.patch.yml',
    '--patch', '/p/desktop-usage.patch.yml',
    '--patch', '/p/desktop-dsh-im.patch.yml',
    '--patch', '/p/desktop-market.patch.yml',
    '--patch', '/p/desktop-dshbot.patch.yml',
    '--dump-config',
  ]);
  assert.deepEqual(rounds[1].args, [
    '/h/apps/cli/lib/bin.js', 'web',
    '--patch', '/p/desktop-install.patch.yml',
    '--patch', '/p/desktop-usage.patch.yml',
    '--patch', '/p/session-search.patch.yml',
    '--patch', '/p/desktop-dsh-im.patch.yml',
    '--patch', '/p/desktop-market.patch.yml',
    '--patch', '/p/desktop-dshbot.patch.yml',
    '--dump-config',
  ]);
});

function fakeHarnessRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-harness-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'apps', 'cli', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps', 'cli', 'lib', 'bin.js'), '// stub, never executed\n');
  return root;
}

function healthyStdout(args) {
  const skip = args.includes('--skip-user-plugins');
  return skip ? DESKTOP_ROWS : `- id: ${CANARY_ID}\n${DESKTOP_ROWS}${FULL_ONLY_ROWS}`;
}

test('runSkipComposeContract replays the managed-block migration and passes overlays on both rounds', async (t) => {
  const root = fakeHarnessRoot(t);
  const calls = [];
  const result = await runSkipComposeContract(root, {
    spawnSync: (nodeBin, args, options) => {
      calls.push({ nodeBin, args, options });
      return { status: 0, stdout: healthyStdout(args) };
    },
  });
  assert.deepEqual(result, { ok: true, rounds: 2 });
  assert.equal(calls.length, 2);
  const [skipCall, fullCall] = calls;
  assert.equal(skipCall.args[0], path.join(root, 'apps', 'cli', 'lib', 'bin.js'));
  assert.equal(skipCall.args[1], 'web');
  assert.equal(skipCall.args[2], '--skip-user-plugins');
  assert.equal(skipCall.args[3], '--patch');
  // The overlays are generated by the REAL ensures inside the temp home —
  // including the migration that strips the seeded managed blocks while
  // keeping the canary user row (asserted inside the run).
  const home = skipCall.options.env.DSH_HOME;
  assert.ok(home && home.startsWith(os.tmpdir()));
  const installOverlay = path.join(home, 'profiles', 'web', 'desktop-plugins', 'install-dsh-plugin', 'desktop-install.patch.yml');
  const usageOverlay = path.join(home, 'profiles', 'web', 'desktop-plugins', 'dsh-usage-panel', 'desktop-usage-panel.patch.yml');
  const imOverlay = path.join(home, 'profiles', 'web', 'desktop-plugins', 'dsh-im', 'desktop-dsh-im.patch.yml');
  const marketOverlay = path.join(home, 'profiles', 'web', 'desktop-plugins', 'dsh-market', 'desktop-dsh-market.patch.yml');
  const botOverlay = path.join(home, 'profiles', 'web', 'desktop-plugins', 'dshbot', 'desktop-dshbot.patch.yml');
  const searchOverlay = path.join(home, 'profiles', 'web', 'desktop-plugins', 'session-search', 'desktop-session-search.patch.yml');
  assert.equal(skipCall.args[4], installOverlay);
  assert.equal(skipCall.args[5], '--patch');
  assert.equal(skipCall.args[6], usageOverlay);
  assert.equal(skipCall.args[7], '--patch');
  assert.equal(skipCall.args[8], imOverlay);
  assert.equal(skipCall.args[9], '--patch');
  assert.equal(skipCall.args[10], marketOverlay);
  assert.equal(skipCall.args[11], '--patch');
  assert.equal(skipCall.args[12], botOverlay);
  assert.equal(skipCall.args[13], '--dump-config');
  // dsh-home rule: the child composes only against the throwaway home.
  assert.equal(skipCall.options.env.DSHD_HOME, undefined);
  assert.equal(skipCall.options.env.DSH_HARNESS_ROOT, undefined);
  // Full starts add session-search between usage and dsh-im; market and
  // dshbot trail in production order.
  assert.deepEqual(fullCall.args.slice(1), [
    'web', '--patch', installOverlay,
    '--patch', usageOverlay,
    '--patch', searchOverlay,
    '--patch', imOverlay,
    '--patch', marketOverlay,
    '--patch', botOverlay,
    '--dump-config',
  ]);
  // The throwaway home is removed after the run.
  assert.equal(fs.existsSync(home), false);
});

test('runSkipComposeContract fails when the full round composes the install row twice', async (t) => {
  const root = fakeHarnessRoot(t);
  await assert.rejects(
    () => runSkipComposeContract(root, {
      spawnSync: (nodeBin, args) => {
        const skip = args.includes('--skip-user-plugins');
        return {
          status: 0,
          stdout: skip
            ? DESKTOP_ROWS
            : `- id: ${CANARY_ID}\n${DESKTOP_ROWS}- id: ${INSTALL_ID}\n`,
        };
      },
    }),
    /双挂载/,
  );
});

test('runSkipComposeContract fails when the skip round drops the dsh-im row', async (t) => {
  const root = fakeHarnessRoot(t);
  await assert.rejects(
    () => runSkipComposeContract(root, {
      spawnSync: (nodeBin, args) => {
        const skip = args.includes('--skip-user-plugins');
        return {
          status: 0,
          stdout: skip ? `- id: ${INSTALL_ID}\n` : `- id: ${CANARY_ID}\n${DESKTOP_ROWS}`,
        };
      },
    }),
    new RegExp(IM_ID),
  );
});

test('runSkipComposeContract fails on user-layer resurrection under skip', async (t) => {
  const root = fakeHarnessRoot(t);
  await assert.rejects(
    () => runSkipComposeContract(root, {
      spawnSync: () => ({ status: 0, stdout: `${DESKTOP_ROWS}- id: ${CANARY_ID}\n` }),
    }),
    /--skip-user-plugins 未生效/,
  );
});

test('runSkipComposeContract surfaces a nonzero dump-config exit with stderr', async (t) => {
  const root = fakeHarnessRoot(t);
  await assert.rejects(
    () => runSkipComposeContract(root, {
      spawnSync: () => ({ status: 1, stdout: '', stderr: 'dsh: cannot resolve profile bundle "@deepseek-ai/dsh-web-app"' }),
    }),
    (error) => {
      assert.match(String(error.message), /退出码 1/);
      assert.match(String(error.message), /cannot resolve profile bundle/);
      return true;
    },
  );
});

test('runSkipComposeContract refuses a runtime without the built CLI', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-empty-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await assert.rejects(() => runSkipComposeContract(root), /缺少已构建的 CLI/);
});
