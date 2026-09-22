import type { QueryClient } from "@tanstack/react-query";
import type { CheckoutStatusResponse, CheckoutStatusUpdate } from "@chisacode/protocol/messages";
import { checkoutStatusQueryKey, normalizeCheckoutCwd } from "@/git/query-keys";

export type CheckoutStatusPayload = CheckoutStatusResponse["payload"];

export interface CheckoutStatusClient {
  getCheckoutStatus: (cwd: string) => Promise<CheckoutStatusPayload>;
}

export async function peekOrFetchCheckoutStatus({
  queryClient,
  client,
  serverId,
  cwd,
}: {
  queryClient: QueryClient;
  client: CheckoutStatusClient;
  serverId: string;
  cwd: string;
}): Promise<CheckoutStatusPayload> {
  const normalizedCwd = normalizeCheckoutCwd(cwd);
  const queryKey = checkoutStatusQueryKey(serverId, normalizedCwd);
  const cached = queryClient.getQueryData<CheckoutStatusPayload>(queryKey);
  if (cached) {
    return cached;
  }

  const snapshot = await client.getCheckoutStatus(cwd);
  queryClient.setQueryData(queryKey, snapshot);
  return snapshot;
}

export function applyCheckoutStatusUpdate({
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
  const normalizedCwd = normalizeCheckoutCwd(cwd);
  if (normalizeCheckoutCwd(message.payload.cwd) !== normalizedCwd) {
    return;
  }
  queryClient.setQueryData(checkoutStatusQueryKey(serverId, normalizedCwd), message.payload);
}
