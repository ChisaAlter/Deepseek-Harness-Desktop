import { useCallback, useMemo, useState } from "react";
import { StyleSheet as RNStyleSheet, View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FOOTER_HEIGHT, MAX_CONTENT_WIDTH } from "@/constants/layout";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useKeyboardShiftStyle } from "@/hooks/use-keyboard-shift-style";
import { useUserVisibleErrorReporter } from "@/hooks/use-user-visible-error";
import { Button } from "@/components/ui/button";
import { unarchiveAgent } from "@/components/archived-agent-unarchive";
import type { Theme } from "@/styles/theme";

interface ArchivedAgentCalloutProps {
  serverId: string;
  agentId: string;
}

export function ArchivedAgentCallout({ serverId, agentId }: ArchivedAgentCalloutProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const [isUnarchiving, setIsUnarchiving] = useState(false);
  const reportError = useUserVisibleErrorReporter();

  const { style: keyboardAnimatedStyle } = useKeyboardShiftStyle({ mode: "translate" });

  const containerStyle = useMemo(
    () => [staticStyles.container, { paddingBottom: insets.bottom }, keyboardAnimatedStyle],
    [insets.bottom, keyboardAnimatedStyle],
  );

  const handleUnarchive = useCallback(async () => {
    if (!client || !isConnected || isUnarchiving) return;
    await unarchiveAgent({
      agentId,
      refreshAgent: (id) => client.refreshAgent(id),
      reportError,
      fallbackMessage: t("session.unarchiveFailed"),
      setPending: setIsUnarchiving,
    });
  }, [agentId, client, isConnected, isUnarchiving, reportError, t]);

  return (
    <Animated.View style={containerStyle}>
      <View style={styles.inputAreaContainer}>
        <View style={styles.inputAreaContent}>
          <View style={styles.callout}>
            <Text style={styles.calloutText}>{t("session.archivedCallout")}</Text>
            <Button
              size="sm"
              variant="secondary"
              onPress={handleUnarchive}
              disabled={!isConnected || isUnarchiving}
            >
              {t("session.unarchive")}
            </Button>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  inputAreaContainer: {
    position: "relative",
    minHeight: FOOTER_HEIGHT,
    marginHorizontal: "auto",
    alignItems: "center",
    width: "100%",
    overflow: "visible",
    padding: theme.spacing[4],
  },
  inputAreaContent: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
  },
  callout: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    backgroundColor: theme.colors.surface0,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: 14,
    paddingVertical: {
      xs: theme.spacing[3],
      md: theme.spacing[4],
    },
    paddingHorizontal: {
      xs: theme.spacing[4],
      md: theme.spacing[6],
    },
  },
  calloutText: {
    color: theme.colors.foregroundMuted,
    fontSize: 14.5,
    lineHeight: 20,
  },
})) as unknown as Record<string, object>;

const staticStyles = RNStyleSheet.create({
  container: {
    flexDirection: "column",
    position: "relative",
  },
});
