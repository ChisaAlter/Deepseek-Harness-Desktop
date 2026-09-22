import { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useIsCompactFormFactor } from "@/constants/layout";
import { Check, CircleHelp, X } from "lucide-react-native";
import type { PendingPermission } from "@/types/shared";
import type { AgentPermissionResponse } from "@chisacode/protocol/agent-types";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import {
  areQuestionsAnswered,
  buildQuestionFormAnswers,
  parseQuestionFormQuestions,
  questionShowsTextInput,
  resolveDismissLabel,
  shouldSubmitEmptyOnDismiss,
  type QuestionFormQuestion,
  type QuestionOption,
} from "./question-form-card-core";

interface QuestionFormCardProps {
  permission: PendingPermission;
  onRespond: (response: AgentPermissionResponse) => void;
  isResponding: boolean;
}

const IS_WEB = isWeb;

const ThemedCheck = withUnistyles(Check);
const ThemedCircleHelp = withUnistyles(CircleHelp);
const ThemedX = withUnistyles(X);
const ThemedActivityIndicator = withUnistyles(ActivityIndicator);
const ThemedTextInput = withUnistyles(TextInput, (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const foregroundColorMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
});

function getQuestionInputPlaceholder(question: QuestionFormQuestion): string {
  return (
    question.placeholder ?? (question.options.length === 0 ? "Type your answer..." : "Other...")
  );
}

interface QuestionOptionRowProps {
  qIndex: number;
  optIndex: number;
  option: QuestionOption;
  isSelected: boolean;
  multiSelect: boolean;
  isResponding: boolean;
  onToggle: (qIndex: number, optIndex: number, multiSelect: boolean) => void;
}

function QuestionOptionRow({
  qIndex,
  optIndex,
  option,
  isSelected,
  multiSelect,
  isResponding,
  onToggle,
}: QuestionOptionRowProps) {
  const handlePress = useCallback(() => {
    onToggle(qIndex, optIndex, multiSelect);
  }, [onToggle, qIndex, optIndex, multiSelect]);

  const pressableStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.optionItem,
      // Soft: hover wash surface1; solid selected surface3.
      Boolean(hovered) && !isSelected && styles.optionItemHovered,
      isSelected && styles.optionItemSelected,
      pressed && styles.optionItemPressed,
    ],
    [isSelected],
  );

  return (
    <Pressable style={pressableStyle} onPress={handlePress} disabled={isResponding}>
      <View style={styles.optionItemContent}>
        <View style={styles.optionTextBlock}>
          <Text style={styles.optionLabel}>{option.label}</Text>
          {option.description ? (
            <Text style={styles.optionDescription}>{option.description}</Text>
          ) : null}
        </View>
        {isSelected ? (
          <View style={styles.optionCheckSlot}>
            <ThemedCheck size={16} uniProps={foregroundMutedColorMapping} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

interface QuestionOtherInputProps {
  qIndex: number;
  value: string;
  placeholder: string;
  isResponding: boolean;
  onChange: (qIndex: number, text: string) => void;
  onSubmit: () => void;
}

function QuestionOtherInput({
  qIndex,
  value,
  placeholder,
  isResponding,
  onChange,
  onSubmit,
}: QuestionOtherInputProps) {
  const handleChange = useCallback(
    (text: string) => {
      onChange(qIndex, text);
    },
    [onChange, qIndex],
  );
  const otherInputStyle = useMemo(
    () =>
      [
        styles.otherInput,
        IS_WEB ? { outlineStyle: "none", outlineWidth: 0, outlineColor: "transparent" } : null,
      ] as const,
    [],
  );
  return (
    <ThemedTextInput
      // @ts-expect-error - outlineStyle is web-only
      style={otherInputStyle}
      placeholder={placeholder}
      value={value}
      onChangeText={handleChange}
      onSubmitEditing={onSubmit}
      editable={!isResponding}
      blurOnSubmit={false}
    />
  );
}

export function QuestionFormCard({ permission, onRespond, isResponding }: QuestionFormCardProps) {
  const { t } = useTranslation();
  const isMobile = useIsCompactFormFactor();
  const questions = parseQuestionFormQuestions(permission.request.input);

  const [selections, setSelections] = useState<Record<number, Set<number>>>({});
  const [otherTexts, setOtherTexts] = useState<Record<number, string>>({});
  const [respondingAction, setRespondingAction] = useState<"submit" | "dismiss" | null>(null);

  const toggleOption = useCallback((qIndex: number, optIndex: number, multiSelect: boolean) => {
    setSelections((prev) => {
      const current = prev[qIndex] ?? new Set<number>();
      const next = new Set(current);
      if (multiSelect) {
        if (next.has(optIndex)) {
          next.delete(optIndex);
        } else {
          next.add(optIndex);
        }
      } else {
        if (next.has(optIndex)) {
          next.clear();
        } else {
          next.clear();
          next.add(optIndex);
        }
      }
      return { ...prev, [qIndex]: next };
    });
    setOtherTexts((prev) => {
      if (!prev[qIndex]) return prev;
      const next = { ...prev };
      delete next[qIndex];
      return next;
    });
  }, []);

  const setOtherText = useCallback((qIndex: number, text: string) => {
    setOtherTexts((prev) => ({ ...prev, [qIndex]: text }));
    if (text.length > 0) {
      setSelections((prev) => {
        if (!prev[qIndex] || prev[qIndex].size === 0) return prev;
        return { ...prev, [qIndex]: new Set<number>() };
      });
    }
  }, []);

  const allAnswered = areQuestionsAnswered(questions, selections, otherTexts);

  const handleSubmit = useCallback(() => {
    if (!questions || !allAnswered || isResponding) return;
    setRespondingAction("submit");
    onRespond({
      behavior: "allow",
      updatedInput: {
        ...permission.request.input,
        answers: buildQuestionFormAnswers(questions, selections, otherTexts),
      },
    });
  }, [
    questions,
    allAnswered,
    isResponding,
    selections,
    otherTexts,
    onRespond,
    permission.request.input,
  ]);

  const handleDeny = useCallback(() => {
    if (!questions) return;
    setRespondingAction("dismiss");
    if (shouldSubmitEmptyOnDismiss(questions)) {
      onRespond({
        behavior: "allow",
        updatedInput: {
          ...permission.request.input,
          answers: buildQuestionFormAnswers(questions, selections, otherTexts),
        },
      });
      return;
    }
    onRespond({
      behavior: "deny",
      message: t("workspace.questionFormUserClosed"),
    });
  }, [questions, onRespond, otherTexts, permission.request.input, selections, t]);

  const dismissButtonStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.actionButton,
      hovered ? styles.actionButtonHovered : styles.actionButtonDefault,
      pressed && styles.optionItemPressed,
    ],
    [],
  );

  const submitDisabled = !allAnswered || isResponding;
  const submitButtonStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.actionButton,
      hovered && !submitDisabled ? styles.actionButtonHovered : styles.actionButtonDefault,
      submitDisabled && styles.actionButtonDisabled,
      pressed && !submitDisabled ? styles.optionItemPressed : null,
    ],
    [submitDisabled],
  );

  const containerStyle = styles.container;
  const questionTextStyle = styles.questionText;
  const actionsContainerStyle = useMemo(
    () => [styles.actionsContainer, !isMobile && styles.actionsContainerDesktop],
    [isMobile],
  );
  const dismissActionTextStyle = styles.actionTextMuted;
  const submitActionTextStyle = allAnswered ? styles.actionTextForeground : styles.actionTextMuted;
  const submitIconMapping = allAnswered ? foregroundColorMapping : foregroundMutedColorMapping;

  if (!questions) {
    return null;
  }

  const dismissLabel = resolveDismissLabel(questions);

  return (
    <View style={containerStyle}>
      {questions.map((q, qIndex) => {
        const selected = selections[qIndex] ?? new Set<number>();
        const otherText = otherTexts[qIndex] ?? "";
        const showTextInput = questionShowsTextInput(q);

        return (
          <View key={q.question} style={styles.questionBlock}>
            <View style={styles.questionHeader}>
              <Text style={questionTextStyle}>{q.question}</Text>
              <ThemedCircleHelp size={14} uniProps={foregroundMutedColorMapping} />
            </View>
            {q.options.length > 0 ? (
              <View style={styles.optionsWrap}>
                {q.options.map((opt, optIndex) => (
                  <QuestionOptionRow
                    key={opt.label}
                    qIndex={qIndex}
                    optIndex={optIndex}
                    option={opt}
                    isSelected={selected.has(optIndex)}
                    multiSelect={q.multiSelect}
                    isResponding={isResponding}
                    onToggle={toggleOption}
                  />
                ))}
              </View>
            ) : null}
            {showTextInput ? (
              <QuestionOtherInput
                qIndex={qIndex}
                value={otherText}
                placeholder={getQuestionInputPlaceholder(q)}
                isResponding={isResponding}
                onChange={setOtherText}
                onSubmit={handleSubmit}
              />
            ) : null}
          </View>
        );
      })}

      <View style={actionsContainerStyle}>
        <Pressable style={dismissButtonStyle} onPress={handleDeny} disabled={isResponding}>
          {respondingAction === "dismiss" ? (
            <ThemedActivityIndicator size="small" uniProps={foregroundMutedColorMapping} />
          ) : (
            <View style={styles.actionContent}>
              <ThemedX size={14} uniProps={foregroundMutedColorMapping} />
              <Text style={dismissActionTextStyle}>{dismissLabel}</Text>
            </View>
          )}
        </Pressable>

        <Pressable style={submitButtonStyle} onPress={handleSubmit} disabled={submitDisabled}>
          {respondingAction === "submit" ? (
            <ThemedActivityIndicator size="small" uniProps={foregroundColorMapping} />
          ) : (
            <View style={styles.actionContent}>
              <ThemedCheck size={14} uniProps={submitIconMapping} />
              <Text style={submitActionTextStyle}>{t("workspace.questionFormSubmit")}</Text>
            </View>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Soft .card form shell.
  container: {
    padding: theme.spacing[3],
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    gap: theme.spacing[3],
  },
  questionBlock: {
    gap: theme.spacing[2],
  },
  questionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[1],
  },
  questionText: {
    flex: 1,
    fontSize: 14.5,
    lineHeight: 22,
    color: theme.colors.foreground,
  },
  optionsWrap: {
    gap: theme.spacing[1],
  },

  optionItemHovered: {
    backgroundColor: theme.colors.surface1,
  },
  optionItemSelected: {
    backgroundColor: theme.colors.surface3,
  },
  actionButtonDefault: {
    backgroundColor: theme.colors.surface0,
    borderColor: theme.colors.border,
  },
  actionButtonHovered: {
    backgroundColor: theme.colors.surfaceWorkspace,
    borderColor: theme.colors.border,
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  actionTextMuted: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 18,
  },
  actionTextForeground: {
    color: theme.colors.foreground,
    fontSize: 12.5,
    lineHeight: 18,
  },
  optionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: 10,
  },
  optionItemPressed: {
    opacity: 0.9,
  },
  optionItemContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  optionTextBlock: {
    flex: 1,
    gap: 2,
  },
  optionLabel: {
    // Soft chrome: 12.5 meta.
    fontSize: 12.5,
    lineHeight: 18,
    color: theme.colors.foreground,
  },
  optionDescription: {
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
  },
  optionCheckSlot: {
    width: 16,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: "auto",
  },
  otherInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    // Soft form field body: 14.5 readability.
    fontSize: 14.5,
    lineHeight: 22,
    borderColor: theme.colors.border,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface0,
  },
  actionsContainer: {
    gap: theme.spacing[2],
  },
  actionsContainerDesktop: {
    flexDirection: "row",
    justifyContent: "flex-start",
    alignItems: "center",
  },
  actionButton: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: 10,
    alignItems: "center",
    borderWidth: theme.borderWidth[1],
  },
  actionContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  actionText: {
    // Soft chrome: 12.5 meta.
    fontSize: 12.5,
    lineHeight: 18,
  },
}));
