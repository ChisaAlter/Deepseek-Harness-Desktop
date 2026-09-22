import type { z } from "zod/v3";

export type GenerativeUiComponentCategory = "chart" | "table" | "form" | "map" | "media" | "layout";

export type Platform = "web" | "ios" | "android";

export interface GenerativeUiComponentAction {
  name: string;
  payloadSchema: z.ZodType;
  description: string;
}

export interface GenerativeUiComponentBaseProps {
  instanceId: string;
  props: Record<string, unknown>;
  sendAction: (instanceId: string, action: string, payload: unknown) => Promise<boolean>;
}

export interface GenerativeUiComponentEntry<
  Props extends Record<string, unknown> = Record<string, unknown>,
> {
  component: React.ComponentType<GenerativeUiComponentBaseProps & Props>;
  propsSchema: z.ZodType<Props>;
  defaultProps?: Partial<Props>;
  category: GenerativeUiComponentCategory;
  platforms?: Platform[];
  icon?: string;
  description: string;
  actions?: GenerativeUiComponentAction[];
}
