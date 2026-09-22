const { tokenFromHeaders, tokensEqual } = require('./remote-auth');

const RELAY_HOST_TOKEN_PATTERN = /^[A-Za-z0-9._~+/=-]{32,512}$/;

function normalizeRelayHostToken(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const token = value.trim();
  return RELAY_HOST_TOKEN_PATTERN.test(token) ? token : '';
}

function relayHostAuthorized(headers, expectedToken) {
  const expected = normalizeRelayHostToken(expectedToken);
  if (!expected) {
    return false;
  }
  return tokensEqual(tokenFromHeaders(headers || {}, '/'), expected);
}

module.exports = {
  normalizeRelayHostToken,
  relayHostAuthorized,
};
