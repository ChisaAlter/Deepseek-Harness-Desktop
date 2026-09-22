import { StyleSheet as RNStyleSheet, View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import Animated, { useAnimatedStyle, withTiming, useSharedValue } from "react-native-reanimated";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Upload } from "lucide-react-native";
import { useFileDropZone } from "@/hooks/use-file-drop-zone";
import { ThemedIconHost } from "@/components/themed-icon-host";
import type { ImageAttachment } from "@/composer/types";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";

interface FileDropZoneProps {
  children: React.ReactNode;
  onFilesDropped: (files: ImageAttachment[]) => void;
  disabled?: boolean;
}

const IS_WEB = isWeb;

const primaryColorMapping = (theme: Theme) => ({
  color: theme.colors.primary,
});

export function FileDropZone({ children, onFilesDropped, disabled = false }: FileDropZoneProps) {
  const { t } = useTranslation();
  const { isDragging, containerRef } = useFileDropZone({
    onFilesDropped,
    disabled,
  });

  const overlayOpacity = useSharedValue(0);

  useEffect(() => {
    overlayOpacity.value = withTiming(isDragging ? 1 : 0, { duration: 150 });
  }, [isDragging, overlayOpacity]);

  const overlayAnimatedStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
    pointerEvents: overlayOpacity.value > 0 ? "auto" : "none",
  }));

  const overlayStyle = useMemo(
    () => [staticStyles.overlay, overlayAnimatedStyle],
    [overlayAnimatedStyle],
  );

  // On non-web platforms, just render children
  if (!IS_WEB) {
    return children;
  }

  return (
    <View
      // Cast ref for web - View renders as div on web
      ref={containerRef as unknown as React.RefObject<View>}
      style={styles.container}
    >
      {children}

      {/* Drop overlay */}
      <Animated.View style={overlayStyle}>
        {/* Backdrop */}
        <View style={styles.backdrop} />
        {/* Content */}
        <View style={styles.overlayContent}>
          <ThemedIconHost Icon={Upload} size={32} uniProps={primaryColorMapping} />
          <Text style={styles.overlayText}>{t("files.dropImagesHere")}</Text>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minWidth: 0,
    width: "100%",
    position: "relative",
    // Visible so Soft Home / session pen-bar soft shadows are not clipped square.
    // Drop overlay is absoluteFill and does not rely on clipping.
    overflow: "visible",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.surface0,
    opacity: 0.7,
  },
  overlayContent: {
    alignItems: "center",
    gap: theme.spacing[2],
  },
  overlayText: {
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
}));

const staticStyles = RNStyleSheet.create({
  overlay: {
    ...RNStyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
});
