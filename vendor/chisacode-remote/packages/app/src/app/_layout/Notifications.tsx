import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "expo-router";
import * as Notifications from "expo-notifications";
import { isAndroid, isWeb } from "@/constants/platform";
import { getIsElectronRuntime } from "@/constants/layout";
import { getDesktopHost } from "@/desktop/host";
import { useStableEvent } from "@/hooks/use-stable-event";
import { createAndroidNotificationDrainController } from "@/native/android-notification-drain-controller";
import {
  ensureOsNotificationPermission,
  WEB_NOTIFICATION_CLICK_EVENT,
  type WebNotificationClickDetail,
} from "@/utils/os-notifications";
import {
  buildNotificationRoute,
  normalizeAndroidNotificationData,
  resolveNotificationTarget,
} from "@/utils/notification-routing";
import { navigateToAgent } from "@/utils/navigate-to-agent";

function PushNotificationRouter() {
  const router = useRouter();
  const pathname = usePathname();
  const lastHandledIdRef = useRef<string | null>(null);
  const openNotification = useStableEvent((data: Record<string, unknown> | undefined) => {
    const target = resolveNotificationTarget(data);
    const serverId = target.serverId;
    const agentId = target.agentId;
    if (serverId && agentId) {
      navigateToAgent({ serverId, agentId, currentPathname: pathname, pin: true });
      return;
    }

    router.navigate(buildNotificationRoute(data));
  });
  const openAndroidNotification = useStableEvent((data: unknown) => {
    const normalized = normalizeAndroidNotificationData(data);
    if (normalized) {
      openNotification(normalized);
    }
  });

  useEffect(() => {
    if (isWeb) {
      let removeDesktopNotificationListener: (() => void) | null = null;
      let cancelled = false;

      if (getIsElectronRuntime()) {
        void ensureOsNotificationPermission();

        const unlistenResult = getDesktopHost()?.events?.on?.(
          "notification-click",
          (payload: unknown) => {
            const data =
              typeof payload === "object" &&
              payload !== null &&
              "data" in payload &&
              typeof (payload as { data?: unknown }).data === "object" &&
              (payload as { data?: unknown }).data !== null
                ? (payload as { data: Record<string, unknown> }).data
                : undefined;
            openNotification(data);
          },
        );

        void Promise.resolve(unlistenResult).then((unlisten) => {
          if (typeof unlisten !== "function") {
            return;
          }
          if (cancelled) {
            unlisten();
            return;
          }
          removeDesktopNotificationListener = unlisten;
          return;
        });
      }

      const openFromWebClick = (event: Event) => {
        const customEvent = event as CustomEvent<WebNotificationClickDetail>;
        event.preventDefault();
        openNotification(customEvent.detail?.data);
      };

      window.addEventListener(WEB_NOTIFICATION_CLICK_EVENT, openFromWebClick as EventListener);

      return () => {
        cancelled = true;
        removeDesktopNotificationListener?.();
        window.removeEventListener(WEB_NOTIFICATION_CLICK_EVENT, openFromWebClick as EventListener);
      };
    }

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        // When the app is open, don't show OS banners.
        shouldShowAlert: false,
        shouldShowBanner: false,
        shouldShowList: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });

    const openFromResponse = (response: Notifications.NotificationResponse) => {
      const identifier = response.notification.request.identifier;
      if (lastHandledIdRef.current === identifier) {
        return;
      }
      lastHandledIdRef.current = identifier;

      const data = response.notification.request.content.data as
        | Record<string, unknown>
        | undefined;
      openNotification(data);
    };

    const subscription = Notifications.addNotificationResponseReceivedListener(openFromResponse);

    let cancelled = false;
    let removeAndroidNotificationListener: (() => void) | null = null;
    let androidDrainController: ReturnType<typeof createAndroidNotificationDrainController> | null =
      null;
    if (isAndroid) {
      void import("@/native/android-runtime.android")
        .then((runtime) => {
          const controller = createAndroidNotificationDrainController({
            drain: () => runtime.consumeInitialNotificationData(),
            onData: openAndroidNotification,
            onError: (error) => {
              console.error("Failed to drain Android notification launch data", error);
            },
          });
          const removeListener = runtime.subscribeNotificationResponses(() => {
            controller.requestDrain();
          });
          if (cancelled) {
            removeListener();
            controller.dispose();
            return;
          }
          removeAndroidNotificationListener = removeListener;
          androidDrainController = controller;
          controller.requestDrain();
          return;
        })
        .catch((error: unknown) => {
          console.error("Failed to consume Android notification launch data", error);
        });
    }

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        openFromResponse(response);
      }
      return;
    });

    return () => {
      cancelled = true;
      removeAndroidNotificationListener?.();
      androidDrainController?.dispose();
      subscription.remove();
    };
  }, [openAndroidNotification, openNotification]);

  return null;
}

export { PushNotificationRouter };
