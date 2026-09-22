import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";

interface BrowserPaneProps {
  browserId: string;
  serverId: string;
  workspaceId: string;
  cwd: string | null;
  isInteractive?: boolean;
  onFocusPane?: () => void;
}

export function BrowserPane({ browserId }: BrowserPaneProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t("browser.desktopOnlyTitle")}</Text>
      <Text style={styles.subtitle}>{t("browser.desktopOnlyBody")}</Text>
      <Text style={styles.subtitle}>浏览器会话 {browserId}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
  },
  // Soft empty-state title scale.
  title: {
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: "500",
    color: theme.colors.foreground,
  },
  subtitle: {
    fontSize: 12.5,
    lineHeight: 18,
    color: theme.colors.foregroundMuted,
  },
}));
