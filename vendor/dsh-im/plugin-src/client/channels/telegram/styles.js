export const TELEGRAM_STYLE_ID = 'xmanrui-dsh-im-telegram-settings';

const CSS = String.raw`
.dtg-page { --ddt-accent: #229ed9; --ddt-accent-deep: #1687bd; --ddt-accent-wash: #eaf7fd; }
.dtg-avatar { color: #fff; background: #229ed9; }
.dtg-avatar svg { display: block; }
.dtg-access { min-width: 0; width: 100%; max-width: 100%; display: grid; gap: 10px; padding: 12px; border: 1px solid var(--dsw-alias-border-l2, #dfe1e5); border-radius: 10px; background: var(--dsw-alias-bg-layer-2, #f7f8fa); }
.dtg-accessHeading { position: relative; min-width: 0; max-width: 100%; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 12px; }
.dtg-accessHeading > strong { min-width: 0; font-size: 13px; overflow-wrap: anywhere; }
.dtg-accessStatus { min-width: 0; max-width: 100%; flex: 0 1 auto; display: inline-flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 6px; }
.dtg-accessBadge { min-width: 0; max-width: 100%; flex: 0 1 auto; padding: 3px 8px; border-radius: 999px; color: #1687bd; background: #eaf7fd; font-size: 11px; font-weight: 700; overflow-wrap: anywhere; text-align: center; }
.dtg-accessBadge[data-mode="private-allowlist"] { color: #a15c00; background: #fff3d6; }
.dtg-accessHelp { position: static; display: inline-flex; flex: none; }
.dtg-accessHelpButton { width: 20px; height: 20px; display: grid; place-items: center; padding: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 50%; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-1); font: inherit; font-size: 12px; line-height: 1; font-weight: 700; cursor: help; transition: border-color .15s ease, color .15s ease, background .15s ease, box-shadow .15s ease; }
.dtg-accessHelpButton:hover { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.dtg-accessHelpButton:focus-visible { outline: none; border-color: var(--dsw-alias-state-business-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent); }
.dtg-accessTooltip { position: absolute; top: calc(100% + 8px); right: 0; z-index: 30; width: min(300px, 100%); max-width: 100%; display: grid; gap: 8px; padding: 10px 11px; border: 1px solid var(--dsw-alias-border-l2, #dfe1e5); border-radius: 9px; color: var(--dsw-alias-label-primary, #1f2329); background: var(--dsw-alias-bg-layer-3, #fff); box-shadow: 0 10px 28px rgb(31 35 41 / 16%); opacity: 0; visibility: hidden; transform: translateY(-3px); pointer-events: none; transition: opacity .15s ease, transform .15s ease, visibility .15s ease; }
.dtg-accessTooltipItem { display: grid; gap: 2px; }
.dtg-accessTooltipItem + .dtg-accessTooltipItem { padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l2, #eef0f3); }
.dtg-accessTooltipItem strong { color: var(--dsw-alias-label-primary, #1f2329); font-size: 12px; line-height: 17px; font-weight: 700; }
.dtg-accessTooltipItem > span { color: var(--dsw-alias-label-secondary, #646a73); font-size: 11px; line-height: 16px; font-weight: 400; }
.dtg-accessHelp:hover .dtg-accessTooltip, .dtg-accessHelp:focus-within .dtg-accessTooltip { opacity: 1; visibility: visible; transform: translateY(0); }
.dtg-accessField { min-width: 0; max-width: 100%; display: grid; gap: 5px; color: var(--dsw-alias-label-primary, #1f2329); font-size: 12px; font-weight: 600; }
.dtg-accessField select, .dtg-accessField textarea { min-width: 0; width: 100%; max-width: 100%; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l1, #c9cdd4); border-radius: 7px; color: inherit; background: var(--dsw-alias-bg-layer-1, #fff); font: inherit; font-weight: 400; }
.dtg-accessField select { height: 34px; padding: 0 9px; }
.dtg-accessField textarea { min-height: 68px; padding: 8px 9px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.dtg-accessField textarea:disabled { color: var(--dsw-alias-label-tertiary, #8f959e); background: var(--dsw-alias-bg-module-platform, #f2f3f5); cursor: not-allowed; resize: none; opacity: 1; }
.dtg-accessField > span, .dtg-accessField small { overflow-wrap: anywhere; }
.dtg-accessField small { color: var(--dsw-alias-label-secondary, #646a73); font-weight: 400; }
.dtg-accessWarning, .dtg-accessError { margin: 0; font-size: 12px; line-height: 1.5; }
.dtg-accessWarning { color: #a15c00; }
.dtg-accessError { color: var(--dsw-alias-state-error-primary, #d83931); }
.dtg-accessActions { min-width: 0; max-width: 100%; display: flex; justify-content: flex-end; flex-wrap: wrap; }
.dtg-accessActions .ddt-button { max-width: 100%; white-space: normal; }
`;

export function installTelegramStyles() {
  if (typeof document === 'undefined') return () => {};
  const existing = document.querySelector(`style[data-plugin-css="${TELEGRAM_STYLE_ID}"]`);
  if (existing) return () => {};
  const style = document.createElement('style');
  style.dataset.plugin = '@xmanrui/dsh-im';
  style.dataset.pluginCss = TELEGRAM_STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  return () => style.remove();
}
