import { genUiRegistry } from "@/generative-ui/registry/registry";

export type GenerativeUiActionSender = (
  instanceId: string,
  action: string,
  payload: unknown,
) => Promise<boolean>;

interface DispatchValidatedActionOptions {
  componentId: string;
  instanceId: string;
  action: string;
  payload: unknown;
  sender: GenerativeUiActionSender;
}

/** Validates an action against the rendered component before invoking its sender. */
export async function dispatchValidatedAction({
  componentId,
  instanceId,
  action,
  payload,
  sender,
}: DispatchValidatedActionOptions): Promise<boolean> {
  try {
    genUiRegistry.validateActionPayload(componentId, action, payload);
    return await sender(instanceId, action, payload);
  } catch {
    return false;
  }
}
