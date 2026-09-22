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

/**
 * Native fallback for the browser panel.
 * Instead of rendering a full WebView, shows a help message with a link
 * to open the current browser session URL in the system browser.
 *
 * The real browser implementation lives in `browser-pane.electron.tsx`.
 */
export function BrowserPane({ browserId: _browserId }: BrowserPaneProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t("browser.desktopOnlyTitle")}</Text>
      <Text style={styles.subtitle}>{t("browser.desktopOnlyBody")}</Text>
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
