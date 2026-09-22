import { useCallback } from "react";
import { useToast } from "@/contexts/toast-context";
import {
  reportUserVisibleError,
  type UserVisibleErrorReporterInput,
} from "@/utils/user-visible-error";

export function useUserVisibleErrorReporter(): (input: UserVisibleErrorReporterInput) => void {
  const toast = useToast();
  return useCallback(
    (input: UserVisibleErrorReporterInput) => {
      reportUserVisibleError({ ...input, toast });
    },
    [toast],
  );
}
