import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { type Theme } from "@/styles/theme";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { FolderOpen, Inbox, Plug, Smartphone } from "lucide-react-native";
import { ChisaCodeLogo } from "@/components/icons/chisacode-logo";
import { MenuHeader } from "@/components/headers/menu-header";
import { useOpenProjectPicker } from "@/hooks/use-open-project-picker";
import { usePanelStore } from "@/stores/panel-store";
import {
  useIsCompactFormFactor,
  HEADER_INNER_HEIGHT,
  HEADER_INNER_HEIGHT_MOBILE,
  HEADER_TOP_PADDING_MOBILE,
} from "@/constants/layout";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { PairDeviceModal } from "@/desktop/components/pair-device-modal";
import { buildHostAgentDetailRoute, buildSettingsHostRoute } from "@/utils/host-routes";
import { ImportSessionSheet } from "@/components/import-session-sheet";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useOpenProject } from "@/hooks/use-open-project";
import { shouldShowOpenProjectMenuHeader } from "./open-project-screen-layout";
import { isWeb } from "@/constants/platform";
import type { Href } from "expo-router";

export function OpenProjectScreen({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const openDesktopAgentList = usePanelStore((s) => s.openDesktopAgentList);
  const openProjectPicker = useOpenProjectPicker(serverId);
  const isLocalDaemon = useIsLocalDaemon(serverId);
  const client = useHostRuntimeClient(serverId);
  const openProject = useOpenProject(serverId);
  const [isPairDeviceOpen, setIsPairDeviceOpen] = useState(false);
  const [isImportSheetOpen, setIsImportSheetOpen] = useState(false);

  const isCompactLayout = useIsCompactFormFactor();

  useEffect(() => {
    if (!isCompactLayout) {
      openDesktopAgentList();
    }
  }, [isCompactLayout, openDesktopAgentList]);

  const handleOpenPicker = useCallback(() => {
    void openProjectPicker();
  }, [openProjectPicker]);

  const handleOpenPairDevice = useCallback(() => setIsPairDeviceOpen(true), []);
  const handleClosePairDevice = useCallback(() => setIsPairDeviceOpen(false), []);

  const handleOpenImportSession = useCallback(() => setIsImportSheetOpen(true), []);
  const handleCloseImportSession = useCallback(() => setIsImportSheetOpen(false), []);

  const handleImported = useCallback(
    (agent: { id: string; cwd: string }) => {
      void (async () => {
        await openProject(agent.cwd);
        router.push(buildHostAgentDetailRoute(serverId, agent.id) as Href);
      })();
    },
    [openProject, router, serverId],
  );

  const handleOpenProviders = useCallback(() => {
    router.push(buildSettingsHostRoute(serverId));
  }, [router, serverId]);

  return (
    <View style={styles.container}>
      {shouldShowOpenProjectMenuHeader({ isCompactLayout }) ? <MenuHeader borderless /> : null}
      <View style={styles.content}>
        <TitlebarDragRegion />
        <View style={styles.hero}>
          <View style={styles.logo}>
            <ChisaCodeLogo size={40} />
          </View>
          <Text style={styles.heroEyebrow}>{t("workspace.softHomeEyebrow")}</Text>
          <Text style={styles.heroTitle}>{t("openProject.heroTitle")}</Text>
          <Text style={styles.heroSubtitle}>{t("openProject.heroSubtitle")}</Text>
        </View>
        <View style={styles.tiles}>
          <HomeTile
            icon={FolderOpen}
            title={t("openProject.addProject.title")}
            description={t("openProject.addProject.description")}
            onPress={handleOpenPicker}
            testID="open-project-submit"
            accent
          />
          <HomeTile
            icon={Inbox}
            title={t("openProject.importSession.title")}
            description={t("openProject.importSession.description")}
            onPress={handleOpenImportSession}
            testID="open-project-import-session"
          />
          <HomeTile
            icon={Plug}
            title={t("openProject.setupProviders.title")}
            description={t("openProject.setupProviders.description")}
            onPress={handleOpenProviders}
            testID="open-project-setup-providers"
          />
          {isLocalDaemon ? (
            <HomeTile
              icon={Smartphone}
              title={t("openProject.pairDevice.title")}
              description={t("openProject.pairDevice.description")}
              onPress={handleOpenPairDevice}
              testID="open-project-pair-device"
            />
          ) : null}
        </View>
      </View>
      <PairDeviceModal
        visible={isPairDeviceOpen}
        onClose={handleClosePairDevice}
        testID="open-project-pair-device-modal"
      />
      <ImportSessionSheet
        visible={isImportSheetOpen}
        client={client}
        serverId={serverId}
        onClose={handleCloseImportSession}
        onImported={handleImported}
      />
    </View>
  );
}

interface HomeTileProps {
  icon: ComponentType<{ size: number; color: string }>;
  title: string;
  description: string;
  onPress: () => void;
  testID?: string;
  accent?: boolean;
}

const accentColorMapping = (theme: Theme) => ({
  color: theme.colors.accent,
});
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

function HomeTile({ icon: Icon, title, description, onPress, testID, accent }: HomeTileProps) {
  const [hovered, setHovered] = useState(false);
  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);

  const ThemedIcon = useMemo(() => withUnistyles(Icon), [Icon]);
  const iconColorMapping = accent ? accentColorMapping : foregroundMutedColorMapping;

  const pressableStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.tile,
      hovered && styles.tileHovered,
      pressed && styles.tilePressed,
    ],
    [hovered],
  );

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      testID={testID}
      style={pressableStyle}
    >
      <ThemedIcon size={20} uniProps={iconColorMapping} />
      <View style={styles.tileText}>
        <Text style={styles.tileTitle}>{title}</Text>
        <Text style={styles.tileDescription}>{description}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Soft Workbench canvas — same quiet shell as Soft Home.
  container: {
    flex: 1,
    backgroundColor: theme.colors.surfaceWorkspace,
    userSelect: "none",
  },
  content: {
    position: "relative",
    flex: 1,
    justifyContent: { xs: "flex-start", md: "center" },
    alignItems: "center",
    gap: 0,
    padding: theme.spacing[6],
    paddingTop: { xs: theme.spacing[12], md: theme.spacing[6] },
    paddingBottom: {
      xs: HEADER_INNER_HEIGHT_MOBILE + HEADER_TOP_PADDING_MOBILE + theme.spacing[6],
      md: HEADER_INNER_HEIGHT + theme.spacing[6],
    },
  },
  hero: {
    width: "100%",
    maxWidth: 520,
    alignItems: "center",
    gap: theme.spacing[2],
    marginBottom: theme.spacing[2],
  },
  logo: {
    marginBottom: theme.spacing[2],
  },
  heroEyebrow: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    textAlign: "center",
  },
  heroTitle: {
    color: theme.colors.foreground,
    fontSize: { xs: 28, md: 34 },
    fontWeight: theme.fontWeight.bold,
    letterSpacing: -0.7,
    textAlign: "center",
    lineHeight: { xs: 34, md: 40 },
  },
  heroSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: 14.5,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: theme.spacing[2],
  },
  tiles: {
    marginTop: { xs: theme.spacing[4], md: theme.spacing[6] },
    width: "100%",
    maxWidth: 480,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: theme.spacing[3],
  },
  // Soft card tiles: quiet surface, soft radius, shadow only on hover.
  tile: {
    width: { xs: "100%", md: 228 },
    minHeight: { xs: 0, md: 128 },
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    gap: theme.spacing[3],
  },
  tileHovered: {
    backgroundColor: theme.colors.surface0,
    borderColor: theme.colors.border,
    ...(isWeb
      ? {
          boxShadow: "0 1px 2px rgba(20, 23, 31, 0.04), 0 8px 28px rgba(20, 23, 31, 0.06)",
        }
      : { backgroundColor: theme.colors.surfaceWorkspace }),
  },
  tilePressed: {
    opacity: 0.9,
  },
  tileText: {
    gap: theme.spacing[1],
  },
  tileTitle: {
    color: theme.colors.foreground,
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: theme.fontWeight.medium,
  },
  tileDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
}));
