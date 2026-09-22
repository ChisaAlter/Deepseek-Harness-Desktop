import { describe, expect, it, vi } from "vitest";
import { submitPermissionResponse } from "./permission-response";

describe("submitPermissionResponse", () => {
  it("reports a failed response and restores the retry state", async () => {
    const error = {};
    const respond = vi.fn().mockRejectedValue(error);
    const presentError = vi.fn();
    const onFailure = vi.fn();
    const logError = vi.fn();

    const succeeded = await submitPermissionResponse({
      agentId: "agent-1",
      requestId: "permission-1",
      response: { behavior: "allow", selectedActionId: "accept" },
      respond,
      presentError,
      fallbackMessage: "Unable to respond to the permission request",
      onFailure,
      logger: { error: logError },
    });

    expect(succeeded).toBe(false);
    expect(respond).toHaveBeenCalledWith({
      agentId: "agent-1",
      requestId: "permission-1",
      response: { behavior: "allow", selectedActionId: "accept" },
    });
    expect(logError).toHaveBeenCalledWith(
      "[PermissionRequestCard] Failed to respond to permission",
      error,
    );
    expect(presentError).toHaveBeenCalledWith("Unable to respond to the permission request");
    expect(onFailure).toHaveBeenCalledOnce();
  });
});
