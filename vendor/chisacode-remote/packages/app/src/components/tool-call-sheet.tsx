import React, { createContext, useContext, useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  BottomSheetScrollView,
  BottomSheetBackdrop,
  BottomSheetBackgroundProps,
} from "@gorhom/bottom-sheet";
import { X } from "lucide-react-native";
import type { ToolCallDetail } from "@chisacode/protocol/agent-types";
import {
  IsolatedBottomSheetModal,
  useIsolatedBottomSheetVisibility,
} from "@/components/ui/isolated-bottom-sheet-modal";
import type { ToolCallIconComponent } from "@/utils/tool-call-icon";
import type { Theme } from "@/styles/theme";
import { ToolCallDetailsContent } from "./tool-call-details";

// ----- Types -----

export interface ToolCallSheetData {
  displayName: string;
  summary?: string;
  detail?: ToolCallDetail;
  errorText?: string;
  icon: ToolCallIconComponent;
  showLoadingSkeleton?: boolean;
}

interface ToolCallSheetContextValue {
  openToolCall: (data: ToolCallSheetData) => void;
  closeToolCall: () => void;
}

// ----- Context -----

const ToolCallSheetContext = createContext<ToolCallSheetContextValue | null>(null);

export function useToolCallSheet(): ToolCallSheetContextValue {
  const context = useContext(ToolCallSheetContext);
  if (!context) {
    throw new Error("useToolCallSheet must be used within a ToolCallSheetProvider");
  }
  return context;
}

const ThemedX = withUnistyles(X);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

// ----- Custom Background Component -----

function CustomSheetBackground({ style }: BottomSheetBackgroundProps) {
  // Theme-reactive surface lives in StyleSheet.create (styles.sheetBackground);
  // layer incoming `style` first to preserve the original [style, themed] order.
  const containerStyle = useMemo(() => [style, styles.sheetBackground], [style]);
  return <View pointerEvents="none" style={containerStyle} />;
}

// ----- Provider Component -----

interface ToolCallSheetProviderProps {
  children: ReactNode;
}

export function ToolCallSheetProvider({ children }: ToolCallSheetProviderProps) {
  const [sheetData, setSheetData] = React.useState<ToolCallSheetData | null>(null);
  const [isSheetOpen, setIsSheetOpen] = React.useState(false);

  const snapPoints = useMemo(() => ["60%", "95%"], []);

  const openToolCall = useCallback((data: ToolCallSheetData) => {
    setSheetData(data);
    setIsSheetOpen(true);
  }, []);

  const closeToolCall = useCallback(() => {
    setIsSheetOpen(false);
  }, []);

  const {
    sheetRef: bottomSheetRef,
    handleSheetChange,
    handleSheetDismiss,
  } = useIsolatedBottomSheetVisibility({
    visible: isSheetOpen,
    onClose: closeToolCall,
  });

  const handleToolCallSheetDismiss = useCallback(() => {
    handleSheetDismiss();
    setSheetData(null);
  }, [handleSheetDismiss]);

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.28} />
    ),
    [],
  );

  const contextValue = useMemo(
    () => ({ openToolCall, closeToolCall }),
    [openToolCall, closeToolCall],
  );

  return (
    <ToolCallSheetContext.Provider value={contextValue}>
      {children}
      <IsolatedBottomSheetModal
        ref={bottomSheetRef}
        snapPoints={snapPoints}
        index={0}
        enableDynamicSizing={false}
        onChange={handleSheetChange}
        onDismiss={handleToolCallSheetDismiss}
        backdropComponent={renderBackdrop}
        enablePanDownToClose
        backgroundComponent={CustomSheetBackground}
        handleIndicatorStyle={styles.sheetHandleIndicator}
      >
        {sheetData && <ToolCallSheetContent data={sheetData} onClose={closeToolCall} />}
      </IsolatedBottomSheetModal>
    </ToolCallSheetContext.Provider>
  );
}

// ----- Sheet Content Component -----

interface ToolCallSheetContentProps {
  data: ToolCallSheetData;
  onClose: () => void;
}

function ToolCallSheetContent({ data, onClose }: ToolCallSheetContentProps) {
  const { displayName, detail, errorText, icon: IconComponent, showLoadingSkeleton } = data;
  const ThemedIcon = useMemo(() => withUnistyles(IconComponent), [IconComponent]);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <ThemedIcon size={20} uniProps={foregroundColorMapping} />
          <Text style={styles.headerTitle} numberOfLines={1}>
            {displayName}
          </Text>
        </View>
        <Pressable onPress={onClose} style={styles.closeButton}>
          <ThemedX size={20} uniProps={foregroundMutedColorMapping} />
        </Pressable>
      </View>

      {/* Content */}
      <BottomSheetScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        <ToolCallDetailsContent
          detail={detail}
          errorText={errorText}
          fillAvailableHeight
          showLoadingSkeleton={showLoadingSkeleton}
        />
      </BottomSheetScrollView>
    </View>
  );
}

// ----- Styles -----

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderBottomWidth: theme.borderWidth[1],
    // Soft sheet header: quiet border-soft rule.
    borderBottomColor: theme.colors.secondary,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flex: 1,
  },
  // Soft tool sheet title: near .topbar title scale.
  headerTitle: {
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
    flex: 1,
  },
  closeButton: {
    padding: theme.spacing[2],
  },
  content: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  contentContainer: {
    padding: 0,
    flexGrow: 1,
  },
  // Soft sheet surface: composer-family r18.
  sheetBackground: {
    backgroundColor: theme.colors.surface0,
    borderRadius: 18,
  },
  sheetHandleIndicator: {
    backgroundColor: theme.colors.foregroundFaint,
  },
}));
