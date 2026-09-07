const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  createPreviewController,
  DISCOVER_PORTS,
  discoverLocalServers,
  isAllowedPreviewUrl,
  previewRequestFilter,
  registerPreviewIpc,
} = require('./preview.js');
const { createPreviewSessionCache } = require('./preview-session.js');
const {
  PREVIEW_PIP_FRAME_CHANNEL,
  PREVIEW_PIP_FRAME_INTERVAL_MS,
  fitPictureInPictureContentSize,
} = require('./preview-pip-protocol.js');

const leftoverPrimaryCss = `--${['t', '3'].join('')}-primary`;

function fakePartitionSession() {
  return {
    storageClears: [],
    cacheClears: 0,
    getUserAgent() {
      return 'Mozilla/5.0';
    },
    setUserAgent() {},
    setPermissionRequestHandler() {},
    setPermissionCheckHandler() {},
    clearStorageData(options) {
      this.storageClears.push(options);
      return Promise.resolve();
    },
    clearCache() {
      this.cacheClears += 1;
      return Promise.resolve();
    },
  };
}

function fakeAttach() {
  const navigations = [];
  const redirects = [];
  const loads = [];
  const destroyed = [];
  const views = [];

  function attach({ id, url, bounds, partition, extraHeaders }) {
    const listeners = new Map();
    const requestListeners = [];
    let zoomFactor = 1;
    const session = fakePartitionSession();
    const guestDebugger = {
      attached: false,
      attachCalls: [],
      commands: [],
      isAttached() {
        return this.attached;
      },
      attach(protocol) {
        this.attachCalls.push(protocol);
        this.attached = true;
      },
      sendCommand(method, params) {
        this.commands.push({ method, params });
        return Promise.resolve();
      },
    };
    const ipcListeners = new Map();
    const webContents = {
      history: [],
      index: -1,
      recordedEvents: [],
      session,
      debugger: guestDebugger,
      stopped: false,
      focused: false,
      destroyed: false,
      title: '',
      sent: [],
      captureRects: [],
      jpegQualities: [],
      ipc: {
        on(channel, listener) {
          const list = ipcListeners.get(channel) ?? [];
          list.push(listener);
          ipcListeners.set(channel, list);
        },
        removeListener(channel, listener) {
          const list = ipcListeners.get(channel) ?? [];
          ipcListeners.set(channel, list.filter((item) => item !== listener));
        },
        emit(channel, ...args) {
          for (const listener of ipcListeners.get(channel) ?? []) listener({}, ...args);
        },
      },
      send(channel, ...args) {
        this.sent.push([channel, ...args]);
      },
      focus() {
        this.focused = true;
      },
      isFocused() {
        return this.focused === true;
      },
      isDestroyed() {
        return this.destroyed === true;
      },
      getTitle() {
        return this.title;
      },
      on(event, listener) {
        this.recordedEvents.push(event);
        const list = listeners.get(event) ?? [];
        list.push(listener);
        listeners.set(event, list);
      },
      once(event, listener) {
        const wrap = (...args) => {
          this.off(event, wrap);
          listener(...args);
        };
        this.on(event, wrap);
      },
      off(event, listener) {
        const list = listeners.get(event) ?? [];
        listeners.set(event, list.filter((item) => item !== listener));
      },
      emit(event, ...args) {
        for (const listener of listeners.get(event) ?? []) listener(...args);
      },
      loadURL(next, options) {
        loads.push({ id, url: next, options: options ?? null });
        view.url = next;
        if (this.index < 0) {
          this.history = [next];
          this.index = 0;
        } else {
          this.history = this.history.slice(0, this.index + 1);
          this.history.push(next);
          this.index = this.history.length - 1;
        }
        for (const listener of listeners.get('did-navigate') ?? []) listener();
        for (const listener of listeners.get('did-navigate-in-page') ?? []) listener();
      },
      getURL() {
        return this.history[this.index] ?? view.url;
      },
      canGoBack() {
        return this.index > 0;
      },
      canGoForward() {
        return this.index < this.history.length - 1;
      },
      goBack() {
        if (this.index > 0) this.index -= 1;
        view.url = this.history[this.index];
        for (const listener of listeners.get('did-navigate') ?? []) listener();
        for (const listener of listeners.get('did-navigate-in-page') ?? []) listener();
      },
      goForward() {
        if (this.index < this.history.length - 1) this.index += 1;
        view.url = this.history[this.index];
        for (const listener of listeners.get('did-navigate') ?? []) listener();
        for (const listener of listeners.get('did-navigate-in-page') ?? []) listener();
      },
      reload() {
        loads.push({ id, url: this.getURL(), options: { reload: true } });
      },
      reloadIgnoringCache() {
        loads.push({ id, url: this.getURL(), options: { reloadIgnoringCache: true } });
      },
      stop() {
        this.stopped = true;
      },
      setZoomFactor(next) {
        zoomFactor = next;
      },
      getZoomFactor() {
        return zoomFactor;
      },
      capturePage(rect) {
        this.captureRects.push(rect);
        const width = rect && rect.width ? rect.width : 100;
        const height = rect && rect.height ? rect.height : 80;
        return {
          toPNG: () => Buffer.from('png'),
          toJPEG: (quality) => {
            webContents.jpegQualities.push(quality);
            return Buffer.from('jpeg');
          },
          toDataURL: () => `data:image/png;base64,${Buffer.from('png').toString('base64')}`,
          getSize: () => ({ width, height }),
        };
      },
      executed: [],
      executeJavaScript(code) {
        this.executed.push(code);
        if (typeof this.executeJavaScriptImpl === 'function') {
          return Promise.resolve(this.executeJavaScriptImpl(code));
        }
        return Promise.resolve(undefined);
      },
      isLoading() {
        return false;
      },
      openDevTools(options) {
        view.devTools = options ?? true;
      },
    };
    const view = {
      id,
      url,
      bounds: bounds ?? null,
      visible: true,
      partition,
      extraHeaders: extraHeaders ?? null,
      session,
      webContents,
      setBounds(next) {
        view.bounds = next;
      },
      setVisible(visible) {
        view.visible = visible;
      },
      webRequest: {
        onBeforeRequest(_filter, listener) {
          requestListeners.push(listener);
        },
      },
      destroy() {
        destroyed.push(id);
      },
      emit(event, ...args) {
        webContents.emit(event, ...args);
      },
      emitBeforeInput(input) {
        const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
        webContents.emit('before-input-event', event, input);
        return event;
      },
      emitRequest(next, resourceType = 'mainFrame') {
        let decision = { cancel: false };
        for (const listener of requestListeners) {
          listener({ url: next, resourceType }, (result) => { decision = result; });
        }
        return decision;
      },
      emitNavigate(next) {
        const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
        for (const listener of listeners.get('will-navigate') ?? []) listener(event, next);
        navigations.push({ url: next, prevented: event.defaultPrevented });
        return event;
      },
      emitRedirect(next) {
        const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
        for (const listener of listeners.get('will-redirect') ?? []) listener(event, next);
        redirects.push({ url: next, prevented: event.defaultPrevented });
        return event;
      },
    };
    views.push(view);
    return view;
  }

  return { attach, navigations, redirects, loads, destroyed, views };
}

function fakePipWindow() {
  const listeners = new Map();
  let destroyed = false;
  let contentSize = [480, 320];
  const sent = [];
  const window = {
    options: null,
    loadURLs: [],
    showInactiveCalls: 0,
    aspectRatioCalls: [],
    contentSizeCalls: [],
    alwaysOnTopCalls: [],
    closed: false,
    sent,
    webContents: {
      send(channel, payload) {
        sent.push([channel, payload]);
      },
    },
    loadURL(url) {
      window.loadURLs.push(url);
      return Promise.resolve();
    },
    showInactive() {
      window.showInactiveCalls += 1;
    },
    setAlwaysOnTop(...args) {
      window.alwaysOnTopCalls.push(args);
    },
    setVisibleOnAllWorkspaces() {},
    setAspectRatio(ratio) {
      window.aspectRatioCalls.push(ratio);
    },
    setContentSize(width, height, animate) {
      window.contentSizeCalls.push([width, height, animate]);
      contentSize = [width, height];
    },
    getContentSize() {
      return contentSize.slice();
    },
    isDestroyed() {
      return destroyed;
    },
    once(event, listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
    },
    close() {
      if (destroyed) return;
      destroyed = true;
      window.closed = true;
      for (const listener of listeners.get('closed') ?? []) listener();
    },
    destroy() {
      window.close();
    },
  };
  return window;
}

function createPipFactory() {
  const created = [];
  function createPipWindow(options) {
    const win = fakePipWindow();
    win.options = options;
    created.push(win);
    return win;
  }
  return { createPipWindow, created };
}

function stubWideCapture(webContents) {
  webContents.capturePage = function capturePage(rect) {
    this.captureRects.push(rect);
    return {
      toPNG: () => Buffer.from('png'),
      toJPEG: (quality) => {
        this.jpegQualities.push(quality);
        return Buffer.from('jpeg-frame');
      },
      getSize: () => ({ width: 1280, height: 720 }),
    };
  };
}

test('isAllowedPreviewUrl accepts http://127.0.0.1 with any port', () => {
  assert.equal(isAllowedPreviewUrl('http://127.0.0.1:3000'), true);
  assert.equal(isAllowedPreviewUrl('http://127.0.0.1'), true);
  assert.equal(isAllowedPreviewUrl('http://127.0.0.1:8080/app'), true);
});

test('isAllowedPreviewUrl accepts IPv6 loopback with WHATWG brackets', () => {
  assert.equal(isAllowedPreviewUrl('http://[::1]:3000'), true);
  assert.equal(isAllowedPreviewUrl('http://[::1]/app'), true);
});

test('isAllowedPreviewUrl accepts any http(s) document URL', () => {
  assert.equal(isAllowedPreviewUrl('https://example.com'), true);
  assert.equal(isAllowedPreviewUrl('http://evil.example'), true);
  assert.equal(isAllowedPreviewUrl('file:///etc/passwd'), false);
  assert.equal(isAllowedPreviewUrl('javascript:alert(1)'), false);
  assert.equal(isAllowedPreviewUrl('ftp://example.com'), false);
});

test('isAllowedPreviewUrl accepts 0.0.0.0 and previewOpen rewrites it to 127.0.0.1', async () => {
  assert.equal(isAllowedPreviewUrl('http://0.0.0.0:5173/'), true);
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const result = await preview.open({ url: 'http://0.0.0.0:5173/app' });
  assert.equal(result.ok, true);
  assert.equal(result.url, 'http://127.0.0.1:5173/app');
  assert.deepEqual(fake.loads, [{ id: result.id, url: 'http://127.0.0.1:5173/app', options: null }]);
});

test('previewRequestFilter allows http(s) frames and remote subresources', () => {
  assert.deepEqual(previewRequestFilter({ url: 'https://example.com/', resourceType: 'mainFrame' }), { cancel: false });
  assert.deepEqual(previewRequestFilter({ url: 'https://example.com/embed', resourceType: 'subFrame' }), { cancel: false });
  assert.deepEqual(previewRequestFilter({ url: 'https://cdn.example/font.woff2', resourceType: 'font' }), { cancel: false });
  assert.deepEqual(previewRequestFilter({ url: 'https://cdn.example/app.js', resourceType: 'script' }), { cancel: false });
  assert.deepEqual(previewRequestFilter({ url: 'http://127.0.0.1:4173/app', resourceType: 'mainFrame' }), { cancel: false });
  assert.deepEqual(previewRequestFilter({ url: 'http://[::1]:3000/', resourceType: 'mainFrame' }), { cancel: false });
  assert.deepEqual(previewRequestFilter({ url: 'file:///etc/passwd', resourceType: 'mainFrame' }), { cancel: true });
  // Missing resourceType is treated as a document navigation.
  assert.deepEqual(previewRequestFilter({ url: 'https://example.com/page' }), { cancel: false });
  assert.deepEqual(previewRequestFilter({ url: 'file:///etc/passwd' }), { cancel: true });
});

test('previewOpen succeeds for http://127.0.0.1 and attaches an isolated view', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const result = await preview.open({ url: 'http://127.0.0.1:4173', bounds: { x: 10, y: 20, width: 400, height: 300 } });
  assert.equal(result.ok, true);
  assert.equal(typeof result.id, 'string');
  assert.equal(result.url, 'http://127.0.0.1:4173');
  assert.equal(fake.views.length, 1);
  assert.match(fake.views[0].partition, /^persist:dshd-preview-[0-9a-f]{20}$/);
  assert.equal(fake.views[0].extraHeaders, null);
  assert.deepEqual(fake.loads, [{ id: result.id, url: 'http://127.0.0.1:4173', options: null }]);
});

test('previewOpen rejects a file: URL and does not attach a view', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const result = await preview.open({ url: 'file:///etc/passwd' });
  assert.equal(result.ok, false);
  assert.equal(result.message, 'Preview only opens http(s) URLs.');
  assert.equal(fake.views.length, 0);
  assert.equal(fake.loads.length, 0);
});

test('previewOpen hashes the persist partition from scope', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const opened = await preview.open({ url: 'https://example.com', scope: '/tmp/proj' });
  assert.equal(opened.ok, true);
  assert.equal(opened.url, new URL('https://example.com').href);
  assert.match(fake.views[0].partition, /^persist:dshd-preview-[0-9a-f]{20}$/);
  const empty = await preview.open({ url: 'https://example.com', scope: '' });
  assert.equal(empty.ok, true);
  assert.match(fake.views[1].partition, /^persist:dshd-preview-[0-9a-f]{20}$/);
  assert.notEqual(fake.views[0].partition, fake.views[1].partition);
});

test('onBeforeRequest allows http(s) iframes and CDN fonts and cancels file: documents', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  assert.equal(opened.ok, true);
  const view = fake.views[0];
  assert.deepEqual(view.emitRequest('https://example.com/iframe', 'subFrame'), { cancel: false });
  assert.deepEqual(view.emitRequest('http://127.0.0.1:3000/next', 'mainFrame'), { cancel: false });
  assert.deepEqual(view.emitRequest('https://fonts.googleapis.com/css', 'stylesheet'), { cancel: false });
  assert.deepEqual(view.emitRequest('file:///etc/passwd', 'mainFrame'), { cancel: true });
});

test('will-navigate allows http(s) and prevents file:', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  assert.equal(opened.ok, true);
  const view = fake.views[0];
  const navigate = view.emitNavigate('https://example.com/steal');
  const redirect = view.emitRedirect('https://evil.example/key');
  assert.equal(navigate.defaultPrevented, false);
  assert.equal(redirect.defaultPrevented, false);
  const local = view.emitNavigate('http://127.0.0.1:3000/next');
  assert.equal(local.defaultPrevented, false);
  const fileNav = view.emitNavigate('file:///etc/passwd');
  const fileRedirect = view.emitRedirect('file:///etc/passwd');
  assert.equal(fileNav.defaultPrevented, true);
  assert.equal(fileRedirect.defaultPrevented, true);
});

test('previewNavigate loads a public http(s) URL', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  const allowed = await preview.navigate(opened.id, 'https://example.com');
  assert.equal(allowed.ok, true);
  assert.equal(fake.loads.at(-1).url, new URL('https://example.com').href);
  const denied = await preview.navigate(opened.id, 'file:///etc/passwd');
  assert.equal(denied.ok, false);
  const loopback = await preview.navigate(opened.id, 'http://127.0.0.1:3001');
  assert.equal(loopback.ok, true);
  assert.equal(fake.loads.at(-1).url, 'http://127.0.0.1:3001');
});

test('back, forward, reload, and state follow the guest history', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  await preview.navigate(opened.id, 'http://127.0.0.1:3000/app');
  const back = await preview.back(opened.id);
  assert.equal(back.ok, true);
  assert.equal(back.url, 'http://127.0.0.1:3000');
  assert.equal(back.canGoBack, false);
  assert.equal(back.canGoForward, true);
  const forward = await preview.forward(opened.id);
  assert.equal(forward.url, 'http://127.0.0.1:3000/app');
  const reloaded = await preview.reload(opened.id);
  assert.equal(reloaded.ok, true);
  const state = await preview.state(opened.id);
  assert.equal(state.url, 'http://127.0.0.1:3000/app');
  const tools = await preview.openDevTools(opened.id);
  assert.equal(tools.ok, true);
  assert.deepEqual(fake.views[0].devTools, { mode: 'detach' });
});

test('guest did-navigate reports the live URL to onState', async () => {
  const seen = [];
  const fake = fakeAttach();
  const preview = createPreviewController({
    attach: fake.attach,
    onState: (state) => { seen.push(state.url); },
  });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  assert.equal(seen.at(-1), 'http://127.0.0.1:3000');
  await preview.navigate(opened.id, 'http://127.0.0.1:3000/app');
  assert.equal(seen.at(-1), 'http://127.0.0.1:3000/app');
  await preview.back(opened.id);
  assert.equal(seen.at(-1), 'http://127.0.0.1:3000');
});

test('discoverLocalServers reports the loopback ports the probe accepts', async () => {
  const found = await discoverLocalServers(async (port) => port === 5173 || port === 3000);
  assert.deepEqual(found, [
    { url: 'http://127.0.0.1:3000', port: 3000 },
    { url: 'http://127.0.0.1:5173', port: 5173 },
  ]);
});

test('discoverLocalServers includes port 5175 from the common dev table', async () => {
  const found = await discoverLocalServers(async (port) => port === 5175);
  assert.deepEqual(found, [{ url: 'http://127.0.0.1:5175', port: 5175 }]);
});

test('DISCOVER_PORTS includes 9000', () => {
  assert.equal(DISCOVER_PORTS.includes(9000), true);
});

test('closeAll destroys every live view', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const first = await preview.open({ url: 'http://127.0.0.1:3000' });
  const second = await preview.open({ url: 'http://127.0.0.1:3001' });
  assert.equal(fake.views.length, 2);
  await preview.closeAll();
  assert.deepEqual(fake.destroyed.sort(), [first.id, second.id].sort());
  assert.equal(fake.views.length, 2); // destroy() marks the fake, the table is what cleared
  await assert.rejects(() => preview.navigate(first.id, 'http://127.0.0.1:3000'), /unknown preview id/);
});

test('registerPreviewIpc exposes workspace-file and closeAll closes that server', async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); } };
  let closed = 0;
  let fileWindowClosed = 0;
  const fileWindowCalls = [];
  const workspacePreview = {
    fileUrl(input) {
      return { ok: true, url: `http://127.0.0.1:9/token/${input.relativePath}` };
    },
    close() {
      closed += 1;
    },
  };
  const live = registerPreviewIpc(ipcMain, {
    async closeAll() {},
  }, {
    authorize() {},
    workspacePreview,
    filePreviewWindow: {
      open(input) { fileWindowCalls.push(input); return { ok: true }; },
      close() { fileWindowClosed += 1; },
    },
  });
  assert.deepEqual(
    await handlers.get('shell:preview-workspace-file')(
      { sender: { id: 1 } },
      { cwd: '/tmp', relativePath: 'index.html' },
    ),
    { ok: true, url: 'http://127.0.0.1:9/token/index.html' },
  );
  assert.deepEqual(
    await handlers.get('shell:preview-open-file-window')(
      { sender: { id: 1 } },
      { cwd: '/tmp', relativePath: 'image.png' },
    ),
    { ok: true },
  );
  assert.deepEqual(fileWindowCalls, [{ cwd: '/tmp', relativePath: 'image.png' }]);
  await live.closeAll();
  assert.equal(fileWindowClosed, 1);
  assert.equal(closed, 1);
});

test('registerPreviewIpc authorizes state-only requests before dispatch', async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); } };
  let authorized = 0;
  const controller = {
    state(id) { return { ok: true, id }; },
  };
  registerPreviewIpc(ipcMain, controller, {
    authorize(event) {
      assert.equal(event.sender.id, 9);
      authorized += 1;
    },
  });
  assert.deepEqual(
    await handlers.get('shell:preview-state')({ sender: { id: 9 } }, 'preview-1'),
    { ok: true, id: 'preview-1' },
  );
  assert.equal(authorized, 1);
});

test('hardReload calls reloadIgnoringCache', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  const result = await preview.hardReload(opened.id);
  assert.equal(result.ok, true);
  assert.deepEqual(fake.loads.at(-1).options, { reloadIgnoringCache: true });
});

test('zoomIn from 1.0 sets zoom factor 1.1', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  const result = await preview.zoomIn(opened.id);
  assert.equal(fake.views[0].webContents.getZoomFactor(), 1.1);
  assert.equal(result.zoomFactor, 1.1);
});

test('setColorScheme dark sends Emulation.setEmulatedMedia', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  await preview.setColorScheme(opened.id, 'dark');
  const dbg = fake.views[0].webContents.debugger;
  assert.deepEqual(dbg.attachCalls, ['1.3']);
  assert.deepEqual(dbg.commands[0], {
    method: 'Emulation.setEmulatedMedia',
    params: {
      features: [{ name: 'prefers-color-scheme', value: 'dark' }],
    },
  });
});

test('clearCache and clearCookies sweep cached preview sessions', async () => {
  const ses = fakePartitionSession();
  const cache = createPreviewSessionCache(() => ses);
  cache.getSession('shared');
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach, sessionCache: cache });
  const cookies = await preview.clearCookies();
  const cacheResult = await preview.clearCache();
  assert.equal(cookies.ok, true);
  assert.equal(cacheResult.ok, true);
  assert.deepEqual(ses.storageClears, [{
    storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers'],
  }]);
  assert.equal(ses.cacheClears, 1);
});

test('clearCookies succeeds when the session cache is empty', async () => {
  const cache = createPreviewSessionCache(() => {
    throw new Error('should not mint a session');
  });
  const preview = createPreviewController({
    attach: fakeAttach().attach,
    sessionCache: cache,
  });
  const cookies = await preview.clearCookies();
  const cacheResult = await preview.clearCache();
  assert.equal(cookies.ok, true);
  assert.equal(cacheResult.ok, true);
});

test('did-fail-load reports unreachable onState', async () => {
  const seen = [];
  const fake = fakeAttach();
  const preview = createPreviewController({
    attach: fake.attach,
    onState: (state) => { seen.push(state); },
  });
  await preview.open({ url: 'http://127.0.0.1:3000' });
  fake.views[0].emit('did-fail-load');
  assert.equal(seen.at(-1).unreachable, true);
});

test('Cmd+R before-input-event prevents default and reloads', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  await preview.open({ url: 'http://127.0.0.1:3000' });
  const event = fake.views[0].emitBeforeInput({ control: true, key: 'r' });
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(fake.loads.at(-1).options, { reload: true });
});

test('stop, screenshot, title, and loading bind on the fake guest', async () => {
  const seen = [];
  const fake = fakeAttach();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dshd-preview-shot-bind-'));
  const preview = createPreviewController({
    attach: fake.attach,
    onState: (state) => { seen.push(state); },
    userDataPath: dir,
  });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  const view = fake.views[0];
  for (const name of [
    'did-fail-load',
    'did-start-loading',
    'did-stop-loading',
    'page-title-updated',
    'before-input-event',
  ]) {
    assert.equal(view.webContents.recordedEvents.includes(name), true, name);
  }
  await preview.stop(opened.id);
  assert.equal(view.webContents.stopped, true);
  const shot = await preview.captureScreenshot(opened.id);
  assert.equal(shot.ok, true);
  assert.equal(shot.pngBase64, Buffer.from('png').toString('base64'));
  view.emit('page-title-updated', {}, 'Docs');
  assert.equal(seen.at(-1).title, 'Docs');
  view.emit('did-start-loading');
  assert.equal(seen.at(-1).loading, true);
  assert.equal(seen.at(-1).unreachable, false);
  view.emit('did-fail-load');
  view.emit('did-stop-loading');
  assert.equal(seen.at(-1).loading, false);
  assert.equal(seen.at(-1).unreachable, true);
});

test('captureScreenshot writes a png under preview-recordings', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dshd-preview-shot-'));
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach, userDataPath: dir });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  const shot = await preview.captureScreenshot(opened.id);
  assert.equal(shot.ok, true);
  assert.equal(shot.mimeType, 'image/png');
  assert.equal(typeof shot.path, 'string');
  assert.equal(typeof shot.sizeBytes, 'number');
  const recDir = path.join(dir, 'preview-recordings');
  const files = await fs.readdir(recDir);
  const pngs = files.filter((name) => name.startsWith('browser-screenshot-') && name.endsWith('.png'));
  assert.equal(pngs.length, 1);
  assert.equal(path.basename(shot.path), pngs[0]);
  const written = await fs.readFile(path.join(recDir, pngs[0]));
  assert.deepEqual(written, Buffer.from('png'));
});

test('captureScreenshot unknown id returns ok false', async () => {
  const preview = createPreviewController({
    attach: fakeAttach().attach,
    userDataPath: os.tmpdir(),
  });
  const shot = await preview.captureScreenshot('missing');
  assert.equal(shot.ok, false);
  assert.ok(shot.message);
});

test('registerPreviewIpc authorizes guest control channels', async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); } };
  let authorized = 0;
  const calls = [];
  const controller = {
    hardReload(id) { calls.push(['hardReload', id]); return { ok: true, id }; },
    stop(id) { calls.push(['stop', id]); return { ok: true, id }; },
    zoomIn(id) { calls.push(['zoomIn', id]); return { ok: true, id, zoomFactor: 1.1 }; },
    zoomOut(id) { calls.push(['zoomOut', id]); return { ok: true, id, zoomFactor: 0.9 }; },
    resetZoom(id) { calls.push(['resetZoom', id]); return { ok: true, id, zoomFactor: 1 }; },
    setColorScheme(id, scheme) { calls.push(['setColorScheme', id, scheme]); return { ok: true, id }; },
    clearCookies() { calls.push(['clearCookies']); return { ok: true }; },
    clearCache() { calls.push(['clearCache']); return { ok: true }; },
    captureScreenshot(id) { calls.push(['captureScreenshot', id]); return { ok: true, pngBase64: 'x' }; },
    pickElement(id) { calls.push(['pickElement', id]); return { ok: true }; },
    cancelPickElement(id) { calls.push(['cancelPickElement', id]); return { ok: true }; },
    setAnnotationTheme(id, theme) { calls.push(['setAnnotationTheme', id, theme]); return { ok: true }; },
    openPictureInPicture(id) { calls.push(['openPictureInPicture', id]); return { ok: true }; },
    closePictureInPicture() { calls.push(['closePictureInPicture']); return { ok: true }; },
    startRecording(id) { calls.push(['startRecording', id]); return { ok: true }; },
    stopRecording(id) { calls.push(['stopRecording', id]); return { ok: true }; },
    saveRecording(id, payload) { calls.push(['saveRecording', id, payload]); return { ok: true }; },
    revealArtifact(artifactPath) { calls.push(['revealArtifact', artifactPath]); return { ok: true }; },
    copyArtifactToClipboard(artifactPath) { calls.push(['copyArtifactToClipboard', artifactPath]); return { ok: true }; },
  };
  registerPreviewIpc(ipcMain, controller, {
    authorize() { authorized += 1; },
  });
  const event = { sender: { id: 4 } };
  assert.equal(typeof handlers.get('shell:preview-hard-reload'), 'function');
  assert.equal(typeof handlers.get('shell:preview-stop'), 'function');
  assert.equal(typeof handlers.get('shell:preview-zoom-in'), 'function');
  assert.equal(typeof handlers.get('shell:preview-zoom-out'), 'function');
  assert.equal(typeof handlers.get('shell:preview-zoom-reset'), 'function');
  assert.equal(typeof handlers.get('shell:preview-color-scheme'), 'function');
  assert.equal(typeof handlers.get('shell:preview-clear-cookies'), 'function');
  assert.equal(typeof handlers.get('shell:preview-clear-cache'), 'function');
  assert.equal(typeof handlers.get('shell:preview-capture-screenshot'), 'function');
  assert.equal(typeof handlers.get('shell:preview-pick-element'), 'function');
  assert.equal(typeof handlers.get('shell:preview-cancel-pick'), 'function');
  assert.equal(typeof handlers.get('shell:preview-annotation-theme'), 'function');
  assert.equal(typeof handlers.get('shell:preview-open-pip'), 'function');
  assert.equal(typeof handlers.get('shell:preview-close-pip'), 'function');
  assert.equal(typeof handlers.get('shell:preview-start-recording'), 'function');
  assert.equal(typeof handlers.get('shell:preview-stop-recording'), 'function');
  assert.equal(typeof handlers.get('shell:preview-save-recording'), 'function');
  assert.equal(typeof handlers.get('shell:preview-reveal-artifact'), 'function');
  assert.equal(typeof handlers.get('shell:preview-copy-artifact'), 'function');
  // The high-privilege automation chain (evaluate / CDP input) was removed
  // with no consumer; the channels must stay unregistered.
  for (const channel of [...handlers.keys()]) {
    assert.ok(!channel.startsWith('shell:preview-automation-'), `${channel} must not exist`);
  }
  await handlers.get('shell:preview-hard-reload')(event, 'pv-1');
  await handlers.get('shell:preview-stop')(event, 'pv-1');
  await handlers.get('shell:preview-zoom-in')(event, 'pv-1');
  await handlers.get('shell:preview-zoom-out')(event, 'pv-1');
  await handlers.get('shell:preview-zoom-reset')(event, 'pv-1');
  await handlers.get('shell:preview-color-scheme')(event, 'pv-1', 'dark');
  await handlers.get('shell:preview-clear-cookies')(event);
  await handlers.get('shell:preview-clear-cache')(event);
  await handlers.get('shell:preview-capture-screenshot')(event, 'pv-1');
  await handlers.get('shell:preview-pick-element')(event, 'pv-1');
  await handlers.get('shell:preview-cancel-pick')(event, 'pv-1');
  await handlers.get('shell:preview-annotation-theme')(event, 'pv-1', { primary: 'rgb(1, 2, 3)' });
  await handlers.get('shell:preview-open-pip')(event, 'pv-1');
  await handlers.get('shell:preview-close-pip')(event);
  const savePayload = { mimeType: 'video/webm', data: new ArrayBuffer(0) };
  await handlers.get('shell:preview-start-recording')(event, 'pv-1');
  await handlers.get('shell:preview-stop-recording')(event, 'pv-1');
  await handlers.get('shell:preview-save-recording')(event, 'pv-1', savePayload);
  await handlers.get('shell:preview-reveal-artifact')(event, '/abs/rec.webm');
  await handlers.get('shell:preview-copy-artifact')(event, '/abs/shot.png');
  assert.equal(authorized, 19);
  assert.deepEqual(calls, [
    ['hardReload', 'pv-1'],
    ['stop', 'pv-1'],
    ['zoomIn', 'pv-1'],
    ['zoomOut', 'pv-1'],
    ['resetZoom', 'pv-1'],
    ['setColorScheme', 'pv-1', 'dark'],
    ['clearCookies'],
    ['clearCache'],
    ['captureScreenshot', 'pv-1'],
    ['pickElement', 'pv-1'],
    ['cancelPickElement', 'pv-1'],
    ['setAnnotationTheme', 'pv-1', { primary: 'rgb(1, 2, 3)' }],
    ['openPictureInPicture', 'pv-1'],
    ['closePictureInPicture'],
    ['startRecording', 'pv-1'],
    ['stopRecording', 'pv-1'],
    ['saveRecording', 'pv-1', savePayload],
    ['revealArtifact', '/abs/rec.webm'],
    ['copyArtifactToClipboard', '/abs/shot.png'],
  ]);
});

function samplePickedElement() {
  return {
    pageUrl: 'http://127.0.0.1:3000/',
    pageTitle: 'App',
    tagName: 'button',
    selector: '#save',
    htmlPreview: '<button id="save">Save</button>',
    componentName: null,
    source: null,
    stack: [],
    styles: '',
    pickedAt: '2026-08-19T00:00:00.000Z',
  };
}

function sampleAnnotation() {
  return {
    id: 'annotation_1',
    pageUrl: 'http://127.0.0.1:3000/',
    pageTitle: 'App',
    comment: 'nudge',
    elements: [{
      id: 'element_1',
      element: samplePickedElement(),
      rect: { x: 10.2, y: 20.8, width: 40.2, height: 12.1 },
    }],
    regions: [],
    strokes: [],
    styleChanges: [],
    screenshot: null,
    createdAt: '2026-08-19T00:00:00.000Z',
  };
}

test('pickElement sends dshd-preview-start-pick with a theme', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  const wc = fake.views[0].webContents;
  const pending = preview.pickElement(opened.id);
  await Promise.resolve();
  const start = wc.sent.find((entry) => entry[0] === 'dshd-preview-start-pick');
  assert.ok(start, 'start-pick was sent');
  assert.equal(typeof start[1], 'object');
  assert.equal(typeof start[1].primary, 'string');
  assert.equal(JSON.stringify(start).includes(leftoverPrimaryCss), false);
  wc.ipc.emit('dshd-preview-element-picked', null);
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.message, 'cancelled');
});

test('completing a pick captures the crop, returns annotation and screenshot, then sends captured', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  const wc = fake.views[0].webContents;
  const pending = preview.pickElement(opened.id);
  await Promise.resolve();
  wc.ipc.emit(
    'dshd-preview-element-picked',
    sampleAnnotation(),
    { x: 10.2, y: 20.8, width: 40.2, height: 12.1 },
    'attach',
  );
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.annotation.comment, 'nudge');
  assert.equal(result.screenshot.dataUrl.startsWith('data:image/png;base64,'), true);
  assert.deepEqual(wc.captureRects.at(-1), { x: 10, y: 20, width: 41, height: 13 });
  assert.ok(wc.sent.some((entry) => entry[0] === 'dshd-preview-annotation-captured'));
});

test('cancelPickElement sends dshd-preview-cancel-pick', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  const wc = fake.views[0].webContents;
  await preview.cancelPickElement(opened.id);
  assert.ok(wc.sent.some((entry) => entry[0] === 'dshd-preview-cancel-pick'));
});

test('setAnnotationTheme sends the theme object to that guest only without leftover primary CSS', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const first = await preview.open({ url: 'http://127.0.0.1:3000' });
  const second = await preview.open({ url: 'http://127.0.0.1:5173' });
  const theme = { primary: 'rgb(1, 2, 3)', background: 'white' };
  await preview.setAnnotationTheme(first.id, theme);
  const firstSent = fake.views[0].webContents.sent.find((entry) => entry[0] === 'dshd-preview-annotation-theme');
  assert.deepEqual(firstSent[1], theme);
  assert.equal(JSON.stringify(firstSent).includes(leftoverPrimaryCss), false);
  assert.equal(
    fake.views[1].webContents.sent.some((entry) => entry[0] === 'dshd-preview-annotation-theme'),
    false,
  );
  const pending = preview.pickElement(first.id);
  await Promise.resolve();
  const start = fake.views[0].webContents.sent.find((entry) => entry[0] === 'dshd-preview-start-pick');
  assert.equal(start[1].primary, 'rgb(1, 2, 3)');
  fake.views[0].webContents.ipc.emit('dshd-preview-element-picked', null);
  await pending;
  void second;
});

test('non-positive crop rects capture the full page', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  const wc = fake.views[0].webContents;
  const pending = preview.pickElement(opened.id);
  await Promise.resolve();
  wc.ipc.emit('dshd-preview-element-picked', sampleAnnotation(), { x: 0, y: 0, width: 0, height: 10 }, 'attach');
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(wc.captureRects.at(-1), undefined);
});

test('pickElement returns unknown preview id without throwing', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const result = await preview.pickElement('missing');
  assert.equal(result.ok, false);
  assert.match(result.message, /unknown preview id/);
});

test('fitPictureInPictureContentSize matches the 16/9 and 9/16 fixtures', () => {
  assert.deepEqual(fitPictureInPictureContentSize([480, 320], 16 / 9), [523, 294]);
  assert.deepEqual(fitPictureInPictureContentSize([480, 320], 9 / 16), [294, 523]);
});

test('openPictureInPicture creates an isolated alwaysOnTop window and hides the guest', async () => {
  const fake = fakeAttach();
  const pip = createPipFactory();
  const preview = createPreviewController({ attach: fake.attach, createPipWindow: pip.createPipWindow });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  const view = fake.views[0];
  stubWideCapture(view.webContents);
  const result = await preview.openPictureInPicture(opened.id);
  try {
    assert.equal(result.ok, true);
    assert.equal(pip.created.length, 1);
    const win = pip.created[0];
    assert.equal(win.options.alwaysOnTop, true);
    assert.equal(win.options.skipTaskbar, true);
    assert.equal(win.options.show, false);
    assert.equal(win.options.width, 480);
    assert.equal(win.options.height, 320);
    assert.equal(win.options.minWidth, 240);
    assert.equal(win.options.minHeight, 160);
    assert.equal(win.options.autoHideMenuBar, true);
    assert.equal(win.options.fullscreenable, false);
    assert.equal(win.options.maximizable, false);
    assert.equal(win.options.minimizable, false);
    assert.equal(win.options.resizable, true);
    assert.equal(win.options.backgroundColor, '#111111');
    assert.equal(win.options.title, 'Browser preview');
    assert.equal(win.options.webPreferences.contextIsolation, true);
    assert.equal(win.options.webPreferences.sandbox, true);
    assert.equal(win.options.webPreferences.nodeIntegration, false);
    assert.equal(win.options.webPreferences.backgroundThrottling, false);
    assert.equal(path.basename(win.options.webPreferences.preload), 'preview-pip-preload.js');
    assert.equal(view.visible, false);
    assert.equal(win.showInactiveCalls, 1);
    assert.match(win.loadURLs[0], /^data:text\/html;charset=utf-8,/);
    assert.deepEqual(win.alwaysOnTopCalls, [[true, process.platform === 'darwin' ? 'floating' : 'normal']]);
    assert.deepEqual(win.aspectRatioCalls, [0, 1280 / 720]);
    assert.deepEqual(win.contentSizeCalls, [[523, 294, false]]);
    assert.equal(view.webContents.jpegQualities.at(-1), 80);
    assert.equal(win.sent.length, 1);
    assert.equal(win.sent[0][0], PREVIEW_PIP_FRAME_CHANNEL);
    assert.equal(win.sent[0][1].data, Buffer.from('jpeg-frame').toString('base64'));
    assert.equal(win.sent[0][1].width, 1280);
    assert.equal(win.sent[0][1].height, 720);
    assert.equal(win.sent[0][1].id, opened.id);
  } finally {
    await preview.closePictureInPicture();
  }
});

test('openPictureInPicture titles the window from a nonempty guest title', async () => {
  const fake = fakeAttach();
  const pip = createPipFactory();
  const preview = createPreviewController({ attach: fake.attach, createPipWindow: pip.createPipWindow });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  fake.views[0].webContents.title = 'Docs';
  stubWideCapture(fake.views[0].webContents);
  const result = await preview.openPictureInPicture(opened.id);
  try {
    assert.equal(result.ok, true);
    assert.equal(pip.created[0].options.title, '预览 · Docs');
  } finally {
    await preview.closePictureInPicture();
  }
});

test('closePictureInPicture destroys the window so show can restore the guest', async () => {
  const fake = fakeAttach();
  const pip = createPipFactory();
  const preview = createPreviewController({ attach: fake.attach, createPipWindow: pip.createPipWindow });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  stubWideCapture(fake.views[0].webContents);
  await preview.openPictureInPicture(opened.id);
  assert.equal(fake.views[0].visible, false);
  const closed = await preview.closePictureInPicture();
  assert.equal(closed.ok, true);
  assert.equal(pip.created[0].closed, true);
  await preview.show(opened.id);
  assert.equal(fake.views[0].visible, true);
});

test('openPictureInPicture returns unknown preview id without throwing', async () => {
  const fake = fakeAttach();
  const pip = createPipFactory();
  const preview = createPreviewController({ attach: fake.attach, createPipWindow: pip.createPipWindow });
  const result = await preview.openPictureInPicture('missing');
  assert.equal(result.ok, false);
  assert.match(result.message, /unknown preview id/);
  assert.equal(pip.created.length, 0);
});

test('openPictureInPicture is idempotent for an undestroyed window', async () => {
  const fake = fakeAttach();
  const pip = createPipFactory();
  const preview = createPreviewController({ attach: fake.attach, createPipWindow: pip.createPipWindow });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  stubWideCapture(fake.views[0].webContents);
  try {
    assert.equal((await preview.openPictureInPicture(opened.id)).ok, true);
    assert.equal((await preview.openPictureInPicture(opened.id)).ok, true);
    assert.equal(pip.created.length, 1);
    assert.equal(pip.created[0].showInactiveCalls, 2);
  } finally {
    await preview.closePictureInPicture();
  }
});

test('closing the PiP window from chrome publishes pictureInPicture false', async () => {
  const seen = [];
  const fake = fakeAttach();
  const pip = createPipFactory();
  const preview = createPreviewController({
    attach: fake.attach,
    createPipWindow: pip.createPipWindow,
    onState: (state) => { seen.push(state); },
  });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  stubWideCapture(fake.views[0].webContents);
  await preview.openPictureInPicture(opened.id);
  pip.created[0].close();
  const last = seen.at(-1);
  assert.equal(pip.created[0].closed, true);
  assert.equal(last.ok, true);
  assert.equal(last.id, opened.id);
  assert.equal(last.pictureInPicture, false);
});

test('openPictureInPicture replaces a destroyed leftover window', async () => {
  const fake = fakeAttach();
  const pip = createPipFactory();
  const preview = createPreviewController({ attach: fake.attach, createPipWindow: pip.createPipWindow });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  stubWideCapture(fake.views[0].webContents);
  try {
    await preview.openPictureInPicture(opened.id);
    pip.created[0].close();
    await preview.openPictureInPicture(opened.id);
    assert.equal(pip.created.length, 2);
    assert.equal(pip.created[1].showInactiveCalls, 1);
  } finally {
    await preview.closePictureInPicture();
  }
});

test('closeAll closes a live picture-in-picture window', async () => {
  const fake = fakeAttach();
  const pip = createPipFactory();
  const preview = createPreviewController({ attach: fake.attach, createPipWindow: pip.createPipWindow });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  stubWideCapture(fake.views[0].webContents);
  await preview.openPictureInPicture(opened.id);
  await preview.closeAll();
  assert.equal(pip.created[0].closed, true);
});

test('preview close of the owning guest closes picture-in-picture', async () => {
  const fake = fakeAttach();
  const pip = createPipFactory();
  const preview = createPreviewController({ attach: fake.attach, createPipWindow: pip.createPipWindow });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  stubWideCapture(fake.views[0].webContents);
  await preview.openPictureInPicture(opened.id);
  await preview.close(opened.id);
  assert.equal(pip.created[0].closed, true);
});

test('startRecording sends JPEG frames on shell:preview-recording-frame', async () => {
  const fake = fakeAttach();
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); } };
  const sent = [];
  const event = {
    sender: {
      isDestroyed() { return false; },
      send(channel, payload) { sent.push([channel, payload]); },
    },
  };
  registerPreviewIpc(ipcMain, undefined, { authorize() {}, attach: fake.attach });
  const opened = await handlers.get('shell:preview-open')(event, { url: 'http://127.0.0.1:3000' });
  stubWideCapture(fake.views[0].webContents);
  const result = await handlers.get('shell:preview-start-recording')(event, opened.id);
  try {
    assert.equal(result.ok, true);
    assert.ok(sent.some((entry) => entry[0] === 'shell:preview-recording-frame'));
    const frame = sent.find((entry) => entry[0] === 'shell:preview-recording-frame')[1];
    assert.equal(frame.id, opened.id);
    assert.equal(frame.data, Buffer.from('jpeg-frame').toString('base64'));
    assert.equal(frame.width, 1280);
    assert.equal(frame.height, 720);
    assert.equal(fake.views[0].webContents.jpegQualities.at(-1), 80);
  } finally {
    await handlers.get('shell:preview-stop-recording')(event, opened.id);
    await handlers.get('shell:preview-close')(event, opened.id);
  }
});

test('stopRecording while PiP is open does not stop pip frames', async () => {
  const fake = fakeAttach();
  const pip = createPipFactory();
  const preview = createPreviewController({ attach: fake.attach, createPipWindow: pip.createPipWindow });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  stubWideCapture(fake.views[0].webContents);
  await preview.openPictureInPicture(opened.id);
  await preview.startRecording(opened.id);
  const afterStart = pip.created[0].sent.length;
  await preview.stopRecording(opened.id);
  await new Promise((resolve) => setTimeout(resolve, PREVIEW_PIP_FRAME_INTERVAL_MS + 40));
  try {
    assert.ok(pip.created[0].sent.length > afterStart);
    assert.equal(pip.created[0].sent.at(-1)[0], PREVIEW_PIP_FRAME_CHANNEL);
  } finally {
    await preview.closePictureInPicture();
  }
});

test('startRecording while PiP is open does not create a second capture interval', async () => {
  const fake = fakeAttach();
  const pip = createPipFactory();
  const preview = createPreviewController({ attach: fake.attach, createPipWindow: pip.createPipWindow });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  const view = fake.views[0];
  stubWideCapture(view.webContents);
  await preview.openPictureInPicture(opened.id);
  const afterPip = view.webContents.captureRects.length;
  await preview.startRecording(opened.id);
  assert.equal(view.webContents.captureRects.length, afterPip);
  await new Promise((resolve) => setTimeout(resolve, PREVIEW_PIP_FRAME_INTERVAL_MS + 40));
  try {
    assert.equal(view.webContents.captureRects.length, afterPip + 1);
  } finally {
    await preview.stopRecording(opened.id);
    await preview.closePictureInPicture();
  }
});

test('saveRecording writes under preview-recordings', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dshd-preview-rec-'));
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach, userDataPath: dir });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  const webm = await preview.saveRecording(opened.id, {
    mimeType: 'video/webm',
    data: Buffer.from('webm-bytes'),
  });
  assert.equal(webm.ok, true);
  const recDir = path.join(dir, 'preview-recordings');
  const files = await fs.readdir(recDir);
  assert.equal(files.filter((name) => name.endsWith('.webm')).length, 1);
  const written = await fs.readFile(path.join(recDir, files.find((name) => name.endsWith('.webm'))));
  assert.equal(written.toString(), 'webm-bytes');
  const mp4 = await preview.saveRecording(opened.id, {
    mimeType: 'video/mp4',
    data: Buffer.from('mp4-bytes'),
  });
  assert.equal(mp4.ok, true);
  const after = await fs.readdir(recDir);
  assert.equal(after.filter((name) => name.endsWith('.mp4')).length, 1);
});

test('saveRecording rejects a payload over the 512 MiB cap without writing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dshd-preview-rec-cap-'));
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach, userDataPath: dir });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  const result = await preview.saveRecording(opened.id, {
    mimeType: 'video/webm',
    data: Buffer.alloc(512 * 1024 * 1024 + 1),
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /512 MiB/);
  const entries = await fs.readdir(dir);
  assert.ok(!entries.includes('preview-recordings'));
});

test('revealArtifact only opens files under preview-recordings', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dshd-preview-reveal-'));
  const recDir = path.join(dir, 'preview-recordings');
  await fs.mkdir(recDir);
  const inside = path.join(recDir, 'rec.webm');
  await fs.writeFile(inside, 'webm');
  const outside = path.join(dir, 'secret.png');
  await fs.writeFile(outside, 'png');
  const shown = [];
  const preview = createPreviewController({
    userDataPath: dir,
    showItemInFolder(artifactPath) { shown.push(artifactPath); },
  });
  const ok = await preview.revealArtifact(inside);
  assert.equal(ok.ok, true);
  assert.equal(shown.length, 1);
  assert.equal(path.basename(shown[0]), 'rec.webm');
  const denied = await preview.revealArtifact(outside);
  assert.equal(denied.ok, false);
  assert.deepEqual(shown, [shown[0]]);
});

test('copyArtifactToClipboard only reads images under preview-recordings', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dshd-preview-copy-'));
  const recDir = path.join(dir, 'preview-recordings');
  await fs.mkdir(recDir);
  const inside = path.join(recDir, 'shot.png');
  const empty = path.join(recDir, 'empty.png');
  const outside = path.join(dir, 'escape.png');
  await fs.writeFile(inside, 'png');
  await fs.writeFile(empty, 'png');
  await fs.writeFile(outside, 'png');
  const written = [];
  const preview = createPreviewController({
    userDataPath: dir,
    nativeImage: {
      createFromPath(artifactPath) {
        return {
          path: artifactPath,
          isEmpty() { return path.basename(artifactPath) === 'empty.png'; },
        };
      },
    },
    clipboard: {
      writeImage(image) { written.push(image); },
    },
  });
  const ok = await preview.copyArtifactToClipboard(inside);
  assert.equal(ok.ok, true);
  assert.equal(written.length, 1);
  const blank = await preview.copyArtifactToClipboard(empty);
  assert.equal(blank.ok, false);
  assert.ok(blank.message);
  assert.equal(written.length, 1);
  const denied = await preview.copyArtifactToClipboard(outside);
  assert.equal(denied.ok, false);
  assert.equal(written.length, 1);
});

test('unknown preview id fails startRecording without throwing', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const start = await preview.startRecording('missing');
  assert.equal(start.ok, false);
  assert.equal(start.message, 'unknown preview id');
});

test('the preview controller exposes no automation surface', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const automationMethods = Object.keys(preview).filter((name) => name.startsWith('automation'));
  assert.deepEqual(automationMethods, []);
});

