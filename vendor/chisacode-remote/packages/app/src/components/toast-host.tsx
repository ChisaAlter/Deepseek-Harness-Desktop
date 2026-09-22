import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Animated, Easing, Platform, Pressable, Text, ToastAndroid, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { AlertTriangle, CheckCircle2, X } from "lucide-react-native";
import { getOverlayRoot, OVERLAY_Z } from "@/lib/overlay-root";
import {
  HEADER_INNER_HEIGHT,
  HEADER_INNER_HEIGHT_MOBILE,
  HEADER_TOP_PADDING_MOBILE,
} from "@/constants/layout";
import { SPACING, type Theme } from "@/styles/theme";
import { createToastQueue, type ToastQueue } from "./toast-queue";

export type ToastVariant = "default" | "success" | "error";

export interface ToastAction {
  label: string;
  onPress: () => void;
}

export interface ToastShowOptions {
  icon?: ReactNode;
  variant?: ToastVariant;
  durationMs?: number | null;
  nativeAndroid?: boolean;
  testID?: string;
  action?: ToastAction;
}

export interface ToastState {
  id: number;
  content: ReactNode;
  nativeMessage: string | null;
  icon?: ReactNode;
  variant: ToastVariant;
  durationMs: number | null;
  testID?: string;
  action?: ToastAction;
}

export interface ToastApi {
  show: (content: ReactNode, options?: ToastShowOptions) => void;
  copied: (label?: string) => void;
  error: (message: string) => void;
}

type ToastViewportPlacement = "app-shell" | "panel";

const DEFAULT_DURATION_MS = 2200;
const TOAST_VERTICAL_GAP = 8;

const ThemedCheckCircle2 = withUnistyles(CheckCircle2);
const ThemedAlertTriangle = withUnistyles(AlertTriangle);
const ThemedX = withUnistyles(X);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const primaryColorMapping = (theme: Theme) => ({ color: theme.colors.primary });
const destructiveColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });

const successToastIcon = <ThemedCheckCircle2 size={18} uniProps={primaryColorMapping} />;
const errorToastIcon = <ThemedAlertTriangle size={18} uniProps={destructiveColorMapping} />;
const copiedToastIcon = <ThemedCheckCircle2 size={18} uniProps={foregroundColorMapping} />;

export function useToastHost(): {
  api: ToastApi;
  toasts: ToastState[];
  dismiss: (id?: number) => void;
} {
  const { t: toastT } = useTranslation();
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const idRef = useRef(0);
  const queueRef = useRef<ToastQueue | null>(null);

  if (!queueRef.current) {
    queueRef.current = createToastQueue(3, (visible) => setToasts(visible));
  }

  useEffect(() => {
    return () => {
      queueRef.current?.clear();
    };
  }, []);

  const show = useCallback((content: ReactNode, options?: ToastShowOptions) => {
    const nativeMessage = typeof content === "string" ? content.trim() : null;
    if (!content || nativeMessage === "") {
      return;
    }

    const variant = options?.variant ?? "default";
    const durationMs = options?.durationMs === undefined ? DEFAULT_DURATION_MS : options.durationMs;
    const nativeAndroid = options?.nativeAndroid ?? false;

    if (Platform.OS === "android" && nativeAndroid && nativeMessage) {
      const duration =
        durationMs !== null && durationMs <= 2500 ? ToastAndroid.SHORT : ToastAndroid.LONG;
      ToastAndroid.showWithGravity(nativeMessage, duration, ToastAndroid.TOP);
      return;
    }

    idRef.current += 1;
    queueRef.current!.push({
      id: idRef.current,
      content,
      nativeMessage,
      icon: options?.icon,
      variant,
      durationMs,
      testID: options?.testID,
      action: options?.action,
    });
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      copied: (label?: string) =>
        show(label ? toastT("common.copiedWithLabel", { label }) : toastT("common.copied"), {
          variant: "success",
          icon: copiedToastIcon,
        }),
      error: (message: string) => show(message, { variant: "error", durationMs: 3200 }),
    }),
    [show, toastT],
  );

  const dismiss = useCallback((id?: number) => {
    if (id === undefined) {
      queueRef.current?.clear();
    } else {
      queueRef.current?.remove(id);
    }
  }, []);

  return { api, toasts, dismiss };
}

function ToastActionButton({ action, onDismiss }: { action: ToastAction; onDismiss: () => void }) {
  const handlePress = useCallback(() => {
    action.onPress();
    onDismiss();
  }, [action, onDismiss]);
  return (
    <Pressable
      testID="app-toast-action"
      onPress={handlePress}
      hitSlop={8}
      style={styles.actionButton}
    >
      <Text style={styles.actionLabel}>{action.label}</Text>
    </Pressable>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-8)).current;
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissDeadlineRef = useRef<number | null>(null);
  const remainingDurationRef = useRef(0);
  const animationRef = useRef<{ stop: () => void } | null>(null);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const animateOut = useCallback(() => {
    clearTimer();
    const animation = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: 140,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: -8,
        duration: 140,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    animationRef.current = animation;
    animation.start(({ finished }) => {
      animationRef.current = null;
      if (finished) {
        onDismiss();
      }
    });
  }, [clearTimer, onDismiss, opacity, translateY]);

  const scheduleDismiss = useCallback(
    (durationMs: number | null) => {
      clearTimer();
      if (durationMs === null) {
        remainingDurationRef.current = 0;
        dismissDeadlineRef.current = null;
        return;
      }
      const nextDurationMs = Math.max(0, durationMs);
      remainingDurationRef.current = nextDurationMs;
      dismissDeadlineRef.current = Date.now() + nextDurationMs;
      timeoutRef.current = setTimeout(() => {
        animateOut();
      }, nextDurationMs);
    },
    [animateOut, clearTimer],
  );

  const pauseDismiss = useCallback(() => {
    if (dismissDeadlineRef.current !== null) {
      remainingDurationRef.current = Math.max(0, dismissDeadlineRef.current - Date.now());
    }
    dismissDeadlineRef.current = null;
    clearTimer();
  }, [clearTimer]);

  const resumeDismiss = useCallback(() => {
    if (toast.durationMs === null) {
      return;
    }
    scheduleDismiss(remainingDurationRef.current || toast.durationMs);
  }, [scheduleDismiss, toast.durationMs]);

  useEffect(() => {
    opacity.setValue(0);
    translateY.setValue(-8);

    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 140,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 140,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();

    scheduleDismiss(toast.durationMs);

    return () => {
      clearTimer();
      // Stop any in-flight animate-out so its callback does not fire onDismiss
      // after the ToastItem has unmounted.
      animationRef.current?.stop();
      animationRef.current = null;
    };
  }, [clearTimer, opacity, scheduleDismiss, toast.durationMs, translateY]);

  const animatedStyle = useMemo(
    () => [
      styles.toast,
      toast.variant === "success" ? styles.toastSuccess : null,
      toast.variant === "error" ? styles.toastError : null,
      { opacity, transform: [{ translateY }], marginBottom: TOAST_VERTICAL_GAP },
    ],
    [toast.variant, opacity, translateY],
  );

  const messageStyle = useMemo(
    () => [styles.message, toast.variant === "error" ? styles.messageError : null],
    [toast.variant],
  );

  let defaultIcon: ReactNode = null;
  if (toast.variant === "success") {
    defaultIcon = successToastIcon;
  } else if (toast.variant === "error") {
    defaultIcon = errorToastIcon;
  }
  const icon = toast.icon ?? defaultIcon;

  return (
    <Animated.View
      testID={toast.testID ?? "app-toast"}
      onPointerEnter={isWeb ? pauseDismiss : undefined}
      onPointerLeave={isWeb ? resumeDismiss : undefined}
      style={animatedStyle}
      accessibilityRole="alert"
    >
      {icon ? <View style={styles.iconSlot}>{icon}</View> : null}
      {typeof toast.content === "string" ? (
        <Text testID="app-toast-message" style={messageStyle}>
          {toast.content}
        </Text>
      ) : (
        <View testID="app-toast-message" style={styles.contentSlot}>
          {toast.content}
        </View>
      )}
      {toast.action ? <ToastActionButton action={toast.action} onDismiss={onDismiss} /> : null}
      {toast.variant === "error" ? (
        <Pressable
          testID="app-toast-close"
          onPress={onDismiss}
          hitSlop={6}
          style={styles.closeButton}
          accessibilityRole="button"
          accessibilityLabel="关闭"
        >
          <ThemedX size={14} uniProps={destructiveColorMapping} />
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

export function ToastViewport({
  toasts,
  onDismiss,
  placement = "app-shell",
}: {
  toasts: ToastState[];
  onDismiss: (id: number) => void;
  placement?: ToastViewportPlacement;
}) {
  const insets = useSafeAreaInsets();
  const isMobile = useIsCompactFormFactor();

  const headerHeight = isMobile ? HEADER_INNER_HEIGHT_MOBILE : HEADER_INNER_HEIGHT;
  const headerTopPadding = isMobile ? HEADER_TOP_PADDING_MOBILE : 0;
  const topOffset =
    placement === "app-shell"
      ? insets.top + headerTopPadding + headerHeight + SPACING[2]
      : SPACING[3];

  const containerStyle = useMemo(() => [styles.container, { marginTop: topOffset }], [topOffset]);

  const handleToastDismiss = useCallback((id: number) => () => onDismiss(id), [onDismiss]);

  if (toasts.length === 0) {
    return null;
  }

  const content = (
    <View style={containerStyle} pointerEvents="box-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={handleToastDismiss(toast.id)} />
      ))}
    </View>
  );

  if (placement === "app-shell" && isWeb && typeof document !== "undefined") {
    return createPortal(content, getOverlayRoot());
  }

  return content;
}

const styles = StyleSheet.create((theme) => ({
  container: {
    position: "absolute",
    left: theme.spacing[4],
    right: theme.spacing[4],
    top: 0,
    zIndex: OVERLAY_Z.toast,
    alignItems: "center",
  },
  toast: {
    alignSelf: "center",
    maxWidth: "92%",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    backgroundColor: theme.colors.surface0,
    borderRadius: 14,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    ...theme.shadow.sm,
  },
  toastSuccess: {
    borderColor: theme.colors.border,
  },
  toastError: {
    borderColor: theme.colors.destructive,
  },
  iconSlot: {
    alignItems: "center",
    justifyContent: "center",
  },
  contentSlot: {
    flexShrink: 1,
    minWidth: 0,
  },
  actionButton: {
    marginLeft: theme.spacing[2],
    paddingHorizontal: theme.spacing[1],
    paddingVertical: 2,
  },
  actionLabel: {
    fontSize: 12.5,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.primary,
    textDecorationLine: "underline",
  },
  message: {
    flexShrink: 1,
    color: theme.colors.foreground,
    // Soft toast body: 12.5 meta.
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: theme.fontWeight.normal,
  },
  messageError: {
    color: theme.colors.destructive,
  },
  closeButton: {
    alignItems: "center",
    justifyContent: "center",
    marginLeft: theme.spacing[1],
    padding: 2,
  },
}));
