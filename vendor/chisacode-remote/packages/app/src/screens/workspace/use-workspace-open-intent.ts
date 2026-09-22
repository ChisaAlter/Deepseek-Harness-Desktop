import { useEffect, useMemo, useRef } from "react";
import { useGlobalSearchParams, useRouter, type Href } from "expo-router";

import { isWeb } from "@/constants/platform";
import { resolveWorkspaceScreenOpenIntentAction } from "@/screens/workspace/workspace-open-intent";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";

interface UseWorkspaceOpenIntentInput {
  isRouteFocused: boolean;
  persistenceKey: string | null;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  hasExplorerCheckout: boolean;
  isTerminalCreatePending: boolean;
  onOpenChanges: () => void;
  onCreateTerminal: () => void;
}

function getSearchParamValue(value: string | string[] | undefined): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const firstValue = value[0];
    return typeof firstValue === "string" ? firstValue.trim() : "";
  }
  return "";
}

function stripOpenSearchParamFromBrowserUrl(): void {
  if (!isWeb || typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  if (!url.searchParams.has("open")) {
    return;
  }
  url.searchParams.delete("open");
  window.history.replaceState(null, "", url.toString());
}

/** Consumes workspace screen URL intents once their target surface is ready. */
export function useWorkspaceOpenIntent(input: UseWorkspaceOpenIntentInput): void {
  const {
    isRouteFocused,
    persistenceKey,
    normalizedServerId,
    normalizedWorkspaceId,
    hasExplorerCheckout,
    isTerminalCreatePending,
    onOpenChanges,
    onCreateTerminal,
  } = input;
  const globalParams = useGlobalSearchParams<{ open?: string | string[] }>();
  const router = useRouter();
  const openIntentValue = useMemo(
    () => getSearchParamValue(globalParams.open),
    [globalParams.open],
  );
  const consumedIntentRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isRouteFocused || !openIntentValue || !persistenceKey) {
      return;
    }
    const consumptionKey = `${normalizedServerId}:${normalizedWorkspaceId}:${openIntentValue}`;
    if (consumedIntentRef.current === consumptionKey) {
      return;
    }
    const action = resolveWorkspaceScreenOpenIntentAction({
      openIntentValue,
      hasExplorerCheckout,
      isTerminalCreatePending,
    });
    if (action.kind === "ignore" || action.kind === "wait") {
      return;
    }

    consumedIntentRef.current = consumptionKey;
    if (isWeb) {
      stripOpenSearchParamFromBrowserUrl();
    } else {
      router.replace(buildHostWorkspaceRoute(normalizedServerId, normalizedWorkspaceId) as Href);
    }
    if (action.kind === "open-changes") {
      onOpenChanges();
      return;
    }
    onCreateTerminal();
  }, [
    hasExplorerCheckout,
    isRouteFocused,
    isTerminalCreatePending,
    normalizedServerId,
    normalizedWorkspaceId,
    onCreateTerminal,
    onOpenChanges,
    openIntentValue,
    persistenceKey,
    router,
  ]);
}
