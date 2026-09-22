import { useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { QrCode, Link2, ClipboardPaste } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet, type SheetHeader } from "./adaptive-modal-sheet";
import { isNative } from "@/constants/platform";
import type { Theme } from "@/styles/theme";

// Lucide icons only accept `color` (a non-style prop), so wrap each one with
// `withUnistyles` and feed the theme-reactive color through `uniProps`. Only the
// icon node re-renders on theme changes — the surrounding tree does not.
const ThemedQrCode = withUnistyles(QrCode);
const ThemedLink2 = withUnistyles(Link2);
const ThemedClipboardPaste = withUnistyles(ClipboardPaste);

const foregroundColorMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
});

const styles = StyleSheet.create((theme) => ({
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[4],
    padding: theme.spacing[4],
    borderRadius: 14,
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  optionText: {
    color: theme.colors.foreground,
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: theme.fontWeight.normal,
  },
  optionSubtext: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    marginTop: theme.spacing[1],
  },
  optionBody: {
    flex: 1,
  },
}));

export interface AddHostMethodModalProps {
  visible: boolean;
  onClose: () => void;
  onDirectConnection: () => void;
  onScanQr: () => void;
  onPasteLink: () => void;
}

export function AddHostMethodModal({
  visible,
  onClose,
  onDirectConnection,
  onScanQr,
  onPasteLink,
}: AddHostMethodModalProps) {
  const { t } = useTranslation();
  const header = useMemo<SheetHeader>(() => ({ title: t("host.addConnection") }), [t]);

  const handleDirect = useCallback(() => {
    onDirectConnection();
  }, [onDirectConnection]);

  const handleScan = useCallback(() => {
    onScanQr();
  }, [onScanQr]);

  const handlePaste = useCallback(() => {
    onPasteLink();
  }, [onPasteLink]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      testID="add-host-method-modal"
    >
      <Pressable
        style={styles.option}
        onPress={handleDirect}
        accessibilityRole="button"
        accessibilityLabel={t("host.directConnection")}
        testID="add-host-method-direct"
      >
        <ThemedLink2 size={18} uniProps={foregroundColorMapping} />
        <View style={styles.optionBody}>
          <Text style={styles.optionText}>{t("host.directConnection")}</Text>
          <Text style={styles.optionSubtext}>{t("host.localNetworkOrVpn")}</Text>
        </View>
      </Pressable>

      {isNative ? (
        <Pressable
          style={styles.option}
          onPress={handleScan}
          accessibilityRole="button"
          accessibilityLabel={t("host.scanQr")}
        >
          <ThemedQrCode size={18} uniProps={foregroundColorMapping} />
          <View style={styles.optionBody}>
            <Text style={styles.optionText}>{t("host.scanQr")}</Text>
            <Text style={styles.optionSubtext}>{t("host.encryptedRelayConnection")}</Text>
          </View>
        </Pressable>
      ) : null}

      <Pressable
        style={styles.option}
        onPress={handlePaste}
        accessibilityRole="button"
        accessibilityLabel={t("host.pastePairingLink")}
        testID="add-host-method-pair-link"
      >
        <ThemedClipboardPaste size={18} uniProps={foregroundColorMapping} />
        <View style={styles.optionBody}>
          <Text style={styles.optionText}>{t("host.pastePairingLink")}</Text>
          <Text style={styles.optionSubtext}>{t("host.encryptedRelayConnection")}</Text>
        </View>
      </Pressable>
    </AdaptiveModalSheet>
  );
}
