import { Component, useCallback, useMemo, type ErrorInfo, type ReactNode } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { useTranslation } from "react-i18next";
import { appI18n } from "@/i18n";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: unknown, resetError: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: unknown;
}

/**
 * React Error Boundary that catches render errors in its subtree and displays
 * a recovery UI instead of crashing the entire application.
 *
 * Place at strategic points in the component tree (e.g. wrapping the main
 * shell, individual agent screens, or heavy components like the sidebar) to
 * limit the blast radius of render errors.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: undefined };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    console.error("[ErrorBoundary] Uncaught render error:", error, errorInfo.componentStack);
  }

  resetError = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.resetError);
      }
      return <DefaultErrorFallback error={this.state.error} onReset={this.resetError} />;
    }
    return this.props.children;
  }
}

/**
 * Standalone fallback component with no hook dependencies so it can render
 * even when the hook tree is corrupted. Uses static, theme-independent styles
 * as a safe fallback — the rest of the app may be in a broken state.
 */
function DefaultErrorFallback({ error, onReset }: { error: unknown; onReset: () => void }) {
  const message =
    error instanceof Error
      ? error.message
      : appI18n.t("errors.generic", { defaultValue: "出了点问题。" });

  return (
    <View style={fallbackStyles.container}>
      <Text style={fallbackStyles.title}>
        {appI18n.t("startup.errorTitle", { defaultValue: "出错了" })}
      </Text>
      <Text style={fallbackStyles.message} numberOfLines={5}>
        {message}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={appI18n.t("common.retry", { defaultValue: "重试" })}
        onPress={onReset}
        style={defaultRetryButtonStyle}
      >
        <Text style={fallbackStyles.retryText}>
          {appI18n.t("common.retry", { defaultValue: "重试" })}
        </Text>
      </Pressable>
    </View>
  );
}

function defaultRetryButtonStyle({ pressed }: PressableStateCallbackType) {
  return [fallbackStyles.retryButton, pressed && fallbackStyles.retryButtonPressed];
}

const fallbackStyles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  // Soft empty/error title scale.
  title: {
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: "500",
  },
  message: {
    fontSize: 14.5,
    lineHeight: 22,
    textAlign: "center",
    maxWidth: 400,
  },
  // Soft quiet pill control.
  retryButton: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
  },
  retryButtonPressed: {
    opacity: 0.7,
  },
  retryText: {
    // Soft error secondary: 12.5 muted.
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: "500",
  },
});

/**
 * 分级 ErrorBoundary 使用的局部 fallback。与根级 DefaultErrorFallback 不同，
 * 这里通过 StyleSheet theme factory 读取 theme token，避免硬编码 fontSize/color，样式随主题变化。
 * 作为真正的函数组件渲染（由 ErrorBoundary 的 fallback render callback 返回对应元素），
 * 因此可以使用 hooks。
 */
interface SectionErrorFallbackProps {
  error: unknown;
  onReset: () => void;
  /**
   * 可选的自定义标题，默认走 i18n generic 错误标题。
   * 传入区域名（如 "工作区"）时会拼成 "工作区渲染异常" 之类的语义。
   */
  sectionLabel?: string;
  /**
   * 紧凑模式：用于 pane 级局部兜底，避免占满整屏。
   * true 时容器不撑满、内边距更小，适合嵌入到面板内部。
   */
  compact?: boolean;
}

export function SectionErrorFallback({
  error,
  onReset,
  sectionLabel,
  compact = false,
}: SectionErrorFallbackProps) {
  const { t } = useTranslation();
  const message =
    error instanceof Error
      ? error.message
      : appI18n.t("errors.generic", { defaultValue: "出了点问题。" });
  const title = sectionLabel
    ? t("errors.sectionTitle", {
        defaultValue: "{{section}} 渲染异常",
        section: sectionLabel,
      })
    : t("startup.errorTitle", { defaultValue: "出错了" });

  const containerStyle = useMemo(
    () => (compact ? sectionStyles.compactContainer : sectionStyles.container),
    [compact],
  );

  const sectionRetryButtonStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      sectionStyles.retryButton,
      pressed && sectionStyles.retryButtonPressed,
    ],
    [],
  );

  return (
    <View style={containerStyle}>
      <Text style={sectionStyles.title} numberOfLines={2}>
        {title}
      </Text>
      <Text style={sectionStyles.message} numberOfLines={compact ? 3 : 5}>
        {message}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("common.retry", { defaultValue: "重试" })}
        onPress={onReset}
        style={sectionRetryButtonStyle}
      >
        <Text style={sectionStyles.retryText}>{t("common.retry", { defaultValue: "重试" })}</Text>
      </Pressable>
    </View>
  );
}

const sectionStyles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
    gap: theme.spacing[3],
    backgroundColor: theme.colors.background,
  },
  compactContainer: {
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[3],
    gap: theme.spacing[2],
    borderColor: theme.colors.border,
    borderRadius: 14,
    backgroundColor: theme.colors.surface0,
    ...(isWeb
      ? {
          boxShadow: "0 1px 2px rgba(20, 23, 31, 0.04), 0 8px 24px rgba(20, 23, 31, 0.06)",
        }
      : theme.shadow.sm),
  },
  title: {
    fontWeight: "600",
    textAlign: "center",
    color: theme.colors.foreground,
    fontSize: 14.5,
  },
  message: {
    textAlign: "center",
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
  },
  retryButton: {
    borderWidth: 1,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: 10,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  retryButtonPressed: {
    opacity: 0.7,
  },
  retryText: {
    fontWeight: "500",
    color: theme.colors.foreground,
    fontSize: 12.5,
  },
}));
