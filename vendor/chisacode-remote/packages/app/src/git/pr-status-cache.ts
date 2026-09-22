import type { CheckoutPrStatusResponse, CheckoutStatusUpdate } from "@chisacode/protocol/messages";
import type { QueryClient } from "@tanstack/react-query";
import { checkoutPrStatusQueryKey, normalizeCheckoutCwd } from "@/git/query-keys";

export type CheckoutPrStatusPayload = CheckoutPrStatusResponse["payload"];

export function applyCheckoutPrStatusUpdate({
  queryClient,
  serverId,
  cwd,
  message,
}: {
  queryClient: QueryClient;
  serverId: string;
  cwd: string;
  message: CheckoutStatusUpdate;
}): void {
  const prStatus = message.payload.prStatus;
  if (!prStatus || normalizeCheckoutCwd(prStatus.cwd) !== normalizeCheckoutCwd(cwd)) {
    return;
  }
  queryClient.setQueryData(checkoutPrStatusQueryKey(serverId, cwd), prStatus);
}
