import { describe, expect, test } from "vitest";

import type { DaemonCommandTransport } from "./daemon-client-command-transport.js";
import { ProviderCommandClient } from "./daemon-client-provider-commands.js";

describe("ProviderCommandClient", () => {
  test("maps bounded diagnostics options to the correlated transport", async () => {
    const requests: Array<Parameters<DaemonCommandTransport["request"]>[0]> = [];
    const client = new ProviderCommandClient({
      request: async (params) => {
        requests.push(params);
        return {} as never;
      },
    });

    await client.getDiagnostics({
      includeLogs: true,
      maxLogLines: 80,
      requestId: "diagnostics-1",
    });

    expect(requests).toEqual([
      {
        requestId: "diagnostics-1",
        message: {
          type: "diagnostics.request",
          includeLogs: true,
          maxLogLines: 80,
        },
        responseType: "diagnostics.response",
        timeout: 30000,
      },
    ]);
  });

  test("maps provider snapshot commands with scope, filters, and bounded timeouts", async () => {
    const requests: Array<Parameters<DaemonCommandTransport["request"]>[0]> = [];
    const client = new ProviderCommandClient({
      request: async (params) => {
        requests.push(params);
        return {} as never;
      },
    });

    await client.listProviderModels("pi", { cwd: "~/project", requestId: "models-1" });
    await client.listProviderModes("pi", { cwd: "~/project", requestId: "modes-1" });
    await client.listProviderFeatures(
      {
        provider: "pi",
        cwd: "/workspace/project",
        model: "openai/gpt-5",
      },
      { requestId: "features-1" },
    );
    await client.listAvailableProviders({ requestId: "available-1" });
    await client.getProvidersSnapshot({ cwd: "~/project", requestId: "snapshot-1" });
    await client.refreshProvidersSnapshot({
      cwd: "~/project",
      providers: ["pi"],
      requestId: "refresh-1",
    });

    expect(requests).toEqual([
      {
        requestId: "models-1",
        message: { type: "list_provider_models_request", provider: "pi", cwd: "~/project" },
        responseType: "list_provider_models_response",
        timeout: 45000,
      },
      {
        requestId: "modes-1",
        message: { type: "list_provider_modes_request", provider: "pi", cwd: "~/project" },
        responseType: "list_provider_modes_response",
        timeout: 45000,
      },
      {
        requestId: "features-1",
        message: {
          type: "list_provider_features_request",
          draftConfig: { provider: "pi", cwd: "/workspace/project", model: "openai/gpt-5" },
        },
        responseType: "list_provider_features_response",
        timeout: 45000,
      },
      {
        requestId: "available-1",
        message: { type: "list_available_providers_request" },
        responseType: "list_available_providers_response",
        timeout: 30000,
      },
      {
        requestId: "snapshot-1",
        message: { type: "get_providers_snapshot_request", cwd: "~/project" },
        responseType: "get_providers_snapshot_response",
        timeout: 10000,
      },
      {
        requestId: "refresh-1",
        message: {
          type: "refresh_providers_snapshot_request",
          cwd: "~/project",
          providers: ["pi"],
        },
        responseType: "refresh_providers_snapshot_response",
        timeout: 60000,
      },
    ]);
  });

  test("maps provider diagnostic correlation and propagates transport rejection", async () => {
    const expectedError = new Error("daemon disconnected");
    const requests: Array<Parameters<DaemonCommandTransport["request"]>[0]> = [];
    const client = new ProviderCommandClient({
      request: async (params) => {
        requests.push(params);
        throw expectedError;
      },
    });

    await expect(client.getProviderDiagnostic("pi", { requestId: "diagnostic-1" })).rejects.toBe(
      expectedError,
    );
    expect(requests).toEqual([
      {
        requestId: "diagnostic-1",
        message: { type: "provider_diagnostic_request", provider: "pi" },
        responseType: "provider_diagnostic_response",
        timeout: 30000,
      },
    ]);
  });

  test("keeps provider tooling transport alive beyond the complete server budget", async () => {
    const requests: Array<Parameters<DaemonCommandTransport["request"]>[0]> = [];
    const client = new ProviderCommandClient({
      request: async (params) => {
        requests.push(params);
        return {} as never;
      },
    });
    const toolingCommandBudgetMs = 120_000;
    const availabilityRefreshBudgetMs = 30_000;
    const modelsAndModesRefreshBudgetMs = 30_000;
    const versionMetadataRefreshBudgetMs = 8_000;
    const responseDeliveryGraceMs = 10_000;

    await client.runProviderToolingAction("codex", "update", {
      requestId: "provider-tooling-1",
    });

    expect(requests).toEqual([
      {
        requestId: "provider-tooling-1",
        message: {
          type: "provider.tooling.run.request",
          provider: "codex",
          action: "update",
        },
        responseType: "provider.tooling.run.response",
        timeout:
          toolingCommandBudgetMs +
          availabilityRefreshBudgetMs +
          modelsAndModesRefreshBudgetMs +
          versionMetadataRefreshBudgetMs +
          responseDeliveryGraceMs,
      },
    ]);
  });

  test("maps model gateway connectivity tests with the intended upstream format", async () => {
    const requests: Array<Parameters<DaemonCommandTransport["request"]>[0]> = [];
    const client = new ProviderCommandClient({
      request: async (params) => {
        requests.push(params);
        return {} as never;
      },
    });

    await client.runModelGatewayTest({
      gatewayId: "zai",
      modelId: "glm-5",
      targetFormat: "chatCompletions",
      requestId: "gateway-test-1",
    });

    expect(requests).toEqual([
      {
        requestId: "gateway-test-1",
        message: {
          type: "model_gateway.test.request",
          gatewayId: "zai",
          modelId: "glm-5",
          targetFormat: "chatCompletions",
        },
        responseType: "model_gateway.test.response",
        timeout: 30000,
      },
    ]);
  });
});
