/** `messageEdit` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'action.edit': '编辑',
  'action.running': '等待当前回复结束后编辑',
  'action.unsupported': '包含非文本内容，暂不支持编辑',
  'action.cancel': '取消',
  'editor.banner': '正在重新编辑此消息',
  'editor.editing': '正在下方输入框中重新编辑',
  'editor.hint.running': '当前回复尚未结束，结束后可发送',
  'editor.hint.stale': '会话已有更新的消息，此条不能再重新发送',
  'error.busy': '输入框正忙，暂时无法编辑',
  'error.generic': '无法重新发送编辑后的消息，请重试',
} satisfies Record<string, string>

/** The messageEdit namespace key union. */
export type MessageEditKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The latest-user-message edit control's copy. */
    messageEdit: MessageEditKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'action.edit': 'Edit',
  'action.running': 'Wait for the current response to finish before editing',
  'action.unsupported': 'Messages with non-text content cannot be edited yet',
  'action.cancel': 'Cancel',
  'editor.banner': 'Re-editing this message',
  'editor.editing': 'Re-editing in the input box below',
  'editor.hint.running': 'The current response has not finished; send once it settles',
  'editor.hint.stale': 'Newer messages arrived, so this one can no longer be resent',
  'error.busy': 'The input box is busy; editing is unavailable right now',
  'error.generic': 'Could not resend the edited message. Try again.',
} satisfies Record<MessageEditKey, string>
