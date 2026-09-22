import type { CommandError } from "../output/index.js";
import { tCli } from "../i18n.js";

export interface ResolveProviderAndModelOptions {
  provider?: string;
  model?: string;
  defaultProvider?: string;
}

export interface ResolvedProviderModel {
  provider: string;
  model: string | undefined;
}

export function resolveProviderAndModel(
  options: ResolveProviderAndModelOptions,
): ResolvedProviderModel {
  const providerInput = options.provider?.trim() || options.defaultProvider;
  const modelInput = options.model?.trim();

  if (!providerInput) {
    const error: CommandError = {
      code: "MISSING_PROVIDER",
      message: tCli("providerModel.missingProvider"),
      details: tCli("providerModel.missingProviderDetails"),
    };
    throw error;
  }

  if (options.model !== undefined && !modelInput) {
    const error: CommandError = {
      code: "INVALID_MODEL",
      message: tCli("providerModel.emptyModel"),
    };
    throw error;
  }

  const slashIndex = providerInput.indexOf("/");
  if (slashIndex === -1) {
    return {
      provider: providerInput,
      model: modelInput,
    };
  }

  const provider = providerInput.slice(0, slashIndex).trim();
  const modelFromProvider = providerInput.slice(slashIndex + 1).trim();
  if (!provider || !modelFromProvider) {
    const error: CommandError = {
      code: "INVALID_PROVIDER",
      message: tCli("providerModel.invalidProvider"),
      details: tCli("providerModel.invalidProviderDetails"),
    };
    throw error;
  }

  if (modelInput && modelInput !== modelFromProvider) {
    const error: CommandError = {
      code: "CONFLICTING_MODEL_OPTIONS",
      message: tCli("providerModel.conflictingModel"),
      details: tCli("providerModel.conflictingModelDetails", {
        providerModel: modelFromProvider,
        model: modelInput,
      }),
    };
    throw error;
  }

  return {
    provider,
    model: modelInput ?? modelFromProvider,
  };
}
