'use strict';

/**
 * True when `baseUrl` would carry a credential off this machine in
 * cleartext: a parseable `http:` URL whose hostname is not loopback.
 * Loopback http stays allowed — local OpenAI-compatible gateways are a
 * supported setup and nothing leaves the host. Empty, unparseable, or
 * non-http input is not cleartext (unparseable values fail at fetch).
 * @param {unknown} baseUrl
 * @returns {boolean}
 */
function isCleartextBaseUrl(baseUrl) {
  const raw = typeof baseUrl === 'string' ? baseUrl.trim() : '';
  if (!raw) return false;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:') return false;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1';
}

module.exports = { isCleartextBaseUrl };
