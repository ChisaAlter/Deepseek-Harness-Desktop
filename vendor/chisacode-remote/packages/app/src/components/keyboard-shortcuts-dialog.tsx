import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { getIsElectronRuntime } from "@/constants/layout";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Shortcut } from "@/components/ui/shortcut";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { getShortcutOs } from "@/utils/shortcut-platform";
import {
  buildKeyboardShortcutHelpSections,
  type KeyboardShortcutHelpCopy,
  type ShortcutSectionId,
} from "@/keyboard/keyboard-shortcuts";
import {
  COMPOSER_VOICE_UI_VISIBLE,
  isComposerVoiceShortcutHelpId,
} from "@/composer/voice-visibility";

const SNAP_POINTS: string[] = ["70%", "92%"];
const SHORTCUT_SECTION_IDS: ShortcutSectionId[] = [
  "navigation",
  "projects",
  "panels",
  "agent-input",
];
const SHORTCUT_LABEL_IDS = [
  "new-agent",
  "new-worktree",
  "archive-worktree",
  "workspace-jump-index",
  "workspace-jump-previous",
  "workspace-jump-next",
  "terminal-new",
  "command-center-toggle",
  "show-shortcuts",
  "toggle-left-sidebar",
  "toggle-right-sidebar",
  "toggle-both-sidebars",
  "settings-toggle",
  "focus-mode-toggle",
  "theme-cycle",
  "message-input-focus",
  "voice-mode-toggle",
  "dictation-toggle",
  "agent-interrupt",
  "message-send",
  "message-queue",
  "voice-mode-mute-toggle",
];
export function KeyboardShortcutsDialog() {
  const { t } = useTranslation();
  const open = useKeyboardShortcutsStore((s) => s.shortcutsDialogOpen);
  const setOpen = useKeyboardShortcutsStore((s) => s.setShortcutsDialogOpen);

  const isMac = getShortcutOs() === "mac";
  const isDesktopApp = getIsElectronRuntime();
  const copy = useMemo<KeyboardShortcutHelpCopy>(
    () => ({
      sectionTitles: SHORTCUT_SECTION_IDS.reduce(
        (acc, id) => {
          acc[id] = t(`shortcuts.sections.${id}`);
          return acc;
        },
        {} as Record<ShortcutSectionId, string>,
      ),
      labels: SHORTCUT_LABEL_IDS.reduce<Record<string, string>>((acc, id) => {
        acc[id] = t(`shortcuts.labels.${id}`);
        return acc;
      }, {}),
      notes: {
        "show-shortcuts": t("shortcuts.notes.show-shortcuts"),
      },
    }),
    [t],
  );
  const sections = useMemo(() => {
    const nextSections = buildKeyboardShortcutHelpSections(
      { isMac, isDesktop: isDesktopApp },
      undefined,
      copy,
    );
    if (COMPOSER_VOICE_UI_VISIBLE) {
      return nextSections;
    }
    return nextSections.flatMap((section) => {
      const rows = section.rows.filter((row) => !isComposerVoiceShortcutHelpId(row.id));
      return rows.length > 0 ? [{ title: section.title, rows }] : [];
    });
  }, [copy, isDesktopApp, isMac]);
  const header = useMemo<SheetHeader>(() => ({ title: t("shortcuts.title") }), [t]);

  const handleClose = useCallback(() => setOpen(false), [setOpen]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={open}
      onClose={handleClose}
      testID="keyboard-shortcuts-dialog"
      snapPoints={SNAP_POINTS}
    >
      <View testID="keyboard-shortcuts-dialog-content" style={styles.content}>
        {sections.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <View style={styles.rows}>
              {section.rows.map((row) => (
                <View key={row.id} style={styles.row}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>{row.label}</Text>
                    {row.note ? <Text style={styles.rowNote}>{row.note}</Text> : null}
                  </View>
                  <Shortcut keys={row.keys} style={styles.rowShortcut} />
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: {
    gap: theme.spacing[4],
  },
  section: {
    gap: theme.spacing[2],
  },
  // Soft section label: 12.5 medium muted.
  sectionTitle: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
  // Soft quiet card family (r14).
  rows: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: theme.colors.surface0,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderBottomWidth: theme.borderWidth[1],
    // Soft quiet list rule inside card (--border-soft).
    borderBottomColor: theme.colors.secondary,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    // Soft shortcut row: 12.5 meta.
    fontSize: 12.5,
    lineHeight: 18,
    color: theme.colors.foreground,
  },
  rowNote: {
    marginTop: 2,
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
  },
  rowShortcut: {
    alignSelf: "flex-start",
  },
}));
