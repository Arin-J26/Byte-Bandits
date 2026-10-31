// Tiny fuzzy matcher for the command palette. Pure.

/**
 * Score how well `query` matches `text` (higher is better, -1 = no match).
 * Letters must appear in order; consecutive letters and word starts score extra.
 */
export function fuzzyScore(query, text) {
  const q = String(query || '').toLowerCase().trim();
  const s = String(text || '').toLowerCase();
  if (!q) return 0;
  if (s.includes(q)) return 100 - s.indexOf(q) + (s.startsWith(q) ? 50 : 0);
  let score = 0, si = 0, streak = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const at = s.indexOf(ch, si);
    if (at < 0) return -1;
    streak = at === si ? streak + 1 : 0;
    score += 1 + streak * 2 + (at === 0 || /[\s\-_@/]/.test(s[at - 1]) ? 3 : 0);
    si = at + 1;
  }
  return score;
}

/** Filter and rank items by `key(item)`; keeps original order for an empty query. */
export function fuzzyFilter(items, query, key = (x) => x, limit = 50) {
  if (!String(query || '').trim()) return items.slice(0, limit);
  return items
    .map((item, i) => ({ item, i, s: fuzzyScore(query, key(item)) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.item);
}
