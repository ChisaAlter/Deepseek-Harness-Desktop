import { z } from "zod/v3";

/**
 * App → Server: User interaction callback for generative UI components.
 */
const GenerativeUiActionRequestPayloadShape = {
  requestId: z.string(),
  /** Target agent session */
  agentId: z.string(),
  /** Match against generative_ui timeline item instanceId */
  instanceId: z.string(),
  /** Action name as defined in the component's actions array */
  action: z.string(),
  /** Action-specific payload */
  payload: z.unknown(),
  /** Event timestamp (client-side) */
  timestamp: z.number(),
};

export const GenerativeUiActionRequestSchema = z.object({
  type: z.literal("generative_ui.action.request"),
  ...GenerativeUiActionRequestPayloadShape,
});

// COMPAT(generativeUiActionFlatRpc): added in v0.1.101; remove after 2027-01-11 once the client floor is >= v0.1.101.
export const LegacyGenerativeUiActionRequestSchema = z.object({
  type: z.literal("generative_ui.action"),
  ...GenerativeUiActionRequestPayloadShape,
});

/**
 * Server → App: Acknowledgement of received interaction.
 */
export const GenerativeUiActionResponseSchema = z.object({
  type: z.literal("generative_ui.action.response"),
  payload: z.object({
    requestId: z.string(),
    received: z.boolean(),
    error: z.string().nullable(),
  }),
});

/** Canonical generative UI action request sent by current clients. */
export type GenerativeUiActionRequest = z.infer<typeof GenerativeUiActionRequestSchema>;

/** Legacy flat generative UI action request accepted during the compatibility window. */
export type LegacyGenerativeUiActionRequest = z.infer<typeof LegacyGenerativeUiActionRequestSchema>;

/** Generative UI action acknowledgement returned for canonical and legacy requests. */
export type GenerativeUiActionResponse = z.infer<typeof GenerativeUiActionResponseSchema>;
