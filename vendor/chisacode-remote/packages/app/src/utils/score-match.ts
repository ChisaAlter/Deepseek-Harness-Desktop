/** Result of scoring a query against text. Lower tier = better match. */
export interface MatchScore {
  tier: number;
  offset: number;
  spread?: number;
}

function isWordBoundaryChar(ch: string | undefined): boolean {
  if (ch === undefined) return true;
  return !/[a-z0-9]/.test(ch);
}

function scoreSubstringMatch(query: string, text: string): MatchScore | null {
  let best: MatchScore | null = null;
  let pos = 0;
  while (pos <= text.length - query.length) {
    const found = text.indexOf(query, pos);
    if (found === -1) break;
    const before = found > 0 ? text[found - 1] : undefined;
    const after = text[found + query.length];
    const startsAtBoundary = found === 0 || isWordBoundaryChar(before);
    const endsAtBoundary = after === undefined || isWordBoundaryChar(after);
    let tier: number;
    if (startsAtBoundary && endsAtBoundary) {
      tier = 1;
    } else if (found === 0) {
      tier = 2;
    } else if (startsAtBoundary) {
      tier = 3;
    } else {
      tier = 4;
    }
    if (!best || tier < best.tier || (tier === best.tier && found < best.offset)) {
      best = { tier, offset: found };
    }
    pos = found + 1;
  }
  return best;
}

function scoreSubsequenceMatch(query: string, text: string): MatchScore | null {
  let queryIndex = 0;
  let firstIndex = -1;
  let lastIndex = -1;
  for (let textIndex = 0; textIndex < text.length && queryIndex < query.length; textIndex += 1) {
    if (text[textIndex] !== query[queryIndex]) continue;
    if (firstIndex === -1) firstIndex = textIndex;
    lastIndex = textIndex;
    queryIndex += 1;
  }

  if (queryIndex !== query.length || firstIndex === -1) return null;
  return { tier: 5, offset: firstIndex, spread: lastIndex - firstIndex + 1 };
}

/**
 * Scores how well `query` matches `text`, preferring exact, boundary-aligned,
 * and prefix matches over fuzzy subsequence matches.
 * @param query The search query (case-insensitive)
 * @param text The text to search within
 * @returns A match score, or null if no match is found
 */
export function scoreMatch(query: string, text: string): MatchScore | null {
  if (!query) return { tier: 0, offset: 0 };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t === q) return { tier: 0, offset: 0 };

  return scoreSubstringMatch(q, t) ?? scoreSubsequenceMatch(q, t);
}

/**
 * Compares two match scores for sorting (ascending: better match first).
 * @param a First match score
 * @param b Second match score
 * @returns Negative if `a` is better, positive if `b` is better, 0 if equal
 */
export function compareMatchScores(a: MatchScore, b: MatchScore): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  if (a.offset !== b.offset) return a.offset - b.offset;
  return (a.spread ?? 0) - (b.spread ?? 0);
}

/**
 * Scores a multi-token query against multiple text fields, aggregating the
 * best per-token match across all fields. Returns null if any token fails to
 * match any field.
 * @param query The whitespace-separated search query
 * @param fields The text fields to search across
 * @returns An aggregate match score, or null if any token is unmatched
 */
export function scoreTextFields(query: string, fields: string[]): MatchScore | null {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return { tier: 0, offset: 0, spread: 0 };

  const aggregate: MatchScore = { tier: 0, offset: 0, spread: 0 };
  for (const token of tokens) {
    let best: MatchScore | null = null;
    for (const field of fields) {
      const score = scoreMatch(token, field);
      if (score && (!best || compareMatchScores(score, best) < 0)) {
        best = score;
      }
    }
    if (!best) return null;
    aggregate.tier += best.tier;
    aggregate.offset += best.offset;
    aggregate.spread = (aggregate.spread ?? 0) + (best.spread ?? token.length);
  }
  return aggregate;
}
