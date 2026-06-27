import { describe, it, expect } from 'vitest';
import { fuzzySearch } from '../fuzzy';

describe('fuzzySearch', () => {
  it('returns empty array for no match', () => {
    const results = fuzzySearch('zzz', ['apple', 'banana', 'cherry']);
    expect(results).toHaveLength(0);
  });

  it('returns exact match with highest score', () => {
    const results = fuzzySearch('hello', ['hello', 'hello world']);
    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('hello');
    expect(results[0].score).toBe(1000);
  });

  it('matches prefix', () => {
    const results = fuzzySearch('app', ['apple', 'application', 'banana']);
    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('apple');
  });

  it('matches substring', () => {
    const results = fuzzySearch('ple', ['pineapple', 'apple', 'orange']);
    expect(results).toHaveLength(2);
    expect(results.map(r => r.name).sort()).toEqual(['apple', 'pineapple']);
  });

  it('matches fuzzy characters', () => {
    const results = fuzzySearch('apl', ['apple', 'banana', 'cherry']);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('apple');
  });

  it('is case insensitive', () => {
    const results = fuzzySearch('HELLO', ['Hello World', 'goodbye']);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Hello World');
  });

  it('returns fuzzy idx matching input array index', () => {
    const items = ['one', 'two', 'three'];
    const results = fuzzySearch('two', items);
    expect(results).toHaveLength(1);
    expect(results[0].idx).toBe(1);
  });

  it('sorts results by score descending', () => {
    const items = ['testabc', 'test', 'abctest', 'xyz'];
    const results = fuzzySearch('test', items);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('returns all items for empty query', () => {
    const results = fuzzySearch('', ['apple', 'banana']);
    expect(results).toHaveLength(2);
  });

  it('handles empty items array', () => {
    const results = fuzzySearch('test', []);
    expect(results).toHaveLength(0);
  });

  it('uses last path segment as name for scoring', () => {
    const results = fuzzySearch('song', ['/home/user/music/song.mp3']);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('song.mp3');
    expect(results[0].score).toBe(592);
  });
});
