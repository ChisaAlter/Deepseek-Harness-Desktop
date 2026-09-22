const crypto = require('crypto');

const DEVICE_ID_BYTES = 8;
const FALLBACK_NAME = '设备';
const COMPUTER_NAME = '电脑';

function generateDeviceId() {
  return crypto.randomBytes(DEVICE_ID_BYTES).toString('hex');
}

function deviceName(userAgent) {
  const ua = String(userAgent || '');
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua) || /Mac OS X|Macintosh/i.test(ua) || /Linux/i.test(ua)) return COMPUTER_NAME;
  return FALLBACK_NAME;
}

function deviceBrowser(userAgent) {
  const ua = String(userAgent || '');
  if (/Edg(?:e|iOS|A)?\//i.test(ua)) return 'Edge';
  if (/SamsungBrowser\//i.test(ua)) return 'Samsung Internet';
  if (/Firefox\//i.test(ua) || /FxiOS\//i.test(ua)) return 'Firefox';
  if (/CriOS\//i.test(ua) || (/Chrome\//i.test(ua) && !/Edg/i.test(ua))) return 'Chrome';
  if (/Safari\//i.test(ua) && /Version\//i.test(ua)) return 'Safari';
  return '';
}

/**
 * Parse a stored user-agent into a short line for the device list.
 * Omits empty segments. Does not include the raw UA string.
 * @param {string} userAgent
 * @returns {string}
 */
function deviceDetail(userAgent) {
  const ua = String(userAgent || '');
  if (!ua) return '';
  const parts = [];
  if (/iPhone/i.test(ua)) {
    const ios = ua.match(/OS (\d+[_\d]*)/);
    parts.push(ios ? `iPhone · iOS ${ios[1].replaceAll('_', '.')}` : 'iPhone');
  } else if (/iPad/i.test(ua)) {
    const ios = ua.match(/OS (\d+[_\d]*)/);
    parts.push(ios ? `iPad · iOS ${ios[1].replaceAll('_', '.')}` : 'iPad');
  } else if (/Android/i.test(ua)) {
    const android = ua.match(/Android ([\d.]+)(?:; ([^;)]+))?/i);
    let line = 'Android';
    if (android) {
      line = `Android ${android[1]}`;
      const model = (android[2] || '').replace(/\s*Build\/.*$/i, '').trim();
      if (model && !/^(wv|Mobile)$/i.test(model)) line += ` · ${model}`;
    }
    parts.push(line);
  } else if (/Windows/i.test(ua)) {
    const arch = /ARM64/i.test(ua) ? 'ARM64' : /(Win64|x64|WOW64)/i.test(ua) ? 'x64' : '';
    parts.push(arch ? `Windows · ${arch}` : 'Windows');
  } else if (/Mac OS X|Macintosh/i.test(ua)) {
    const ver = ua.match(/Mac OS X (\d+[._]\d+(?:[._]\d+)?)/i);
    parts.push(ver ? `macOS ${ver[1].replaceAll('_', '.')}` : 'macOS');
  } else if (/Linux/i.test(ua)) {
    const arch = ua.match(/Linux ([a-z0-9_]+)/i);
    parts.push(arch ? `Linux ${arch[1]}` : 'Linux');
  }
  const browser = deviceBrowser(ua);
  if (browser) parts.push(browser);
  return parts.join(' · ');
}

function normalizeDevices(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const id = typeof item.id === 'string' ? item.id : '';
    const token = typeof item.token === 'string' ? item.token : '';
    if (!id || !token || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push({
      id,
      token,
      name: typeof item.name === 'string' && item.name ? item.name : FALLBACK_NAME,
      userAgent: typeof item.userAgent === 'string' ? item.userAgent : '',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
      lastSeenAt: typeof item.lastSeenAt === 'string' ? item.lastSeenAt : '',
    });
  }
  return out;
}

function publicDevices(devices, onlineIds) {
  const online = new Set(onlineIds || []);
  return normalizeDevices(devices).map((device) => {
    const detail = deviceDetail(device.userAgent);
    return {
      id: device.id,
      name: device.userAgent ? deviceName(device.userAgent) : device.name,
      createdAt: device.createdAt,
      lastSeenAt: device.lastSeenAt,
      online: online.has(device.id),
      shortId: device.id.slice(-4),
      ...(detail ? { detail } : {}),
    };
  });
}

function createDevice(userAgent, token) {
  const now = new Date().toISOString();
  const ua = String(userAgent || '').slice(0, 180);
  return {
    id: generateDeviceId(),
    token,
    name: deviceName(ua),
    userAgent: ua,
    createdAt: now,
    lastSeenAt: now,
  };
}

module.exports = {
  generateDeviceId,
  deviceName,
  deviceDetail,
  normalizeDevices,
  publicDevices,
  createDevice,
};
