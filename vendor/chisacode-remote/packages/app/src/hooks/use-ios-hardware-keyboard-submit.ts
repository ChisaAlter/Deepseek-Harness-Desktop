import { useEffect, useRef } from "react";
import {
  addHardwareKeyboardSubmitListener,
  setHardwareKeyboardSubmitEnabled,
} from "@/native/ios-hardware-keyboard-submit";
import {
  createHardwareKeyboardSubmitController,
  type HardwareKeyboardSubmitController,
} from "./hardware-keyboard-submit-controller";

interface UseIosHardwareKeyboardSubmitInput {
  isEnabled: boolean;
  onSubmit: () => void;
}

export function useIosHardwareKeyboardSubmit(input: UseIosHardwareKeyboardSubmitInput) {
  const controllerRef = useRef<HardwareKeyboardSubmitController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createHardwareKeyboardSubmitController({
      addListener: addHardwareKeyboardSubmitListener,
      setEnabled: setHardwareKeyboardSubmitEnabled,
    });
  }
  const controller = controllerRef.current;

  // Keep the controller's onSubmit callback fresh via an effect rather than
  // mutating during render (render-phase side effects break purity and can
  // dispatch the previous handler in Strict Mode's double render).
  useEffect(() => {
    controller.setOnSubmit(input.onSubmit);
  }, [controller, input.onSubmit]);

  useEffect(() => {
    if (!input.isEnabled) {
      return;
    }
    controller.enable();
    return () => controller.disable();
  }, [controller, input.isEnabled]);
}
