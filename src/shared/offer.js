const OFFER_VERSION = 1;

function encodeOffer(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeOffer(raw) {
  try {
    const json = Buffer.from(String(raw || ''), 'base64url').toString('utf8');
    const value = JSON.parse(json);
    if (!value || value.v !== OFFER_VERSION || typeof value.token !== 'string' || !value.token) {
      return null;
    }
    return {
      v: OFFER_VERSION,
      token: value.token,
      mode: value.mode === 'relay' ? 'relay' : 'lan',
      relay: typeof value.relay === 'string' ? value.relay : '',
      // Optional self-signed LAN TLS certificate SHA-256 for native pinning.
      fp: typeof value.fp === 'string' ? value.fp : '',
    };
  } catch {
    return null;
  }
}

function offerFromHash(hash) {
  const match = String(hash || '').match(/(?:^|#|&)offer=([^&]+)/);
  return match ? decodeOffer(match[1]) : null;
}

module.exports = {
  OFFER_VERSION,
  encodeOffer,
  decodeOffer,
  offerFromHash,
};
