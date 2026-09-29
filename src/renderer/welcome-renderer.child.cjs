'use strict';
const { app, nativeTheme } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertWelcomePresentation } = require('../main/smoke/welcome-presentation');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-welcome-render-'));
app.setPath('userData', fixture);
const root = process.env.DSH_WELCOME_TEST_ROOT || path.resolve(__dirname, '../..');
const { openWelcomeWindow } = require(path.join(root, 'src/main/welcome-window'));
const { resolveDesktopLocale } = require(path.join(root, 'src/main/desktop-locale'));
app.on('window-all-closed', () => {});
app.on('browser-window-created', (_event, win) => { win.on('show', () => win.hide()); });

app.whenReady().then(async () => {
  const cases = [];
  for (const theme of ['light', 'dark']) {
    nativeTheme.themeSource = theme;
    for (const language of ['zh-CN', 'en']) {
      let skipped = 0;
      const win = await openWelcomeWindow(resolveDesktopLocale(language), {
        takeNotice: () => null, startSignIn: () => null, cancelSignIn: () => null,
        copySignInLink: () => null, saveApiKey: () => ({ ok: true }), skip: () => { skipped++; },
      });
      await win.webContents.executeJavaScript('document.fonts.ready');
      const inspect = async () => {
        const result = await win.webContents.executeJavaScript(`(() => {
          try { return (${assertWelcomePresentation.toString()})(); }
          catch (error) { return { error: error.message }; }
        })()`);
        if (result?.error) throw new Error(result.error);
        return result;
      };
      assert.equal(await inspect(), true);
      const entry = await win.webContents.executeJavaScript(`({
        margin: getComputedStyle(document.body).margin,
        image: document.querySelector('img.brand').naturalWidth,
        font: getComputedStyle(document.getElementById('root')).fontFamily
      })`);
      assert.equal(entry.margin, '0px');
      assert.match(entry.font, /Montserrat/);
      await win.webContents.executeJavaScript(`document.getElementById('api-key').click()`);
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(await inspect(), true);
      await win.webContents.executeJavaScript(`document.getElementById('skip-key').click()`);
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(skipped, 1);
      // Mutations must fail the same guard used by packaged smoke.
      const css = await win.webContents.insertCSS('#root { display: block !important; }');
      await assert.rejects(inspect(), /Welcome presentation invalid/);
      await win.webContents.removeInsertedCSS(css);
      await win.webContents.executeJavaScript(`new Promise(resolve => {
        const img = document.querySelector('img.brand');
        img.onerror = resolve; img.src = 'missing-welcome-image.svg';
      })`);
      await assert.rejects(inspect(), /Welcome presentation invalid/);
      cases.push({ theme, language, ...entry, skipped });
      win.destroy();
    }
  }
  console.log('WELCOME_RESULT:' + JSON.stringify(cases));
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
