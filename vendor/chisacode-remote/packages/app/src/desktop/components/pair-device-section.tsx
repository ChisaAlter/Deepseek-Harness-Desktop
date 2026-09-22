import { useCallback, useMemo } from "react";
import { ActivityIndicator, Image, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as QRCode from "qrcode";
import { useQuery } from "@tanstack/react-query";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { RotateCw, Copy, Check } from "lucide-react-native";
import { settingsStyles } from "@/styles/settings";
import { Button } from "@/components/ui/button";
import { getDesktopDaemonPairing, shouldUseDesktopDaemon } from "@/desktop/daemon/desktop-daemon";
import { useHosts, useHostMutations } from "@/runtime/host-runtime";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedCopy = withUnistyles(Copy);
const ThemedCheck = withUnistyles(Check);
const ThemedTextInput = withUnistyles(TextInput);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const accentColorMapping = (theme: Theme) => ({ color: theme.colors.accent });
const textInputSelectionMapping = (theme: Theme) => ({ selectionColor: theme.colors.accent });

type PairingViewState =
  | { tag: "loading" }
  | { tag: "error"; message: string }
  | { tag: "unavailable"; message: string }
  | { tag: "ready"; url: string };

function resolvePairingViewState(args: {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data: { url?: string | null; relayEnabled?: boolean } | undefined;
}): PairingViewState {
  if (args.isPending) return { tag: "loading" };
  if (args.isError) {
    const message =
      args.error instanceof Error ? args.error.message : "Failed to load pairing offer.";
    return { tag: "error", message };
  }
  if (!args.data?.url) {
    const message =
      args.data?.relayEnabled === false
        ? "Relay is not enabled. Enable relay to pair a device."
        : "配对信息不可用。";
    return { tag: "unavailable", message };
  }
  return { tag: "ready", url: args.data.url };
}

export function PairDeviceSection() {
  const { t } = useTranslation();
  const showSection = shouldUseDesktopDaemon();
  const hosts = useHosts();
  const { clearRelayDeviceCredentials } = useHostMutations();
  const [copied, setCopied] = useState(false);
  const [credentialMessage, setCredentialMessage] = useState<string | null>(null);
  const [isClearing, setIsClearing] = useState(false);

  const relayConnections = hosts.flatMap((host) =>
    host.connections
      .filter((connection) => connection.type === "relay")
      .map((connection) => ({ host, connection })),
  );
  const pairedCount = relayConnections.filter(
    (entry) => entry.connection.type === "relay" && entry.connection.deviceSecret,
  ).length;
  const securityChip =
    pairedCount > 0
      ? t("settings.hostPage.pairDevice.securityV2")
      : t("settings.hostPage.pairDevice.securityMissing");

  const handleClearCredentials = useCallback(async () => {
    if (isClearing) return;
    setIsClearing(true);
    setCredentialMessage(null);
    try {
      for (const entry of relayConnections) {
        if (entry.connection.type !== "relay") continue;
        await clearRelayDeviceCredentials(entry.host.serverId, entry.connection.id);
      }
      setCredentialMessage(t("settings.hostPage.pairDevice.clearCredentialsDone"));
    } catch {
      setCredentialMessage(t("settings.hostPage.pairDevice.clearCredentialsFailed"));
    } finally {
      setIsClearing(false);
    }
  }, [clearRelayDeviceCredentials, isClearing, relayConnections, t]);

  const onClearCredentialsPress = useCallback(() => {
    void handleClearCredentials();
  }, [handleClearCredentials]);

  const pairingQuery = useQuery({
    queryKey: ["desktop-daemon-pairing"],
    queryFn: getDesktopDaemonPairing,
    enabled: showSection,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const qrQuery = useQuery({
    queryKey: ["desktop-daemon-pairing-qr", pairingQuery.data?.url],
    queryFn: () =>
      QRCode.toDataURL(pairingQuery.data!.url!, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 480,
      }),
    enabled: !!pairingQuery.data?.url,
    staleTime: Infinity,
  });

  const handleCopyLink = useCallback(async () => {
    if (!pairingQuery.data?.url) return;
    await Clipboard.setStringAsync(pairingQuery.data.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [pairingQuery.data?.url]);

  const handleRefetch = useCallback(() => {
    void pairingQuery.refetch();
  }, [pairingQuery]);

  const handleCopyPress = useCallback(() => {
    void handleCopyLink();
  }, [handleCopyLink]);

  const qrImageSource = useMemo(
    () => (qrQuery.data ? { uri: qrQuery.data } : null),
    [qrQuery.data],
  );

  const retryIcon = useMemo(
    () => <ThemedRotateCw size={ICON_SIZE.sm} uniProps={foregroundColorMapping} />,
    [],
  );
  const copyButtonIcon = useMemo(
    () =>
      copied ? (
        <ThemedCheck size={ICON_SIZE.sm} uniProps={accentColorMapping} />
      ) : (
        <ThemedCopy size={ICON_SIZE.sm} uniProps={foregroundColorMapping} />
      ),
    [copied],
  );

  if (!showSection) return null;

  const viewState = resolvePairingViewState({
    isPending: pairingQuery.isPending,
    isError: pairingQuery.isError,
    error: pairingQuery.error,
    data: pairingQuery.data,
  });

  return (
    <View style={settingsStyles.section} testID="host-page-pair-device-card">
      <View style={settingsStyles.card}>
        <PairDeviceBody
          viewState={viewState}
          retryIcon={retryIcon}
          copyButtonIcon={copyButtonIcon}
          qrImageSource={qrImageSource}
          qrQuery={qrQuery}
          copied={copied}
          handleRefetch={handleRefetch}
          handleCopyPress={handleCopyPress}
          securityChip={securityChip}
          credentialMessage={credentialMessage}
          isClearing={isClearing}
          onClearCredentials={onClearCredentialsPress}
          clearCredentialsLabel={t("settings.hostPage.pairDevice.clearCredentials")}
          clearCredentialsHint={t("settings.hostPage.pairDevice.clearCredentialsHint")}
          alwaysVisibleNote={t("settings.hostPage.pairDevice.alwaysVisibleActions")}
        />
      </View>
    </View>
  );
}

interface PairDeviceBodyProps {
  viewState: PairingViewState;
  retryIcon: React.ReactElement;
  copyButtonIcon: React.ReactElement;
  qrImageSource: { uri: string } | null;
  qrQuery: { isError: boolean };
  copied: boolean;
  handleRefetch: () => void;
  handleCopyPress: () => void;
  securityChip: string;
  credentialMessage: string | null;
  isClearing: boolean;
  onClearCredentials: () => void;
  clearCredentialsLabel: string;
  clearCredentialsHint: string;
  alwaysVisibleNote: string;
}

function PairDeviceBody(props: PairDeviceBodyProps) {
  const {
    viewState,
    retryIcon,
    copyButtonIcon,
    qrImageSource,
    qrQuery,
    copied,
    handleRefetch,
    handleCopyPress,
    securityChip,
    credentialMessage,
    isClearing,
    onClearCredentials,
    clearCredentialsLabel,
    clearCredentialsHint,
    alwaysVisibleNote,
  } = props;

  if (viewState.tag === "loading") {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="small" />
        <Text style={styles.hint}>正在加载配对信息...</Text>
      </View>
    );
  }

  if (viewState.tag === "error" || viewState.tag === "unavailable") {
    return (
      <View style={styles.centered}>
        <Text style={styles.hint}>{viewState.message}</Text>
        <Button variant="outline" size="sm" leftIcon={retryIcon} onPress={handleRefetch}>
          Retry
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.content}>
      <Text style={styles.securityChip} testID="pair-device-security-chip">
        {securityChip}
      </Text>
      <Text style={styles.hint}>用手机上的ChisaCode扫描这个二维码，或复制下面的链接。</Text>
      <View style={styles.qrContainer}>
        <PairDeviceQrContent qrImageSource={qrImageSource} qrQuery={qrQuery} />
      </View>
      <View style={styles.linkRow}>
        <View style={styles.inputWrapper}>
          <ThemedTextInput
            style={styles.linkInput}
            value={viewState.url}
            readOnly
            selectTextOnFocus
            uniProps={textInputSelectionMapping}
          />
        </View>
        <Button variant="outline" size="sm" leftIcon={copyButtonIcon} onPress={handleCopyPress}>
          {copied ? "已复制" : "复制"}
        </Button>
      </View>
      <Text style={styles.hint}>{clearCredentialsHint}</Text>
      <Button
        variant="outline"
        size="sm"
        onPress={onClearCredentials}
        disabled={isClearing}
        testID="pair-device-clear-credentials"
      >
        {isClearing ? "..." : clearCredentialsLabel}
      </Button>
      {credentialMessage ? <Text style={styles.hint}>{credentialMessage}</Text> : null}
      <Text style={styles.hint}>{alwaysVisibleNote}</Text>
    </View>
  );
}

function PairDeviceQrContent(props: {
  qrImageSource: { uri: string } | null;
  qrQuery: { isError: boolean };
}) {
  if (props.qrImageSource) {
    return <Image source={props.qrImageSource} style={styles.qrImage} resizeMode="contain" />;
  }
  if (props.qrQuery.isError) {
    return <Text style={styles.hint}>二维码不可用。</Text>;
  }
  return <ActivityIndicator size="small" />;
}

const styles = StyleSheet.create((theme) => ({
  centered: {
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[6],
    paddingHorizontal: theme.spacing[4],
  },
  content: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    textAlign: "center",
  },
  securityChip: {
    alignSelf: "center",
    color: theme.colors.accent,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },
  // Soft QR card: r14 quiet elevation family.
  qrContainer: {
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    width: 320,
    height: 320,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    padding: theme.spacing[2],
  },
  qrImage: {
    width: "100%",
    height: "100%",
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  inputWrapper: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    overflow: "hidden",
  },
  linkInput: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    outlineStyle: "none",
  } as object,
}));
