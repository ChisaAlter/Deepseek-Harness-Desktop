const OFFER_VERSION = 1;

function padBase64(value) {
  const padded = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  return padded + '='.repeat((4 - (padded.length % 4)) % 4);
}

function utf8FromBase64Url(raw) {
  const binary = atob(padBase64(raw));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function decodeOffer(raw) {
  try {
    const value = JSON.parse(utf8FromBase64Url(raw));
    if (!value || value.v !== OFFER_VERSION || typeof value.token !== 'string' || !value.token) {
      return null;
    }
    return {
      v: OFFER_VERSION,
      token: value.token,
      mode: value.mode === 'relay' ? 'relay' : 'lan',
      relay: typeof value.relay === 'string' ? value.relay : '',
    };
  } catch {
    return null;
  }
}

function offerFromHash(hash) {
  const match = String(hash || '').match(/(?:^|#|&)offer=([^&]+)/);
  return match ? decodeOffer(match[1]) : null;
}

// 「带了 #offer= 但解不开」必须和「根本没有 offer」分开处理：
// 前者是配对失败，要给用户报错；后者才走静默的 Cookie 试探（C9）。
function hashHasOffer(hash) {
  return /(?:^|#|&)offer=[^&]+/.test(String(hash || ''));
}

function offerFromPaste(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const fromText = offerFromHash(text.startsWith('#') ? text : `#${text}`);
  if (fromText) return fromText;
  try {
    return offerFromHash(new URL(text).hash);
  } catch {
    return null;
  }
}

export { OFFER_VERSION, decodeOffer, offerFromHash, offerFromPaste, hashHasOffer };
