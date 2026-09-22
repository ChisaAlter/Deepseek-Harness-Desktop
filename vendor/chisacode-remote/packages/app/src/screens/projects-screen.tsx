import { useCallback } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { isWeb } from "@/constants/platform";
import { router, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronRight } from "lucide-react-native";
import { ProjectIconView } from "@/components/project-icon-view";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { projectIconToDataUri, useProjectIconQuery } from "@/hooks/use-project-icon-query";
import { useProjects, type ProjectHostError } from "@/hooks/use-projects";
import { settingsStyles } from "@/styles/settings";
import { buildProjectSettingsRoute } from "@/utils/host-routes";
import type { ProjectHostEntry, ProjectSummary } from "@/utils/projects";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ThemedChevronRight = withUnistyles(ChevronRight);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

interface ProjectsScreenProps {
  view: { kind: "projects" } | { kind: "project"; projectKey: string };
  returnTo?: string | null;
}

export default function ProjectsScreen({ view, returnTo }: ProjectsScreenProps) {
  const { t } = useTranslation();
  const { projects, hostErrors, isLoading } = useProjects();
  const selectedProjectKey = view.kind === "project" ? view.projectKey : null;

  if (isLoading && projects.length === 0) {
    return (
      <View style={styles.centered} testID="projects-list">
        <LoadingSpinner size="large" color={styles.spinnerColor.color} />
      </View>
    );
  }

  if (projects.length === 0) {
    return (
      <View style={styles.centered} testID="projects-list">
        <Text style={styles.emptyText}>{t("sidebar.noProjects")}</Text>
      </View>
    );
  }

  return (
    <View testID="projects-list">
      {hostErrors.length > 0 ? <HostErrorsBanner errors={hostErrors} /> : null}
      <View style={settingsStyles.card}>
        {projects.map((project, index) => (
          <ProjectRow
            key={project.projectKey}
            project={project}
            isFirst={index === 0}
            isSelected={selectedProjectKey === project.projectKey}
            returnTo={returnTo}
          />
        ))}
      </View>
    </View>
  );
}

function HostErrorsBanner({ errors }: { errors: ProjectHostError[] }) {
  const { t } = useTranslation();
  return (
    <View style={styles.errorsBanner} testID="projects-host-errors">
      {errors.map((error) => (
        <Text key={error.serverId} style={styles.errorsBannerText}>
          {t("workspace.hostProjectLoadError", {
            serverName: error.serverName,
            message: error.message,
          })}
        </Text>
      ))}
    </View>
  );
}

interface ProjectRowProps {
  project: ProjectSummary;
  isFirst: boolean;
  isSelected: boolean;
  returnTo?: string | null;
}

function ProjectRow({ project, isFirst, isSelected, returnTo }: ProjectRowProps) {
  const { hosts, projectKey, projectName } = project;
  const leadingHost = hosts[0];

  const handleNavigate = useCallback(() => {
    router.navigate(buildProjectSettingsRoute(projectKey, { returnTo }) as Href);
  }, [projectKey, returnTo]);

  const rowStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      settingsStyles.row,
      !isFirst && settingsStyles.rowBorder,
      styles.row,
      isSelected && styles.rowSelected,
      hovered && !isSelected && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [isFirst, isSelected],
  );

  return (
    <Pressable
      style={rowStyle}
      onPress={handleNavigate}
      accessibilityRole="button"
      accessibilityLabel={`Edit ${projectName}`}
      testID={`project-row-${projectKey}`}
      data-selected={isSelected ? "true" : "false"}
    >
      <View style={styles.rowMain}>
        <View style={styles.leading}>
          <ProjectRowIcon host={leadingHost} projectName={projectName} projectKey={projectKey} />
        </View>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {projectName}
        </Text>
      </View>
      <ThemedChevronRight size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
    </Pressable>
  );
}

function ProjectRowIcon({
  host,
  projectName,
  projectKey,
}: {
  host: ProjectHostEntry | undefined;
  projectName: string;
  projectKey: string;
}) {
  const initial = projectName.trim().charAt(0).toUpperCase() || "?";
  const { icon } = useProjectIconQuery({
    serverId: host?.serverId ?? "",
    cwd: host?.repoRoot ?? "",
  });
  return (
    <ProjectIconView
      iconDataUri={projectIconToDataUri(icon)}
      initial={initial}
      projectKey={projectKey}
      imageStyle={styles.iconImage}
      fallbackStyle={styles.iconFallback}
      textStyle={styles.iconFallbackText}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[6],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  errorsBanner: {
    // Soft quiet card family (r14).
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    backgroundColor: theme.colors.surface0,
    padding: theme.spacing[3],
    marginBottom: theme.spacing[3],
    gap: theme.spacing[1],
  },
  errorsBannerText: {
    color: theme.colors.destructive,
    fontSize: 12.5,
    lineHeight: 16,
  },
  // Soft project rows: quiet r-10 chip, elevated when selected.
  row: {
    gap: theme.spacing[3],
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  rowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  rowPressed: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  rowSelected: {
    backgroundColor: theme.colors.surface0,
    ...(isWeb
      ? ({
          boxShadow: "0 1px 2px rgba(20, 23, 31, 0.04)",
        } as object)
      : {}),
  },
  leading: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  iconImage: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  iconFallback: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  iconFallbackText: {
    fontSize: 12.5,
    lineHeight: 16,
  },
  spinnerColor: {
    color: theme.colors.foregroundMuted,
  },
}));
