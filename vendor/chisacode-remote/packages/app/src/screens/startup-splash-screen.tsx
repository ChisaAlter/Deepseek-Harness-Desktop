import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { openExternalUrl } from "@/utils/open-external-url";
import { BookOpen, Copy, RotateCw, Settings, TriangleAlert } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { type Theme } from "@/styles/theme";
import { ChisaCodeLogo } from "@/components/icons/chisacode-logo";
import { Button } from "@/components/ui/button";
import { Fonts } from "@/constants/theme";
import {
  getDesktopDaemonLogs,
  shouldUseDesktopDaemon,
  type DesktopDaemonLogs,
} from "@/desktop/daemon/desktop-daemon";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { isWeb } from "@/constants/platform";
import { useWebScrollbarStyle } from "@/hooks/use-web-scrollbar-style";
import { useTranslation } from "react-i18next";

interface StartupSplashScreenProps {
  bootstrapState?: {
    splashError: string | null;
    retry: () => void;
  };
}

const GITHUB_ISSUE_URL = "https://github.com/getchisacode/chisacode/issues/new";
const DOCS_URL = "https://chisacode.sh/docs";

const LOGO_SIZE = 96;

const ThemedCopy = withUnistyles(Copy);
const ThemedTriangleAlert = withUnistyles(TriangleAlert);
const ThemedBookOpen = withUnistyles(BookOpen);
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedSettings = withUnistyles(Settings);

const foregroundColorMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
});
const paletteWhiteColorMapping = (theme: Theme) => ({
  color: theme.colors.palette.white,
});

function openGithubIssue(): void {
  void openExternalUrl(GITHUB_ISSUE_URL);
}

function openDocs(): void {
  void openExternalUrl(DOCS_URL);
}

function LogoShimmer() {
  return <ChisaCodeLogo size={LOGO_SIZE} />;
}

const styles = StyleSheet.create((theme) => ({
  // Soft quiet splash canvas.
  container: {
    position: "relative",
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surfaceWorkspace,
    paddingHorizontal: theme.spacing[8],
    paddingVertical: theme.spacing[8],
  },
  errorScreen: {
    position: "relative",
    flex: 1,
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  errorScrollView: {
    flex: 1,
    ...(isWeb
      ? {
          overflowX: "auto",
          overflowY: "auto",
          WebkitAppRegion: "no-drag",
        }
      : null),
  },
  errorScrollContent: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingHorizontal: theme.spacing[8],
    paddingVertical: theme.spacing[8],
    paddingTop: theme.spacing[16],
  },
  errorContent: {
    alignItems: "stretch",
    maxWidth: 720,
    width: "100%",
    gap: theme.spacing[6],
  },
  errorHeader: {
    alignItems: "flex-start",
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize["3xl"],
    fontWeight: theme.fontWeight.semibold,
    textAlign: "left",
  },
  errorDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: 14.5,
    lineHeight: 22,
  },
  errorMessage: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.code,
    lineHeight: 20,
    fontFamily: Fonts.mono,
  },
  logsMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  logsContainer: {
    height: 200,
    borderRadius: 14,
    backgroundColor: theme.colors.surface0,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  logsScroll: {
    flexGrow: 0,
  },
  logsContent: {
    padding: theme.spacing[4],
  },
  logsText: {
    fontFamily: Fonts.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foreground,
    lineHeight: 18,
    ...(isWeb
      ? {
          whiteSpace: "pre",
          overflowWrap: "normal",
        }
      : null),
  },
  actionRow: {
    flexDirection: "row",
    gap: theme.spacing[3],
    flexWrap: "wrap",
  },
}));

export function StartupSplashScreen({ bootstrapState }: StartupSplashScreenProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const webScrollbarStyle = useWebScrollbarStyle();
  const errorScrollViewStyle = useMemo(
    () => [styles.errorScrollView, webScrollbarStyle],
    [webScrollbarStyle],
  );
  const logsScrollStyle = useMemo(
    () => [styles.logsScroll, webScrollbarStyle],
    [webScrollbarStyle],
  );
  const [daemonLogs, setDaemonLogs] = useState<DesktopDaemonLogs | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  const isError = bootstrapState !== undefined && bootstrapState.splashError !== null;

  useEffect(() => {
    if (!isError) {
      setDaemonLogs(null);
      setLogsError(null);
      setIsLoadingLogs(false);
      return;
    }

    let isCancelled = false;
    setIsLoadingLogs(true);
    setLogsError(null);

    void getDesktopDaemonLogs()
      .then((logs) => {
        if (isCancelled) {
          return;
        }
        setDaemonLogs(logs);
        return;
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setDaemonLogs(null);
        setLogsError(t("startup.daemonLogsLoadFailed", { message }));
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingLogs(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isError, t]);

  const logsText = useMemo(() => {
    if (isLoadingLogs) {
      return t("startup.loadingDaemonLogs");
    }
    if (daemonLogs?.contents) {
      return daemonLogs.contents;
    }
    if (logsError) {
      return logsError;
    }
    return t("startup.noDaemonLogs");
  }, [daemonLogs?.contents, isLoadingLogs, logsError, t]);

  const handleCopyLogs = useCallback(() => {
    const payload = daemonLogs?.logPath
      ? `${daemonLogs.logPath}\n\n${daemonLogs.contents}`
      : logsText;
    void Clipboard.setStringAsync(payload);
  }, [daemonLogs?.logPath, daemonLogs?.contents, logsText]);

  const copyIcon = useMemo(() => <ThemedCopy size={16} uniProps={foregroundColorMapping} />, []);
  const warningIcon = useMemo(
    () => <ThemedTriangleAlert size={16} uniProps={foregroundColorMapping} />,
    [],
  );
  const bookIcon = useMemo(
    () => <ThemedBookOpen size={16} uniProps={foregroundColorMapping} />,
    [],
  );
  const retryIcon = useMemo(
    () => <ThemedRotateCw size={16} uniProps={paletteWhiteColorMapping} />,
    [],
  );
  const settingsIcon = useMemo(
    () => <ThemedSettings size={16} uniProps={foregroundColorMapping} />,
    [],
  );

  const handleOpenSettings = useCallback(() => {
    router.push("/settings");
  }, [router]);

  if (!isError) {
    return (
      <View testID="startup-splash" style={styles.container}>
        <TitlebarDragRegion />
        <LogoShimmer />
      </View>
    );
  }

  return (
    <View style={styles.errorScreen}>
      <TitlebarDragRegion />
      <ScrollView
        style={errorScrollViewStyle}
        contentContainerStyle={styles.errorScrollContent}
        showsVerticalScrollIndicator
      >
        <View style={styles.errorContent}>
          <View style={styles.errorHeader}>
            <ChisaCodeLogo size={64} />
            <Text style={styles.title}>{t("startup.errorTitle")}</Text>
          </View>

          <Text style={styles.errorDescription}>{t("startup.serverFailed")}</Text>

          <Text style={styles.errorMessage}>{bootstrapState.splashError}</Text>

          {daemonLogs?.logPath ? <Text style={styles.logsMeta}>{daemonLogs.logPath}</Text> : null}

          <View style={styles.logsContainer}>
            <ScrollView
              style={logsScrollStyle}
              contentContainerStyle={styles.logsContent}
              showsVerticalScrollIndicator
            >
              <Text selectable style={styles.logsText}>
                {logsText}
              </Text>
            </ScrollView>
          </View>

          <View style={styles.actionRow}>
            <Button variant="secondary" leftIcon={copyIcon} onPress={handleCopyLogs}>
              {t("startup.copyLogs")}
            </Button>
            <Button variant="outline" leftIcon={warningIcon} onPress={openGithubIssue}>
              {t("startup.openGithubIssue")}
            </Button>
            <Button variant="outline" leftIcon={bookIcon} onPress={openDocs}>
              {t("startup.docs")}
            </Button>
            {shouldUseDesktopDaemon() && (
              <Button variant="outline" leftIcon={settingsIcon} onPress={handleOpenSettings}>
                {t("startup.openSettings")}
              </Button>
            )}
            <Button variant="default" leftIcon={retryIcon} onPress={bootstrapState.retry}>
              {t("common.retry")}
            </Button>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
