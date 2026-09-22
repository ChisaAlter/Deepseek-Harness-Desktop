'use strict';

/**
 * Map annotation-editor keyboard events onto attach/send.
 * @param {{ key: string, metaKey: boolean, ctrlKey: boolean, shiftKey: boolean, isComposing: boolean }} event
 * @returns {'attach' | 'send' | null}
 */
function resolveAnnotationSubmission(event) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return null;
  return event.metaKey || event.ctrlKey ? 'send' : 'attach';
}

module.exports = {
  resolveAnnotationSubmission,
};
