import type { LrcLine } from '../types';

export function parseLRC(content: string): LrcLine[] {
  const lines: LrcLine[] = [];
  const regex = /\[(\d{2}):(\d{2})(?:[.:](\d{2,3}))?\](.*)/;
  const rawLines = content.split(/\r?\n/);
  for (const raw of rawLines) {
    const match = raw.match(regex);
    if (match) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      let ms = match[3] ? parseInt(match[3], 10) : 0;
      if (ms < 100) ms *= 10;
      const time = min * 60 + sec + ms / 1000;
      const text = match[4].trim();
      if (text) lines.push({ time, text });
    }
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

export function getCurrentLineIdx(lines: LrcLine[], currentTime: number): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].time <= currentTime) return i;
  }
  return -1;
}
