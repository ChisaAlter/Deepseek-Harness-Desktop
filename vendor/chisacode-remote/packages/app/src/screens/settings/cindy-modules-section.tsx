import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Target, Users, Camera, Brain } from "lucide-react-native";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Theme } from "@/styles/theme";
import { ICON_SIZE } from "@/styles/theme";
import { isWeb } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";

const ThemedTarget = withUnistyles(Target);
const ThemedUsers = withUnistyles(Users);
const ThemedCamera = withUnistyles(Camera);
const ThemedBrain = withUnistyles(Brain);

const accentColorMapping = (theme: Theme) => ({ color: theme.colors.accent });

const SHEET_SNAP_POINTS = ["70%", "90%"];
const SHEET_DESKTOP_MAX_WIDTH = 460;

interface Goal {
  agentId: string;
  objective: string;
  status: string;
  turnsUsed: number;
  tokensUsed: number;
}

interface TeamWorker {
  id: string;
  label: string;
  role: string;
  status: string;
  focused: boolean;
}

interface LearnRun {
  id: string;
  status: string;
  proposalCount: number;
  createdAt: string;
}

const EMPTY_GOALS: Goal[] = [];
const EMPTY_WORKERS: TeamWorker[] = [];
const EMPTY_LEARN_RUNS: LearnRun[] = [];

interface CindyModulesSectionProps {
  serverId: string;
}

type SheetKind = "goal" | "team" | "snapshot" | "learn";

export function CindyModulesSection({ serverId }: CindyModulesSectionProps) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const client = useHostRuntimeClient(serverId);
  const [activeSheet, setActiveSheet] = useState<SheetKind | null>(null);

  const goalsQuery = useQuery({
    queryKey: ["goals", serverId],
    enabled: Boolean(serverId && client && isConnected),
    staleTime: 5_000,
    queryFn: async () => {
      if (!client) throw new Error("Not connected");
      const result = await client.cindy.goalList();
      return result.goals ?? EMPTY_GOALS;
    },
  });

  const teamQuery = useQuery({
    queryKey: ["team", serverId],
    enabled: Boolean(serverId && client && isConnected),
    staleTime: 5_000,
    queryFn: async () => {
      if (!client) throw new Error("Not connected");
      const result = await client.cindy.teamListWorkers();
      return { team: result.team, workers: result.workers ?? EMPTY_WORKERS };
    },
  });

  const learnQuery = useQuery({
    queryKey: ["learn-runs", serverId],
    enabled: Boolean(serverId && client && isConnected),
    staleTime: 10_000,
    queryFn: async () => {
      if (!client) throw new Error("Not connected");
      const result = await client.cindy.learnList();
      return result.runs ?? EMPTY_LEARN_RUNS;
    },
  });

  const goals = goalsQuery.data ?? EMPTY_GOALS;
  const activeGoals = useMemo(() => goals.filter((g) => g.status === "active"), [goals]);
  const team = teamQuery.data?.team ?? null;
  const workers = teamQuery.data?.workers ?? EMPTY_WORKERS;
  const activeWorkers = useMemo(() => workers.filter((w) => w.status !== "archived"), [workers]);
  const learnRuns = learnQuery.data ?? EMPTY_LEARN_RUNS;
  const pendingReviews = useMemo(
    () => learnRuns.filter((r) => r.status === "awaiting-review"),
    [learnRuns],
  );

  const handleOpenSheet = useCallback((sheet: SheetKind) => {
    setActiveSheet(sheet);
  }, []);

  const handleCloseSheet = useCallback(() => setActiveSheet(null), []);

  const openGoalSheet = useCallback(() => handleOpenSheet("goal"), [handleOpenSheet]);
  const openTeamSheet = useCallback(() => handleOpenSheet("team"), [handleOpenSheet]);
  const openSnapshotSheet = useCallback(() => handleOpenSheet("snapshot"), [handleOpenSheet]);
  const openLearnSheet = useCallback(() => handleOpenSheet("learn"), [handleOpenSheet]);

  const goalIcon = useMemo(
    () => <ThemedTarget size={ICON_SIZE.md} uniProps={accentColorMapping} />,
    [],
  );
  const teamIcon = useMemo(
    () => <ThemedUsers size={ICON_SIZE.md} uniProps={accentColorMapping} />,
    [],
  );
  const snapshotIcon = useMemo(
    () => <ThemedCamera size={ICON_SIZE.md} uniProps={accentColorMapping} />,
    [],
  );
  const learnIcon = useMemo(
    () => <ThemedBrain size={ICON_SIZE.md} uniProps={accentColorMapping} />,
    [],
  );

  if (!isConnected) return null;

  return (
    <>
      <SettingsSection title={t("cindy.title", "Agent 工具")} testID="cindy-modules-card">
        <View style={settingsStyles.card}>
          <ModuleRow
            icon={goalIcon}
            title={t("cindy.goals", "目标")}
            subtitle={
              activeGoals.length > 0
                ? t("cindy.goalsActive", "{{count}} 个进行中", { count: activeGoals.length })
                : t("cindy.goalsNone", "没有进行中的目标")
            }
            isFirst
            onPress={openGoalSheet}
          />
          <ModuleRow
            icon={teamIcon}
            title={t("cindy.team", "团队")}
            subtitle={
              team
                ? t("cindy.teamActive", "{{count}} 个工作线程", { count: activeWorkers.length })
                : t("cindy.teamNone", "没有活跃的团队")
            }
            onPress={openTeamSheet}
          />
          <ModuleRow
            icon={snapshotIcon}
            title={t("cindy.snapshots", "快照")}
            subtitle={t("cindy.snapshotsDesc", "Git 快照与回退")}
            onPress={openSnapshotSheet}
          />
          <ModuleRow
            icon={learnIcon}
            title={t("cindy.learn", "学习")}
            subtitle={
              pendingReviews.length > 0
                ? t("cindy.learnPending", "{{count}} 个待审核", {
                    count: pendingReviews.length,
                  })
                : t("cindy.learnNone", "技能提取")
            }
            isLast
            onPress={openLearnSheet}
          />
        </View>
      </SettingsSection>

      <GoalSheet
        visible={activeSheet === "goal"}
        serverId={serverId}
        goals={goals}
        onClose={handleCloseSheet}
      />
      <TeamSheet
        visible={activeSheet === "team"}
        serverId={serverId}
        team={team}
        workers={activeWorkers}
        onClose={handleCloseSheet}
      />
      <LearnSheet
        visible={activeSheet === "learn"}
        serverId={serverId}
        runs={learnRuns}
        onClose={handleCloseSheet}
      />
    </>
  );
}

// ── Module Row ──────────────────────────────────────────────────────────────

interface ModuleRowProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  isFirst?: boolean;
  isLast?: boolean;
  onPress: () => void;
}

function ModuleRow({ icon, title, subtitle, isFirst, isLast: _isLast, onPress }: ModuleRowProps) {
  const rowStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.moduleRow,
      !isFirst && styles.moduleRowBorder,
      (hovered || pressed) && styles.moduleRowHovered,
    ],
    [isFirst],
  );

  return (
    <Pressable style={rowStyle} onPress={onPress} accessibilityRole="button">
      <View style={styles.moduleIcon}>{icon}</View>
      <View style={styles.moduleTextColumn}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

// ── Goal Sheet ──────────────────────────────────────────────────────────────

function GoalSheet({
  visible,
  serverId,
  goals,
  onClose,
}: {
  visible: boolean;
  serverId: string;
  goals: Goal[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [objective, setObjective] = useState("");
  const [agentId, setAgentId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const header = useMemo<SheetHeader>(() => ({ title: t("cindy.goals", "目标") }), [t]);

  const handleSetGoal = useCallback(async () => {
    if (!client || !objective.trim() || !agentId.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await client.cindy.goalSet({ agentId: agentId.trim(), objective: objective.trim() });
      setObjective("");
      setAgentId("");
      void queryClient.invalidateQueries({ queryKey: ["goals", serverId] });
      onClose();
    } catch (error) {
      toast.error(t("cindy.actionFailed", "操作失败，请重试"));
      console.error("[Cindy] goalSet failed", error);
    } finally {
      setIsSubmitting(false);
    }
  }, [client, objective, agentId, isSubmitting, queryClient, serverId, onClose, t, toast]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      desktopMaxWidth={SHEET_DESKTOP_MAX_WIDTH}
      snapPoints={SHEET_SNAP_POINTS}
      testID="goal-sheet"
    >
      <View style={styles.sheetContent}>
        {goals.length > 0 ? (
          <View style={styles.listSection}>
            {goals.map((goal) => (
              <View key={goal.agentId} style={styles.listItem}>
                <Text style={settingsStyles.rowTitle} numberOfLines={1}>
                  {goal.objective}
                </Text>
                <Text style={settingsStyles.rowHint}>
                  {goal.status} · {goal.turnsUsed} turns · {goal.tokensUsed} tokens
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.emptyText}>{t("cindy.noGoals", "尚未设置目标")}</Text>
        )}
        <View style={styles.formGroup}>
          <AdaptiveTextInput
            initialValue={agentId}
            resetKey="goal-agent-id"
            onChangeText={setAgentId}
            placeholder={t("cindy.agentId", "Agent ID")}
            autoCapitalize="none"
            autoCorrect={false}
            testID="goal-agent-id-input"
            // @ts-expect-error - outlineStyle is web-only
            style={FORM_INPUT_STYLE}
          />
          <AdaptiveTextInput
            initialValue={objective}
            resetKey="goal-objective"
            onChangeText={setObjective}
            placeholder={t("cindy.objective", "目标描述")}
            autoCapitalize="none"
            autoCorrect={false}
            testID="goal-objective-input"
            // @ts-expect-error - outlineStyle is web-only
            style={FORM_INPUT_STYLE}
          />
          <Button
            variant="default"
            size="sm"
            onPress={handleSetGoal}
            disabled={!objective.trim() || !agentId.trim() || isSubmitting}
            loading={isSubmitting}
          >
            {t("cindy.setGoal", "设置目标")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

// ── Team Sheet ──────────────────────────────────────────────────────────────

function TeamSheet({
  visible,
  serverId,
  team,
  workers,
  onClose,
}: {
  visible: boolean;
  serverId: string;
  team: { id: string; status: string } | null;
  workers: TeamWorker[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [label, setLabel] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const header = useMemo<SheetHeader>(() => ({ title: t("cindy.team", "团队") }), [t]);

  const handleStartTeam = useCallback(async () => {
    if (!client || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await client.cindy.teamStart();
      void queryClient.invalidateQueries({ queryKey: ["team", serverId] });
      onClose();
    } catch (error) {
      toast.error(t("cindy.actionFailed", "操作失败，请重试"));
      console.error("[Cindy] teamStart failed", error);
    } finally {
      setIsSubmitting(false);
    }
  }, [client, isSubmitting, queryClient, serverId, onClose, t, toast]);

  const handleCreateWorker = useCallback(async () => {
    if (!client || !label.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await client.cindy.teamCreateWorker({ label: label.trim() });
      setLabel("");
      void queryClient.invalidateQueries({ queryKey: ["team", serverId] });
    } catch (error) {
      toast.error(t("cindy.actionFailed", "操作失败，请重试"));
      console.error("[Cindy] teamCreateWorker failed", error);
    } finally {
      setIsSubmitting(false);
    }
  }, [client, label, isSubmitting, queryClient, serverId, t, toast]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      desktopMaxWidth={SHEET_DESKTOP_MAX_WIDTH}
      snapPoints={SHEET_SNAP_POINTS}
      testID="team-sheet"
    >
      <View style={styles.sheetContent}>
        {!team ? (
          <View style={styles.formGroup}>
            <Text style={styles.emptyText}>{t("cindy.noTeam", "没有活跃的团队")}</Text>
            <Button
              variant="default"
              size="sm"
              onPress={handleStartTeam}
              disabled={isSubmitting}
              loading={isSubmitting}
            >
              {t("cindy.startTeam", "启动团队")}
            </Button>
          </View>
        ) : (
          <>
            {workers.length > 0 ? (
              <View style={styles.listSection}>
                {workers.map((worker) => (
                  <View key={worker.id} style={styles.listItem}>
                    <Text style={settingsStyles.rowTitle} numberOfLines={1}>
                      {worker.label}
                      {worker.focused ? " ●" : ""}
                    </Text>
                    <Text style={settingsStyles.rowHint}>
                      {worker.role} · {worker.status}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
            <View style={styles.formGroup}>
              <AdaptiveTextInput
                initialValue={label}
                resetKey="worker-label"
                onChangeText={setLabel}
                placeholder={t("cindy.workerLabel", "工作线程标签（如 dev-1）")}
                autoCapitalize="none"
                autoCorrect={false}
                testID="worker-label-input"
                // @ts-expect-error - outlineStyle is web-only
                style={FORM_INPUT_STYLE}
              />
              <Button
                variant="default"
                size="sm"
                onPress={handleCreateWorker}
                disabled={!label.trim() || isSubmitting}
                loading={isSubmitting}
              >
                {t("cindy.addWorker", "添加工作线程")}
              </Button>
            </View>
          </>
        )}
      </View>
    </AdaptiveModalSheet>
  );
}

// ── Learn Sheet ─────────────────────────────────────────────────────────────

function LearnSheet({
  visible,
  serverId,
  runs,
  onClose,
}: {
  visible: boolean;
  serverId: string;
  runs: LearnRun[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [pendingRunId, setPendingRunId] = useState<string | null>(null);

  const header = useMemo<SheetHeader>(() => ({ title: t("cindy.learn", "学习") }), [t]);

  const handleApply = useCallback(
    async (runId: string) => {
      if (!client || pendingRunId) return;
      setPendingRunId(runId);
      try {
        await client.cindy.learnApply({ runId });
        void queryClient.invalidateQueries({ queryKey: ["learn-runs", serverId] });
      } catch (error) {
        toast.error(t("cindy.actionFailed", "操作失败，请重试"));
        console.error("[Cindy] learnApply failed", error);
      } finally {
        setPendingRunId(null);
      }
    },
    [client, pendingRunId, queryClient, serverId, t, toast],
  );

  const handleDiscard = useCallback(
    async (runId: string) => {
      if (!client || pendingRunId) return;
      setPendingRunId(runId);
      try {
        await client.cindy.learnDiscard({ runId });
        void queryClient.invalidateQueries({ queryKey: ["learn-runs", serverId] });
      } catch (error) {
        toast.error(t("cindy.actionFailed", "操作失败，请重试"));
        console.error("[Cindy] learnDiscard failed", error);
      } finally {
        setPendingRunId(null);
      }
    },
    [client, pendingRunId, queryClient, serverId, t, toast],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      desktopMaxWidth={SHEET_DESKTOP_MAX_WIDTH}
      snapPoints={SHEET_SNAP_POINTS}
      testID="learn-sheet"
    >
      <View style={styles.sheetContent}>
        {runs.length > 0 ? (
          <View style={styles.listSection}>
            {runs.map((run) => (
              <LearnRunRow
                key={run.id}
                run={run}
                disabled={pendingRunId !== null}
                onApply={handleApply}
                onDiscard={handleDiscard}
              />
            ))}
          </View>
        ) : (
          <Text style={styles.emptyText}>{t("cindy.noLearnRuns", "暂无学习记录")}</Text>
        )}
      </View>
    </AdaptiveModalSheet>
  );
}

function LearnRunRow({
  run,
  disabled,
  onApply,
  onDiscard,
}: {
  run: LearnRun;
  disabled: boolean;
  onApply: (id: string) => void;
  onDiscard: (id: string) => void;
}) {
  const { t } = useTranslation();
  const handleApply = useCallback(() => onApply(run.id), [onApply, run.id]);
  const handleDiscard = useCallback(() => onDiscard(run.id), [onDiscard, run.id]);

  return (
    <View style={styles.listItem}>
      <View style={styles.learnRowHeader}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {run.status} · {run.proposalCount} proposals
        </Text>
        {run.status === "awaiting-review" ? (
          <View style={styles.learnActions}>
            <Pressable onPress={handleApply} hitSlop={8} disabled={disabled}>
              <Text style={styles.applyText}>{t("common.apply", "Apply")}</Text>
            </Pressable>
            <Pressable onPress={handleDiscard} hitSlop={8} disabled={disabled}>
              <Text style={styles.discardText}>{t("common.discard", "Discard")}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
      <Text style={settingsStyles.rowHint}>{new Date(run.createdAt).toLocaleString()}</Text>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create((theme) => ({
  moduleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    minHeight: 52,
  },
  moduleRowBorder: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.secondary,
  },
  moduleRowHovered: {
    backgroundColor: theme.colors.surface1,
  },
  moduleIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface1,
  },
  moduleTextColumn: {
    flex: 1,
    minWidth: 0,
  },
  sheetContent: {
    gap: theme.spacing[4],
  },
  listSection: {
    gap: theme.spacing[2],
  },
  listItem: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  formGroup: {
    gap: theme.spacing[3],
  },
  formInput: {
    backgroundColor: theme.colors.surface0,
    borderRadius: 12,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontSize: 13,
    lineHeight: 18,
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    textAlign: "center",
    paddingVertical: theme.spacing[4],
  },
  learnRowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  learnActions: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  applyText: {
    color: theme.colors.accent,
    fontSize: 12.5,
    fontWeight: theme.fontWeight.medium,
  },
  discardText: {
    color: theme.colors.destructive,
    fontSize: 12.5,
    fontWeight: theme.fontWeight.medium,
  },
}));

const FORM_INPUT_STYLE = [styles.formInput, isWeb && { outlineStyle: "none" }];
