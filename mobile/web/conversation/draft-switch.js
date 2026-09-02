// Session switch is the one moment the composer draft must be persisted
// explicitly: relying on textarea `input` events alone loses programmatic
// edits and races with the id flip (DEF-DRAFT-SWITCH).

function switchDraft({ store, fromId, toId, currentText, currentAttachments }) {
  if (store && fromId && fromId !== toId) {
    store.save(fromId, typeof currentText === 'string' ? currentText : '');
    store.saveAttachments(fromId, Array.isArray(currentAttachments) ? currentAttachments : []);
  }
  if (!store || !toId) return { text: '', attachments: [] };
  return {
    text: store.load(toId) || '',
    attachments: store.loadAttachments(toId) || [],
  };
}

export { switchDraft };
