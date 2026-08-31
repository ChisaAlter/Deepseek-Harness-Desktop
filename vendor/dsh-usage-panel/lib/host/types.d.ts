declare module '@deepseek-ai/cordis' {
    interface Context {
        interval(callback: () => void, delay: number): () => void;
    }
}
export interface HostRpcResult<T> {
    ok: boolean;
    value?: T;
    error?: {
        code: string;
        message: string;
        details: Record<string, unknown>;
    };
}
export interface HostRpcHandle {
    handle(path: string, handler: (endpoint: string, payload: unknown) => Promise<HostRpcResult<unknown>>, options: {
        authority: 'loopback';
    }): () => void;
}
export interface HostConnection {
    rpc: HostRpcHandle;
}
export interface LlmProviderInfoLike {
    id: string;
    name: string;
}
export interface LlmModelInfoLike {
    id: string;
}
export interface HostLlm {
    listProviders(): Promise<LlmProviderInfoLike[]> | LlmProviderInfoLike[];
    /** Adapter-known models for one provider (may be unavailable on some adapters). */
    listModels?(provider: string): Promise<LlmModelInfoLike[]>;
}
