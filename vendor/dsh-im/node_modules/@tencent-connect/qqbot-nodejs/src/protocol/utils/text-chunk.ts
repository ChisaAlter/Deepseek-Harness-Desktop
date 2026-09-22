/**
 * QQ Bot single-message text length limits and a naive fallback splitter.
 *
 * The QQ Open Platform caps a single text message at ~5000 characters.
 * When richer markdown-aware chunking is unavailable (e.g. outside an
 * outbound pipeline), this module provides a simple byte-window split
 * so callers always have a safe fallback.
 */

/** Maximum text length for a single QQ Bot message. */
export const TEXT_CHUNK_LIMIT = 5000;

/** Text chunker function signature. */
export type ChunkTextFn = (text: string, limit: number) => string[];

/**
 * Naive text chunking fallback.
 *
 * Splits on a fixed character window — does not respect markdown
 * structure. Use this only when the embedder cannot supply a
 * smarter chunker.
 */
export function chunkText(text: string, limit: number = TEXT_CHUNK_LIMIT): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += limit) {
    chunks.push(text.slice(i, i + limit));
  }
  return chunks.length > 0 ? chunks : [text];
}
