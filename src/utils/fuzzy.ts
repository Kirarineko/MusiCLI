import type { FuzzyResult } from '../types';

export function fuzzySearch(query: string, items: string[]): FuzzyResult[] {
  const q = query.toLowerCase();
  const results: FuzzyResult[] = [];

  for (let i = 0; i < items.length; i++) {
    const name = items[i].split(/[/\\]/).pop()!.toLowerCase();
    let score = 0;
    if (name === q) {
      score = 1000;
    } else if (name.startsWith(q)) {
      score = 500 + (100 - Math.min(100, name.length));
    } else if (name.includes(q)) {
      const pos = name.indexOf(q);
      score = 200 - pos;
    } else {
      let qi = 0;
      for (let ci = 0; ci < name.length && qi < q.length; ci++) {
        if (name[ci] === q[qi]) qi++;
      }
      if (qi === q.length) score = 10 - Math.min(9, name.length - q.length);
    }
    if (score > 0) {
      results.push({ idx: i, name: items[i].split(/[/\\]/).pop()!, score });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}
