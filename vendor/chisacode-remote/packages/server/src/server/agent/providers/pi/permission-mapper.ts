import type {
  AgentMetadata,
  AgentPermissionRequest,
  AgentPermissionResponse,
} from "../../agent-sdk-types.js";
import type { PiRuntimeEvent } from "./rpc-types.js";
import { isRecord, optionalBoolean, optionalString, readStringArray } from "./event-values.js";

const PI_PROVIDER = "pi";
const QUESTION_RESPONSE_HEADER = "Response";
const QUESTION_COMMENT_HEADER = "Comment";
const PI_ASK_USER_FREEFORM_SENTINEL = "✏️ Type custom response...";
const COMBINED_ASK_USER_METADATA = "ask_user_select_optional_comment";

/** Active Pi ask_user behavior advertised by the tool invocation. */
export interface ActiveAskUserDialog {
  allowComment: boolean;
  allowFreeform: boolean;
  allowMultiple: boolean;
}

/** Deferred values used to answer Pi's follow-up freeform or comment prompt. */
export interface PendingCombinedAskUserResponse {
  comment: string;
  freeform: string | null;
}

/** Options controlling how Pi extension UI requests are combined. */
export interface PiExtensionUiMappingOptions {
  combineOptionalComment?: boolean;
  allowFreeform?: boolean;
}

/**
 * Reads ask_user behavior flags from a Pi tool invocation.
 * @param toolName Pi tool name
 * @param args Unknown tool arguments
 * @returns Active dialog behavior, or null for non-ask_user tools
 */
export function readActiveAskUserDialog(
  toolName: string,
  args: unknown,
): ActiveAskUserDialog | null {
  if (toolName !== "ask_user" || !isRecord(args)) {
    return null;
  }
  return {
    allowComment: optionalBoolean(args.allowComment) ?? false,
    allowFreeform: optionalBoolean(args.allowFreeform) ?? true,
    allowMultiple: optionalBoolean(args.allowMultiple) ?? false,
  };
}

/** Returns whether a Pi input placeholder represents an optional follow-up. */
export function isOptionalInputPlaceholder(placeholder: string | undefined): boolean {
  return /\boptional\b|\bskip\b/i.test(placeholder ?? "");
}

/**
 * Maps a Pi extension UI request to the shared permission contract.
 * @param event Pi extension UI request
 * @param options ask_user combination options
 * @returns Shared permission request, or null for fire-and-forget methods
 */
export function mapExtensionUiRequestToPermission(
  event: Extract<PiRuntimeEvent, { type: "extension_ui_request" }>,
  options: PiExtensionUiMappingOptions = {},
): AgentPermissionRequest | null {
  switch (event.method) {
    case "select": {
      const selectOptions = readStringArray(event.options);
      if (options.combineOptionalComment) {
        return buildCombinedAskUserQuestionPermission(event, {
          question: optionalString(event.title) ?? "Select an option",
          options: selectOptions,
          allowFreeform: options.allowFreeform === true,
        });
      }
      return buildExtensionUiQuestionPermission(event, {
        question: optionalString(event.title) ?? "Select an option",
        options: selectOptions,
        multiSelect: false,
      });
    }
    case "input": {
      const placeholder = optionalString(event.placeholder);
      const title = optionalString(event.title);
      const allowEmpty = isOptionalInputPlaceholder(placeholder);
      return buildExtensionUiQuestionPermission(event, {
        question: getInputQuestionTitle(title, placeholder),
        options: [],
        multiSelect: false,
        ...(placeholder ? { placeholder } : {}),
        ...(allowEmpty ? { allowEmpty: true, dismissLabel: "Skip" } : {}),
      });
    }
    case "editor":
      return buildExtensionUiQuestionPermission(event, {
        question: optionalString(event.title) ?? "Edit text",
        options: [],
        multiSelect: false,
      });
    case "confirm":
      return buildExtensionUiQuestionPermission(event, {
        question: [optionalString(event.title), optionalString(event.message)]
          .filter(Boolean)
          .join("\n\n"),
        options: ["Yes", "No"],
        multiSelect: false,
      });
    default:
      return null;
  }
}

/** Returns whether a permission represents the combined ask_user flow. */
export function isCombinedAskUserPermission(request: AgentPermissionRequest): boolean {
  return request.metadata?.combinedAskUser === COMBINED_ASK_USER_METADATA;
}

/**
 * Converts a combined ask_user permission response to Pi UI state.
 * @param request Pending permission request
 * @param response User permission response
 * @returns Immediate select response and deferred follow-up values
 */
export function buildCombinedAskUserSelectionResponse(
  request: AgentPermissionRequest,
  response: AgentPermissionResponse,
): {
  uiResponse: { value?: string; cancelled?: boolean };
  pendingResponse: PendingCombinedAskUserResponse | null;
} {
  if (response.behavior === "deny") {
    return { uiResponse: { cancelled: true }, pendingResponse: null };
  }

  const answer = permissionAnswer(response.updatedInput, QUESTION_RESPONSE_HEADER);
  if (answer === null) {
    return { uiResponse: { cancelled: true }, pendingResponse: null };
  }

  const selectOptions = readStringArray(request.metadata?.selectOptions);
  const freeformSentinel = optionalString(request.metadata?.freeformSentinel);
  const isFreeform = Boolean(freeformSentinel) && !selectOptions.includes(answer);
  const comment = permissionAnswer(response.updatedInput, QUESTION_COMMENT_HEADER) ?? "";
  return {
    uiResponse: { value: isFreeform ? freeformSentinel : answer },
    pendingResponse: {
      comment,
      freeform: isFreeform ? answer : null,
    },
  };
}

/**
 * Converts a shared permission response to the Pi extension UI response shape.
 * @param request Pending permission request
 * @param response User permission response
 * @returns Pi extension UI response
 */
export function buildExtensionUiResponse(
  request: AgentPermissionRequest,
  response: AgentPermissionResponse,
): { value?: string; confirmed?: boolean; cancelled?: boolean } {
  if (response.behavior === "deny") {
    return { cancelled: true };
  }

  const method = optionalString(request.metadata?.extensionUiMethod);
  const answer = firstPermissionAnswer(response.updatedInput);
  if (answer === null) {
    return { cancelled: true };
  }

  if (method === "confirm") {
    return { confirmed: /^yes$/i.test(answer.trim()) };
  }
  return { value: answer };
}

function getInputQuestionTitle(title: string | undefined, placeholder: string | undefined): string {
  if (!isOptionalInputPlaceholder(placeholder)) {
    return title ?? "Enter a value";
  }
  if (/\bcomment\b/i.test(`${title ?? ""}\n${placeholder ?? ""}`)) {
    return "Optional comment";
  }
  return "Optional response";
}

function isPiAskUserFreeformOption(option: string): boolean {
  return option === PI_ASK_USER_FREEFORM_SENTINEL;
}

function buildExtensionUiQuestionPermission(
  event: Extract<PiRuntimeEvent, { type: "extension_ui_request" }>,
  input: {
    question: string;
    options: string[];
    multiSelect: boolean;
    placeholder?: string;
    allowEmpty?: boolean;
    dismissLabel?: string;
  },
): AgentPermissionRequest {
  return {
    id: event.id,
    provider: PI_PROVIDER,
    name: `Pi ${event.method}`,
    kind: "question",
    title: input.question,
    input: {
      questions: [
        {
          question: input.question,
          header: QUESTION_RESPONSE_HEADER,
          options: input.options.map((label) => ({ label })),
          multiSelect: input.multiSelect,
          ...(input.placeholder ? { placeholder: input.placeholder } : {}),
          ...(input.allowEmpty ? { allowEmpty: true } : {}),
          ...(input.dismissLabel ? { dismissLabel: input.dismissLabel } : {}),
        },
      ],
    },
    metadata: {
      extensionUiMethod: event.method,
      answerHeader: QUESTION_RESPONSE_HEADER,
    },
  };
}

function buildCombinedAskUserQuestionPermission(
  event: Extract<PiRuntimeEvent, { type: "extension_ui_request" }>,
  input: {
    question: string;
    options: string[];
    allowFreeform: boolean;
  },
): AgentPermissionRequest {
  const visibleOptions = input.options.filter((option) => !isPiAskUserFreeformOption(option));
  const allowOther = input.allowFreeform || visibleOptions.length !== input.options.length;
  return {
    id: event.id,
    provider: PI_PROVIDER,
    name: "Pi ask_user",
    kind: "question",
    title: input.question,
    input: {
      questions: [
        {
          question: input.question,
          header: QUESTION_RESPONSE_HEADER,
          options: visibleOptions.map((label) => ({ label })),
          multiSelect: false,
          ...(allowOther ? { allowOther: true } : {}),
        },
        {
          question: "Optional comment",
          header: QUESTION_COMMENT_HEADER,
          options: [],
          multiSelect: false,
          placeholder: "Optional comment (press Enter to skip)...",
          allowEmpty: true,
        },
      ],
    },
    metadata: {
      extensionUiMethod: event.method,
      answerHeader: QUESTION_RESPONSE_HEADER,
      commentHeader: QUESTION_COMMENT_HEADER,
      combinedAskUser: COMBINED_ASK_USER_METADATA,
      selectOptions: visibleOptions,
      ...(allowOther ? { freeformSentinel: PI_ASK_USER_FREEFORM_SENTINEL } : {}),
    },
  };
}

function permissionAnswer(input: AgentMetadata | undefined, header: string): string | null {
  const answers = isRecord(input?.answers) ? input.answers : null;
  if (!answers) {
    return null;
  }
  const answer = answers[header];
  return typeof answer === "string" ? answer : null;
}

function firstPermissionAnswer(input: AgentMetadata | undefined): string | null {
  const answers = isRecord(input?.answers) ? input.answers : null;
  if (!answers) {
    return null;
  }
  const first = Object.values(answers).find((value) => typeof value === "string");
  return typeof first === "string" ? first : null;
}
