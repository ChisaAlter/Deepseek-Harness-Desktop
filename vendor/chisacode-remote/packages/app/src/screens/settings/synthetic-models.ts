import type {
  ProviderProfileModel,
  SyntheticModelConfig,
  SyntheticModelMoa,
} from "@chisacode/protocol/provider-config";
import type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@chisacode/protocol/messages";

type ModelGatewayConfig = NonNullable<MutableDaemonConfig["modelGateways"]>[string];

export interface SelectableSyntheticGateway {
  id: string;
  label: string;
  models: ProviderProfileModel[];
  syntheticModels: SyntheticModelConfig[];
}

export interface SyntheticModelEntry extends SyntheticModelConfig {
  gatewayId: string;
  gatewayLabel: string;
}

export interface SaveSyntheticModelInput {
  currentGateways: MutableDaemonConfig["modelGateways"] | undefined;
  previousGatewayId?: string | null;
  previousId?: string | null;
  gatewayId: string;
  id: string;
  label: string;
  description?: string | null;
  references: string[];
  aggregatorModel: string;
  rounds: number;
  moa?: SyntheticModelMoa;
}

function trim(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePositiveRounds(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.min(4, Math.trunc(value)));
}

function getGatewayOrThrow(
  gateways: MutableDaemonConfig["modelGateways"] | undefined,
  gatewayId: string,
): ModelGatewayConfig {
  const gateway = gateways?.[gatewayId];
  if (!gateway) {
    throw new Error("Select a configured provider");
  }
  return gateway;
}

function modelFromSyntheticModel(model: SyntheticModelConfig): ProviderProfileModel {
  return {
    id: model.id,
    label: model.label,
    ...(model.description ? { description: model.description } : {}),
  };
}

function modelIds(models: ProviderProfileModel[]): Set<string> {
  return new Set(models.map((model) => model.id));
}

function validateMoaModels(
  moa: SyntheticModelMoa | undefined,
  availableModelIds: Set<string>,
): void {
  if (!moa) {
    return;
  }
  const modelIdsToCheck = [
    moa.aggregator.model,
    ...moa.layers.flatMap((layer) => layer.nodes.map((node) => node.model)),
  ];
  for (const model of modelIdsToCheck) {
    if (!availableModelIds.has(model)) {
      throw new Error(`Model "${model}" is not configured on this provider`);
    }
  }
}

function buildGatewayPatch(
  gateway: ModelGatewayConfig,
  syntheticModels: SyntheticModelConfig[],
): Partial<ModelGatewayConfig> {
  return {
    syntheticModels,
    models: gateway.models ?? [],
  };
}

export function collectSyntheticModelGateways(
  gateways: MutableDaemonConfig["modelGateways"] | undefined,
): SelectableSyntheticGateway[] {
  return Object.values(gateways ?? {})
    .filter((gateway) => gateway.enabled !== false && (gateway.models ?? []).length > 0)
    .map((gateway) => ({
      id: gateway.id,
      label: gateway.label ?? gateway.id,
      models: gateway.models ?? [],
      syntheticModels: gateway.syntheticModels ?? [],
    }))
    .sort((a, b) => {
      const labelCompare = a.label.localeCompare(b.label);
      return labelCompare !== 0 ? labelCompare : a.id.localeCompare(b.id);
    });
}

export function collectSyntheticModels(
  gateways: MutableDaemonConfig["modelGateways"] | undefined,
): SyntheticModelEntry[] {
  return Object.values(gateways ?? {})
    .flatMap((gateway) =>
      (gateway.syntheticModels ?? []).map((model) => ({
        id: model.id,
        label: model.label,
        description: model.description,
        references: model.references,
        aggregatorModel: model.aggregatorModel,
        rounds: model.rounds,
        moa: model.moa,
        gatewayId: gateway.id,
        gatewayLabel: gateway.label ?? gateway.id,
      })),
    )
    .sort((a, b) => {
      const labelCompare = a.label.localeCompare(b.label);
      return labelCompare !== 0 ? labelCompare : a.id.localeCompare(b.id);
    });
}

export function buildSaveSyntheticModelPatch(
  input: SaveSyntheticModelInput,
): MutableDaemonConfigPatch {
  const gatewayId = trim(input.gatewayId);
  const id = trim(input.id);
  const label = trim(input.label) || id;
  const aggregatorModel = trim(input.aggregatorModel);
  const references = Array.from(new Set(input.references.map(trim))).filter(Boolean);

  if (!gatewayId) {
    throw new Error("Select a provider");
  }
  if (!id) {
    throw new Error("Model ID is required");
  }
  if (references.length < 1) {
    throw new Error("Select at least one reference model");
  }
  if (!aggregatorModel) {
    throw new Error("Select an aggregator model");
  }

  const gateway = getGatewayOrThrow(input.currentGateways, gatewayId);
  const availableModelIds = modelIds(gateway.models ?? []);
  for (const model of [...references, aggregatorModel]) {
    if (!availableModelIds.has(model)) {
      throw new Error(`Model "${model}" is not configured on ${gateway.label ?? gateway.id}`);
    }
  }
  validateMoaModels(input.moa, availableModelIds);

  const nextModel: SyntheticModelConfig = {
    id,
    label,
    ...(trim(input.description) ? { description: trim(input.description) } : {}),
    references: references.map((model) => ({ model })),
    aggregatorModel,
    rounds: normalizePositiveRounds(input.rounds),
    ...(input.moa ? { moa: input.moa } : {}),
  };
  const previousGatewayId = trim(input.previousGatewayId);
  const previousId = trim(input.previousId);
  const patchGateways: NonNullable<MutableDaemonConfigPatch["modelGateways"]> = {};

  if (previousGatewayId && previousGatewayId !== gatewayId) {
    const previousGateway = getGatewayOrThrow(input.currentGateways, previousGatewayId);
    patchGateways[previousGatewayId] = buildGatewayPatch(
      previousGateway,
      (previousGateway.syntheticModels ?? []).filter((model) => model.id !== previousId),
    );
  }

  const idsToRemove = new Set([id, previousId].filter(Boolean));
  patchGateways[gatewayId] = buildGatewayPatch(gateway, [
    ...(gateway.syntheticModels ?? []).filter((model) => !idsToRemove.has(model.id)),
    nextModel,
  ]);

  return { modelGateways: patchGateways };
}

export function buildDeleteSyntheticModelPatch(input: {
  currentGateways: MutableDaemonConfig["modelGateways"] | undefined;
  gatewayId: string;
  id: string;
}): MutableDaemonConfigPatch {
  const gatewayId = trim(input.gatewayId);
  const id = trim(input.id);
  if (!gatewayId || !id) {
    throw new Error("Synthetic model is required");
  }
  const gateway = getGatewayOrThrow(input.currentGateways, gatewayId);
  return {
    modelGateways: {
      [gatewayId]: buildGatewayPatch(
        gateway,
        (gateway.syntheticModels ?? []).filter((model) => model.id !== id),
      ),
    },
  };
}

export function getGatewayModelListWithSyntheticModels(
  gateway: SelectableSyntheticGateway,
): ProviderProfileModel[] {
  return [...gateway.models, ...gateway.syntheticModels.map(modelFromSyntheticModel)];
}

export function createLegacyMoaConfig(input: {
  references: SyntheticModelConfig["references"];
  aggregatorModel: string;
  rounds?: number;
}): SyntheticModelMoa {
  const rounds = normalizePositiveRounds(input.rounds ?? 1);
  const nodes = input.references.map((reference) => ({ model: reference.model }));
  return {
    layers: Array.from({ length: rounds }, (_, index) => ({
      id: `layer-${index + 1}`,
      label: `Layer ${index + 1}`,
      nodes,
    })),
    aggregator: { model: input.aggregatorModel },
  };
}
