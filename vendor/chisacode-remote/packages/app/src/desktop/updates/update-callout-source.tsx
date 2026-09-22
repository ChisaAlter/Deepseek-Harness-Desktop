import { Gift } from "lucide-react-native";
import { type ReactNode, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { withUnistyles } from "react-native-unistyles";
import {
  type SidebarCalloutAction,
  SidebarCalloutDescriptionText,
} from "@/components/sidebar-callout";
import { useSidebarCallouts } from "@/contexts/sidebar-callout-context";
import {
  resolveUpdateCalloutDescriptor,
  type UpdateCalloutActionDescriptor,
  type UpdateCalloutBody,
} from "@/desktop/updates/resolve-update-callout";
import { useDesktopAppUpdater } from "@/desktop/updates/use-desktop-app-updater";
import { useStableEvent } from "@/hooks/use-stable-event";
import { openExternalUrl } from "@/utils/open-external-url";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ThemedGift = withUnistyles(Gift);

const giftIconMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: ICON_SIZE.sm,
});

const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const CHANGELOG_URL = "https://chisacode.sh/changelog";

function renderBody(
  body: UpdateCalloutBody,
  copy: {
    installingBody: string;
    availableWithVersion: (versionLabel: string) => string;
    availableGeneric: string;
    stopsAgentsAndTerminals: string;
  },
): ReactNode {
  if (body.kind === "installing") return copy.installingBody;
  if (body.kind === "error") return body.message;
  return <UpdateAvailableDescription versionLabel={body.versionLabel ?? undefined} copy={copy} />;
}

function materializeActions(
  actions: readonly UpdateCalloutActionDescriptor[],
  handlers: { changelog: () => void; install: () => void; retry: () => void },
): SidebarCalloutAction[] {
  return actions.map((action) => ({
    label: action.label,
    onPress: handlers[action.role],
    variant: action.variant,
    disabled: action.disabled,
  }));
}

export function UpdateCalloutSource() {
  const callouts = useSidebarCallouts();
  const { t } = useTranslation();
  const {
    isDesktopApp,
    status,
    availableUpdate,
    errorMessage,
    checkForUpdates,
    installUpdate,
    isInstalling,
  } = useDesktopAppUpdater();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const openChangelog = useStableEvent(() => {
    void openExternalUrl(CHANGELOG_URL);
  });
  const install = useStableEvent(() => {
    void installUpdate();
  });
  const retry = useStableEvent(() => {
    void checkForUpdates();
  });
  useEffect(() => {
    if (!isDesktopApp) return;

    void checkForUpdates({ silent: true });

    intervalRef.current = setInterval(() => {
      void checkForUpdates({ silent: true });
    }, CHECK_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isDesktopApp, checkForUpdates]);

  useEffect(() => {
    const copy = {
      installingTitle: t("desktopUpdates.callout.installingTitle"),
      failedTitle: t("desktopUpdates.callout.failedTitle"),
      availableTitle: t("desktopUpdates.callout.availableTitle"),
      fallbackError: t("desktopUpdates.callout.fallbackError"),
      changelog: t("desktopUpdates.callout.changelog"),
      retry: t("desktopUpdates.callout.retry"),
      installingAction: t("desktopUpdates.callout.installingAction"),
      installAndRestart: t("desktopUpdates.callout.installAndRestart"),
      installingBody: t("desktopUpdates.callout.installingBody"),
      availableWithVersion: (versionLabel: string) =>
        t("desktopUpdates.callout.availableWithVersion", { versionLabel }),
      availableGeneric: t("desktopUpdates.callout.availableGeneric"),
      stopsAgentsAndTerminals: t("desktopUpdates.callout.stopsAgentsAndTerminals"),
    };
    const descriptor = resolveUpdateCalloutDescriptor({
      isDesktopApp,
      status,
      isInstalling,
      availableUpdate,
      errorMessage,
      copy,
    });
    if (!descriptor) return;

    return callouts.show({
      id: descriptor.id,
      dismissalKey: descriptor.dismissalKey,
      priority: descriptor.priority,
      title: descriptor.title,
      description: renderBody(descriptor.body, copy),
      icon: descriptor.showGiftIcon ? <ThemedGift uniProps={giftIconMapping} /> : undefined,
      variant: descriptor.variant,
      actions: materializeActions(descriptor.actions, {
        changelog: openChangelog,
        install,
        retry,
      }),
      testID: descriptor.testID,
    });
  }, [
    availableUpdate,
    callouts,
    errorMessage,
    install,
    isDesktopApp,
    isInstalling,
    openChangelog,
    retry,
    status,
    t,
  ]);

  return null;
}

function UpdateAvailableDescription({
  versionLabel,
  copy,
}: {
  versionLabel?: string;
  copy: {
    availableWithVersion: (versionLabel: string) => string;
    availableGeneric: string;
    stopsAgentsAndTerminals: string;
  };
}) {
  return (
    <>
      <SidebarCalloutDescriptionText>
        {versionLabel ? copy.availableWithVersion(versionLabel) : copy.availableGeneric}
      </SidebarCalloutDescriptionText>
      <SidebarCalloutDescriptionText>{copy.stopsAgentsAndTerminals}</SidebarCalloutDescriptionText>
    </>
  );
}
