import React, { memo, useCallback, useMemo, useState } from "react";
import { Pressable, Text, View, type TextStyle } from "react-native";
import { Code2, PanelsTopLeft } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { HighlightedCodeBlock } from "@/components/highlighted-code-block";
import { Fonts } from "@/constants/theme";
import { buildGenerativeHtmlDocument } from "@/utils/generative-ui-html";
import { GenerativeHtmlPreviewFrame } from "./generative-html-preview-frame";

interface GenerativeHtmlPreviewProps {
  html: string;
  inheritedStyles: TextStyle;
  sourceTextStyle: TextStyle;
}

export const GenerativeHtmlPreview = memo(function GenerativeHtmlPreview({
  html,
  inheritedStyles,
  sourceTextStyle,
}: GenerativeHtmlPreviewProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const documentHtml = useMemo(() => buildGenerativeHtmlDocument(html), [html]);
  const showPreview = mode === "preview";
  const showPreviewMode = useCallback(() => setMode("preview"), []);
  const showSourceMode = useCallback(() => setMode("source"), []);

  return (
    <View style={generativeHtmlPreviewStyles.card} testID="generative-ui-preview">
      <View style={generativeHtmlPreviewStyles.header}>
        <View style={generativeHtmlPreviewStyles.titleGroup}>
          <PanelsTopLeft size={15} color={generativeHtmlPreviewStyles.titleIcon.color} />
          <Text style={generativeHtmlPreviewStyles.title}>
            {t("workspace.generativeHtmlPreviewTitle")}
          </Text>
          <Text style={generativeHtmlPreviewStyles.subtitle}>
            {t("workspace.generativeHtmlPreviewSubtitle")}
          </Text>
        </View>
        <View style={generativeHtmlPreviewStyles.segment}>
          <ModeButton
            active={showPreview}
            icon="preview"
            label={t("workspace.generativeHtmlPreviewPreview")}
            onPress={showPreviewMode}
          />
          <ModeButton
            active={!showPreview}
            icon="source"
            label={t("workspace.generativeHtmlPreviewSource")}
            onPress={showSourceMode}
          />
        </View>
      </View>

      {showPreview ? (
        <View style={generativeHtmlPreviewStyles.frame} testID="generative-ui-frame">
          <GenerativeHtmlPreviewFrame
            documentHtml={documentHtml}
            title={t("workspace.generativeHtmlPreviewFrameTitle")}
          />
        </View>
      ) : (
        <View style={generativeHtmlPreviewStyles.source} testID="generative-ui-source">
          <HighlightedCodeBlock
            code={html}
            language="html"
            inheritedStyles={inheritedStyles}
            textStyle={sourceTextStyle}
          />
        </View>
      )}
    </View>
  );
});

interface ModeButtonProps {
  active: boolean;
  icon: "preview" | "source";
  label: string;
  onPress: () => void;
}

const ModeButton = memo(function ModeButton({ active, icon, label, onPress }: ModeButtonProps) {
  const buttonStyle = useMemo(
    () => [
      generativeHtmlPreviewStyles.modeButton,
      active && generativeHtmlPreviewStyles.modeButtonActive,
    ],
    [active],
  );
  const labelStyle = useMemo(
    () => [
      generativeHtmlPreviewStyles.modeButtonLabel,
      active && generativeHtmlPreviewStyles.modeButtonLabelActive,
    ],
    [active],
  );
  const color = active
    ? generativeHtmlPreviewStyles.modeButtonLabelActive.color
    : generativeHtmlPreviewStyles.modeButtonLabel.color;
  const Icon = icon === "preview" ? PanelsTopLeft : Code2;
  const accessibilityState = useMemo(() => ({ selected: active }), [active]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      onPress={onPress}
      style={buttonStyle}
    >
      <Icon size={13} color={color} />
      <Text style={labelStyle}>{label}</Text>
    </Pressable>
  );
});

const generativeHtmlPreviewStyles = StyleSheet.create((theme) => ({
  // Soft quiet card family (r14).
  card: {
    overflow: "hidden",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    ...theme.shadow.sm,
  },
  header: {
    minHeight: 42,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    borderBottomWidth: 1,
    // Soft quiet chrome rule (--border-soft).
    borderBottomColor: theme.colors.secondary,
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  titleGroup: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 1,
  },
  titleIcon: {
    color: theme.colors.accent,
  },
  title: {
    color: theme.colors.foreground,
    fontFamily: Fonts.sans,
    // Soft preview title: 12.5 meta.
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: theme.fontWeight.semibold,
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontFamily: Fonts.sans,
    fontSize: 12.5,
    lineHeight: 16,
  },
  // Soft .seg micro track.
  segment: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    padding: 2,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  // Soft segment chip: quiet r8, 12.5 label.
  modeButton: {
    minHeight: 26,
    paddingHorizontal: theme.spacing[2],
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  modeButtonActive: {
    backgroundColor: theme.colors.surface0,
    ...theme.shadow.sm,
  },
  modeButtonLabel: {
    color: theme.colors.foregroundMuted,
    fontFamily: Fonts.sans,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.medium,
  },
  modeButtonLabelActive: {
    color: theme.colors.foreground,
  },
  frame: {
    height: 340,
    backgroundColor: theme.colors.surface0,
  },
  source: {
    padding: theme.spacing[3],
    backgroundColor: theme.colors.surface0,
  },
}));
