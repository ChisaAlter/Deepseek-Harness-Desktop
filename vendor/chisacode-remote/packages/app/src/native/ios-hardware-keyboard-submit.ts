type HardwareKeyboardSubmitHandler = () => void;

interface RemovableEventSubscription {
  remove(): void;
}

export function setHardwareKeyboardSubmitEnabled(_enabled: boolean) {}

export function addHardwareKeyboardSubmitListener(
  _handler: HardwareKeyboardSubmitHandler,
): RemovableEventSubscription {
  return {
    remove: () => {},
  };
}
