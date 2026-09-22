'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  isOfficialDeepSeekBaseUrl,
  applyOfficialDeepSeekSpawnEnv,
} = require('./official-deepseek-env');

test('empty or whitespace baseUrl is official DeepSeek (public API default)', () => {
  assert.equal(isOfficialDeepSeekBaseUrl(undefined), true);
  assert.equal(isOfficialDeepSeekBaseUrl(''), true);
  assert.equal(isOfficialDeepSeekBaseUrl('   '), true);
});

test('api.deepseek.com https URLs are official', () => {
  assert.equal(isOfficialDeepSeekBaseUrl('https://api.deepseek.com'), true);
  assert.equal(isOfficialDeepSeekBaseUrl('https://api.deepseek.com/'), true);
  assert.equal(isOfficialDeepSeekBaseUrl('https://api.deepseek.com/v1'), true);
  assert.equal(isOfficialDeepSeekBaseUrl('https://API.DEEPSEEK.COM/v1'), true);
});

test('third-party, cleartext, and invalid URLs are not official DeepSeek', () => {
  assert.equal(isOfficialDeepSeekBaseUrl('https://ayase.cn/v1'), false);
  assert.equal(isOfficialDeepSeekBaseUrl('https://api.deepseek.com.evil.example/v1'), false);
  assert.equal(isOfficialDeepSeekBaseUrl('not a url'), false);
  assert.equal(isOfficialDeepSeekBaseUrl('ftp://api.deepseek.com'), false);
  assert.equal(isOfficialDeepSeekBaseUrl('http://api.deepseek.com'), false);
});

test('applyOfficialDeepSeekSpawnEnv never aliases onto a cleartext official host', () => {
  const env = applyOfficialDeepSeekSpawnEnv({}, {
    apiKey: 'sk-official',
    baseUrl: 'http://api.deepseek.com',
  });
  assert.equal(env.DEEPSEEK_API_KEY, undefined);
  assert.equal(env.DEEPSEEK_BASE_URL, undefined);
});

test('applyOfficialDeepSeekSpawnEnv does not write Ayase onto DEEPSEEK_*', () => {
  const env = applyOfficialDeepSeekSpawnEnv({}, {
    apiKey: 'ayase-key',
    baseUrl: 'https://ayase.cn/v1',
  });
  assert.equal(env.DEEPSEEK_API_KEY, undefined);
  assert.equal(env.DEEPSEEK_BASE_URL, undefined);
});

test('applyOfficialDeepSeekSpawnEnv leaves inherited DEEPSEEK_* when the shell gateway is third-party', () => {
  const env = applyOfficialDeepSeekSpawnEnv({
    DEEPSEEK_API_KEY: 'from-host',
    DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
  }, {
    apiKey: 'ayase-key',
    baseUrl: 'https://ayase.cn/v1',
  });
  assert.equal(env.DEEPSEEK_API_KEY, 'from-host');
  assert.equal(env.DEEPSEEK_BASE_URL, 'https://api.deepseek.com');
});

test('applyOfficialDeepSeekSpawnEnv writes official host and key', () => {
  const env = applyOfficialDeepSeekSpawnEnv({}, {
    apiKey: 'sk-official',
    baseUrl: 'https://api.deepseek.com/',
  });
  assert.equal(env.DEEPSEEK_API_KEY, 'sk-official');
  assert.equal(env.DEEPSEEK_BASE_URL, 'https://api.deepseek.com/anthropic');
});

test('applyOfficialDeepSeekSpawnEnv remaps bare and /v1 official roots onto the Messages endpoint', () => {
  for (const baseUrl of ['https://api.deepseek.com', 'https://api.deepseek.com/', 'https://api.deepseek.com/v1', 'https://api.deepseek.com/v1/']) {
    const env = applyOfficialDeepSeekSpawnEnv({}, { apiKey: 'k', baseUrl });
    assert.equal(env.DEEPSEEK_BASE_URL, 'https://api.deepseek.com/anthropic', baseUrl);
  }
});

test('applyOfficialDeepSeekSpawnEnv keeps an explicit /anthropic or other official path', () => {
  for (const baseUrl of ['https://api.deepseek.com/anthropic', 'https://api.deepseek.com/beta']) {
    const env = applyOfficialDeepSeekSpawnEnv({}, { apiKey: 'k', baseUrl });
    assert.equal(env.DEEPSEEK_BASE_URL, baseUrl, baseUrl);
  }
});

test('applyOfficialDeepSeekSpawnEnv writes the key without BASE_URL when baseUrl is empty', () => {
  const env = applyOfficialDeepSeekSpawnEnv({}, { apiKey: 'sk-official' });
  assert.equal(env.DEEPSEEK_API_KEY, 'sk-official');
  assert.equal(env.DEEPSEEK_BASE_URL, undefined);
});
