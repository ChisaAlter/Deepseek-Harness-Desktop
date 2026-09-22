import { useCallback, useMemo, useState, type ReactNode } from "react";
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import {
  CONVERSATION_COLUMN_MAX_WIDTH_RATIO,
  WORKBENCH_ASSISTANT_MESSAGE_MAX_WIDTH,
  useIsCompactFormFactor,
} from "@/constants/layout";
import { resolveThemeWorkbenchSurfaceRoles } from "@/styles/workbench-surface-roles";

/**
 * Left-aligned chat column capped at pane height (1:1).
 *
 * Important: never set an explicit pixel `width` from a self-measured pane width.
 * That creates a flex feedback loop (child width → parent min content size →
 * parent cannot shrink → layout width never decreases). Cap with maxWidth only.
 *
 * @param props.children Stream + composer (or draft setup) content
 */
export function ConversationAspectColumn({ children }: { children: ReactNode }) {
  const isCompact = useIsCompactFormFactor();
  // Only height is needed for the 1:1 max-width cap.
  const [paneHeight, setPaneHeight] = useState(0);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { height } = event.nativeEvent.layout;
    // Ignore non-positive heights. When the keyed agent panel remounts inside
    // this shell, React/RNW can emit a transient 0-height layout pass; writing
    // that back would drop maxWidth to the 800 fallback and flash the column
    // horizontally (the exact switch flash this shell exists to prevent).
    if (!(height > 0)) {
      return;
    }
    setPaneHeight((current) => (current === height ? current : height));
  }, []);

  const maxWidth =
    !isCompact && paneHeight > 0
      ? Math.round(paneHeight * CONVERSATION_COLUMN_MAX_WIDTH_RATIO)
      : null;

  const hostStyle = useMemo<StyleProp<ViewStyle>>(
    () => [styles.conversationAspectHost, !isCompact && styles.conversationAspectHostDesktopInset],
    [isCompact],
  );

  const columnStyle = useMemo<StyleProp<ViewStyle>>(() => {
    if (maxWidth == null) {
      return styles.conversationColumn;
    }
    return [styles.conversationColumn, { maxWidth }];
  }, [maxWidth]);

  return (
    <View style={hostStyle} onLayout={handleLayout} testID="conversation-aspect-host">
      <View style={columnStyle} testID="conversation-aspect-column">
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  conversationAspectHost: {
    flex: 1,
    width: "100%",
    minWidth: 0,
    // Keep visible so pen-bar soft shadows are not clipped into hard corners.
    // Column width is already capped via maxWidth + minWidth:0 (no self-measured width).
    overflow: "visible",
    // Soft Workbench: center the reading column (design .stream-inner).
    alignItems: "center",
    backgroundColor: resolveThemeWorkbenchSurfaceRoles(theme).content,
  },
  // Desktop only: soft session padding around the document stream + dock.
  // Keep modest so pen-bar and stream share the same wide column edge.
  conversationAspectHostDesktopInset: {
    paddingLeft: 20,
    paddingRight: 20,
  },
  conversationColumn: {
    flex: 1,
    // Soft reading column: same hard cap as assistant messages / pen-bar.
    width: "100%",
    minWidth: 0,
    maxWidth: WORKBENCH_ASSISTANT_MESSAGE_MAX_WIDTH,
    flexShrink: 1,
  },
}));
