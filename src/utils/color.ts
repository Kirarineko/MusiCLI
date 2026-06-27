import type { ParsedColor } from '../types';

export function parseColor(c: string): ParsedColor | null {
  let m = c.match(/^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);
  if (m) return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16), a: parseInt(m[4], 16) / 255 };
  m = c.match(/^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);
  if (m) return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16), a: 1 };
  m = c.match(/^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/);
  if (m) return { r: parseInt(m[1] + m[1], 16), g: parseInt(m[2] + m[2], 16), b: parseInt(m[3] + m[3], 16), a: 1 };
  m = c.match(/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/i);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
  return null;
}

export function formatColor(parsed: ParsedColor): string {
  if (parsed.a >= 1) {
    return '#' + [parsed.r, parsed.g, parsed.b]
      .map(c => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0'))
      .join('');
  }
  return `rgba(${parsed.r},${parsed.g},${parsed.b},${parsed.a.toFixed(2)})`;
}

export function darken(color: string, factor: number): string {
  const p = parseColor(color);
  if (!p) return color;
  p.r = Math.floor(p.r * factor);
  p.g = Math.floor(p.g * factor);
  p.b = Math.floor(p.b * factor);
  return formatColor(p);
}


