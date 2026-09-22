import { isWeb } from "@/constants/platform";

/**
 * Soft Home optical top inset from window height.
 * Compact uses a tighter band so hero + pen-bar stay on one phone screen.
 * @param windowHeight Measured window height in px
 * @param compact Whether the compact Soft Home layout is active
 * @returns Top padding in px
 */
export function resolveSoftHomeTopInset(windowHeight: number, compact: boolean): number {
  if (compact) {
    return Math.min(72, Math.max(24, Math.round(windowHeight * 0.08)));
  }
  return Math.min(180, Math.max(56, Math.round(windowHeight * 0.18)));
}

/** Soft docked pen-bar elevation props (web CSS shadow or native elevation). */
export interface SoftComposerCardElevation {
  boxShadow?: string;
  shadowColor?: string;
  shadowOffset?: { width: number; height: number };
  shadowOpacity?: number;
  shadowRadius?: number;
  elevation?: number;
}

/**
 * Soft docked pen-bar elevation shared by Soft Home and the session composer.
 * Web keeps CSS box-shadow; native uses RN shadow + Android elevation.
 * @returns Style props for the floating composer card shell
 */
export function resolveSoftComposerCardElevation(): SoftComposerCardElevation {
  if (isWeb) {
    return {
      // Soft docked pen-bar: multi-layer ambient veil (matches --shadow-soft family).
      // Avoid hard contact-only stacks — they read as square corners under light borders.
      boxShadow:
        "0 1px 0 rgba(20, 23, 31, 0.04), 0 6px 16px rgba(20, 23, 31, 0.06), 0 14px 36px rgba(20, 23, 31, 0.05)",
    };
  }
  return {
    shadowColor: "rgba(20, 23, 31, 1)",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 14,
    elevation: 4,
  };
}
