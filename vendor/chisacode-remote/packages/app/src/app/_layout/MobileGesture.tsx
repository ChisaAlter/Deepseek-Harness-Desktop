import { type ReactNode, useCallback, useMemo } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Extrapolation, interpolate, runOnJS, useSharedValue } from "react-native-reanimated";
import { isWeb } from "@/constants/platform";
import { useHorizontalScrollOptional } from "@/contexts/horizontal-scroll-context";
import { useSidebarAnimation } from "@/contexts/sidebar-animation-context";
import { usePanelStore } from "@/stores/panel-store";

export const MOBILE_WEB_EDGE_SWIPE_WIDTH = 32;
export const MOBILE_WEB_GESTURE_TOUCH_ACTION = isWeb ? "auto" : "pan-y";

export function MobileGestureWrapper({
  children,
  chromeEnabled,
}: {
  children: ReactNode;
  chromeEnabled: boolean;
}) {
  const mobileView = usePanelStore((state) => state.mobileView);
  const showMobileAgentList = usePanelStore((state) => state.showMobileAgentList);
  const horizontalScroll = useHorizontalScrollOptional();
  const {
    translateX,
    backdropOpacity,
    windowWidth,
    animateToOpen,
    animateToClose,
    isGesturing,
    gestureAnimatingRef,
    openGestureRef,
  } = useSidebarAnimation();
  const touchStartX = useSharedValue(0);
  const touchStartY = useSharedValue(0);
  const openGestureEnabled = chromeEnabled && mobileView === "agent";

  const handleGestureOpen = useCallback(() => {
    gestureAnimatingRef.current = true;
    showMobileAgentList();
  }, [showMobileAgentList, gestureAnimatingRef]);

  const openGesture = useMemo(
    () =>
      Gesture.Pan()
        .withRef(openGestureRef)
        .enabled(openGestureEnabled)
        .manualActivation(true)
        .failOffsetY([-10, 10])
        .onTouchesDown((event) => {
          const touch = event.changedTouches[0];
          if (touch) {
            touchStartX.value = touch.absoluteX;
            touchStartY.value = touch.absoluteY;
          }
        })
        .onTouchesMove((event, stateManager) => {
          const touch = event.changedTouches[0];
          if (!touch || event.numberOfTouches !== 1) return;

          const deltaX = touch.absoluteX - touchStartX.value;
          const deltaY = touch.absoluteY - touchStartY.value;
          const absDeltaX = Math.abs(deltaX);
          const absDeltaY = Math.abs(deltaY);

          if (horizontalScroll?.isAnyScrolledRight.value) {
            stateManager.fail();
            return;
          }

          if (isWeb && touchStartX.value > MOBILE_WEB_EDGE_SWIPE_WIDTH) {
            stateManager.fail();
            return;
          }

          if (deltaX <= -10) {
            stateManager.fail();
            return;
          }

          if (absDeltaY > 10 && absDeltaY > absDeltaX) {
            stateManager.fail();
            return;
          }

          if (deltaX > 15 && absDeltaX > absDeltaY) {
            stateManager.activate();
          }
        })
        .onStart(() => {
          isGesturing.value = true;
        })
        .onUpdate((event) => {
          const newTranslateX = Math.min(0, -windowWidth + event.translationX);
          translateX.value = newTranslateX;
          backdropOpacity.value = interpolate(
            newTranslateX,
            [-windowWidth, 0],
            [0, 1],
            Extrapolation.CLAMP,
          );
        })
        .onEnd((event) => {
          isGesturing.value = false;
          const shouldOpen = event.translationX > windowWidth / 3 || event.velocityX > 500;
          if (shouldOpen) {
            animateToOpen();
            runOnJS(handleGestureOpen)();
          } else {
            animateToClose();
          }
        })
        .onFinalize(() => {
          isGesturing.value = false;
        }),
    [
      openGestureEnabled,
      windowWidth,
      translateX,
      backdropOpacity,
      animateToOpen,
      animateToClose,
      handleGestureOpen,
      isGesturing,
      openGestureRef,
      horizontalScroll?.isAnyScrolledRight,
      touchStartX,
      touchStartY,
    ],
  );

  return (
    <GestureDetector gesture={openGesture} touchAction={MOBILE_WEB_GESTURE_TOUCH_ACTION}>
      {children}
    </GestureDetector>
  );
}
