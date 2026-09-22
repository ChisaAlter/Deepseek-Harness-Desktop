/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useCheckoutStatusQuery } from "@/git/use-status-query";

const hostRuntime = vi.hoisted(() => ({
  client: null as null | {
    getCheckoutStatus: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  },
  isConnected: true,
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => hostRuntime.client,
  useHostRuntimeIsConnected: () => hostRuntime.isConnected,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function createClient() {
  return {
    getCheckoutStatus: vi.fn(async () => ({
      isGit: true,
      cwd: "/repo",
      currentBranch: "main",
      isDirty: false,
    })),
    on: vi.fn(() => () => undefined),
  };
}

describe("useCheckoutStatusQuery", () => {
  it("does not fetch or subscribe when disabled", () => {
    const client = createClient();
    hostRuntime.client = client;
    hostRuntime.isConnected = true;

    const { result } = renderHook(
      () => useCheckoutStatusQuery({ serverId: "local", cwd: "/repo", enabled: false }),
      { wrapper: createWrapper() },
    );

    expect(result.current.status).toBeNull();
    expect(client.getCheckoutStatus).not.toHaveBeenCalled();
    expect(client.on).not.toHaveBeenCalled();
  });

  it("fetches and subscribes when enabled", async () => {
    const client = createClient();
    hostRuntime.client = client;
    hostRuntime.isConnected = true;

    const { result } = renderHook(
      () => useCheckoutStatusQuery({ serverId: "local", cwd: "/repo", enabled: true }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.status?.isGit).toBe(true));
    expect(client.getCheckoutStatus).toHaveBeenCalledExactlyOnceWith("/repo");
    expect(client.on).toHaveBeenCalledExactlyOnceWith(
      "checkout_status_update",
      expect.any(Function),
    );
  });
});
