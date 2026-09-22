import type { ToastApi } from "@/components/toast-host";
import { toErrorMessage } from "@/utils/error-messages";

/** Minimal logging surface used to record reported errors */
export interface ErrorLogger {
  error(label: string, error: unknown): void;
}

/** Describes an error to log and present to the user through a caller-supplied presenter */
export interface PresentedErrorReport {
  logLabel: string;
  error: unknown;
  logger?: ErrorLogger;
  message?: string;
  fallbackMessage?: string;
  notify?: boolean;
  present: (message: string) => void;
}

/** An error report presented via a toast API instead of an explicit presenter callback */
export type UserVisibleErrorReport = Omit<PresentedErrorReport, "present"> & {
  toast: ToastApi;
};

/** The subset of {@link UserVisibleErrorReport} a caller supplies when a reporter injects the toast */
export type UserVisibleErrorReporterInput = Omit<UserVisibleErrorReport, "toast">;

/**
 * Logs an error and presents a message for it, unless notifications are disabled
 * @param input The error report including the presenter callback and optional message overrides
 */
export function reportPresentedError(input: PresentedErrorReport): void {
  const logger = input.logger ?? console;
  logger.error(input.logLabel, input.error);
  if (input.notify === false) return;
  input.present(input.message?.trim() || toErrorMessage(input.error, input.fallbackMessage));
}

/**
 * Logs an error and shows its message as an error toast
 * @param input The error report including the toast API to present with
 */
export function reportUserVisibleError(input: UserVisibleErrorReport): void {
  const { toast, ...report } = input;
  reportPresentedError({ ...report, present: toast.error });
}
