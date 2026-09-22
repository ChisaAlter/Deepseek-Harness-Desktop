import type { DesktopAppUpdateStatus } from "@/desktop/updates/use-desktop-app-updater";

export type UpdateCalloutBody =
  | { kind: "available"; versionLabel: string | null }
  | { kind: "installing" }
  | { kind: "error"; message: string };

export type UpdateCalloutActionRole = "changelog" | "install" | "retry";

export interface UpdateCalloutActionDescriptor {
  role: UpdateCalloutActionRole;
  label: string;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}

export interface UpdateCalloutDescriptor {
  id: "desktop-update";
  dismissalKey: string;
  priority: number;
  title: string;
  body: UpdateCalloutBody;
  showGiftIcon: boolean;
  variant: "default" | "error";
  actions: UpdateCalloutActionDescriptor[];
  testID: "update-callout";
}

export interface ResolveUpdateCalloutInput {
  isDesktopApp: boolean;
  status: DesktopAppUpdateStatus;
  isInstalling: boolean;
  availableUpdate: { latestVersion?: string | null } | null;
  errorMessage: string | null;
  copy: UpdateCalloutCopy;
}

export interface UpdateCalloutCopy {
  installingTitle: string;
  failedTitle: string;
  availableTitle: string;
  fallbackError: string;
  changelog: string;
  retry: string;
  installingAction: string;
  installAndRestart: string;
}

function formatVersionLabel(latestVersion: string | null | undefined): string | null {
  if (!latestVersion) return null;
  return `v${latestVersion.replace(/^v/i, "")}`;
}

export function resolveUpdateCalloutDescriptor(
  input: ResolveUpdateCalloutInput,
): UpdateCalloutDescriptor | null {
  if (!input.isDesktopApp) return null;
  if (input.status !== "available" && input.status !== "installing" && input.status !== "error") {
    return null;
  }

  const isError = input.status === "error";
  const isInstalling = input.isInstalling;
  const isAvailable = !isInstalling && !isError;

  const latestVersion = input.availableUpdate?.latestVersion ?? null;
  const dismissalKey = `desktop-update:${input.status}:${latestVersion ?? "unknown"}`;

  let title: string;
  let body: UpdateCalloutBody;
  if (isInstalling) {
    title = input.copy.installingTitle;
    body = { kind: "installing" };
  } else if (isError) {
    title = input.copy.failedTitle;
    body = { kind: "error", message: input.errorMessage ?? input.copy.fallbackError };
  } else {
    title = input.copy.availableTitle;
    body = { kind: "available", versionLabel: formatVersionLabel(latestVersion) };
  }

  const actions: UpdateCalloutActionDescriptor[] = [
    { role: "changelog", label: input.copy.changelog },
  ];
  if (isError) {
    actions.push({ role: "retry", label: input.copy.retry, variant: "primary" });
  } else {
    actions.push({
      role: "install",
      label: isInstalling ? input.copy.installingAction : input.copy.installAndRestart,
      variant: "primary",
      disabled: isInstalling,
    });
  }

  return {
    id: "desktop-update",
    dismissalKey,
    priority: 200,
    title,
    body,
    showGiftIcon: isAvailable,
    variant: isError ? "error" : "default",
    actions,
    testID: "update-callout",
  };
}
