import type {
  ChisaCodeConfigRaw,
  ChisaCodeConfigRevision,
  MutableDaemonConfigPatch,
} from "@chisacode/protocol/messages";

import type {
  DaemonCommandResponsePayload,
  DaemonCommandTransport,
} from "./daemon-client-command-transport.js";

/** Implements daemon status and daemon/project configuration RPC commands. */
export class ConfigCommandClient {
  constructor(private readonly transport: DaemonCommandTransport) {}

  getDaemonConfig(
    requestId?: string,
  ): Promise<DaemonCommandResponsePayload<"get_daemon_config_response">> {
    return this.transport.request({
      requestId,
      message: { type: "get_daemon_config_request" },
      responseType: "get_daemon_config_response",
      timeout: 10000,
    });
  }

  getDaemonStatus(
    requestId?: string,
  ): Promise<DaemonCommandResponsePayload<"daemon.get_status.response">> {
    return this.transport.request({
      requestId,
      message: { type: "daemon.get_status.request" },
      responseType: "daemon.get_status.response",
      timeout: 10000,
    });
  }

  getDaemonPairingOffer(
    requestId?: string,
  ): Promise<DaemonCommandResponsePayload<"daemon.get_pairing_offer.response">> {
    return this.transport.request({
      requestId,
      message: { type: "daemon.get_pairing_offer.request" },
      responseType: "daemon.get_pairing_offer.response",
      timeout: 10000,
    });
  }

  patchDaemonConfig(
    config: MutableDaemonConfigPatch,
    requestId?: string,
  ): Promise<DaemonCommandResponsePayload<"set_daemon_config_response">> {
    return this.transport.request({
      requestId,
      message: { type: "set_daemon_config_request", config },
      responseType: "set_daemon_config_response",
      timeout: 10000,
    });
  }

  readProjectConfig(
    repoRoot: string,
    requestId?: string,
  ): Promise<DaemonCommandResponsePayload<"read_project_config_response">> {
    return this.transport.request({
      requestId,
      message: { type: "read_project_config_request", repoRoot },
      responseType: "read_project_config_response",
      timeout: 10000,
    });
  }

  writeProjectConfig(input: {
    repoRoot: string;
    config: ChisaCodeConfigRaw;
    expectedRevision: ChisaCodeConfigRevision | null;
    requestId?: string;
  }): Promise<DaemonCommandResponsePayload<"write_project_config_response">> {
    return this.transport.request({
      requestId: input.requestId,
      message: {
        type: "write_project_config_request",
        repoRoot: input.repoRoot,
        config: input.config,
        expectedRevision: input.expectedRevision,
      },
      responseType: "write_project_config_response",
      timeout: 10000,
    });
  }
}
