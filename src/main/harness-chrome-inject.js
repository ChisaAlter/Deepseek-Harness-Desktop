(() => {
  const STYLE_ID = 'dshd-shell-integrated-chrome';
  const CONTROLS_ID = 'dshd-shell-controls';
  const CONTROL_SIZE = 32;
  const CONTROL_GAP = 0;
  const EDGE = 8;
  const CLUSTER = 8;
  /** Full titlebar height so the no-drag plate covers drag padding around the 32px buttons. */
  const CAPTION_HEIGHT = 48;

  const ICON_MIN = '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="5.4" width="8" height="1.2" rx="0.6" fill="currentColor"/></svg>';
  const ICON_MAX = '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.4" y="2.4" width="7.2" height="7.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';
  const ICON_RESTORE = '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="3.4" y="2.2" width="6.2" height="6.2" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.15"/><rect x="2.2" y="3.6" width="6.2" height="6.2" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.15"/></svg>';
  const ICON_CLOSE = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3L3 9" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>';

  function toHex(input) {
    if (!input || input === 'transparent') {
      return '';
    }
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillStyle = input;
    const painted = String(ctx.fillStyle || '');
    if (painted.startsWith('#')) {
      if (painted.length === 4) {
        return `#${painted[1]}${painted[1]}${painted[2]}${painted[2]}${painted[3]}${painted[3]}`;
      }
      return painted.slice(0, 7);
    }
    const match = painted.match(/rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*([\d.]+)/i);
    if (!match) {
      return '';
    }
    const hex = (value) => Math.max(0, Math.min(255, Math.round(Number(value)))).toString(16).padStart(2, '0');
    return `#${hex(match[1])}${hex(match[2])}${hex(match[3])}`;
  }

  function opaqueBg(el) {
    let node = el;
    while (node && node !== document.documentElement) {
      const bg = getComputedStyle(node).backgroundColor;
      const hex = toHex(bg);
      if (hex && bg && bg !== 'transparent' && !String(bg).endsWith(', 0)') && bg !== 'rgba(0, 0, 0, 0)') {
        return hex;
      }
      node = node.parentElement;
    }
    return toHex(getComputedStyle(document.body).backgroundColor)
      || toHex(getComputedStyle(document.documentElement).backgroundColor)
      || '#ffffff';
  }

  function windowControlsRight() {
    return EDGE + CONTROL_SIZE * 3 + CONTROL_GAP * 2 + CLUSTER;
  }

  function ensureStyle() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      document.documentElement.appendChild(style);
    }
    const css = `
      :root { --dshd-wco-controls: ${windowControlsRight()}px; }
      #${CONTROLS_ID} {
        position: fixed;
        top: 0;
        right: 0;
        z-index: 2147483647;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: ${CONTROL_GAP}px;
        width: ${windowControlsRight()}px;
        height: ${CAPTION_HEIGHT}px;
        padding: 12px ${EDGE}px 4px;
        background: transparent;
        pointer-events: auto;
        user-select: none;
        -webkit-app-region: no-drag;
      }
      #${CONTROLS_ID} button {
        width: ${CONTROL_SIZE}px;
        height: ${CONTROL_SIZE}px;
        margin: 0;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: var(--dsw-alias-label-primary);
        cursor: pointer;
        pointer-events: auto;
        -webkit-app-region: no-drag;
      }
      #${CONTROLS_ID} button svg {
        width: 12px;
        height: 12px;
        display: block;
        pointer-events: none;
      }
      #${CONTROLS_ID} button:hover {
        background: var(--dsw-alias-interactive-bg-hover);
      }
      #${CONTROLS_ID} button[data-act="close"]:hover {
        background: #e81123;
        color: #fff;
      }
      /* The conversation-header corner expander (new seat in the rc.1 merge)
         duplicates the titlebar's own right-panel toggle. */
      [data-sidebar-right-expand] {
        display: none;
      }
    `;
    if (style.textContent !== css) {
      style.textContent = css;
    }
  }

  function ensureControls() {
    let host = document.getElementById(CONTROLS_ID);
    if (host) {
      return host;
    }
    host = document.createElement('div');
    host.id = CONTROLS_ID;
    host.innerHTML = [
      `<button type="button" data-act="minimize" aria-label="最小化">${ICON_MIN}</button>`,
      `<button type="button" data-act="maximize" aria-label="最大化">${ICON_MAX}</button>`,
      `<button type="button" data-act="close" aria-label="关闭">${ICON_CLOSE}</button>`,
    ].join('');
    const dispatch = (event) => {
      if (event.type === 'pointerdown' && event.button !== 0) {
        return;
      }
      const button = event.target.closest('[data-act]');
      if (!button || !window.shell || typeof window.shell.windowAction !== 'function') {
        return;
      }
      if (event.type === 'pointerdown') {
        event.preventDefault();
        event.stopPropagation();
        host.dataset.pointerAct = '1';
        window.shell.windowAction(button.dataset.act);
        window.setTimeout(() => {
          delete host.dataset.pointerAct;
        }, 0);
        return;
      }
      if (host.dataset.pointerAct === '1') {
        return;
      }
      window.shell.windowAction(button.dataset.act);
    };
    host.addEventListener('pointerdown', dispatch);
    host.addEventListener('click', dispatch);
    (document.body || document.documentElement).appendChild(host);
    return host;
  }

  function placeControls(host) {
    host.style.top = '0px';
    host.style.right = '0px';
    host.style.width = `${windowControlsRight()}px`;
    host.style.height = `${CAPTION_HEIGHT}px`;
    host.style.gap = `${CONTROL_GAP}px`;
    host.style.padding = `12px ${EDGE}px 4px`;
  }

  function applyControlTheme(host, maximized) {
    const maxBtn = host.querySelector('[data-act="maximize"]');
    if (!maxBtn) {
      return;
    }
    const mode = maximized ? 'restore' : 'maximize';
    if (maxBtn.dataset.mode === mode) {
      return;
    }
    maxBtn.dataset.mode = mode;
    maxBtn.innerHTML = maximized ? ICON_RESTORE : ICON_MAX;
    maxBtn.setAttribute('aria-label', maximized ? '还原' : '最大化');
  }

  function measure() {
    ensureStyle();
    const host = ensureControls();
    placeControls(host);
    document.documentElement.style.setProperty('--dshd-wco-controls', `${windowControlsRight()}px`);
    applyControlTheme(host, Boolean(window.__dshShellMaximized));
    const sample = { bg: opaqueBg(document.body) };
    if (window.shell && typeof window.shell.reportChrome === 'function') {
      window.shell.reportChrome(sample);
    }
    return sample;
  }

  if (!window.__dshShellChromeBound) {
    window.__dshShellChromeBound = true;
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(measure, 80);
    };
    window.addEventListener('resize', schedule);
    if (window.shell && typeof window.shell.onWindowState === 'function') {
      window.shell.onWindowState((state) => {
        window.__dshShellMaximized = Boolean(state && state.maximized);
        measure();
      });
    }
    window.setTimeout(measure, 200);
    window.setTimeout(measure, 800);
    window.setTimeout(measure, 2000);
  }

  return measure();
})();
