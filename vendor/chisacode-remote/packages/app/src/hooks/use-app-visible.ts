import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { getIsAppActivelyVisible } from "@/utils/app-visibility";
import { isWeb } from "@/constants/platform";

let current = getIsAppActivelyVisible();
const listeners = new Set<() => void>();
/** Reference count of active global subscriptions so the native/web sources
 *  stay alive while at least one consumer remains (useSyncExternalStore contract). */
let globalSubscriptionRefCount = 0;
let appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
let webListenersAttached = false;

function notify(): void {
  const next = getIsAppActivelyVisible();
  if (next === current) {
    return;
  }
  current = next;
  for (const listener of listeners) {
    listener();
  }
}

function attachGlobalListeners(): void {
  if (globalSubscriptionRefCount > 0) {
    globalSubscriptionRefCount += 1;
    return;
  }
  globalSubscriptionRefCount = 1;

  appStateSubscription = AppState.addEventListener("change", notify);

  if (isWeb && typeof document !== "undefined") {
    document.addEventListener("visibilitychange", notify);
    window.addEventListener("focus", notify);
    window.addEventListener("blur", notify);
    webListenersAttached = true;
  }
}

function detachGlobalListeners(): void {
  if (globalSubscriptionRefCount <= 0) {
    return;
  }
  globalSubscriptionRefCount -= 1;
  if (globalSubscriptionRefCount > 0) {
    return;
  }

  appStateSubscription?.remove();
  appStateSubscription = null;

  if (webListenersAttached && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", notify);
    window.removeEventListener("focus", notify);
    window.removeEventListener("blur", notify);
    webListenersAttached = false;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  attachGlobalListeners();
  return () => {
    listeners.delete(listener);
    detachGlobalListeners();
  };
}

function getSnapshot(): boolean {
  return current;
}

export function useAppVisible(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
