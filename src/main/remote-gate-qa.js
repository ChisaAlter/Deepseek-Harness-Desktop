'use strict';

/**
 * Real-machine gate for unparked Remote: TC-NEG-001 + TC-REM-001.
 * Does not open the pairing URL / phone SPA (that is the scan-link path).
 */

const net = require('net');
const { PAGE_HELPERS, summarizeRemoteQaDetail } = require('./release-ui-walk');

const REMOTE_GATE_CASES = Object.freeze([
  { id: 'neg.available', title: 'Remote snapshot is available by default' },
  { id: 'neg.notEnabled', title: 'Remote stays off until the user turns it on' },
  { id: 'neg.notListening', title: 'Default config does not listen on the remote port' },
  { id: 'neg.footerPresent', title: 'Sidebar exposes the remote trigger' },
  { id: 'rem.enabledListening', title: 'Turning remote on opens the LAN listener' },
  { id: 'rem.pairingOffer', title: 'Enabled remote exposes a hash offer URL (not opened)' },
  { id: 'rem.qrVisible', title: 'Remote popup shows a QR face' },
  { id: 'rem.disabledStopped', title: 'Turning remote off stops the listener' },
  { id: 'cold.openShowsQr', title: 'Preset-on: open popup without toggling shows QR' },
  { id: 'cold.noBareOfferText', title: 'Popup text has no raw #offer= dump' },
  { id: 'cold.copyAndRotateControls', title: 'Popup exposes copy-link and rotate controls' },
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(probe, timeoutMs, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await probe();
    if (last) return last;
    await sleep(intervalMs);
  }
  return last;
}

function pageEval(wc, fn) {
  return wc.executeJavaScript(`(() => { ${PAGE_HELPERS}; return (${fn.toString()})(); })()`);
}

function makeRecorder(steps) {
  return (name, ok, detail, optional = false) => {
    const row = {
      name,
      ok: Boolean(ok),
      detail: detail == null ? '' : String(detail).slice(0, 600),
    };
    if (optional) row.optional = true;
    steps.push(row);
    console.log(`[DSH_QA_REMOTE] ${ok ? 'PASS' : (optional ? 'SKIP' : 'FAIL')} ${name}${row.detail ? ` — ${row.detail}` : ''}`);
  };
}

function remoteHasError(snap) {
  const err = snap?.error;
  return typeof err === 'string' ? err.trim().length > 0 : err != null;
}

function pairingOffer(snap) {
  const raw = Array.isArray(snap && snap.urls)
    ? (snap.urls.find((row) => row && row.pairingUrl) || {}).pairingUrl
    : '';
  return typeof raw === 'string' && raw.includes('#offer=') ? raw : '';
}

function portOpen(port) {
  const target = Number(port);
  if (!Number.isInteger(target) || target <= 0) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: target }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

function assertRemoteGateQaResult(qa) {
  if (!qa || qa.ok !== true) {
    const failed = (qa?.failed && qa.failed.length > 0)
      ? qa.failed
      : (qa?.steps || []).filter((s) => !s.ok && !s.optional).map((s) => `${s.name}: ${s.detail || ''}`);
    throw new Error(`Remote gate QA failed:\n${failed.join('\n')}\n${JSON.stringify(qa)}`);
  }
  const names = new Set((qa.steps || []).map((s) => s.name));
  const missing = REMOTE_GATE_CASES.map((c) => c.id).filter((id) => !names.has(id));
  if (missing.length > 0) {
    throw new Error(`Remote gate QA omitted required cases: ${missing.join(', ')}`);
  }
}

/**
 * @param {Electron.WebContents} wc
 * @param {{
 *   pressEscape: Function,
 *   probeRemote: () => Promise<object>,
 *   setRemote: (patch: object) => Promise<object>,
 * }} helpers
 */
async function runRemoteGateQa(wc, helpers) {
  const steps = [];
  const rec = makeRecorder(steps);

  await helpers.pressEscape(wc);

  let snap = null;
  try {
    snap = await helpers.probeRemote();
  } catch (error) {
    snap = { error: String(error) };
  }

  rec(
    'neg.available',
    snap && snap.available === true && !remoteHasError(snap),
    summarizeRemoteQaDetail(snap),
  );
  rec(
    'neg.notEnabled',
    snap != null && snap.enabled !== true && !remoteHasError(snap),
    snap ? `enabled=${snap.enabled}` : 'no snapshot',
  );
  const defaultPort = Number(snap && snap.port) || 3180;
  const listeningBefore = snap != null && snap.listening === true;
  const portBefore = await portOpen(defaultPort);
  rec(
    'neg.notListening',
    snap != null && !listeningBefore && !portBefore && !remoteHasError(snap),
    `listening=${snap && snap.listening}; portOpen=${portBefore}`,
  );

  const footer = await pageEval(wc, () => {
    const trigger = document.querySelector('[data-dsh-remote-trigger], [data-sidebar-action="remote"]');
    if (trigger && dshShown(trigger)) return 'trigger';
    return dshFind('^remote$|^远程$') ? 'label' : null;
  });
  rec('neg.footerPresent', footer != null, footer || 'no remote footer');

  let enabled = null;
  try {
    enabled = await helpers.setRemote({ remoteEnabled: true, remoteMode: 'lan' });
  } catch (error) {
    enabled = { error: String(error) };
  }
  enabled = await waitUntil(async () => {
    const next = await helpers.probeRemote();
    return next && next.listening === true ? next : null;
  }, 15_000) || enabled;

  const offer = pairingOffer(enabled);
  const portAfter = await portOpen(Number(enabled && enabled.port) || defaultPort);
  rec(
    'rem.enabledListening',
    enabled
      && enabled.available === true
      && enabled.enabled === true
      && enabled.listening === true
      && portAfter
      && !remoteHasError(enabled),
    `${summarizeRemoteQaDetail(enabled)}; portOpen=${portAfter}`,
  );
  rec(
    'rem.pairingOffer',
    Boolean(offer),
    offer ? 'pairingUrl has #offer= (not fetched)' : 'no pairingUrl with #offer=',
  );

  let qrDetail = 'remote trigger missing';
  let qrOk = false;
  if (footer) {
    await pageEval(wc, () => {
      const trigger = document.querySelector('[data-dsh-remote-trigger], [data-sidebar-action="remote"]');
      if (trigger) trigger.click();
      return Boolean(trigger);
    });
    const qr = await waitUntil(() => pageEval(wc, () => {
      const root = document.querySelector('[data-dsh-remote-popover], [data-dsh-remote-panel], [role="dialog"]')
        || document.body;
      const canvas = root.querySelector('canvas');
      const img = root.querySelector('img[src*="qr"], img[alt*="QR"], img[alt*="二维码"], svg');
      if (canvas && canvas.width > 0 && canvas.height > 0) return { kind: 'canvas', w: canvas.width, h: canvas.height };
      if (img) return { kind: img.tagName.toLowerCase() };
      const text = (root.innerText || '').slice(0, 200);
      return /二维码|QR|配对/.test(text) ? { kind: 'copy', text } : null;
    }), 8_000);
    qrOk = Boolean(qr);
    qrDetail = qr ? JSON.stringify(qr) : 'popup opened but no QR face';
    await helpers.pressEscape(wc);
  }
  rec('rem.qrVisible', qrOk, qrDetail);

  let disabled = null;
  try {
    disabled = await helpers.setRemote({ remoteEnabled: false });
  } catch (error) {
    disabled = { error: String(error) };
  }
  disabled = await waitUntil(async () => {
    const next = await helpers.probeRemote();
    return next && next.listening !== true ? next : null;
  }, 15_000) || disabled;
  const portStopped = !(await portOpen(Number(disabled && disabled.port) || defaultPort));
  rec(
    'rem.disabledStopped',
    disabled != null
      && disabled.enabled !== true
      && disabled.listening !== true
      && portStopped
      && !remoteHasError(disabled),
    `${summarizeRemoteQaDetail(disabled)}; portClosed=${portStopped}`,
  );

  // Cold-open segment: remote already on → open popup without setRemote(true).
  // Proves the Off→On dance is not required to surface a QR.
  let cold = null;
  try {
    cold = await helpers.setRemote({ remoteEnabled: true, remoteMode: 'lan' });
  } catch (error) {
    cold = { error: String(error) };
  }
  cold = await waitUntil(async () => {
    const next = await helpers.probeRemote();
    return next && next.listening === true && pairingOffer(next) ? next : null;
  }, 15_000) || cold;
  await helpers.pressEscape(wc);

  let coldQrOk = false;
  let coldQrDetail = 'remote trigger missing';
  let bareOffer = true;
  let copyOk = false;
  let rotateOk = false;
  if (footer) {
    await pageEval(wc, () => {
      const trigger = document.querySelector('[data-dsh-remote-trigger], [data-sidebar-action="remote"]');
      if (trigger) trigger.click();
      return Boolean(trigger);
    });
    const face = await waitUntil(() => pageEval(wc, () => {
      const root = document.querySelector('[data-dsh-remote-panel], [role="dialog"]') || document.body;
      const img = root.querySelector('img[src*="qr"], img[alt*="QR"], img[alt*="二维码"], svg');
      const copy = root.querySelector('[data-dsh-remote-copy-link]');
      const rotate = root.querySelector('[data-dsh-remote-rotate]');
      const text = root.innerText || '';
      return {
        hasQr: Boolean(img) || /二维码|QR|配对/.test(text.slice(0, 200)),
        bareOffer: text.includes('#offer='),
        copy: Boolean(copy && dshShown(copy)),
        rotate: Boolean(rotate && dshShown(rotate)),
      };
    }), 8_000);
    coldQrOk = Boolean(face && face.hasQr);
    coldQrDetail = face ? JSON.stringify(face) : 'popup opened but no QR face';
    bareOffer = Boolean(face && face.bareOffer);
    copyOk = Boolean(face && face.copy);
    rotateOk = Boolean(face && face.rotate);
    await helpers.pressEscape(wc);
  }
  rec(
    'cold.openShowsQr',
    coldQrOk && Boolean(pairingOffer(cold)) && !remoteHasError(cold),
    coldQrDetail,
  );
  rec(
    'cold.noBareOfferText',
    coldQrOk && !bareOffer,
    bareOffer ? 'popup text still dumps #offer=' : 'no bare #offer= in popup text',
  );
  rec(
    'cold.copyAndRotateControls',
    copyOk && rotateOk,
    `copy=${copyOk}; rotate=${rotateOk}`,
  );

  try {
    await helpers.setRemote({ remoteEnabled: false });
  } catch {
    // Best-effort teardown for the cold segment.
  }

  const failed = steps.filter((s) => !s.ok && !s.optional).map((s) => s.name);
  return {
    ok: failed.length === 0,
    failed,
    steps,
    cases: REMOTE_GATE_CASES.map((c) => c.id),
  };
}

module.exports = {
  REMOTE_GATE_CASES,
  runRemoteGateQa,
  assertRemoteGateQaResult,
  remoteHasError,
  pairingOffer,
  portOpen,
};
