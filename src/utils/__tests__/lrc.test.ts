import { describe, it, expect } from 'vitest';
import { parseLRC, getCurrentLineIdx } from '../lrc';

describe('parseLRC', () => {
  it('parses valid LRC lines', () => {
    const lines = parseLRC('[00:01.50]Hello\n[00:05.00]World');
    expect(lines).toHaveLength(2);
    expect(lines[0].time).toBeCloseTo(1.5);
    expect(lines[0].text).toBe('Hello');
    expect(lines[1].time).toBeCloseTo(5.0);
    expect(lines[1].text).toBe('World');
  });

  it('sorts lines by time', () => {
    const lines = parseLRC('[00:10.00]C\n[00:05.00]A\n[00:07.00]B');
    expect(lines.map(l => l.text)).toEqual(['A', 'B', 'C']);
  });

  it('skips empty text lines', () => {
    const lines = parseLRC('[00:01.00] \n[00:02.00]Hello\n[00:03.00]\n');
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('Hello');
  });

  it('skips metadata tags', () => {
    const lines = parseLRC('[ti:Title]\n[ar:Artist]\n[00:01.00]Hello');
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('Hello');
  });

  it('handles colons in timestamps', () => {
    const lines = parseLRC('[00:01:50]Hello');
    expect(lines).toHaveLength(1);
    expect(lines[0].time).toBeCloseTo(1.5);
    expect(lines[0].text).toBe('Hello');
  });

  it('handles 2-digit milliseconds (centiseconds)', () => {
    const lines = parseLRC('[00:01.99]Hello');
    expect(lines).toHaveLength(1);
    expect(lines[0].time).toBeCloseTo(1.99);
  });

  it('handles 3-digit milliseconds', () => {
    const lines = parseLRC('[00:01.500]Hello');
    expect(lines).toHaveLength(1);
    expect(lines[0].time).toBe(0.5 + 1);
  });

  it('handles lines without milliseconds', () => {
    const lines = parseLRC('[00:01]Hello');
    expect(lines).toHaveLength(1);
    expect(lines[0].time).toBeCloseTo(1);
  });

  it('returns empty array for empty input', () => {
    expect(parseLRC('')).toHaveLength(0);
  });
});

describe('getCurrentLineIdx', () => {
  it('returns -1 for empty lines', () => {
    expect(getCurrentLineIdx([], 5)).toBe(-1);
  });

  it('returns -1 when time is before first line', () => {
    const lines = [{ time: 10, text: 'A' }, { time: 20, text: 'B' }];
    expect(getCurrentLineIdx(lines, 5)).toBe(-1);
  });

  it('returns correct index when time matches', () => {
    const lines = [{ time: 10, text: 'A' }, { time: 20, text: 'B' }];
    expect(getCurrentLineIdx(lines, 10)).toBe(0);
    expect(getCurrentLineIdx(lines, 20)).toBe(1);
  });

  it('returns previous line when time is between', () => {
    const lines = [{ time: 10, text: 'A' }, { time: 20, text: 'B' }];
    expect(getCurrentLineIdx(lines, 15)).toBe(0);
  });

  it('returns last line when time is past all lines', () => {
    const lines = [{ time: 10, text: 'A' }, { time: 20, text: 'B' }];
    expect(getCurrentLineIdx(lines, 30)).toBe(1);
  });
});
