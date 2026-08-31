const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { EventEmitter } = require('node:events');

test('boot caption disables drag while the harness BrowserView covers it', () => {
  const css = fs.readFileSync(path.join(__dirname, '../renderer/boot.css'), 'utf8');
  assert.match(css, /body\[data-harness-covered\] \.caption/);
  assert.match(css, /body\[data-harness-covered\] \.caption[\s\S]*?-webkit-app-region:\s*no-drag/);
});

test('boot failure actions include a download-log ghost button', () => {
  const html = fs.readFileSync(path.join(__dirname, '../renderer/boot.html'), 'utf8');
  const boot = fs.readFileSync(path.join(__dirname, '../renderer/boot.js'), 'utf8');
  assert.match(html, /id="save-log"/);
  assert.match(html, /<button type="button" class="ghost" id="save-log">/);
  assert.match(boot, /invoke\('saveBootLog'\)/);
  assert.doesNotMatch(boot, /saveLogEl\.disabled/);
});

test('boot log docks above the corner rails and clips older lines from the top', () => {
  const css = fs.readFileSync(path.join(__dirname, '../renderer/boot.css'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../renderer/boot.html'), 'utf8');
  assert.match(html, /<div class="log-dock">\s*<ol class="log" id="log"/);
  assert.match(css, /--boot-log-inset:\s*64px/);
  assert.match(css, /--boot-rail-inset:\s*16px/);
  assert.match(css, /--boot-rail-size:\s*28px/);
  assert.match(css, /\.log-dock[\s\S]*?position:\s*fixed/);
  assert.match(css, /\.log-dock[\s\S]*?bottom:\s*var\(--boot-log-inset\)/);
  assert.match(css, /\.log-dock[\s\S]*?left:\s*var\(--boot-log-inset\)/);
  assert.match(css, /\.log-dock[\s\S]*?justify-content:\s*flex-end/);
  assert.match(css, /\.log-dock[\s\S]*?overflow:\s*hidden/);
  assert.match(css, /\.stage[\s\S]*?padding:[^;]*boot-log-inset[^;]*boot-log-max/);
  assert.doesNotMatch(css, /\.log li\s*\{[^}]*opacity:\s*0/);
});

test('boot corner rails are fixed to the viewport and enclose the caption strip', () => {
  const css = fs.readFileSync(path.join(__dirname, '../renderer/boot.css'), 'utf8');
  assert.match(css, /\.rail\s*\{[\s\S]*?position:\s*fixed/);
  assert.match(css, /\.rail-tl\s*\{[^}]*top:\s*var\(--boot-rail-inset\)/);
  assert.match(css, /\.rail-tr\s*\{[^}]*top:\s*var\(--boot-rail-inset\)/);
  assert.doesNotMatch(css, /\.rail-tl\s*\{[^}]*--caption-h/);
  assert.doesNotMatch(css, /\.rail-tr\s*\{[^}]*--caption-h/);
});

test('window-control buttons are a no-drag hit target and ignore SVG pointer events', () => {
  const css = fs.readFileSync(path.join(__dirname, '../renderer/window-controls.css'), 'utf8');
  assert.match(css, /\.window-controls[\s\S]*?-webkit-app-region:\s*no-drag/);
  assert.match(css, /\.window-controls button svg[\s\S]*?pointer-events:\s*none/);
});

test('harness view relayouts on maximize and unmaximize', () => {
  const src = fs.readFileSync(path.join(__dirname, 'window.js'), 'utf8');
  assert.match(src, /win\.on\('maximize', relayout\)/);
  assert.match(src, /win\.on\('unmaximize', relayout\)/);
});

test('setBootHarnessCovered toggles the boot flag only on boot.html', () => {
  const electronPath = require.resolve('electron');
  const previous = require.cache[electronPath];
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      BrowserView: class {},
      BrowserWindow: class {},
      shell: { openExternal() {} },
      nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
      app: { isPackaged: false },
    },
  };
  try {
    delete require.cache[require.resolve('./window.js')];
    delete require.cache[require.resolve('./chrome.js')];
    delete require.cache[require.resolve('./paths.js')];
    const { rendererFile } = require('./paths.js');
    const { setBootHarnessCovered } = require('./window.js');
    const scripts = [];
    const bootWin = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        getURL: () => pathToFileURL(rendererFile('boot.html')).href,
        executeJavaScript(code) {
          scripts.push(code);
          return Promise.resolve();
        },
      },
    };
    setBootHarnessCovered(bootWin, true);
    setBootHarnessCovered(bootWin, false);
    assert.match(scripts[0], /toggleAttribute\('data-harness-covered', true\)/);
    assert.match(scripts[1], /toggleAttribute\('data-harness-covered', false\)/);

    const otherWin = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        getURL: () => 'http://127.0.0.1:3080/',
        executeJavaScript() {
          throw new Error('must not run on the harness view');
        },
      },
    };
    setBootHarnessCovered(otherWin, true);
  } finally {
    if (previous) {
      require.cache[electronPath] = previous;
    } else {
      delete require.cache[electronPath];
    }
    delete require.cache[require.resolve('./window.js')];
    delete require.cache[require.resolve('./chrome.js')];
    delete require.cache[require.resolve('./paths.js')];
  }
});

test('showBoot cancels a plugin boot watch before its first probe', { timeout: 1_000 }, async () => {
  const electronPath = require.resolve('electron');
  const chromePath = require.resolve('./chrome.js');
  const pathsPath = require.resolve('./paths.js');
  const cached = new Map([
    [electronPath, require.cache[electronPath]],
    [chromePath, require.cache[chromePath]],
    [pathsPath, require.cache[pathsPath]],
  ]);

  class FakeWebContents extends EventEmitter {
    constructor() {
      super();
      this.destroyed = false;
      this.url = '';
      this.probes = 0;
    }

    isDestroyed() { return this.destroyed; }
    getURL() { return this.url; }
    setWindowOpenHandler(handler) { this.windowOpenHandler = handler; }
    send() {}
    close() { this.destroyed = true; }

    loadURL(url) {
      this.url = url;
      return Promise.resolve();
    }

    executeJavaScript(script) {
      if (script.includes('data-dshd-boot-status')) {
        this.probes += 1;
      }
      return Promise.resolve({
        pending: true,
        ready: 0,
        total: 0,
        failed: false,
        hasApp: false,
        error: '',
      });
    }
  }

  class FakeBrowserView {
    constructor(options) {
      this.webContents = new FakeWebContents();
      this.webContents.ownerOptions = options;
    }

    setBounds() {}
    setAutoResize() {}
  }

  class FakeBrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.webContents = new FakeWebContents();
      this.webContents.ownerOptions = options;
      this.views = [];
    }

    isDestroyed() { return false; }
    setBackgroundColor() {}
    getContentBounds() { return { width: 1_440, height: 920 }; }
    getBrowserViews() { return this.views; }
    setTopBrowserView() {}
    show() {}

    addBrowserView(view) {
      if (!this.views.includes(view)) this.views.push(view);
    }

    removeBrowserView(view) {
      this.views = this.views.filter((candidate) => candidate !== view);
    }

    loadFile(file) {
      this.webContents.url = `file:///${file.replaceAll('\\\\', '/')}`;
      return Promise.resolve();
    }
  }

  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      BrowserView: FakeBrowserView,
      BrowserWindow: FakeBrowserWindow,
      shell: { openExternal() {} },
      nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
    },
  };
  require.cache[chromePath] = {
    id: chromePath,
    filename: chromePath,
    loaded: true,
    exports: {
      windowChrome: (options) => options,
      attachIntegratedChrome() {},
      hideNativeMenu() {},
      prepareHarnessChrome() {},
      syncHarnessChrome() {},
      currentTheme: () => ({ bg: '#ffffff' }),
    },
  };
  require.cache[pathsPath] = {
    id: pathsPath,
    filename: pathsPath,
    loaded: true,
    exports: {
      rendererFile: (name) => `C:/app/${name}`,
      assetFile: (name) => `C:/app/${name}`,
      preloadFile: () => 'C:/app/preload.js',
    },
  };

  try {
    delete require.cache[require.resolve('./window.js')];
    const { getHarnessWebContents, getMainWindow, showBoot, showHarness } = require('./window.js');
    const outcome = showHarness('http://127.0.0.1:3080/').then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    const harnessContents = getHarnessWebContents();
    assert.ok(harnessContents);
    assert.equal(harnessContents.probes, 0);
    assert.deepEqual(
      getMainWindow().webContents.ownerOptions.webPreferences.additionalArguments,
      ['--dshd-shell-role=boot'],
    );
    assert.deepEqual(
      harnessContents.ownerOptions.webPreferences.additionalArguments,
      ['--dshd-shell-role=harness', '--dshd-remote-feature=0'],
    );

    const sameOrigin = { prevented: false, preventDefault() { this.prevented = true; } };
    harnessContents.emit('will-navigate', sameOrigin, 'http://127.0.0.1:3080/chat');
    assert.equal(sameOrigin.prevented, false);

    const differentOrigin = { prevented: false, preventDefault() { this.prevented = true; } };
    harnessContents.emit('will-navigate', differentOrigin, 'http://127.0.0.1:5173/');
    assert.equal(differentOrigin.prevented, true);

    await showBoot();
    let timeout;
    const result = await Promise.race([
      outcome,
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve({ timedOut: true }), 250);
      }),
    ]);
    clearTimeout(timeout);
    assert.equal(result.timedOut, undefined, 'cancelled plugin watch must settle');
    assert.equal(result.error?.code, 'HARNESS_OPERATION_CANCELLED');
    assert.equal(harnessContents.probes, 0);
    assert.equal(harnessContents.isDestroyed(), true);
  } finally {
    for (const [modulePath, entry] of cached) {
      if (entry) require.cache[modulePath] = entry;
      else delete require.cache[modulePath];
    }
    delete require.cache[require.resolve('./window.js')];
  }
});
