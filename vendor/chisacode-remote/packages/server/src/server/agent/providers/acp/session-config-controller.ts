import type {
  ClientSideConnection,
  ConfigOptionUpdate,
  CurrentModeUpdate,
  LoadSessionResponse,
  NewSessionResponse,
  ResumeSessionResponse,
  SessionConfigOption,
} from "@agentclientprotocol/sdk";
import type { Logger } from "pino";

import type { AgentMode, AgentRuntimeInfo, AgentStreamEvent } from "../../agent-sdk-types.js";
import {
  deriveCurrentConfigValue,
  deriveModesFromACP,
  findSelectConfigOption,
  flattenSelectOptions,
  resolveACPModeSelection,
  resolveACPModelSelection,
  type ACPBeforeModeWriteResult,
  type ACPModeSelection,
  type ACPModelSelection,
  type ACPProviderModeWriterContext,
  type ACPProviderModeWriteResult,
  type AvailableACPModel,
} from "./session-config.js";

/** ACP session state returned by new, load, and resume operations. */
export type SessionStateResponse = NewSessionResponse | LoadSessionResponse | ResumeSessionResponse;

interface ACPSessionConfigControllerOptions {
  provider: string;
  logger: Logger;
  defaultModes: AgentMode[];
  initialModeId: string | null;
  initialModelId: string | null;
  initialThinkingOptionId: string | null;
  getConnection: () => ClientSideConnection | null;
  getSessionId: () => string | null;
  getRuntimeInfo: () => AgentRuntimeInfo;
  emit: (event: AgentStreamEvent) => void;
  sessionResponseTransformer?: (response: SessionStateResponse) => SessionStateResponse;
  configOptionsTransformer?: (configOptions: SessionConfigOption[]) => SessionConfigOption[];
  modeIdTransformer?: (modeId: string) => string | null;
  providerModeWriter?: (
    context: ACPProviderModeWriterContext,
  ) => Promise<ACPProviderModeWriteResult>;
  beforeModeWriter?: (context: ACPProviderModeWriterContext) => Promise<ACPBeforeModeWriteResult>;
  thinkingOptionWriter?: (
    connection: ClientSideConnection,
    sessionId: string,
    thinkingOptionId: string,
  ) => Promise<void>;
}

interface ActiveACPSession {
  connection: ClientSideConnection;
  sessionId: string;
}

/** Owns ACP mode, model, thinking-option state and all related session configuration writes. */
export class ACPSessionConfigController {
  private readonly provider: string;
  private readonly logger: Logger;
  private readonly defaultModes: AgentMode[];
  private readonly configuredModeId: string | null;
  private readonly configuredModelId: string | null;
  private readonly configuredThinkingOptionId: string | null;
  private readonly getConnection: () => ClientSideConnection | null;
  private readonly getSessionId: () => string | null;
  private readonly getRuntimeInfo: () => AgentRuntimeInfo;
  private readonly emit: (event: AgentStreamEvent) => void;
  private readonly sessionResponseTransformer?: (
    response: SessionStateResponse,
  ) => SessionStateResponse;
  private readonly configOptionsTransformer?: (
    configOptions: SessionConfigOption[],
  ) => SessionConfigOption[];
  private readonly modeIdTransformer?: (modeId: string) => string | null;
  private readonly providerModeWriter?: (
    context: ACPProviderModeWriterContext,
  ) => Promise<ACPProviderModeWriteResult>;
  private readonly beforeModeWriter?: (
    context: ACPProviderModeWriterContext,
  ) => Promise<ACPBeforeModeWriteResult>;
  private readonly thinkingOptionWriter?: (
    connection: ClientSideConnection,
    sessionId: string,
    thinkingOptionId: string,
  ) => Promise<void>;

  private currentModeId: string | null;
  private availableModes: AgentMode[];
  private usesNativeModeWriter: boolean;
  private currentModelId: string | null;
  private availableModels: AvailableACPModel[] | null = null;
  private currentThinkingOptionId: string | null;
  private currentConfigOptions: SessionConfigOption[] = [];

  constructor(options: ACPSessionConfigControllerOptions) {
    this.provider = options.provider;
    this.logger = options.logger;
    this.defaultModes = options.defaultModes;
    this.configuredModeId = options.initialModeId;
    this.configuredModelId = options.initialModelId;
    this.configuredThinkingOptionId = options.initialThinkingOptionId;
    this.getConnection = options.getConnection;
    this.getSessionId = options.getSessionId;
    this.getRuntimeInfo = options.getRuntimeInfo;
    this.emit = options.emit;
    this.sessionResponseTransformer = options.sessionResponseTransformer;
    this.configOptionsTransformer = options.configOptionsTransformer;
    this.modeIdTransformer = options.modeIdTransformer;
    this.providerModeWriter = options.providerModeWriter;
    this.beforeModeWriter = options.beforeModeWriter;
    this.thinkingOptionWriter = options.thinkingOptionWriter;
    this.currentModeId = options.initialModeId;
    this.availableModes = options.defaultModes;
    this.usesNativeModeWriter = options.defaultModes.length > 0;
    this.currentModelId = options.initialModelId;
    this.currentThinkingOptionId = options.initialThinkingOptionId;
  }

  get modeId(): string | null {
    return this.currentModeId;
  }

  get modes(): AgentMode[] {
    return [...this.availableModes];
  }

  get modelId(): string | null {
    return this.currentModelId;
  }

  get thinkingOptionId(): string | null {
    return this.currentThinkingOptionId;
  }

  get configOptions(): SessionConfigOption[] {
    return [...this.currentConfigOptions];
  }

  applySessionState(response: SessionStateResponse): void {
    const transformed = this.sessionResponseTransformer
      ? this.sessionResponseTransformer(response)
      : response;
    this.currentConfigOptions = this.transformConfigOptions(transformed.configOptions ?? []);

    const modeInfo = deriveModesFromACP(
      this.defaultModes,
      transformed.modes,
      this.currentConfigOptions,
    );
    this.availableModes = modeInfo.modes;
    this.usesNativeModeWriter =
      Boolean(transformed.modes?.availableModes?.length) ||
      (!findSelectConfigOption({
        configOptions: this.currentConfigOptions,
        category: "mode",
      }) &&
        this.defaultModes.length > 0);
    this.currentModeId = modeInfo.currentModeId ?? this.currentModeId;

    this.availableModels = transformed.models?.availableModels ?? null;
    this.currentModelId =
      transformed.models?.currentModelId ??
      deriveCurrentConfigValue(this.currentConfigOptions, "model");
    this.currentThinkingOptionId =
      deriveCurrentConfigValue(this.currentConfigOptions, "thought_level") ??
      this.currentThinkingOptionId;
  }

  async applyConfiguredOverrides(): Promise<void> {
    if (this.configuredModeId && this.configuredModeId !== this.currentModeId) {
      await this.setMode(this.configuredModeId);
    }
    if (this.configuredModelId && this.configuredModelId !== this.currentModelId) {
      try {
        await this.setModel(this.configuredModelId);
      } catch (error) {
        if (!this.isModelSelectionUnavailableError(error)) {
          throw error;
        }
        this.logger.warn(
          { value: this.configuredModelId },
          `${this.provider} does not expose ACP model selection; using provider default model`,
        );
      }
    }
    if (
      this.configuredThinkingOptionId &&
      this.configuredThinkingOptionId !== this.currentThinkingOptionId
    ) {
      await this.setThinkingOption(this.configuredThinkingOptionId);
    }
  }

  async setMode(modeId: string): Promise<void> {
    const selection = resolveACPModeSelection({
      modeId,
      availableModes: this.usesNativeModeWriter ? this.availableModes : [],
      configOptions: this.currentConfigOptions,
    });
    await this.setModeWithSelection(modeId, selection);
  }

  async setModel(modelId: string | null): Promise<void> {
    if (!modelId) {
      this.requireSession();
      this.currentModelId = null;
      return;
    }

    const selection = resolveACPModelSelection({
      modelId,
      availableModels: this.availableModels,
      configOptions: this.currentConfigOptions,
    });
    await this.setModelWithSelection(modelId, selection);
  }

  async setThinkingOption(thinkingOptionId: string | null): Promise<void> {
    if (!thinkingOptionId) {
      this.requireSession();
      this.currentThinkingOptionId = null;
      return;
    }

    const { connection, sessionId } = this.requireSession();
    if (this.thinkingOptionWriter) {
      await this.thinkingOptionWriter(connection, sessionId, thinkingOptionId);
      this.currentThinkingOptionId = thinkingOptionId;
      this.emitThinkingOptionChanged();
      return;
    }

    const option = findSelectConfigOption({
      configOptions: this.currentConfigOptions,
      category: "thought_level",
    });
    if (!option) {
      throw new Error(`${this.provider} does not expose ACP thought-level selection`);
    }
    const response = await connection.setSessionConfigOption({
      sessionId,
      configId: option.id,
      value: thinkingOptionId,
    });
    this.currentThinkingOptionId = this.applyConfigOptionResponse({
      response,
      configId: option.id,
      category: "thought_level",
      requestedValue: thinkingOptionId,
      label: "thought-level",
    });
    this.emitThinkingOptionChanged();
  }

  handleCurrentModeUpdate(update: CurrentModeUpdate): AgentStreamEvent[] {
    this.currentModeId = this.modeIdTransformer
      ? this.modeIdTransformer(update.currentModeId)
      : update.currentModeId;
    return [this.modeChangedEvent()];
  }

  handleConfigOptionUpdate(update: ConfigOptionUpdate): AgentStreamEvent[] {
    this.currentConfigOptions = this.transformConfigOptions(update.configOptions);
    const modeInfo = deriveModesFromACP(this.defaultModes, null, this.currentConfigOptions);
    const nextMode = modeInfo.currentModeId;
    const nextModel = deriveCurrentConfigValue(this.currentConfigOptions, "model");
    const nextThinkingOptionId = deriveCurrentConfigValue(
      this.currentConfigOptions,
      "thought_level",
    );

    this.availableModes = modeInfo.modes;
    this.usesNativeModeWriter =
      !findSelectConfigOption({
        configOptions: this.currentConfigOptions,
        category: "mode",
      }) && this.defaultModes.length > 0;
    this.currentModeId = nextMode ?? this.currentModeId;
    this.currentModelId = nextModel ?? this.currentModelId;
    this.currentThinkingOptionId = nextThinkingOptionId ?? this.currentThinkingOptionId;

    const events: AgentStreamEvent[] = [];
    if (nextMode !== null) {
      events.push(this.modeChangedEvent());
    }
    if (nextModel !== null) {
      events.push({
        type: "model_changed",
        provider: this.provider,
        runtimeInfo: this.getRuntimeInfo(),
      });
    }
    if (nextThinkingOptionId !== null) {
      events.push({
        type: "thinking_option_changed",
        provider: this.provider,
        thinkingOptionId: this.currentThinkingOptionId,
      });
    }
    return events;
  }

  // Mode/model selection updates stay after ACP RPC success; this intentionally diverges from Zed's optimistic rollback path (acp.rs:3080-3104).
  private async setModeWithSelection(modeId: string, selection: ACPModeSelection): Promise<void> {
    const { connection, sessionId } = this.requireSession();
    const context: ACPProviderModeWriterContext = {
      connection,
      sessionId,
      requestedModeId: modeId,
      currentModeId: this.currentModeId,
      selection,
      configOptions: this.currentConfigOptions,
      logger: this.logger,
    };
    const providerResult = this.providerModeWriter
      ? await this.providerModeWriter(context)
      : { handled: false };
    if (providerResult.handled) {
      this.currentModeId = providerResult.currentModeId ?? modeId;
      if (providerResult.configOptions) {
        this.currentConfigOptions = this.transformConfigOptions(providerResult.configOptions);
      }
      this.availableModes = deriveModesFromACP(
        this.defaultModes,
        null,
        this.currentConfigOptions,
      ).modes;
      this.usesNativeModeWriter =
        !findSelectConfigOption({
          configOptions: this.currentConfigOptions,
          category: "mode",
        }) && this.defaultModes.length > 0;
      this.emit(this.modeChangedEvent());
      return;
    }

    if (selection.hasAvailableModes) {
      if (!selection.availableMode) {
        this.warnInvalidSelection(
          modeId,
          `is not valid ${this.provider} mode. Available options: ${this.availableModes
            .map((mode) => mode.id)
            .join(", ")}`,
        );
        return;
      }
    } else {
      const modeOption = selection.configOption;
      if (!modeOption) {
        throw new Error(`${this.provider} does not expose ACP mode switching`);
      }
      if (!selection.configChoice) {
        this.warnInvalidSelection(
          modeId,
          `is not valid ${this.provider} mode config option. Available options: ${flattenSelectOptions(
            modeOption.options,
          )
            .map((option) => option.value)
            .join(", ")}`,
        );
        return;
      }
    }

    if (this.beforeModeWriter) {
      const beforeResult = await this.beforeModeWriter(context);
      if (beforeResult?.configOptions) {
        this.currentConfigOptions = this.transformConfigOptions(beforeResult.configOptions);
      }
    }

    if (selection.hasAvailableModes) {
      await connection.setSessionMode({ sessionId, modeId });
      this.currentModeId = modeId;
      this.emit(this.modeChangedEvent());
      return;
    }

    const modeOption = selection.configOption;
    if (!modeOption) {
      throw new Error(`${this.provider} does not expose ACP mode switching`);
    }
    const response = await connection.setSessionConfigOption({
      sessionId,
      configId: modeOption.id,
      value: modeId,
    });
    this.currentModeId = this.applyConfigOptionResponse({
      response,
      configId: modeOption.id,
      category: "mode",
      requestedValue: modeId,
      label: "mode",
    });
    this.availableModes = deriveModesFromACP(
      this.defaultModes,
      null,
      this.currentConfigOptions,
    ).modes;
    this.usesNativeModeWriter = false;
    this.emit(this.modeChangedEvent());
  }

  private async setModelWithSelection(
    modelId: string,
    selection: ACPModelSelection,
  ): Promise<void> {
    const { connection, sessionId } = this.requireSession();
    if (selection.hasAvailableModels) {
      if (!selection.availableModel) {
        this.warnInvalidSelection(
          modelId,
          `is not a valid ${this.provider} model. Available options: ${this.availableModels
            ?.map((model) => model.modelId)
            .join(", ")}`,
        );
        return;
      }

      if (typeof connection.unstable_setSessionModel !== "function") {
        throw new Error(this.modelSelectionUnavailableMessage());
      }

      try {
        await connection.unstable_setSessionModel({ sessionId, modelId });
        this.currentModelId = modelId;
        this.emitModelChanged();
        return;
      } catch {
        // Fall through to config option path.
      }
    }

    const modelOption = selection.configOption;
    if (!modelOption) {
      throw new Error(this.modelSelectionUnavailableMessage());
    }
    if (!selection.configChoice) {
      this.warnInvalidSelection(
        modelId,
        `is not a valid ${this.provider} model config option. Available options: ${flattenSelectOptions(
          modelOption.options,
        )
          .map((option) => option.value)
          .join(", ")}`,
      );
      return;
    }

    const response = await connection.setSessionConfigOption({
      sessionId,
      configId: modelOption.id,
      value: modelId,
    });
    this.currentModelId = this.applyConfigOptionResponse({
      response,
      configId: modelOption.id,
      category: "model",
      requestedValue: modelId,
      label: "model",
    });
    this.emitModelChanged();
  }

  private applyConfigOptionResponse({
    response,
    configId,
    category,
    requestedValue,
    label,
  }: {
    response: { configOptions: SessionConfigOption[] };
    configId: string;
    category: string;
    requestedValue: string;
    label: string;
  }): string {
    this.currentConfigOptions = this.transformConfigOptions(response.configOptions);
    const responseOption = findSelectConfigOption({
      configOptions: this.currentConfigOptions,
      category,
      id: configId,
    });
    if (responseOption?.currentValue != null) {
      return responseOption.currentValue;
    }
    this.logger.warn(
      { configId, value: requestedValue },
      `ACP setSessionConfigOption response did not include the requested ${label} option currentValue; using requested value`,
    );
    return requestedValue;
  }

  private transformConfigOptions(configOptions: SessionConfigOption[]): SessionConfigOption[] {
    return this.configOptionsTransformer
      ? this.configOptionsTransformer(configOptions)
      : configOptions;
  }

  private requireSession(): ActiveACPSession {
    const connection = this.getConnection();
    const sessionId = this.getSessionId();
    if (!connection || !sessionId) {
      throw new Error("ACP session not initialized");
    }
    return { connection, sessionId };
  }

  private modeChangedEvent(): Extract<AgentStreamEvent, { type: "mode_changed" }> {
    return {
      type: "mode_changed",
      provider: this.provider,
      currentModeId: this.currentModeId,
      availableModes: [...this.availableModes],
    };
  }

  private emitModelChanged(): void {
    this.emit({
      type: "model_changed",
      provider: this.provider,
      runtimeInfo: this.getRuntimeInfo(),
    });
  }

  private emitThinkingOptionChanged(): void {
    this.emit({
      type: "thinking_option_changed",
      provider: this.provider,
      thinkingOptionId: this.currentThinkingOptionId,
    });
  }

  private warnInvalidSelection(value: string, message: string): void {
    this.logger.warn({ value }, message);
  }

  private modelSelectionUnavailableMessage(): string {
    return `${this.provider} does not expose ACP model selection`;
  }

  private isModelSelectionUnavailableError(error: unknown): boolean {
    return error instanceof Error && error.message === this.modelSelectionUnavailableMessage();
  }
}
