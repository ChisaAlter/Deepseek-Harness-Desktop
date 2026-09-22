declare module 'uqr' {
  export function encode(data: string | Uint8Array, options?: object): {
    size: number
    version: number
    data: unknown
  }
}
