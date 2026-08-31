// dsh-usage-panel · host-side structural types for services the plugin uses
// at runtime but whose host-side type packages are not public: the Cordis
// `connection` service (RPC) and the `llm` service (provider directory).
// The runtime shapes below are exactly what v0.1.0 already exercised.

// `ctx.interval` comes from @deepseek-ai/cordis-plugin-timer at runtime.
// The augmentation is declared locally so the built bundle has NO runtime
// import of that devDependency (consumers never install devDeps).
declare module '@deepseek-ai/cordis' {
  interface Context {
    interval(callback: () => void, delay: number): () => void
  }
}

export interface HostRpcResult<T> {
  ok: boolean
  value?: T
  error?: { code: string; message: string; details: Record<string, unknown> }
}

export interface HostRpcHandle {
  handle(
    path: string,
    handler: (endpoint: string, payload: unknown) => Promise<HostRpcResult<unknown>>,
    options: { authority: 'loopback' },
  ): () => void
}

export interface HostConnection {
  rpc: HostRpcHandle
}

export interface LlmProviderInfoLike {
  id: string
  name: string
}

export interface LlmModelInfoLike {
  id: string
}

export interface HostLlm {
  listProviders(): Promise<LlmProviderInfoLike[]> | LlmProviderInfoLike[]
  /** Adapter-known models for one provider (may be unavailable on some adapters). */
  listModels?(provider: string): Promise<LlmModelInfoLike[]>
}
