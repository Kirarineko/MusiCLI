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
      // 2 digits = centiseconds, 3 digits = milliseconds — decide by string
      // length, not value (".050" is 50ms, not 500ms). Matches the Rust
      // parser in src-tauri/src/lrc_parser.rs.
      const frac = match[3] || '';
      const ms = frac ? (frac.length === 2 ? parseInt(frac, 10) * 10 : parseInt(frac, 10)) : 0;
      const time = min * 60 + sec + ms / 1000;
      const text = match[4].trim();
      // Preserve empty-text lines — they mark instrumental breaks and their
      // timestamps are needed for correct current-line tracking (matches the
      // Rust parser behavior).
      lines.push({ time, text });
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
