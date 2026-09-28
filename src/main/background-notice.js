'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * One-time toast after the first hide-to-tray. Ported from upstream
 * apps/desktop/background-notice.ts, simplified to a passive hint: the hide
 * never waits on a prompt — the first hide shows a transient notification
 * pointing at the setting, the marker keeps it once-only.
 */
class TrayHideNotice {
  /**
   * @param {{ markerPath: string,
   *           notify: () => void }} options
   */
  constructor(options) {
    this.markerPath = options.markerPath;
    this.notify = options.notify;
    this.acknowledged = false;
    this.disposed = false;
  }

  /**
   * Hide immediately; the first hide also fires the once-only toast.
   * @param {() => void} hide
   */
  close(hide) {
    if (this.disposed) return;
    if (this.acknowledged || fs.existsSync(this.markerPath)) {
      hide();
      return;
    }
    this.acknowledged = true;
    try {
      fs.mkdirSync(path.dirname(this.markerPath), { recursive: true });
      fs.writeFileSync(this.markerPath, '');
    } catch (error) {
      console.warn('tray-hide: could not record acknowledgement', error);
    }
    hide();
    try {
      this.notify();
    } catch (error) {
      console.warn('tray-hide: hint notification failed', error);
    }
  }

  dispose() {
    this.disposed = true;
  }
}

module.exports = { TrayHideNotice };
