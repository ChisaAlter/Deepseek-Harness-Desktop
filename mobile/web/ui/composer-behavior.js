export function draftHeight(contentHeight, viewportHeight) {
  const viewport = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 800;
  return Math.max(48, Math.min(Number.isFinite(contentHeight) ? contentHeight : 48, 240, viewport * 0.3));
}

/** Reading is an explicit pointer action on the transcript, not every blur. */
export function installComposerBehavior({ document, composer, input, readingArea }) {
  let saved = null;
  const refresh = () => {
    const scroll = input.scrollTop;
    input.style.height = 'auto';
    input.style.height = `${draftHeight(input.scrollHeight, document.defaultView.visualViewport?.height || document.defaultView.innerHeight)}px`;
    input.scrollTop = scroll;
  };
  input.setAttribute('enterkeyhint', 'enter');
  input.setAttribute('aria-label', '消息');
  document.addEventListener('pointerdown', (event) => {
    if (!readingArea.contains(event.target) || !input.value || input.scrollHeight <= 48) return;
    saved = { start: input.selectionStart, end: input.selectionEnd, scroll: input.scrollTop };
    composer.dataset.reading = '';
    if (document.activeElement === input) input.blur();
  }, true);
  input.addEventListener('pointerdown', () => {
    if (!composer.hasAttribute('data-reading')) return;
    delete composer.dataset.reading;
    refresh();
    if (saved) {
      input.setSelectionRange(saved.start, saved.end);
      input.scrollTop = saved.scroll;
    }
  });
  input.addEventListener('focus', () => { delete composer.dataset.reading; refresh(); });
  input.addEventListener('input', refresh);
  return { refresh, reset() { saved = null; delete composer.dataset.reading; refresh(); } };
}
