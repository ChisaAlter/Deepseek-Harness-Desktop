import { useEffect } from "react";
import { Platform } from "react-native";
import type { ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import {
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";

const DEFAULT_IOS_KEYBOARD_INSET_MIN_HEIGHT = 120;

function resolveKeyboardShift(input: {
  rawKeyboardHeight: number;
  bottomInset: number;
  isIos: boolean;
  iosMinHeight: number;
  enabled: boolean;
}): number {
  "worklet";

  if (!input.enabled) {
    return 0;
  }

  // iOS can report a small accessory/prediction bar height during touch focus.
  // Treat that as non-keyboard so layouts don't "bounce" while interacting.
  if (input.isIos && input.rawKeyboardHeight < input.iosMinHeight) {
    return 0;
  }

  return Math.max(0, input.rawKeyboardHeight - input.bottomInset);
}

type KeyboardShiftMode = "translate" | "padding";

export function useKeyboardShiftStyle(input: {
  mode: KeyboardShiftMode;
  enabled?: boolean;
  iosMinHeight?: number;
}): {
  shift: SharedValue<number>;
  style: ReturnType<typeof useAnimatedStyle<ViewStyle>>;
} {
  const insets = useSafeAreaInsets();
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const bottomInset = useSharedValue(insets.bottom);
  const enabled = input.enabled ?? true;
  const isIos = Platform.OS === "ios";
  const iosMinHeight = input.iosMinHeight ?? DEFAULT_IOS_KEYBOARD_INSET_MIN_HEIGHT;

  useEffect(() => {
    bottomInset.value = insets.bottom;
  }, [bottomInset, insets.bottom]);

  const shift = useDerivedValue(() => {
    "worklet";
    const rawKeyboardHeight = Math.abs(keyboardHeight.value);
    return resolveKeyboardShift({
      rawKeyboardHeight,
      bottomInset: bottomInset.value,
      isIos,
      iosMinHeight,
      enabled,
    });
  });

  const style = useAnimatedStyle<ViewStyle>(() => {
    "worklet";
    if (input.mode === "padding") {
      if (!enabled) {
        return { paddingBottom: 0 };
      }
      // Include safe-area bottom inset so content clears the home indicator even without a keyboard.
      return { paddingBottom: bottomInset.value + shift.value };
    }

    return { transform: [{ translateY: -shift.value }] };
  }, [input.mode]);

  return { shift, style };
}
