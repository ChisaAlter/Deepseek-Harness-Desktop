import { useEffect, useRef } from "react";
import type { ToastApi } from "@/components/toast-host";
import { useUserVisibleErrorReporter } from "@/hooks/use-user-visible-error";
import { reportUserVisibleError } from "@/utils/user-visible-error";

interface DesktopIpcErrorReport {
  toast: ToastApi;
  logLabel: string;
  message: string;
  error: unknown;
}

interface DesktopIpcQueryErrorToastOptions {
  error: Error | null;
  logLabel: string;
  message: string;
}

interface DesktopIpcErrorReporterInput {
  logLabel: string;
  message: string;
  error: unknown;
}

export function reportDesktopIpcError(input: DesktopIpcErrorReport): void {
  reportUserVisibleError(input);
}

export function useDesktopIpcErrorReporter(): (input: DesktopIpcErrorReporterInput) => void {
  return useUserVisibleErrorReporter();
}

export function useDesktopIpcQueryErrorToast(options: DesktopIpcQueryErrorToastOptions): void {
  const reportError = useDesktopIpcErrorReporter();
  const lastReportedErrorRef = useRef<Error | null>(null);

  useEffect(() => {
    if (!options.error || options.error === lastReportedErrorRef.current) {
      return;
    }

    lastReportedErrorRef.current = options.error;
    reportError({
      logLabel: options.logLabel,
      message: options.message,
      error: options.error,
    });
  }, [options.error, options.logLabel, options.message, reportError]);
}
