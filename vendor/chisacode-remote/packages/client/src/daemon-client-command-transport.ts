import type { SessionInboundMessage, SessionOutboundMessage } from "@chisacode/protocol/messages";

export type DaemonCommandResponseMessage =
  | Extract<SessionOutboundMessage, { payload: { requestId: string } }>
  | Extract<SessionOutboundMessage, { type: "get_daemon_config_response" }>
  | Extract<SessionOutboundMessage, { type: "set_daemon_config_response" }>;
export type DaemonCommandResponseType = DaemonCommandResponseMessage["type"];
export type DaemonCommandResponsePayload<TType extends DaemonCommandResponseType> = Extract<
  DaemonCommandResponseMessage,
  { type: TType }
>["payload"];
export type DaemonCommandRequest = { type: SessionInboundMessage["type"] } & Record<
  string,
  unknown
>;

/** Narrow correlated-RPC port shared by stateless daemon command clients. */
export interface DaemonCommandTransport {
  request<TResponseType extends DaemonCommandResponseType>(params: {
    requestId?: string;
    message: DaemonCommandRequest;
    responseType: TResponseType;
    timeout: number;
  }): Promise<DaemonCommandResponsePayload<TResponseType>>;
}
