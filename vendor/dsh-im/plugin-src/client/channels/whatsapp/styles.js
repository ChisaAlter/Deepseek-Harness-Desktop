export const WHATSAPP_STYLE_ID = 'xmanrui-dsh-im-whatsapp-settings';

const CSS = String.raw`
.dwa-page { --ddt-accent: #25d366; --ddt-accent-deep: #128c7e; --ddt-accent-wash: #eafbf0; }
.dwa-avatar { color: #fff; background: #25d366; }
.dwa-avatar svg { display: block; }
.dwa-access { display: grid; gap: 10px; padding: 12px; border: 1px solid var(--dsw-alias-border-l2, #dfe1e5); border-radius: 10px; background: var(--dsw-alias-bg-layer-2, #f7f8fa); }
.dwa-accessHeading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.dwa-accessHeading > strong { font-size: 13px; }
.dwa-accessStatus { min-width: 0; display: inline-flex; align-items: center; justify-content: flex-end; gap: 6px; }
.dwa-accessBadge { flex: none; padding: 3px 8px; border-radius: 999px; color: #08785f; background: #eafbf0; font-size: 11px; font-weight: 700; }
.dwa-accessBadge[data-mode="private-allowlist"] { color: #0f6f8f; background: #eaf7fd; }
.dwa-accessBadge[data-mode="open"] { color: #a15c00; background: #fff3d6; }
.dwa-accessHelp { position: relative; display: inline-flex; flex: none; }
.dwa-accessHelpButton { width: 20px; height: 20px; display: grid; place-items: center; padding: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 50%; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-1); font: inherit; font-size: 12px; line-height: 1; font-weight: 700; cursor: help; }
.dwa-accessHelpButton:hover { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.dwa-accessHelpButton:focus-visible { outline: none; border-color: var(--dsw-alias-state-business-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent); }
.dwa-accessTooltip { position: absolute; top: calc(100% + 8px); right: 0; z-index: 30; width: 270px; max-width: min(290px, calc(100vw - 48px)); display: grid; gap: 8px; padding: 10px 11px; border: 1px solid var(--dsw-alias-border-l2, #dfe1e5); border-radius: 9px; color: var(--dsw-alias-label-primary, #1f2329); background: var(--dsw-alias-bg-layer-3, #fff); box-shadow: 0 10px 28px rgb(31 35 41 / 16%); opacity: 0; visibility: hidden; transform: translateY(-3px); pointer-events: none; transition: opacity .15s ease, transform .15s ease, visibility .15s ease; }
.dwa-accessTooltipItem { display: grid; gap: 2px; }
.dwa-accessTooltipItem + .dwa-accessTooltipItem { padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l2, #eef0f3); }
.dwa-accessTooltipItem strong { font-size: 12px; line-height: 17px; }
.dwa-accessTooltipItem > span { color: var(--dsw-alias-label-secondary, #646a73); font-size: 11px; line-height: 16px; }
.dwa-accessHelp:hover .dwa-accessTooltip, .dwa-accessHelp:focus-within .dwa-accessTooltip { opacity: 1; visibility: visible; transform: translateY(0); }
.dwa-accessField { display: grid; gap: 5px; color: var(--dsw-alias-label-primary, #1f2329); font-size: 12px; font-weight: 600; }
.dwa-accessField select, .dwa-accessField textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l1, #c9cdd4); border-radius: 7px; color: inherit; background: var(--dsw-alias-bg-layer-1, #fff); font: inherit; font-weight: 400; }
.dwa-accessField select { height: 34px; padding: 0 9px; }
.dwa-accessField textarea { min-height: 68px; padding: 8px 9px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.dwa-accessField textarea:disabled { color: var(--dsw-alias-label-tertiary, #8f959e); background: var(--dsw-alias-bg-module-platform, #f2f3f5); cursor: not-allowed; resize: none; opacity: 1; }
.dwa-accessField small { color: var(--dsw-alias-label-secondary, #646a73); font-weight: 400; }
.dwa-accessWarning, .dwa-accessError { margin: 0; font-size: 12px; line-height: 1.5; }
.dwa-accessWarning { color: #a15c00; }
.dwa-accessError { color: var(--dsw-alias-state-error-primary, #d83931); }
.dwa-accessActions { display: flex; justify-content: flex-end; }
`;

export function installWhatsappStyles() {
  if (typeof document === 'undefined') return () => {};
  const existing = document.querySelector(`style[data-plugin-css="${WHATSAPP_STYLE_ID}"]`);
  if (existing) return () => {};
  const style = document.createElement('style');
  style.dataset.plugin = '@xmanrui/dsh-im';
  style.dataset.pluginCss = WHATSAPP_STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  return () => style.remove();
}
