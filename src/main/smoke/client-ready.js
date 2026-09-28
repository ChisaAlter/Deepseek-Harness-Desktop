'use strict';

/** The boot document is never a substitute for the asynchronously created Harness view. */
async function waitForHarnessContents(getContents, owner, timeoutMs = 300_000, getWelcomeContents = () => null) {
  const deadline = Date.now() + timeoutMs;
  let skippedWelcome;
  while (Date.now() < deadline) {
    const contents = getContents(owner);
    if (contents && !contents.isDestroyed()) return contents;
    const welcome = getWelcomeContents();
    if (welcome && !welcome.isDestroyed() && welcome !== skippedWelcome) {
      try {
        const action = await welcome.executeJavaScript(`(() => {
          const visible = element => element && !element.disabled && !element.closest('[hidden]');
          const key = document.getElementById('api-key');
          if (visible(key)) { key.click(); return 'key-page'; }
          const skip = document.getElementById('skip-key');
          if (visible(skip)) { skip.click(); return 'skipped'; }
          return 'waiting';
        })()`);
        if (action === 'skipped') skippedWelcome = welcome;
      } catch (error) {
        if (!welcome.isDestroyed()) throw error;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Harness WebContents was not created before the smoke deadline');
}

module.exports = { waitForHarnessContents };
