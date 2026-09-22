export const COMPOSER_VOICE_UI_VISIBLE = false;

const COMPOSER_VOICE_SHORTCUT_HELP_IDS = new Set([
  "voice-toggle",
  "voice-mode-toggle",
  "dictation-toggle",
  "voice-mute-toggle",
  "voice-mode-mute-toggle",
]);

export function isComposerVoiceShortcutHelpId(id: string): boolean {
  return COMPOSER_VOICE_SHORTCUT_HELP_IDS.has(id);
}
