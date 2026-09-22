import type { PropsWithChildren } from "react";

const testToastApi = {
  show() {},
  copied() {},
  error() {},
};

export function useToast() {
  return testToastApi;
}

export function ToastProvider({ children }: PropsWithChildren) {
  return children ?? null;
}
