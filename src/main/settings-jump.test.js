'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSettingsSection, buildSettingsSectionScript } = require('./settings-jump');

test('normalizeSettingsSection accepts known section ids and empty input', () => {
  for (const id of ['mcp', 'skills', 'plugins', 'about', 'agent-presets']) {
    assert.deepEqual(normalizeSettingsSection(id), { ok: true, section: id });
  }
  assert.deepEqual(normalizeSettingsSection(''), { ok: true, section: '' });
  assert.deepEqual(normalizeSettingsSection(undefined), { ok: true, section: '' });
  assert.deepEqual(normalizeSettingsSection('  mcp  '), { ok: true, section: 'mcp' });
});

test('normalizeSettingsSection rejects ids that could break out of the selector', () => {
  for (const id of [
    'MCP', 'mcp"', 'mcp\'s', 'a b', 'mcp<script>', '../../etc', 'mcp[1]', '中文',
    'mcp\nx', 'mcp tab',
  ]) {
    assert.equal(normalizeSettingsSection(id).ok, false, `expected rejection for ${JSON.stringify(id)}`);
  }
});

test('normalizeSettingsSection maps non-string input to the default section', () => {
  for (const id of [42, null, {}, ['mcp']]) {
    assert.deepEqual(normalizeSettingsSection(id), { ok: true, section: '' });
  }
});

test('buildSettingsSectionScript embeds the section id as a JSON string', () => {
  const script = buildSettingsSectionScript('mcp');
  assert.match(script, /data-dsh-settings-trigger/);
  assert.match(script, /const id = "mcp";/);
  assert.doesNotMatch(script, /data-dsh-settings-section="[^"]*mcp[^"]*"/);
});

test('buildSettingsSectionScript opens the default section for an empty id', () => {
  const script = buildSettingsSectionScript('');
  assert.match(script, /const id = "";/);
  assert.match(script, /if \(!id\) return true;/);
});

test('buildSettingsSectionScript survives a hostile section id without escaping the attribute', () => {
  const hostile = 'x"]; document.title = "pwned"; const y = ["';
  const script = buildSettingsSectionScript(hostile);
  // The raw value only appears inside a JSON string literal assignment.
  const encoded = JSON.stringify(hostile);
  assert.ok(script.includes(`const id = ${encoded};`));
  // The selector is always built from the quoted runtime variable, never from
  // interpolated source text.
  assert.match(script, /data-dsh-settings-section="' \+ id \+ '"/);
});
