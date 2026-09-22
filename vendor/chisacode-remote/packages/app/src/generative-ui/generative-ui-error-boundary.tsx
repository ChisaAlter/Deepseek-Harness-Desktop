import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { StyleSheet } from "react-native-unistyles";

interface Props {
  instanceId: string;
  componentId: string;
  children: React.ReactNode;
  onError?: (instanceId: string, error: Error) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * 生成式 UI 组件的错误边界
 * 捕获渲染时的同步异常，显示退化 UI 卡片，
 * 防止单个组件崩溃影响整个聊天界面
 */
export class GenerativeUiErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(this.props.instanceId, error);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorCard}>
          <Text style={styles.errorIcon}>⚠</Text>
          <Text style={styles.errorTitle}>{this.props.componentId} 渲染失败</Text>
          <Text style={styles.errorDetail}>组件渲染过程中发生异常，请尝试重试</Text>
          <TouchableOpacity onPress={this.handleRetry}>
            <Text style={styles.retryText}>重试</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create((theme) => ({
  // Soft quiet elevated card (r14 family).
  errorCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    alignItems: "center",
    gap: 8,
  },
  errorIcon: {
    fontSize: 20,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.destructive,
  },
  errorTitle: {
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  errorDetail: {
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
  },
  retryText: {
    // Soft error secondary: 12.5 muted.
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.accent,
  },
}));
