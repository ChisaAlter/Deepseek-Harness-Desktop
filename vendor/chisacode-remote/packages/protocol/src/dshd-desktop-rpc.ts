import { z } from "zod/v3";

export const DshdHostRpcRequestSchema = z.object({
  type: z.literal("dshd.host.rpc.request"),
  requestId: z.string().min(1),
  method: z.string().min(1),
  payload: z.unknown().optional(),
});

export const DshdHostRpcResponseSchema = z.object({
  type: z.literal("dshd.host.rpc.response"),
  payload: z.object({
    requestId: z.string(),
    ok: z.boolean(),
    value: z.unknown().optional(),
    error: z.unknown().optional(),
  }),
});

export const DshdGitRpcRequestSchema = z.object({
  type: z.literal("dshd.git.rpc.request"),
  requestId: z.string().min(1),
  action: z.string().min(1),
  cwd: z.string(),
  payload: z.unknown().optional(),
});

export const DshdGitRpcResponseSchema = z.object({
  type: z.literal("dshd.git.rpc.response"),
  payload: z.object({
    requestId: z.string(),
    ok: z.boolean(),
    value: z.unknown().optional(),
    error: z.string().optional(),
  }),
});

export const DshdHostMuxSubscribeSchema = z.object({
  type: z.literal("dshd.host.mux.subscribe"),
  requestId: z.string().min(1),
});

export const DshdHostMuxUnsubscribeSchema = z.object({
  type: z.literal("dshd.host.mux.unsubscribe"),
  requestId: z.string().min(1),
});

export const DshdHostMuxFrameSchema = z.object({
  type: z.literal("dshd.host.mux.frame"),
  payload: z.object({
    rpcId: z.string(),
    envelope: z.unknown(),
  }),
});

export const DshdInboundMessageSchemas = [
  DshdHostRpcRequestSchema,
  DshdGitRpcRequestSchema,
  DshdHostMuxSubscribeSchema,
  DshdHostMuxUnsubscribeSchema,
] as const;

export const DshdOutboundMessageSchemas = [
  DshdHostRpcResponseSchema,
  DshdGitRpcResponseSchema,
  DshdHostMuxFrameSchema,
] as const;
