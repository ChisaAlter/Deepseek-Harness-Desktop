export type KeyboardFocusScope =
  | "terminal"
  | "message-input"
  | "command-center"
  | "editable"
  | "other";

export type MessageInputKeyboardActionKind =
  | "focus"
  | "send"
  | "queue"
  | "dictation-toggle"
  | "dictation-cancel"
  | "dictation-confirm"
  | "voice-toggle"
  | "voice-mute-toggle"
  | "mode-cycle";

export type KeyboardActionId =
  | "agent.interrupt"
  | "agent.new"
  | "workspace.dock.git.open"
  | "workspace.dock.browser.open"
  | "workspace.dock.pr.open"
  | "workspace.navigate.index"
  | "workspace.navigate.relative"
  | "sidebar.toggle.left"
  | "sidebar.toggle.right"
  | "sidebar.toggle.both"
  | "settings.toggle"
  | "command-center.toggle"
  | "shortcuts.dialog.toggle"
  | "workspace.terminal.new"
  | "workspace.new"
  | "worktree.new"
  | "worktree.archive"
  | "view.toggle.focus"
  | "theme.cycle"
  | "message-input.action";

export type KeyboardShortcutPayload =
  | { index: number }
  | { delta: 1 | -1 }
  | { kind: MessageInputKeyboardActionKind }
  | null;
