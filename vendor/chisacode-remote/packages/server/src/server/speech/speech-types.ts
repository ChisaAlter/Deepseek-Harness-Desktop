import { z } from "zod/v3";

export const SpeechProviderIdSchema = z.enum(["openai", "local", "mimo"]);
export type SpeechProviderId = z.infer<typeof SpeechProviderIdSchema>;

export const RequestedSpeechProviderSchema = z.object({
  provider: SpeechProviderIdSchema,
  explicit: z.boolean(),
  enabled: z.boolean().optional(),
});
export type RequestedSpeechProvider = z.infer<typeof RequestedSpeechProviderSchema>;

export interface RequestedSpeechProviders {
  dictationStt: RequestedSpeechProvider;
  voiceTurnDetection: RequestedSpeechProvider;
  voiceStt: RequestedSpeechProvider;
  voiceTts: RequestedSpeechProvider;
}
