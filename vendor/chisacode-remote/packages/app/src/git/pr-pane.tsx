import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDot,
  CircleSlash,
  CircleX,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  MessageSquare,
  RotateCw,
} from "lucide-react-native";
import { openExternalUrl } from "@/utils/open-external-url";
import { getActivityVerb, getStateLabel } from "@/git/pr-pane-data";
import type {
  CheckStatus,
  PrPaneActivity,
  PrPaneCheck,
  PrPaneData,
  PrState,
} from "@/git/pr-pane-data";
import { type Theme } from "@/styles/theme";

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedCircleCheck = withUnistyles(CircleCheck);
const ThemedCircleDot = withUnistyles(CircleDot);
const ThemedCircleSlash = withUnistyles(CircleSlash);
const ThemedCircleX = withUnistyles(CircleX);
const ThemedExternalLink = withUnistyles(ExternalLink);
const ThemedGitMerge = withUnistyles(GitMerge);
const ThemedGitPullRequest = withUnistyles(GitPullRequest);
const ThemedGitPullRequestClosed = withUnistyles(GitPullRequestClosed);
const ThemedGitPullRequestDraft = withUnistyles(GitPullRequestDraft);
const ThemedMessageSquare = withUnistyles(MessageSquare);
const ThemedRotateCw = withUnistyles(RotateCw);

type ColorMapping = (theme: Theme) => { color: string };

const statusSuccessColorMapping: ColorMapping = (theme) => ({
  color: theme.colors.statusSuccess,
});
const statusDangerColorMapping: ColorMapping = (theme) => ({
  color: theme.colors.statusDanger,
});
const statusWarningColorMapping: ColorMapping = (theme) => ({
  color: theme.colors.statusWarning,
});
const statusMergedColorMapping: ColorMapping = (theme) => ({
  color: theme.colors.statusMerged,
});
const foregroundMutedColorMapping: ColorMapping = (theme) => ({
  color: theme.colors.foregroundMuted,
});

function getStateColorMapping(state: PrState): ColorMapping {
  if (state === "open") return statusSuccessColorMapping;
  if (state === "draft") return foregroundMutedColorMapping;
  if (state === "merged") return statusMergedColorMapping;
  return statusDangerColorMapping;
}

function getStateLabelStyle(state: PrState) {
  if (state === "open") return styles.stateLabelSuccess;
  if (state === "draft") return styles.stateLabelMuted;
  if (state === "merged") return styles.stateLabelMerged;
  return styles.stateLabelDanger;
}

function getStateIcon(state: PrState) {
  if (state === "draft") return ThemedGitPullRequestDraft;
  if (state === "merged") return ThemedGitMerge;
  if (state === "closed") return ThemedGitPullRequestClosed;
  return ThemedGitPullRequest;
}

function rowPressableStyle({ hovered }: { hovered?: boolean }) {
  return [styles.row, Boolean(hovered) && styles.hoverable];
}

function activityPressableStyle({ hovered }: { hovered?: boolean }) {
  return [styles.activityRow, Boolean(hovered) && styles.hoverable];
}

export function PrPane({ data, onRefresh }: { data: PrPaneData; onRefresh?: () => void }) {
  const { t } = useTranslation();
  const [checksOpen, setChecksOpen] = useState(true);
  const [reviewsOpen, setReviewsOpen] = useState(true);

  const handleOpenPrUrl = useCallback(() => {
    void openExternalUrl(data.url);
  }, [data.url]);

  const handleToggleChecks = useCallback(() => {
    setChecksOpen((o) => !o);
  }, []);

  const handleToggleReviews = useCallback(() => {
    setReviewsOpen((o) => !o);
  }, []);

  const passed = data.checks.filter((c) => c.status === "success").length;
  const failed = data.checks.filter((c) => c.status === "failure").length;
  const pending = data.checks.filter((c) => c.status === "pending").length;

  const approvals = data.activity.filter(
    (a) => a.kind === "review" && a.reviewState === "approved",
  ).length;
  const changesRequested = data.activity.filter(
    (a) => a.kind === "review" && a.reviewState === "changes_requested",
  ).length;
  const commentCount = data.activity.filter(
    (a) => a.kind === "comment" || (a.kind === "review" && a.reviewState === "commented"),
  ).length;

  const stateColorMapping = getStateColorMapping(data.state);
  const StateIcon = getStateIcon(data.state);
  const stateLabel = getStateLabel(data.state);
  const stateLabelStyle = getStateLabelStyle(data.state);
  const keyedActivity = useMemo(
    () => data.activity.map((item, idx) => ({ key: `${item.author}-${item.kind}-${idx}`, item })),
    [data.activity],
  );

  const checkSuccessIcon = useMemo(
    () => <ThemedCircleCheck size={12} uniProps={statusSuccessColorMapping} />,
    [],
  );
  const checkDangerIcon = useMemo(
    () => <ThemedCircleX size={12} uniProps={statusDangerColorMapping} />,
    [],
  );
  const checkWarningIcon = useMemo(
    () => <ThemedCircleDot size={12} uniProps={statusWarningColorMapping} />,
    [],
  );
  const commentIcon = useMemo(
    () => <ThemedMessageSquare size={11} uniProps={foregroundMutedColorMapping} />,
    [],
  );

  return (
    <View style={styles.root} testID="pr-pane">
      <Pressable onPress={handleOpenPrUrl} style={styles.header}>
        {({ hovered }) => (
          <>
            <View style={styles.stateLine}>
              <StateIcon size={14} uniProps={stateColorMapping} />
              <Text style={stateLabelStyle} testID="pr-pane-state">
                {stateLabel}
              </Text>
            </View>
            <Text style={styles.title} numberOfLines={3} testID="pr-pane-title">
              {data.title}
              {hovered ? (
                <Text>
                  {"  "}
                  <ThemedExternalLink size={12} uniProps={foregroundMutedColorMapping} />
                </Text>
              ) : null}
            </Text>
          </>
        )}
      </Pressable>

      {onRefresh ? (
        <Pressable onPress={onRefresh} style={styles.refreshButton} testID="pr-pane-refresh">
          <ThemedRotateCw size={14} uniProps={foregroundMutedColorMapping} />
        </Pressable>
      ) : null}

      <View style={styles.divider} />

      <Section
        title={t("pullRequest.checks")}
        open={checksOpen}
        onToggle={handleToggleChecks}
        summary={
          <>
            <SummaryPill
              count={passed}
              textStyle={styles.pillTextSuccess}
              icon={checkSuccessIcon}
              testID="pr-pane-check-passed"
            />
            <SummaryPill
              count={failed}
              textStyle={styles.pillTextDanger}
              icon={checkDangerIcon}
              testID="pr-pane-check-failed"
            />
            <SummaryPill
              count={pending}
              textStyle={styles.pillTextWarning}
              icon={checkWarningIcon}
              testID="pr-pane-check-pending"
            />
          </>
        }
      >
        {data.checks.map((check) => (
          <CheckRow key={check.name} check={check} />
        ))}
      </Section>

      <View style={styles.divider} />

      <Section
        title={t("pullRequest.reviews")}
        open={reviewsOpen}
        onToggle={handleToggleReviews}
        summary={
          <>
            <SummaryPill
              count={approvals}
              textStyle={styles.pillTextSuccess}
              icon={checkSuccessIcon}
            />
            <SummaryPill
              count={changesRequested}
              textStyle={styles.pillTextDanger}
              icon={checkDangerIcon}
            />
            <SummaryPill count={commentCount} textStyle={styles.pillTextMuted} icon={commentIcon} />
          </>
        }
      >
        {keyedActivity.map(({ key, item }) => (
          <ActivityRow key={key} item={item} />
        ))}
      </Section>
    </View>
  );
}

interface SectionProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  summary: React.ReactNode;
  children: React.ReactNode;
}

function Section({ title, open, onToggle, summary, children }: SectionProps) {
  return (
    <View style={open ? styles.sectionOpen : undefined}>
      <Pressable style={styles.sectionHeader} onPress={onToggle}>
        {open ? (
          <ThemedChevronDown size={14} uniProps={foregroundMutedColorMapping} />
        ) : (
          <ThemedChevronRight size={14} uniProps={foregroundMutedColorMapping} />
        )}
        <Text style={styles.sectionTitle}>{title}</Text>
        <View style={styles.summaryWrap}>{summary}</View>
      </Pressable>
      {open && (
        <ScrollView
          style={styles.sectionBody}
          contentContainerStyle={styles.sectionBodyContent}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      )}
    </View>
  );
}

function SummaryPill({
  count,
  textStyle,
  icon,
  testID,
}: {
  count: number;
  textStyle: object;
  icon: React.ReactNode;
  testID?: string;
}) {
  if (count === 0) return null;
  return (
    <View style={styles.summaryPill} testID={testID}>
      {icon}
      <Text style={StyleSheet.compose(styles.summaryPillText, textStyle)}>{count}</Text>
    </View>
  );
}

function CheckRow({ check }: { check: PrPaneCheck }) {
  const handlePress = useCallback(() => {
    void openExternalUrl(check.url);
  }, [check.url]);
  return (
    <Pressable onPress={handlePress} style={rowPressableStyle}>
      <CheckStatusIcon status={check.status} />
      <Text style={styles.rowTitle} numberOfLines={1}>
        {check.name}
      </Text>
      {check.workflow && (
        <Text style={styles.rowMetaMid} numberOfLines={1}>
          {check.workflow}
        </Text>
      )}
      {check.duration && <Text style={styles.rowMeta}>{check.duration}</Text>}
    </Pressable>
  );
}

function CheckStatusIcon({ status }: { status: CheckStatus }) {
  if (status === "success") {
    return <ThemedCircleCheck size={14} uniProps={statusSuccessColorMapping} />;
  }
  if (status === "failure") {
    return <ThemedCircleX size={14} uniProps={statusDangerColorMapping} />;
  }
  if (status === "pending") {
    return <ThemedCircleDot size={14} uniProps={statusWarningColorMapping} />;
  }
  return <ThemedCircleSlash size={14} uniProps={foregroundMutedColorMapping} />;
}

function ActivityRow({ item }: { item: PrPaneActivity }) {
  const verb = getActivityVerb(item);
  const handlePress = useCallback(() => {
    void openExternalUrl(item.url);
  }, [item.url]);
  const avatarStyle = useMemo(
    () => [styles.avatar, { backgroundColor: item.avatarColor }],
    [item.avatarColor],
  );
  return (
    <Pressable onPress={handlePress} style={activityPressableStyle} testID="pr-pane-activity-row">
      <View style={avatarStyle}>
        <Text style={styles.avatarText}>{item.author.slice(0, 1).toUpperCase()}</Text>
      </View>
      <View style={styles.activityMain}>
        <View style={styles.activityHeader}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {item.author}
          </Text>
          <Text style={styles.rowMetaMid}>{verb}</Text>
          <Text style={styles.rowMeta}>{item.age}</Text>
        </View>
        <Text style={styles.rowBody} numberOfLines={2}>
          {item.body}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  hoverable: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  header: {
    flexDirection: "column",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[4],
  },
  stateLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  stateLabelSuccess: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.statusSuccess,
  },
  stateLabelMuted: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  stateLabelMerged: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.statusMerged,
  },
  stateLabelDanger: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.statusDanger,
  },
  // Soft PR title meta: 12.5.
  title: {
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.secondary,
  },
  refreshButton: {
    position: "absolute",
    top: theme.spacing[3],
    right: theme.spacing[3],
    padding: theme.spacing[1],
    borderRadius: 10,
  },
  sectionOpen: {
    flexShrink: 1,
    minHeight: 0,
  },
  sectionBody: {
    flexShrink: 1,
    minHeight: 0,
  },
  sectionBodyContent: {
    paddingBottom: theme.spacing[3],
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  // Soft section label: 12.5 medium muted.
  sectionTitle: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
  summaryWrap: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  summaryPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  summaryPillText: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.normal,
  },
  pillTextSuccess: {
    color: theme.colors.statusSuccess,
  },
  pillTextDanger: {
    color: theme.colors.statusDanger,
  },
  pillTextWarning: {
    color: theme.colors.statusWarning,
  },
  pillTextMuted: {
    color: theme.colors.foregroundMuted,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  activityRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  activityMain: { flex: 1, minWidth: 0, gap: 2 },
  activityHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  // Soft PR row: 12.5 meta.
  rowTitle: {
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foreground,
    flexShrink: 1,
  },
  rowMeta: {
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
    marginLeft: "auto",
  },
  rowMetaMid: {
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
  },
  rowBody: {
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
  },
  avatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  avatarText: {
    fontSize: 10,
    fontWeight: theme.fontWeight.normal,
    color: "#fff",
  },
}));
