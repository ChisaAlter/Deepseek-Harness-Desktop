import { useCallback, useMemo, type ReactElement } from "react";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ChevronDown, FolderPlus, Folder } from "lucide-react-native";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { ThemedIconHost } from "@/components/themed-icon-host";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SidebarV2ProjectSnapshot } from "./projects";
import { useSidebarV2Store } from "./store";

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface SidebarV2ScopeMenuProps {
  serverId: string;
  projects: readonly SidebarV2ProjectSnapshot[];
  onAddProject: () => void;
  onProjectSettings: (project: SidebarV2ProjectSnapshot) => void;
}

export function SidebarV2ScopeMenu({
  serverId,
  projects,
  onAddProject,
  onProjectSettings,
}: SidebarV2ScopeMenuProps) {
  const { t } = useTranslation();
  const scopeProjectKey = useSidebarV2Store(
    (state) => state.getServerUiState(serverId).scopeProjectKey,
  );
  const setScopeProjectKey = useSidebarV2Store((state) => state.setScopeProjectKey);

  const currentProject = projects.find((project) => project.projectKey === scopeProjectKey) ?? null;
  const label = currentProject?.displayName ?? t("sidebarV2.allProjects");

  const handleSelect = useCallback(
    (projectKey: string | null) => {
      setScopeProjectKey(serverId, projectKey);
    },
    [serverId, setScopeProjectKey],
  );
  const handleSelectAll = useCallback(() => handleSelect(null), [handleSelect]);
  const handleSelectProject = useCallback(
    (projectKey: string) => handleSelect(projectKey),
    [handleSelect],
  );

  if (projects.length === 0) {
    return (
      <View style={styles.emptyRow}>
        <Text style={styles.emptyLabel}>{t("sidebarV2.allProjects")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <DropdownMenu>
        <DropdownMenuTrigger>
          <View style={styles.trigger} testID="sidebar-v2-scope-trigger">
            <ThemedIconHost
              Icon={Folder}
              size={ICON_SIZE.sm}
              uniProps={foregroundMutedColorMapping}
            />
            <Text style={styles.triggerLabel} numberOfLines={1}>
              {label}
            </Text>
            <ThemedIconHost
              Icon={ChevronDown}
              size={ICON_SIZE.xs}
              uniProps={foregroundMutedColorMapping}
            />
          </View>
        </DropdownMenuTrigger>
        <DropdownMenuContent minWidth={220}>
          <DropdownMenuItem
            selected={scopeProjectKey === null}
            onSelect={handleSelectAll}
            showSelectedCheck
          >
            {t("sidebarV2.allProjects")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {projects.map((project) => (
            <ProjectScopeItem
              key={project.projectKey}
              project={project}
              selected={project.projectKey === scopeProjectKey}
              onSelect={handleSelectProject}
              onSettings={onProjectSettings}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Pressable
        style={addButtonStyle}
        onPress={onAddProject}
        accessibilityRole="button"
        accessibilityLabel={t("sidebarV2.newProject")}
        testID="sidebar-v2-new-project"
      >
        <ThemedIconHost
          Icon={FolderPlus}
          size={ICON_SIZE.sm}
          uniProps={foregroundMutedColorMapping}
        />
      </Pressable>
    </View>
  );
}

const addButtonStyle = ({ pressed }: { pressed: boolean }) =>
  [styles.addButton, pressed && styles.addButtonPressed] as StyleProp<ViewStyle>;

function ProjectScopeItem({
  project,
  selected,
  onSelect,
  onSettings,
}: {
  project: SidebarV2ProjectSnapshot;
  selected: boolean;
  onSelect: (projectKey: string) => void;
  onSettings: (project: SidebarV2ProjectSnapshot) => void;
}) {
  const handleSelect = useCallback(
    () => onSelect(project.projectKey),
    [onSelect, project.projectKey],
  );
  const handleSettings = useCallback(
    (event: { stopPropagation: () => void }) => {
      event.stopPropagation();
      onSettings(project);
    },
    [onSettings, project],
  );
  const settingsTrailing = useMemo(
    () => (
      <Pressable
        hitSlop={8}
        onPress={handleSettings}
        testID={`sidebar-v2-project-settings-${project.projectKey}`}
      >
        <Text style={styles.settingsAction}>…</Text>
      </Pressable>
    ),
    [handleSettings, project.projectKey],
  );
  return (
    <DropdownMenuItem
      selected={selected}
      onSelect={handleSelect}
      showSelectedCheck
      trailing={settingsTrailing}
    >
      {project.displayName}
    </DropdownMenuItem>
  );
}

/** Project settings dialog content (rename/remove per member). */
export function SidebarV2ProjectSettingsDialog({
  project,
  onClose,
}: {
  project: SidebarV2ProjectSnapshot;
  onClose: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <View style={styles.dialog}>
      <Text style={styles.dialogTitle}>{project.displayName}</Text>
      {project.members.map((member) => (
        <View key={member.workspaceId} style={styles.dialogMember}>
          <Text style={styles.dialogMemberPath} numberOfLines={1}>
            {member.workspaceDirectory}
          </Text>
          <Text style={styles.dialogMemberMeta}>{member.branch ?? member.kind}</Text>
        </View>
      ))}
      <Pressable style={styles.dialogClose} onPress={onClose}>
        <Text style={styles.dialogCloseLabel}>{t("common.close")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  emptyRow: {
    height: 34,
    justifyContent: "center",
    paddingHorizontal: theme.spacing[1],
  },
  emptyLabel: {
    fontSize: 13,
    color: theme.colors.foregroundMuted,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[0.5],
  },
  trigger: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[0.5],
    height: 34,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[1],
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  triggerLabel: {
    flex: 1,
    fontSize: 13,
    color: theme.colors.foreground,
  },
  settingsAction: {
    fontSize: 16,
    color: theme.colors.foregroundMuted,
    paddingHorizontal: 4,
  },
  addButton: {
    width: 30,
    height: 30,
    borderRadius: theme.borderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  addButtonPressed: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  dialog: {
    gap: theme.spacing[1],
  },
  dialogTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  dialogMember: {
    gap: 2,
  },
  dialogMemberPath: {
    fontSize: 12,
    color: theme.colors.foreground,
  },
  dialogMemberMeta: {
    fontSize: 11,
    color: theme.colors.foregroundMuted,
  },
  dialogClose: {
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  dialogCloseLabel: {
    fontSize: 13,
    color: theme.colors.foreground,
  },
}));
