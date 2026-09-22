import { AppState } from "react-native";
import { isNative } from "@/constants/platform";

/**
 * Whether the app is in the foreground and actively visible to the user
 * @param appState React Native AppState value; defaults to the current state
 * @returns True when active, and on web when the document is visible and focused
 */
export function getIsAppActivelyVisible(appState: string = AppState.currentState): boolean {
  if (appState !== "active") {
    return false;
  }

  if (isNative) {
    return true;
  }

  const documentVisible = typeof document === "undefined" || document.visibilityState === "visible";
  const windowFocused =
    typeof document === "undefined" ||
    typeof document.hasFocus !== "function" ||
    document.hasFocus();

  return documentVisible && windowFocused;
}
