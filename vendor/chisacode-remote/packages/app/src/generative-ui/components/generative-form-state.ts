export type GenerativeFormStatus = "editable" | "submitting" | "submitted" | "error";

export interface GenerativeFormState {
  status: GenerativeFormStatus;
  values: Record<string, string>;
  error: string | null;
}

/** Runs a form change effect only while fields are editable. */
export function dispatchGenerativeFormChange(
  state: GenerativeFormState,
  controller: GenerativeFormSubmissionController,
  change: () => void,
): boolean {
  if (!isGenerativeFormEditable(state) || !controller.canChange()) return false;
  change();
  return true;
}
/** Returns whether form fields may emit changes in the current state. */
export function isGenerativeFormEditable(state: GenerativeFormState): boolean {
  return state.status === "editable" || state.status === "error";
}
export type GenerativeFormAction =
  | { type: "field_changed"; field: string; value: string }
  | { type: "submit_started" }
  | { type: "submit_resolved"; sent: boolean };

/** Creates the initial editable form state. */
export function createGenerativeFormState(values: Record<string, string>): GenerativeFormState {
  return { status: "editable", values, error: null };
}

/** Applies a pure form interaction transition. */
export function generativeFormReducer(
  state: GenerativeFormState,
  action: GenerativeFormAction,
): GenerativeFormState {
  switch (action.type) {
    case "field_changed":
      if (state.status === "submitting" || state.status === "submitted") return state;
      return {
        status: "editable",
        values: { ...state.values, [action.field]: action.value },
        error: null,
      };
    case "submit_started":
      return state.status === "editable" || state.status === "error"
        ? { ...state, status: "submitting", error: null }
        : state;
    case "submit_resolved":
      if (state.status !== "submitting") return state;
      return action.sent
        ? { ...state, status: "submitted", error: null }
        : { ...state, status: "error", error: "提交失败，请重试" };
  }
}

export interface GenerativeFormSubmissionController {
  mount(): void;
  unmount(): void;
  begin(): boolean;
  canChange(): boolean;
  complete(sent: boolean): boolean;
}

/** Creates a synchronous submit lock with explicit mounted lifecycle tracking. */
export function createGenerativeFormSubmissionController(): GenerativeFormSubmissionController {
  let mounted = false;
  let locked = false;
  return {
    mount() {
      mounted = true;
    },
    unmount() {
      mounted = false;
    },
    begin() {
      if (!mounted || locked) return false;
      locked = true;
      return true;
    },
    canChange() {
      return mounted && !locked;
    },
    complete(sent) {
      if (!sent) locked = false;
      return mounted;
    },
  };
}
