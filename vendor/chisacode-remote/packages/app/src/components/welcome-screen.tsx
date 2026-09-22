import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Pressable, Text, View, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { QrCode, Link2, ClipboardPaste, ExternalLink, Settings } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HostProfile } from "@/types/host-connection";
import { getHostRuntimeStore, isHostRuntimeConnected, useHosts } from "@/runtime/host-runtime";
import { AddHostModal } from "./add-host-modal";
import { PairLinkModal } from "./pair-link-modal";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { resolveAppVersion } from "@/utils/app-version";
import { formatVersionWithPrefix } from "@/desktop/updates/desktop-updates";
import { buildHostRootRoute } from "@/utils/host-routes";
import { ChisaCodeLogo } from "@/components/icons/chisacode-logo";
import { openExternalUrl } from "@/utils/open-external-url";
import { isWeb, isNative } from "@/constants/platform";
import { SPACING, type Theme } from "@/styles/theme";

// Bake theme colors into withUnistyles mappers — do NOT pass `uniProps` at the
// call site. On web/Electron, lucide icons forward unknown props onto DOM
// nodes, which triggers: React does not recognize the `uniProps` prop.
const ThemedExternalLink = withUnistyles(ExternalLink, (theme: Theme) => ({
  color: theme.colors.accent,
}));
const ThemedQrCode = withUnistyles(QrCode, (theme: Theme) => ({
  color: theme.colors.foreground,
}));
const ThemedQrCodePrimary = withUnistyles(QrCode, (theme: Theme) => ({
  color: theme.colors.accentForeground,
}));
const ThemedLink2 = withUnistyles(Link2, (theme: Theme) => ({
  color: theme.colors.foreground,
}));
const ThemedLink2Primary = withUnistyles(Link2, (theme: Theme) => ({
  color: theme.colors.accentForeground,
}));
const ThemedClipboardPaste = withUnistyles(ClipboardPaste, (theme: Theme) => ({
  color: theme.colors.foreground,
}));

interface WelcomeAction {
  key: "scan-qr" | "direct-connection" | "paste-pairing-link";
  label: string;
  testID: string;
  primary: boolean;
  icon: typeof ThemedQrCode;
  onPress: () => void;
}

const styles = StyleSheet.create((theme) => ({
  // Soft Workbench onboarding canvas.
  root: {
    flex: 1,
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  scrollView: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    padding: theme.spacing[6],
    paddingBottom: 0,
    alignItems: "center",
  },
  content: {
    width: "100%",
    maxWidth: 480,
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    color: theme.colors.foreground,
    fontSize: 28,
    fontWeight: theme.fontWeight.bold,
    letterSpacing: -0.5,
    textAlign: "center",
    lineHeight: 34,
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: 14.5,
    textAlign: "center",
    lineHeight: 22,
  },
  copyBlock: {
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[4],
    marginBottom: theme.spacing[8],
  },
  actions: {
    width: "100%",
    maxWidth: 420,
    gap: theme.spacing[3],
  },
  // Soft pill action buttons — quiet surface cards.
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    minHeight: 48,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    borderRadius: 14,
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow.sm,
  },
  actionButtonPrimary: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  actionText: {
    color: theme.colors.foreground,
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: theme.fontWeight.medium,
  },
  actionTextPrimary: {
    color: theme.colors.accentForeground,
  },
  setupLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  setupLinkText: {
    color: theme.colors.accent,
    // Soft welcome secondary: 12.5 muted.
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: theme.fontWeight.medium,
  },
  versionLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    textAlign: "center",
    marginTop: theme.spacing[6],
  },
  settingsButton: {
    alignSelf: "center",
    marginTop: theme.spacing[6],
  },
}));

function useAnyHostOnline(serverIds: string[]): string | null {
  const runtime = getHostRuntimeStore();
  return useSyncExternalStore(
    (onStoreChange) => runtime.subscribeAll(onStoreChange),
    () => {
      let firstOnlineServerId: string | null = null;
      let firstOnlineAt: string | null = null;
      for (const serverId of serverIds) {
        const snapshot = runtime.getSnapshot(serverId);
        const lastOnlineAt = snapshot?.lastOnlineAt ?? null;
        if (!isHostRuntimeConnected(snapshot) || !lastOnlineAt) {
          continue;
        }
        if (!firstOnlineAt || lastOnlineAt < firstOnlineAt) {
          firstOnlineAt = lastOnlineAt;
          firstOnlineServerId = serverId;
        }
      }
      return firstOnlineServerId;
    },
    () => {
      let firstOnlineServerId: string | null = null;
      let firstOnlineAt: string | null = null;
      for (const serverId of serverIds) {
        const snapshot = runtime.getSnapshot(serverId);
        const lastOnlineAt = snapshot?.lastOnlineAt ?? null;
        if (!isHostRuntimeConnected(snapshot) || !lastOnlineAt) {
          continue;
        }
        if (!firstOnlineAt || lastOnlineAt < firstOnlineAt) {
          firstOnlineAt = lastOnlineAt;
          firstOnlineServerId = serverId;
        }
      }
      return firstOnlineServerId;
    },
  );
}

export interface WelcomeScreenProps {
  onHostAdded?: (profile: HostProfile) => void;
}

export function WelcomeScreen({ onHostAdded }: WelcomeScreenProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const appVersion = resolveAppVersion();
  const appVersionText = formatVersionWithPrefix(appVersion);
  const [isDirectOpen, setIsDirectOpen] = useState(false);
  const [isPasteLinkOpen, setIsPasteLinkOpen] = useState(false);
  const hosts = useHosts();
  const anyOnlineServerId = useAnyHostOnline(hosts.map((h) => h.serverId));

  useEffect(() => {
    if (!anyOnlineServerId) return;
    router.replace(buildHostRootRoute(anyOnlineServerId));
  }, [anyOnlineServerId, router]);

  const finishOnboarding = useCallback(
    (serverId: string) => {
      router.replace(buildHostRootRoute(serverId));
    },
    [router],
  );

  const handleOpenChisaCodeSite = useCallback(() => {
    void openExternalUrl("https://chisacode.sh");
  }, []);

  const handleOpenSettings = useCallback(() => {
    router.push("/settings");
  }, [router]);

  const handleOpenDirect = useCallback(() => setIsDirectOpen(true), []);
  const handleCloseDirect = useCallback(() => setIsDirectOpen(false), []);
  const handleOpenPasteLink = useCallback(() => setIsPasteLinkOpen(true), []);
  const handleClosePasteLink = useCallback(() => setIsPasteLinkOpen(false), []);
  const handleScanQr = useCallback(() => {
    router.push("/pair-scan?source=onboarding");
  }, [router]);

  const handleHostSaved = useCallback(
    ({ profile, serverId }: { profile: HostProfile; serverId: string }) => {
      onHostAdded?.(profile);
      finishOnboarding(serverId);
    },
    [onHostAdded, finishOnboarding],
  );

  const actions: WelcomeAction[] = isWeb
    ? [
        {
          key: "direct-connection",
          label: t("onboarding.directConnection"),
          testID: "welcome-direct-connection",
          primary: true,
          icon: ThemedLink2Primary,
          onPress: handleOpenDirect,
        },
        {
          key: "paste-pairing-link",
          label: t("onboarding.pastePairingLink"),
          testID: "welcome-paste-pairing-link",
          primary: false,
          icon: ThemedClipboardPaste,
          onPress: handleOpenPasteLink,
        },
      ]
    : [
        {
          key: "scan-qr",
          label: t("onboarding.scanQr"),
          testID: "welcome-scan-qr",
          primary: true,
          icon: ThemedQrCodePrimary,
          onPress: handleScanQr,
        },
        {
          key: "direct-connection",
          label: t("onboarding.directConnection"),
          testID: "welcome-direct-connection",
          primary: false,
          icon: ThemedLink2,
          onPress: handleOpenDirect,
        },
        {
          key: "paste-pairing-link",
          label: t("onboarding.pastePairingLink"),
          testID: "welcome-paste-pairing-link",
          primary: false,
          icon: ThemedClipboardPaste,
          onPress: handleOpenPasteLink,
        },
      ];

  const scrollContentContainerStyle = useMemo(
    () => [styles.container, { paddingBottom: SPACING[6] + insets.bottom }],
    [insets.bottom],
  );

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={scrollContentContainerStyle}
        showsVerticalScrollIndicator={false}
        testID="welcome-screen"
      >
        <View style={styles.content}>
          <ChisaCodeLogo size={48} />
          <View style={styles.copyBlock}>
            <Text style={styles.title}>{t("onboarding.welcome")}</Text>
            <Text style={styles.subtitle}>{t("onboarding.connectToStart")}</Text>
            {isNative ? (
              <Pressable style={styles.setupLink} onPress={handleOpenChisaCodeSite}>
                <Text style={styles.setupLinkText}>chisacode.sh</Text>
                <ThemedExternalLink size={14} />
              </Pressable>
            ) : null}
          </View>

          <View style={styles.actions}>
            {actions.map((action) => (
              <WelcomeActionButton key={action.key} action={action} />
            ))}
          </View>

          <Button
            variant="ghost"
            size="sm"
            leftIcon={Settings}
            onPress={handleOpenSettings}
            style={styles.settingsButton}
            testID="welcome-open-settings"
          >
            {t("onboarding.settings")}
          </Button>
        </View>
        <Text style={styles.versionLabel}>{appVersionText}</Text>

        <AddHostModal
          visible={isDirectOpen}
          onClose={handleCloseDirect}
          onSaved={handleHostSaved}
        />

        <PairLinkModal
          visible={isPasteLinkOpen}
          onClose={handleClosePasteLink}
          onSaved={handleHostSaved}
        />
      </ScrollView>
    </View>
  );
}

interface WelcomeActionButtonProps {
  action: WelcomeAction;
}

function WelcomeActionButton({ action }: WelcomeActionButtonProps) {
  const Icon = action.icon;
  const buttonStyle = useMemo(
    () => [styles.actionButton, action.primary ? styles.actionButtonPrimary : null],
    [action.primary],
  );
  const textStyle = useMemo(
    () => [styles.actionText, action.primary ? styles.actionTextPrimary : null],
    [action.primary],
  );
  return (
    <Pressable style={buttonStyle} onPress={action.onPress} testID={action.testID}>
      <Icon size={18} />
      <Text style={textStyle}>{action.label}</Text>
    </Pressable>
  );
}
