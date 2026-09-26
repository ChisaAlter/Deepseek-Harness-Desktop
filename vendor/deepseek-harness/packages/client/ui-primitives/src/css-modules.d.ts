declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

/**
 * `?raw` imports resolve to a module whose default export is the file text —
 * for `highlight.worker.ts` the tsdown plugin substitutes the bundled worker
 * script, so the import yields a self-contained Worker source string.
 */
declare module '*.ts?raw' {
  const source: string
  export default source
}

declare module '*.css'
