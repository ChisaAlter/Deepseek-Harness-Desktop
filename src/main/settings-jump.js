'use strict';

// Harness settings sections are kebab-case slot ids ('mcp', 'skills',
// 'plugins', 'about'). Validating here keeps arbitrary caller strings out of
// the injected CSS selector in buildSettingsSectionScript().
const SETTINGS_SECTION_ID = /^[a-z][a-z0-9-]*$/;

/**
 * Normalize a requested settings section id.
 *
 * @param {unknown} sectionId - caller-provided section id.
 * @returns {{ ok: true, section: string } | { ok: false }} normalized section
 *   ('' opens the default section) or a rejection for invalid input.
 */
function normalizeSettingsSection(sectionId) {
  const requested = typeof sectionId === 'string' ? sectionId.trim() : '';
  if (requested.length === 0) {
    return { ok: true, section: '' };
  }
  if (!SETTINGS_SECTION_ID.test(requested)) {
    return { ok: false };
  }
  return { ok: true, section: requested };
}

/**
 * Build the in-page script that opens the settings dialog and navigates to a
 * section. Must stay in sync with the web UI contract:
 * [data-dsh-settings-trigger] opens the dialog and
 * [data-dsh-settings-section="<id>"] is the nav row.
 *
 * @param {string} section - normalized section id; '' keeps the default.
 * @returns {string} script for webContents.executeJavaScript.
 */
function buildSettingsSectionScript(section) {
  const id = JSON.stringify(section);
  return `
    (() => {
      const trigger = document.querySelector('[data-dsh-settings-trigger]');
      if (!trigger) return false;
      if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
      const id = ${id};
      if (!id) return true;
      const pick = () => document.querySelector('[data-dsh-settings-section="' + id + '"]');
      const found = pick();
      if (found) {
        found.click();
        return true;
      }
      // rAF polling stalls on a just-unhidden (still throttled) renderer —
      // a MutationObserver resolves on the DOM mutation as a microtask,
      // which runs even while frames are paused.
      return new Promise((resolve) => {
        const cap = setTimeout(() => {
          observer.disconnect();
          resolve(false);
        }, 5000);
        const observer = new MutationObserver(() => {
          const nav = pick();
          if (!nav) return;
          observer.disconnect();
          clearTimeout(cap);
          nav.click();
          resolve(true);
        });
        observer.observe(document.body, { childList: true, subtree: true });
      });
    })()
  `;
}

module.exports = { normalizeSettingsSection, buildSettingsSectionScript };
