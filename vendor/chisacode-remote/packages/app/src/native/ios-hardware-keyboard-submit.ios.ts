import { requireNativeModule } from "expo";

type HardwareKeyboardSubmitHandler = () => void;

interface RemovableEventSubscription {
  remove(): void;
}

interface ChisaCodeHardwareKeyboardModule {
  setHardwareKeyboardSubmitEnabled(enabled: boolean): void;
  addListener(
    eventName: "onHardwareKeyboardSubmit",
    handler: HardwareKeyboardSubmitHandler,
  ): RemovableEventSubscription;
}

const module = requireNativeModule<ChisaCodeHardwareKeyboardModule>("ChisaCodeHardwareKeyboard");

export function setHardwareKeyboardSubmitEnabled(enabled: boolean) {
  module.setHardwareKeyboardSubmitEnabled(enabled);
}

export function addHardwareKeyboardSubmitListener(handler: HardwareKeyboardSubmitHandler) {
  return module.addListener("onHardwareKeyboardSubmit", handler);
}
