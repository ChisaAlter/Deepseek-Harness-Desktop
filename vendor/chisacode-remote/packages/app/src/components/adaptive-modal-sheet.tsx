import { forwardRef, useCallback, useEffect, useMemo } from "react";
import type { ReactNode, Ref } from "react";
import { createPortal } from "react-dom";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { TextInputProps } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { useIsCompactFormFactor } from "@/constants/layout";
import { getOverlayRoot, OVERLAY_Z } from "../lib/overlay-root";
import {
  BottomSheetBackdrop,
  BottomSheetScrollView,
  BottomSheetTextInput,
  type BottomSheetBackgroundProps,
} from "@gorhom/bottom-sheet";
import { ArrowLeft, Search, X } from "lucide-react-native";
import { FileDropZone } from "@/components/file-drop-zone";
import type { ImageAttachment } from "@/composer/types";
import {
  IsolatedBottomSheetModal,
  useIsolatedBottomSheetVisibility,
} from "@/components/ui/isolated-bottom-sheet-modal";
import { GlassSurface } from "@/components/ui/glass-surface";
import { isNative, isWeb } from "@/constants/platform";
import { useTranslation } from "react-i18next";

// Horizontal indent token shared by the sheet header (title, back arrow,
// leading icon, search input icon) and any row primitive rendered inside the
// sheet body. Rows whose leading icon should line up with the header must
// match this padding.
export const SHEET_HORIZONTAL_PADDING_SCALE = 6;

export interface SheetHeaderSearch {
  onChange: (value: string) => void;
  resetKey?: string | number;
  placeholder?: string;
  autoFocus?: boolean;
  testID?: string;
}

export interface SheetHeaderBack {
  onPress: () => void;
  label?: string;
  accessibilityLabel?: string;
}

export interface SheetHeader {
  title: string;
  subtitle?: ReactNode;
  back?: SheetHeaderBack;
  leading?: ReactNode;
  actions?: ReactNode;
  search?: SheetHeaderSearch;
}

type EscHandler = () => void;
const escStack: EscHandler[] = [];
let escListenerAttached = false;
const ABSOLUTE_FILL_STYLE = { ...StyleSheet.absoluteFillObject };

function handleEscKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  const top = escStack[escStack.length - 1];
  if (!top) return;
  event.stopPropagation();
  event.preventDefault();
  top();
}

function pushEscHandler(handler: EscHandler): () => void {
  escStack.push(handler);
  if (!escListenerAttached && typeof window !== "undefined") {
    window.addEventListener("keydown", handleEscKeyDown, true);
    escListenerAttached = true;
  }
  return () => {
    const index = escStack.lastIndexOf(handler);
    if (index !== -1) escStack.splice(index, 1);
    if (escStack.length === 0 && escListenerAttached && typeof window !== "undefined") {
      window.removeEventListener("keydown", handleEscKeyDown, true);
      escListenerAttached = false;
    }
  };
}

const styles = StyleSheet.create((theme) => ({
  desktopOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(20, 23, 31, 0.28)",
    justifyContent: "center",
    alignItems: "center",
    padding: theme.spacing[6],
    zIndex: OVERLAY_Z.modal,
    pointerEvents: "auto" as const,
  },
  // Soft floating modal card: composer-family r18.
  desktopCard: {
    width: "100%",
    maxWidth: 520,
    maxHeight: "85%",
    flexShrink: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow.md,
  },
  desktopGlassCard: {
    backgroundColor: theme.glass.enabled ? "transparent" : theme.colors.surface0,
    borderWidth: theme.glass.enabled ? 1 : 0,
    borderColor: theme.glass.border,
  },
  desktopPlainCard: {
    backgroundColor: theme.colors.surface0,
  },
  headerContainer: {
    // Soft sheet header: quiet border-soft rule.
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.secondary,
  },
  headerRow: {
    paddingHorizontal: theme.spacing[SHEET_HORIZONTAL_PADDING_SCALE],
    paddingVertical: theme.spacing[4],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  headerBackButton: {
    borderRadius: 10,
  },
  headerLeadingSlot: {
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitleGroup: {
    flex: 1,
    gap: theme.spacing[1],
    minWidth: 0,
  },
  // Soft sheet title: near .topbar title scale.
  title: {
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: theme.fontWeight.medium,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  closeButton: {
    padding: theme.spacing[2],
    borderRadius: 10,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[SHEET_HORIZONTAL_PADDING_SCALE],
    paddingBottom: theme.spacing[3],
  },
  // Inline variants for InlineHeaderView inside the desktop Combobox popover.
  // Horizontal padding matches the model picker's row indent: the picker uses
  // children mode (desktopChildrenScrollContent, no scroll padding), so the
  // row content starts at item.paddingHorizontal = spacing[3].
  inlineHeaderRow: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  inlineSearchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    // Soft quiet chrome rule (--border-soft).
    borderBottomColor: theme.colors.secondary,
  },
  inlineTitle: {
    flex: 1,
    // Soft sheet secondary: 12.5 meta.
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  searchInput: {
    flex: 1,
    paddingVertical: theme.spacing[2],
    color: theme.colors.foreground,
    // Soft sheet secondary: 12.5 meta.
    fontSize: 12.5,
    lineHeight: 18,
  },
  desktopScroll: {
    flexShrink: 1,
    minHeight: 0,
  },
  desktopContent: {
    padding: theme.spacing[SHEET_HORIZONTAL_PADDING_SCALE],
    gap: theme.spacing[4],
    flexGrow: 1,
  },
  bottomSheetContent: {
    padding: theme.spacing[SHEET_HORIZONTAL_PADDING_SCALE],
    gap: theme.spacing[4],
  },
  bottomSheetStaticContent: {
    flex: 1,
    padding: theme.spacing[SHEET_HORIZONTAL_PADDING_SCALE],
    gap: theme.spacing[4],
    minHeight: 0,
  },
  desktopStaticContent: {
    flexShrink: 1,
    minHeight: 0,
    padding: theme.spacing[SHEET_HORIZONTAL_PADDING_SCALE],
    gap: theme.spacing[4],
  },
  footer: {
    paddingHorizontal: theme.spacing[SHEET_HORIZONTAL_PADDING_SCALE],
    paddingVertical: theme.spacing[3],
    borderTopWidth: 1,
    // Soft quiet chrome rule (--border-soft).
    borderTopColor: theme.colors.secondary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  adaptiveInputOutline: {
    outlineColor: theme.colors.accent,
  },
  adaptiveInputText: {
    color: theme.colors.foreground,
  },
  adaptiveInputPlaceholder: {
    color: theme.colors.foregroundMuted,
  },
  // SheetBackground: theme-reactive surface + top radii (moved out of useUnistyles).
  sheetBackground: {
    backgroundColor: theme.colors.surface0,
    borderTopLeftRadius: theme.borderRadius.xl,
    borderTopRightRadius: theme.borderRadius.xl,
  },
  // SheetHeaderView title color (moved out of useUnistyles-driven titleStyle memo).
  headerTitle: {
    color: theme.colors.foreground,
  },
  // AdaptiveModalSheet bottom-sheet handle indicator color (moved out of useUnistyles).
  sheetHandleIndicator: {
    backgroundColor: theme.colors.foregroundFaint,
  },
}));

// Icon color/size mappings for withUnistyles-wrapped lucide icons. These keep
// theme-reactive icon props (color, size) off the useUnistyles() hook so only
// the leaf icon re-renders on theme change. See docs/unistyles.md "Wrap the
// icon with withUnistyles instead".
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const searchHeaderColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.md,
});
const searchInlineColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
});
type IconColorMapping = (theme: Theme) => { color: string; size?: number };

const ThemedArrowLeft = withUnistyles(ArrowLeft);
const ThemedX = withUnistyles(X);
const ThemedSearch = withUnistyles(Search);

const SEARCH_INPUT_STYLE = [styles.searchInput, isWeb && { outlineStyle: "none" }];

function SheetBackground({ style }: BottomSheetBackgroundProps) {
  // Theme-reactive surface + top radii live in the StyleSheet.create factory
  // (styles.sheetBackground); the incoming `style` prop is layered first to
  // preserve the original [style, { backgroundColor, borderTop*Radius }] order.
  const combinedStyle = useMemo(() => [style, styles.sheetBackground], [style]);
  return <View style={combinedStyle} />;
}

export type AdaptiveTextInputProps = TextInputProps & {
  initialValue?: string;
  resetKey?: string | number;
};

// React Native controlled TextInput can replay stale JS values during fast input
// and visibly flicker/cursor-jump. Keep the rendered text native-owned; callers
// can seed it once with initialValue and remount with resetKey for real resets.
// See https://github.com/facebook/react-native/issues/44157
//
// Text color and placeholder color are owned by this leaf — not the caller.
// `@gorhom/bottom-sheet` mounts header subtrees before the sheet is visible
// under whatever theme is active at mount time, then keeps them mounted across
// theme changes; any caller that paints color via `StyleSheet.create((theme) =>
// ...)` from outside this leaf ends up with stale colors in dark mode (see
// docs/unistyles.md "Hidden Sheet Content"). withUnistyles wraps the actual
// TextInput so theme-driven re-renders land on the wrapper.
const ThemedTextInput = withUnistyles(TextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));
const ThemedBottomSheetTextInput = withUnistyles(BottomSheetTextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));

export const AdaptiveTextInput = forwardRef<TextInput, AdaptiveTextInputProps>(
  function AdaptiveTextInputInner(props, ref) {
    const isMobile = useIsCompactFormFactor();
    const { value: _value, initialValue, resetKey, defaultValue, style, ...inputProps } = props;
    // Leaf-owned color goes LAST so callers cannot override it with a stale
    // theme read. Outline color is theme-aware on web :focus-visible.
    const textInputProps = {
      ...inputProps,
      defaultValue: initialValue ?? defaultValue,
      style: [styles.adaptiveInputOutline, style, styles.adaptiveInputText],
    };

    if (isMobile && isNative) {
      return (
        <ThemedBottomSheetTextInput
          key={resetKey}
          ref={ref as unknown as Ref<never>}
          {...textInputProps}
        />
      );
    }
    return <ThemedTextInput key={resetKey} ref={ref} {...textInputProps} />;
  },
);

export function SheetHeaderView({
  header,
  onClose,
  showCloseButton = true,
  testID,
}: {
  header: SheetHeader;
  onClose: () => void;
  showCloseButton?: boolean;
  testID?: string;
}) {
  const { t } = useTranslation();
  // Title color is theme-reactive via the StyleSheet.create factory; combined
  // with the static title typography from the same factory.
  const titleStyle = useMemo(() => [styles.title, styles.headerTitle], []);
  const back = header.back;
  const handleBackPress = back?.onPress;
  const search = header.search;
  const handleSearchChange = useCallback(
    (value: string) => {
      search?.onChange(value);
    },
    [search],
  );

  return (
    <View style={styles.headerContainer} testID={testID}>
      <View style={styles.headerRow}>
        {handleBackPress ? (
          <Pressable
            onPress={handleBackPress}
            hitSlop={8}
            style={styles.headerBackButton}
            accessibilityRole="button"
            accessibilityLabel={back?.accessibilityLabel ?? back?.label ?? "Back"}
            testID="sheet-header-back"
          >
            {({ pressed }) => (
              <ThemedArrowLeft
                size={18}
                uniProps={
                  (pressed
                    ? foregroundColorMapping
                    : foregroundMutedColorMapping) as IconColorMapping
                }
              />
            )}
          </Pressable>
        ) : null}
        {header.leading ? <View style={styles.headerLeadingSlot}>{header.leading}</View> : null}
        <View style={styles.headerTitleGroup}>
          <Text style={titleStyle} numberOfLines={1}>
            {header.title}
          </Text>
          {header.subtitle}
        </View>
        {header.actions ? <View style={styles.headerActions}>{header.actions}</View> : null}
        {showCloseButton ? (
          <Pressable
            accessibilityLabel={t("common.close")}
            style={styles.closeButton}
            onPress={onClose}
          >
            {({ pressed }) => (
              <ThemedX
                size={16}
                uniProps={
                  (pressed
                    ? foregroundColorMapping
                    : foregroundMutedColorMapping) as IconColorMapping
                }
              />
            )}
          </Pressable>
        ) : null}
      </View>
      {search ? (
        <View style={styles.searchRow}>
          <ThemedSearch uniProps={searchHeaderColorMapping} />
          <AdaptiveTextInput
            // @ts-expect-error - outlineStyle is web-only
            style={SEARCH_INPUT_STYLE}
            placeholder={search.placeholder ?? t("common.search")}
            resetKey={search.resetKey}
            onChangeText={handleSearchChange}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus={search.autoFocus}
            testID={search.testID}
          />
        </View>
      ) : null}
    </View>
  );
}

export function InlineHeaderView({ header }: { header: SheetHeader }) {
  const { t } = useTranslation();
  const back = header.back;
  const handleBackPress = back?.onPress;
  const hasInlineRow = Boolean(handleBackPress || header.leading || header.actions);
  if (!hasInlineRow && !header.search) return null;
  return (
    <View>
      {hasInlineRow ? (
        <View style={styles.inlineHeaderRow}>
          {handleBackPress ? (
            <Pressable
              onPress={handleBackPress}
              hitSlop={8}
              style={styles.headerBackButton}
              accessibilityRole="button"
              accessibilityLabel={back?.accessibilityLabel ?? back?.label ?? "Back"}
              testID="sheet-header-back"
            >
              {({ pressed }) => (
                <ThemedArrowLeft
                  size={16}
                  uniProps={
                    (pressed
                      ? foregroundColorMapping
                      : foregroundMutedColorMapping) as IconColorMapping
                  }
                />
              )}
            </Pressable>
          ) : null}
          {header.leading ? <View style={styles.headerLeadingSlot}>{header.leading}</View> : null}
          <Text style={styles.inlineTitle} numberOfLines={1}>
            {header.title}
          </Text>
          {header.actions ? <View style={styles.headerActions}>{header.actions}</View> : null}
        </View>
      ) : null}
      {header.search ? (
        <View style={styles.inlineSearchRow}>
          <ThemedSearch uniProps={searchInlineColorMapping} />
          <AdaptiveTextInput
            // @ts-expect-error - outlineStyle is web-only
            style={SEARCH_INPUT_STYLE}
            placeholder={header.search.placeholder ?? t("common.search")}
            resetKey={header.search.resetKey}
            onChangeText={header.search.onChange}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus={header.search.autoFocus}
            testID={header.search.testID}
          />
        </View>
      ) : null}
    </View>
  );
}

export interface AdaptiveModalSheetProps {
  header: SheetHeader;
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Sticky footer rendered below the scrollable content. */
  footer?: ReactNode;
  snapPoints?: string[];
  testID?: string;
  /** Override the max width of the desktop card. */
  desktopMaxWidth?: number;
  /** Desktop-only surface treatment. Focused task modals default to the plain themed surface. */
  desktopSurface?: "glass" | "plain";
  /** When provided, wraps the card content in a FileDropZone. */
  onFilesDropped?: (files: ImageAttachment[]) => void;
  scrollable?: boolean;
}

export function AdaptiveModalSheet({
  header,
  visible,
  onClose,
  children,
  footer,
  snapPoints,
  testID,
  desktopMaxWidth,
  desktopSurface = "plain",
  onFilesDropped,
  scrollable = true,
}: AdaptiveModalSheetProps) {
  const { t } = useTranslation();
  const isMobile = useIsCompactFormFactor();
  const resolvedSnapPoints = useMemo(() => snapPoints ?? ["65%", "90%"], [snapPoints]);
  // handleIndicatorStyle is a bottom-sheet library prop carrying a themed
  // style object; the theme-reactive color lives in the StyleSheet.create
  // factory (styles.sheetHandleIndicator) instead of a useUnistyles read.
  const { sheetRef, handleSheetChange, handleSheetDismiss } = useIsolatedBottomSheetVisibility({
    visible,
    isEnabled: isMobile,
    onClose,
  });

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.28} />
    ),
    [],
  );

  const desktopCardStyle = useMemo(
    () => [styles.desktopCard, desktopMaxWidth != null && { maxWidth: desktopMaxWidth }],
    [desktopMaxWidth],
  );
  const desktopPlainCardStyle = useMemo(
    () => [desktopCardStyle, styles.desktopPlainCard],
    [desktopCardStyle],
  );
  const desktopGlassCardStyle = useMemo(
    () => [desktopCardStyle, styles.desktopGlassCard],
    [desktopCardStyle],
  );

  useEffect(() => {
    if (!isWeb || isMobile || !visible) return;
    return pushEscHandler(onClose);
  }, [visible, isMobile, onClose]);

  if (isMobile) {
    return (
      <IsolatedBottomSheetModal
        ref={sheetRef}
        snapPoints={resolvedSnapPoints}
        index={0}
        enableDynamicSizing={false}
        onChange={handleSheetChange}
        onDismiss={handleSheetDismiss}
        backdropComponent={renderBackdrop}
        enablePanDownToClose
        backgroundComponent={SheetBackground}
        handleIndicatorStyle={styles.sheetHandleIndicator}
        keyboardBehavior="extend"
        keyboardBlurBehavior="restore"
        accessible={false}
      >
        <SheetHeaderView header={header} onClose={onClose} testID={testID} />
        {scrollable ? (
          <BottomSheetScrollView
            contentContainerStyle={styles.bottomSheetContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </BottomSheetScrollView>
        ) : (
          <View style={styles.bottomSheetStaticContent}>{children}</View>
        )}
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </IsolatedBottomSheetModal>
    );
  }

  const cardInner = (
    <>
      <SheetHeaderView header={header} onClose={onClose} />
      {scrollable ? (
        <ScrollView
          style={styles.desktopScroll}
          contentContainerStyle={styles.desktopContent}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={styles.desktopStaticContent}>{children}</View>
      )}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </>
  );

  const desktopCard =
    desktopSurface === "plain" ? (
      <View style={desktopPlainCardStyle}>
        {onFilesDropped ? (
          <FileDropZone onFilesDropped={onFilesDropped}>{cardInner}</FileDropZone>
        ) : (
          cardInner
        )}
      </View>
    ) : (
      <GlassSurface variant="sheet" style={desktopGlassCardStyle}>
        {onFilesDropped ? (
          <FileDropZone onFilesDropped={onFilesDropped}>{cardInner}</FileDropZone>
        ) : (
          cardInner
        )}
      </GlassSurface>
    );

  const desktopContent = (
    <View style={styles.desktopOverlay} testID={testID}>
      <Pressable
        accessibilityLabel={t("common.dismiss")}
        style={ABSOLUTE_FILL_STYLE}
        onPress={onClose}
      />
      {desktopCard}
    </View>
  );

  // On web, use portal to overlay root for consistent stacking with toasts
  if (isWeb && typeof document !== "undefined") {
    if (!visible) return null;
    return createPortal(desktopContent, getOverlayRoot());
  }

  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={onClose}
      hardwareAccelerated
    >
      {desktopContent}
    </Modal>
  );
}
