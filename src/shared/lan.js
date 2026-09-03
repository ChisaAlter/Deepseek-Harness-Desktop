const os = require('os');
const { encodeOffer } = require('./offer');

/**
 * Desktop built-in public Away relay — hardcoded for packaged Setup.exe.
 * Do not move these behind env/config files; empty user config falls back here.
 */
const DEFAULT_RELAY_HOST = '125.124.85.212';
const DEFAULT_RELAY_PORT = 8411;
const DEFAULT_RELAY_ENDPOINT = `${DEFAULT_RELAY_HOST}:${DEFAULT_RELAY_PORT}`;
/** Product default public relay origin (HTTP). Only this origin may skip HTTPS for legacy URL fields. */
const DEFAULT_RELAY_ORIGIN = `http://${DEFAULT_RELAY_ENDPOINT}`;
/** Transport default origin only — not a product SPA landing host (QR uses LAN :3180). */
const DEFAULT_APP_BASE_URL = DEFAULT_RELAY_ORIGIN;
/** Public nginx SPA for Away-mode QR. Port 3389 is the cloud-open HTTP port; :80 is also deployed but not in the security group. Never :8411. */
const DEFAULT_PUBLIC_APP_BASE_URL = `http://${DEFAULT_RELAY_HOST}:3389/dshd`;
const DEFAULT_RELAY_USE_TLS = false;

function isIpv4(address, family) {
  return family === 'IPv4' || family === 4 || /^\d{1,3}(\.\d{1,3}){3}$/.test(address);
}

/**
 * Adapter names that carry a private IPv4 but no phone can ever reach: Hyper-V /
 * WSL switches, Docker / VM bridges, VPN / proxy TUN devices. `os.networkInterfaces`
 * lists them alongside the real NIC with no other distinguishing fact, so the
 * name is the only usable signal (Windows: "vEthernet (WSL)", "singbox_tun").
 */
const VIRTUAL_ADAPTER_NAME = /vethernet|wsl|hyper-v|default switch|\btun\b|_tun|tun\d|\btap\b|vmware|vmnet|virtualbox|vbox|docker|br-|tailscale|zerotier|wireguard|\bwg\d|singbox|sing-box|clash|mihomo|utun|npcap|loopback|teredo|isatap/i;

/**
 * IPv4 candidates with their adapter name, real NICs first.
 * @returns {{ address: string, name: string, virtual: boolean }[]}
 */
function listLanCandidates() {
  const found = [];
  const seen = new Set();
  for (const [name, rows] of Object.entries(os.networkInterfaces())) {
    for (const row of rows || []) {
      if (!row || row.internal || !row.address || !isIpv4(row.address, row.family)) {
        continue;
      }
      if (seen.has(row.address)) {
        continue;
      }
      seen.add(row.address);
      found.push({ address: row.address, name, virtual: VIRTUAL_ADAPTER_NAME.test(name) });
    }
  }
  return found;
}

function listLanAddresses() {
  return listLanCandidates().map((row) => row.address);
}

/**
 * Link-local / CGNAT / common hypervisor adapters that should not land in a QR.
 * @param {string} address
 * @returns {boolean}
 */
function isVirtualOrLinkLocalIpv4(address) {
  const parts = String(address || '').split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }
  // 169.254.0.0/16 link-local
  if (parts[0] === 169 && parts[1] === 254) {
    return true;
  }
  // 100.64.0.0/10 CGNAT (often VPN/tailscale-ish)
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) {
    return true;
  }
  return false;
}

function isPrivateLanIpv4(address) {
  const parts = String(address || '').split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  if (parts[0] === 10) {
    return true;
  }
  if (parts[0] === 192 && parts[1] === 168) {
    return true;
  }
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
    return true;
  }
  return false;
}

function isLoopbackHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/**
 * Normalize a public SPA base URL for Away-mode QR (nginx path, not relay :8411).
 * @param {string} value
 * @param {{ relayEndpoint?: string }} [options]
 * @returns {string}
 */
function normalizePublicAppBaseUrl(value, options = {}) {
  const relayEndpoint = options.relayEndpoint ?? DEFAULT_RELAY_ENDPOINT;
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    return '';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return '';
  }
  const hostname = url.hostname;
  if (isLoopbackHostname(hostname) || isVirtualOrLinkLocalIpv4(hostname) || isPrivateLanIpv4(hostname)) {
    return '';
  }
  const hostPort = url.port ? `${hostname}:${url.port}` : hostname;
  if (url.port === '8411' || hostPort === relayEndpoint) {
    return '';
  }
  const pathname = url.pathname.replace(/\/$/, '');
  return `${url.protocol}//${url.host}${pathname}`;
}

/**
 * Pick a phone-reachable LAN IPv4 for pairing QR / SPA base.
 * Skips link-local and prefers RFC1918; empty when no usable NIC.
 * @param {string[]} [addresses]
 * @returns {string}
 */
/**
 * Rank one candidate for the QR: lower sorts first. Real RFC1918 NICs beat
 * hypervisor / TUN adapters, and among private ranges 192.168/16 (home and
 * office Wi-Fi) beats 10/8 beats 172.16/12 — the last is what Hyper-V, WSL,
 * Docker and proxy TUNs hand out, and a `.1` host there is almost always the
 * virtual gateway side, not this machine on a real LAN.
 * @param {{ address: string, virtual: boolean }} row
 * @returns {number}
 */
function lanCandidateRank(row) {
  const parts = row.address.split('.').map((part) => Number(part));
  let rank = 0;
  if (row.virtual) rank += 100;
  if (!isPrivateLanIpv4(row.address)) {
    rank += 50;
  } else if (parts[0] === 172) {
    rank += 20;
    if (parts[3] === 1) rank += 5;
  } else if (parts[0] === 10) {
    rank += 10;
  }
  return rank;
}

/**
 * Pick the address a phone on the same network can reach.
 * @param {(string | { address: string, name?: string, virtual?: boolean })[]} [addresses]
 * @returns {string} best address, or '' when nothing qualifies.
 */
function preferredLanIp(addresses = listLanCandidates()) {
  const usable = (Array.isArray(addresses) ? addresses : [])
    .map((row) => (typeof row === 'string'
      ? { address: row.trim(), virtual: false }
      : { address: String(row?.address || '').trim(), virtual: row?.virtual === true || VIRTUAL_ADAPTER_NAME.test(String(row?.name || '')) }))
    .filter((row) => row.address && row.address !== '127.0.0.1' && !isVirtualOrLinkLocalIpv4(row.address));
  if (usable.length === 0) {
    return '';
  }
  // Stable sort keeps enumeration order among equal ranks.
  return usable
    .map((row, index) => ({ row, index, rank: lanCandidateRank(row) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)[0].row.address;
}

/**
 * Normalize a relay origin: HTTPS always; HTTP only for the desktop default relay.
 * @param {string} value - user-entered relay URL.
 * @returns {string} origin or empty string.
 */
function normalizeRelayOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:') {
      return url.origin;
    }
    if (url.protocol === 'http:' && url.origin === DEFAULT_RELAY_ORIGIN) {
      return url.origin;
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * ChisaCode Away relay host (`hostname:port`). Rejects chisacode.sh.
 * Built-in desktop default is always allowed.
 * @param {string} value
 * @returns {string}
 */
function normalizeRelayEndpoint(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  const withoutScheme = raw.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!withoutScheme || /chisacode\.sh/i.test(withoutScheme)) {
    return '';
  }
  if (!/^[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(withoutScheme)) {
    return '';
  }
  return withoutScheme.includes(':') ? withoutScheme : `${withoutScheme}:443`;
}

/**
 * v1 RemoteGateway offer URL builder (dsh-v1 in hash). NOT used for product ChisaCode v2 QR.
 * Relay mode lands on relay origin — legacy tests only. Product: generateLocalPairingOffer + LAN :3180.
 */
function pairingUrl(address, port, token, options = {}) {
  const mode = options.mode === 'relay' ? 'relay' : 'lan';
  const relay = normalizeRelayOrigin(options.relay);
  const payload = {
    v: 1,
    token: token || '',
    mode,
  };
  if (mode === 'relay' && relay) {
    payload.relay = relay;
  }
  const tls = mode === 'lan' && options.tls === true;
  if (tls && typeof options.fp === 'string' && options.fp) {
    // Certificate SHA-256 so native clients can pin the self-signed LAN cert.
    payload.fp = options.fp;
  }
  const encoded = encodeOffer(payload);
  if (mode === 'relay' && relay) {
    return `${relay}/#offer=${encoded}`;
  }
  return `${tls ? 'https' : 'http'}://${address}:${Number(port) || 3180}/#offer=${encoded}`;
}

function publicUrl(address, port, options = {}) {
  return `${options.tls === true ? 'https' : 'http'}://${address}:${Number(port) || 3180}/`;
}

/**
 * Addresses the pairing UI may advertise for one bind address:
 * the wildcard exposes every LAN address, loopback only itself, and a
 * specific NIC only that NIC (when it is still present).
 * @param {string} bindAddress - normalized bind address from config.
 * @param {string[]} [addresses] - detected LAN addresses (defaults to a live scan).
 * @returns {string[]} addresses reachable through the current listener.
 */
function reachableAddresses(bindAddress, addresses = listLanAddresses()) {
  const bind = String(bindAddress || '0.0.0.0');
  if (bind === '0.0.0.0') {
    return addresses;
  }
  if (bind === '127.0.0.1') {
    return ['127.0.0.1'];
  }
  return addresses.includes(bind) ? [bind] : [bind];
}

module.exports = {
  DEFAULT_RELAY_HOST,
  DEFAULT_RELAY_PORT,
  DEFAULT_RELAY_ORIGIN,
  DEFAULT_RELAY_ENDPOINT,
  DEFAULT_APP_BASE_URL,
  DEFAULT_PUBLIC_APP_BASE_URL,
  DEFAULT_RELAY_USE_TLS,
  listLanAddresses,
  listLanCandidates,
  preferredLanIp,
  isVirtualOrLinkLocalIpv4,
  normalizeRelayOrigin,
  normalizeRelayEndpoint,
  normalizePublicAppBaseUrl,
  pairingUrl,
  publicUrl,
  reachableAddresses,
};
