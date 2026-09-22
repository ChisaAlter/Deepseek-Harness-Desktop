import type {
  AgentPermissionAction,
  AgentPermissionResponse,
  ToolCallTimelineItem,
} from "../../agent-sdk-types.js";
import { nonEmptyString } from "../tool-call-mapper-utils.js";

const CODEX_PLAN_IMPLEMENTATION_PROMPT_PREFIX =
  "The user approved the plan. Implement it now. Do not restate or revise the plan unless blocked.";

function toObjectRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export interface CodexQuestionOption {
  label: string;
  description?: string;
}

export interface CodexQuestionPrompt {
  id: string;
  header: string;
  question: string;
  options: CodexQuestionOption[];
  multiSelect?: boolean;
  isOther?: boolean;
  isSecret?: boolean;
}

export function resolvePermissionDecision(
  response: AgentPermissionResponse,
): "accept" | "cancel" | "decline" {
  if (response.behavior === "allow") return "accept";
  if (response.interrupt) return "cancel";
  return "decline";
}

export function normalizePlanMarkdown(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .trim();
}

export function planStepsToMarkdown(steps: Array<{ step: string; status: string }>): string {
  const lines = steps
    .map((entry) => entry.step.trim())
    .filter((step) => step.length > 0)
    .map((step) => {
      if (/^(#{1,6}\s|[-*+]\s|\d+\.\s)/.test(step)) {
        return step;
      }
      return `- ${step}`;
    });
  return normalizePlanMarkdown(lines.join("\n"));
}

export function mapCodexPlanToToolCall(params: {
  callId: string;
  text: string;
}): ToolCallTimelineItem | null {
  const text = normalizePlanMarkdown(params.text);
  if (!text) {
    return null;
  }
  return {
    type: "tool_call",
    callId: params.callId,
    name: "plan",
    status: "completed",
    error: null,
    detail: {
      type: "plan",
      text,
    },
  };
}

export function buildPlanPermissionActions(options?: {
  includeResumeAction?: boolean;
  resumeLabel?: string;
}): AgentPermissionAction[] {
  const actions: AgentPermissionAction[] = [
    {
      id: "reject",
      label: "Reject",
      behavior: "deny",
      variant: "danger",
      intent: "dismiss",
    },
    {
      id: "implement",
      label: "Implement",
      behavior: "allow",
      variant: "primary",
      intent: "implement",
    },
  ];

  if (options?.includeResumeAction && options.resumeLabel) {
    actions.push({
      id: "implement_resume",
      label: options.resumeLabel,
      behavior: "allow",
      variant: "secondary",
      intent: "implement_resume",
    });
  }

  return actions;
}

export function buildCodexPlanImplementationPrompt(planText: string): string {
  const normalizedPlan = normalizePlanMarkdown(planText);
  if (!normalizedPlan) {
    return `${CODEX_PLAN_IMPLEMENTATION_PROMPT_PREFIX} Make the required code changes and verify them.`;
  }

  return [
    CODEX_PLAN_IMPLEMENTATION_PROMPT_PREFIX,
    "Approved plan:",
    normalizedPlan,
    "Carry out the work, make the necessary code changes, and verify the result.",
  ].join("\n\n");
}

export function normalizeCodexQuestionPrompts(raw: unknown): CodexQuestionPrompt[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const questions: CodexQuestionPrompt[] = [];
  for (const item of raw) {
    const record = toObjectRecord(item);
    if (!record) {
      continue;
    }
    const id = nonEmptyString(record.id);
    const header = nonEmptyString(record.header);
    const question = nonEmptyString(record.question);
    if (!id || !header || !question) {
      continue;
    }
    const options = Array.isArray(record.options)
      ? record.options.flatMap((option): CodexQuestionOption[] => {
          const optionRecord = toObjectRecord(option);
          if (!optionRecord) {
            return [];
          }
          const label = nonEmptyString(optionRecord.label);
          if (!label) {
            return [];
          }
          return [
            {
              label,
              ...(typeof optionRecord.description === "string" &&
              optionRecord.description.trim().length > 0
                ? { description: optionRecord.description }
                : {}),
            },
          ];
        })
      : [];
    questions.push({
      id,
      header,
      question,
      options,
      ...(record.multiSelect === true ? { multiSelect: true } : {}),
      ...(record.isOther === true ? { isOther: true } : {}),
      ...(record.isSecret === true ? { isSecret: true } : {}),
    });
  }
  return questions;
}

export function formatCodexQuestionPrompts(questions: CodexQuestionPrompt[]): string {
  return questions
    .map((question) => {
      const lines = [`${question.header}: ${question.question}`];
      if (question.options.length > 0) {
        lines.push(`Options: ${question.options.map((option) => option.label).join(", ")}`);
      }
      return lines.join("\n");
    })
    .join("\n\n")
    .trim();
}

export function mapCodexQuestionRequestToToolCall(params: {
  callId: string;
  questions: CodexQuestionPrompt[];
  status: ToolCallTimelineItem["status"];
  answers?: Record<string, string[]>;
  error?: unknown;
}): ToolCallTimelineItem {
  const formattedQuestions = formatCodexQuestionPrompts(params.questions);
  const formattedAnswers =
    params.answers && Object.keys(params.answers).length > 0
      ? Object.entries(params.answers)
          .map(([id, values]) => `${id}: ${values.join(", ")}`)
          .join("\n")
      : null;
  const detailText =
    params.status === "completed" && formattedAnswers
      ? [formattedQuestions, "Answers:", formattedAnswers].filter(Boolean).join("\n\n")
      : formattedQuestions;

  const base = {
    type: "tool_call" as const,
    callId: params.callId,
    name: "request_user_input",
    detail: {
      type: "plain_text" as const,
      text: detailText,
      icon: "brain" as const,
    },
    metadata: {
      questions: params.questions,
      ...(params.answers ? { answers: params.answers } : {}),
    },
  };

  if (params.status === "failed") {
    return {
      ...base,
      status: "failed",
      error: params.error ?? { message: "Question dismissed" },
    };
  }
  if (params.status === "canceled") {
    return {
      ...base,
      status: "canceled",
      error: null,
    };
  }
  if (params.status === "running") {
    return {
      ...base,
      status: "running",
      error: null,
    };
  }
  return {
    ...base,
    status: "completed",
    error: null,
  };
}

export function mapCodexQuestionResponseByHeader(params: {
  questions: CodexQuestionPrompt[];
  response: AgentPermissionResponse;
}): Record<string, { answers: string[] }> | null {
  if (params.response.behavior !== "allow") {
    return null;
  }
  const updatedInputRecord = toObjectRecord(params.response.updatedInput);
  const answersRecord = toObjectRecord(updatedInputRecord?.answers);
  if (!answersRecord) {
    return null;
  }

  const answers: Record<string, { answers: string[] }> = {};
  for (const question of params.questions) {
    const rawAnswer = answersRecord[question.header];
    if (typeof rawAnswer !== "string") {
      continue;
    }
    const normalizedAnswer = rawAnswer.trim();
    if (!normalizedAnswer) {
      continue;
    }
    const values = question.multiSelect
      ? normalizedAnswer
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      : [normalizedAnswer];
    if (values.length > 0) {
      answers[question.id] = { answers: values };
    }
  }

  return Object.keys(answers).length > 0 ? answers : null;
}
