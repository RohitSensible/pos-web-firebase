export interface SearchFields {
  primary?: readonly unknown[];
  text?: readonly unknown[];
  identifiers?: readonly unknown[];
}

export function normalizeSearch(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().replace(/\s+/g, ' ').toLowerCase() : '';
}

const words = (value: string) => value.match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];

function scorer(query: string) {
  const needle = normalizeSearch(query);
  const queryWords = words(needle);
  const wordQuery = queryWords.join(' ') === needle;
  return (fields: SearchFields): number => {
    const text = (fields.text ?? []).map(normalizeSearch).filter(Boolean);
    const identifiers = (fields.identifiers ?? []).map(normalizeSearch).filter(Boolean);
    const primary = fields.primary ? fields.primary.map(normalizeSearch).filter(Boolean) : text;
    if (primary.includes(needle)) return 0;
    if (identifiers.includes(needle) || text.includes(needle)) return 1;
    const values = [...text, ...identifiers];
    if (values.some(value => value.startsWith(needle))) return 2;
    const fieldWords = values.map(words);
    if (wordQuery && queryWords.length && fieldWords.some(tokens => (` ${tokens.join(' ')} `).includes(` ${queryWords.join(' ')} `))) return 3;
    if (wordQuery && queryWords.length > 1) {
      const available = new Set(fieldWords.flat());
      if (queryWords.every(word => available.has(word))) return 4;
    }
    if (values.some(value => value.includes(needle)) || values.join(' ').includes(needle)) return 5;
    return Infinity;
  };
}

export function createSearchMatcher(query: string): (fields: SearchFields) => boolean {
  if (!normalizeSearch(query)) return () => true;
  const score = scorer(query);
  return fields => Number.isFinite(score(fields));
}

// Stable ties retain the caller's existing sort. Never mutate records or input arrays.
// Rank-only mode preserves every server result, including matches in server-only fields.
export function rankSearchResults<T>(items: readonly T[], query: string, fields: (item: T) => SearchFields, filter = false): T[] {
  if (!normalizeSearch(query)) return items as T[];
  const score = scorer(query);
  return items.map((item, index) => ({ item, index, rank: score(fields(item)) }))
    .filter(entry => !filter || Number.isFinite(entry.rank))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(entry => entry.item);
}

export const searchRecords = <T,>(items: readonly T[], query: string, fields: (item: T) => SearchFields) =>
  rankSearchResults(items, query, fields, true);
