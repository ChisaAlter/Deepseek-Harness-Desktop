import { describe, expect, test } from "vitest";

import { AgentAttachmentSchema as LegacyAgentAttachmentSchema } from "../messages.js";
import { AgentAttachmentSchema, AgentAttachmentsSchema } from "./attachments.js";

describe("agent attachment domain", () => {
  test("keeps the legacy messages export wired to the domain schema", () => {
    expect(LegacyAgentAttachmentSchema).toBe(AgentAttachmentSchema);
  });

  test("filters malformed legacy attachment entries without rejecting valid entries", () => {
    expect(
      AgentAttachmentsSchema.parse([
        {
          type: "text",
          mimeType: "text/plain",
          title: "Context",
          text: "Keep this",
        },
        { type: "text", mimeType: "text/plain" },
        { type: "unknown", value: "drop this" },
      ]),
    ).toEqual([
      {
        type: "text",
        mimeType: "text/plain",
        title: "Context",
        text: "Keep this",
      },
    ]);
  });
});
