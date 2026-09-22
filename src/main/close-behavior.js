const DEFAULT_CLOSE_TO_TRAY = true;

/**
 * Whether the title-bar close button should hide the window.
 * @param {{ closeToTray?: boolean } | null | undefined} config
 * @param {boolean} [quitting]
 * @returns {boolean}
 */
function hideOnClose(config, quitting = false) {
  if (quitting) {
    return false;
  }
  return (config?.closeToTray ?? DEFAULT_CLOSE_TO_TRAY) !== false;
}

module.exports = {
  DEFAULT_CLOSE_TO_TRAY,
  hideOnClose,
};
