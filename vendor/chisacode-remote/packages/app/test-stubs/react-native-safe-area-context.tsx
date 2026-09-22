import type { PropsWithChildren } from "react";

export function SafeAreaProvider({ children }: PropsWithChildren) {
  return children ?? null;
}

export function SafeAreaView({ children }: PropsWithChildren) {
  return children ?? null;
}

export function useSafeAreaFrame() {
  return { x: 0, y: 0, width: 1024, height: 768 };
}

export function useSafeAreaInsets() {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}
