import { useEffect, useRef } from "react";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { getDesktopHost } from "@/desktop/host";
import { listenToDesktopEvent } from "@/desktop/electron/events";
import { useOpenProject } from "@/hooks/use-open-project";
import { useHostRuntimeClient, useHosts } from "@/runtime/host-runtime";
import { buildHostRootRoute } from "@/utils/host-routes";

function OfferLinkListener({
  upsertDaemonFromOfferUrl,
}: {
  upsertDaemonFromOfferUrl: (offerUrlOrFragment: string) => Promise<unknown>;
}) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const handleUrl = (url: string | null) => {
      if (!url) return;
      if (!url.includes("#offer=")) return;
      void upsertDaemonFromOfferUrl(url)
        .then((profile) => {
          if (cancelled) return;
          const serverId = (profile as { serverId?: unknown } | null)?.serverId;
          if (typeof serverId !== "string" || !serverId) return;
          router.replace(buildHostRootRoute(serverId));
          return;
        })
        .catch((error) => {
          if (cancelled) return;
          console.warn("[Linking] Failed to import pairing offer", error);
        });
    };

    void Linking.getInitialURL()
      .then(handleUrl)
      .catch(() => undefined);

    const subscription = Linking.addEventListener("url", (event) => {
      handleUrl(event.url);
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [router, upsertDaemonFromOfferUrl]);

  return null;
}

export interface OpenProjectEventPayload {
  path?: unknown;
}

function OpenProjectListener() {
  const hosts = useHosts();
  const serverId = hosts[0]?.serverId ?? null;
  const client = useHostRuntimeClient(serverId ?? "");
  const openProject = useOpenProject(serverId);
  const pendingPathRef = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const maybeOpenProject = (inputPath: string) => {
      const nextPath = inputPath.trim();
      if (!nextPath) {
        return;
      }

      pendingPathRef.current = nextPath;

      if (!serverId || !client) {
        return;
      }

      const pathToOpen = pendingPathRef.current;
      pendingPathRef.current = null;
      if (!pathToOpen) {
        return;
      }

      void openProject(pathToOpen).catch(() => undefined);
    };

    // Pull any path that was passed on cold start (before the listener existed).
    // Store in the ref even if this effect instance is disposed — the next
    // effect run picks it up via maybeOpenProject(pendingPathRef.current).
    void getDesktopHost()
      ?.getPendingOpenProject?.()
      ?.then((pending) => {
        if (pending) {
          pendingPathRef.current = pending;
        }
        if (!disposed && pending) {
          maybeOpenProject(pending);
        }
        return;
      })
      .catch(() => undefined);

    // Listen for hot-start paths relayed via the second-instance event.
    void listenToDesktopEvent<OpenProjectEventPayload>("open-project", (payload) => {
      if (disposed) {
        return;
      }
      const nextPath = typeof payload?.path === "string" ? payload.path.trim() : "";
      maybeOpenProject(nextPath);
    })
      .then((dispose) => {
        if (disposed) {
          dispose();
          return;
        }
        unlisten = dispose;
        return;
      })
      .catch(() => undefined);

    maybeOpenProject(pendingPathRef.current ?? "");

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [client, openProject, serverId]);

  return null;
}

export { OfferLinkListener, OpenProjectListener };
