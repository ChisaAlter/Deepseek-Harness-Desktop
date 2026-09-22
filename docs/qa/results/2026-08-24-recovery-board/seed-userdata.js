'use strict';
const fs = require('fs');
const path = require('path');

const ud = path.join(process.env.APPDATA, 'Deepseek-Harness-Desktop');
const cfgPath = path.join(ud, 'config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
cfg.quitAfterStart = false;
cfg.autoStartDesktop = false;
cfg.askOnUpdate = false;
cfg.pluginRecovery = {
  skipUserPlugins: false,
  reason: '',
  at: '',
  appVersion: '',
};
fs.writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
fs.writeFileSync(path.join(ud, 'last-desktop-start.json'), `${JSON.stringify({
  ok: false,
  at: new Date().toISOString(),
  error: 'qa-live: cannot resolve profile bundle "qa-broken-pack"',
}, null, 2)}\n`);
console.log('rewrote clean utf8');
