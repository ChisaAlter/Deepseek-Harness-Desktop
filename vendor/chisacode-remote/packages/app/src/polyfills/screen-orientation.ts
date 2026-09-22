import { isWeb } from "@/constants/platform";

export function polyfillScreenOrientation() {
  if (
    !isWeb ||
    typeof window === "undefined" ||
    typeof screen === "undefined" ||
    screen.orientation
  ) {
    return;
  }

  Object.defineProperty(screen, "orientation", {
    value: {
      get type() {
        return window.innerWidth > window.innerHeight ? "landscape-primary" : "portrait-primary";
      },
      get angle() {
        return 0;
      },
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return true;
      },
    },
    configurable: true,
  });
}
