const test = require('node:test');
const assert = require('node:assert/strict');
const { IPC_ROLES, ipcSenderRole, assertIpcSender } = require('./ipc-authorization');

function contents(url) {
  const mainFrame = { url };
  return { mainFrame };
}

function eventFor(sender, frame = sender.mainFrame) {
  return { sender, senderFrame: frame };
}

function options() {
  const boot = contents('file:///boot.html');
  const harness = contents('http://127.0.0.1:3080/chat');
  const marketplace = contents('file:///marketplace/index.html');
  const launcher = contents('file:///launcher.html');
  return {
    surfaces: {
      boot,
      harness,
      harnessOrigin: 'http://127.0.0.1:3080',
      marketplace,
      launcher,
    },
    isBootUrl: (url) => url === 'file:///boot.html',
    isMarketplaceUrl: (url) => url === 'file:///marketplace/index.html',
    isHarnessUrl: (url, origin) => new URL(url).origin === origin,
    isLauncherUrl: (url) => url === 'file:///launcher.html',
  };
}

test('IPC_ROLES does not define a marketplace sender', () => {
  assert.equal('MARKETPLACE' in IPC_ROLES, false);
  assert.equal(IPC_ROLES.MARKETPLACE, undefined);
  assert.deepEqual(
    Object.values(IPC_ROLES).sort(),
    [IPC_ROLES.BOOT, IPC_ROLES.HARNESS, IPC_ROLES.LAUNCHER].sort(),
  );
});

test('ipcSenderRole identifies only exact top-level desktop surfaces', () => {
  const policy = options();
  assert.equal(ipcSenderRole(eventFor(policy.surfaces.boot), policy), IPC_ROLES.BOOT);
  assert.equal(ipcSenderRole(eventFor(policy.surfaces.harness), policy), IPC_ROLES.HARNESS);
  assert.equal(ipcSenderRole(eventFor(policy.surfaces.launcher), policy), IPC_ROLES.LAUNCHER);
  assert.equal(ipcSenderRole(eventFor(policy.surfaces.marketplace), policy), null);

  const childFrame = { url: policy.surfaces.harness.mainFrame.url };
  assert.equal(ipcSenderRole(eventFor(policy.surfaces.harness, childFrame), policy), null);
  assert.equal(ipcSenderRole({ sender: policy.surfaces.harness }, policy), null);

  const unknown = contents('http://127.0.0.1:3080/chat');
  assert.equal(ipcSenderRole(eventFor(unknown), policy), null);
});

test('ipcSenderRole rejects a harness sender after cross-origin navigation', () => {
  const policy = options();
  policy.surfaces.harness.mainFrame.url = 'http://127.0.0.1:5173/';
  assert.equal(ipcSenderRole(eventFor(policy.surfaces.harness), policy), null);
});

test('assertIpcSender enforces per-surface capabilities', () => {
  const policy = options();
  assert.equal(
    assertIpcSender(eventFor(policy.surfaces.harness), [IPC_ROLES.HARNESS], policy),
    IPC_ROLES.HARNESS,
  );
  assert.throws(
    () => assertIpcSender(eventFor(policy.surfaces.boot), [IPC_ROLES.HARNESS], policy),
    (error) => error.code === 'ERR_DSH_IPC_SENDER',
  );
});
