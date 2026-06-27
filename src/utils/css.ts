import type { AppSettings } from '../types';
import { parseColor, formatColor, darken } from './color';
import { convertFileSrc } from '@tauri-apps/api/core';
import { SHADOW_PRESETS } from '../constants/themes';

export function applyCssVars(s: AppSettings) {
  const root = document.documentElement;
  root.style.setProperty('--bg', s.bg);
  root.style.setProperty('--bg-darker', s['bg-darker'] || darken(s.bg, 0.85));
  root.style.setProperty('--fg', s.fg);
  root.style.setProperty('--fg-dim', s['fg-dim']);
  root.style.setProperty('--fg-bright', s['fg-bright']);
  root.style.setProperty('--accent', s.accent);
  root.style.setProperty('--line', s.line);
  root.style.setProperty('--lyric', s.lyric);

  if (s['bg-img']) {
    const imgPath = s['bg-img'].replace(/\\/g, '/');
    const imgUrl = (window as any).__TAURI_INTERNALS__
      ? convertFileSrc(imgPath)
      : `file:///${imgPath}`;
    root.style.setProperty('--bg-img', `url(${imgUrl})`);
  } else if (s['bg-img-data']) {
    const ext = s['bg-img-data'].startsWith('/9j/') ? 'jpg' :
                s['bg-img-data'].startsWith('iVBOR') ? 'png' :
                s['bg-img-data'].startsWith('R0lG') ? 'gif' :
                s['bg-img-data'].startsWith('UklGR') ? 'webp' : 'jpg';
    root.style.setProperty('--bg-img', `url(data:image/${ext};base64,${s['bg-img-data']})`);
  } else {
    root.style.setProperty('--bg-img', 'none');
  }
  root.style.setProperty('--bg-blur', `${s['bg-blur'] || 0}px`);
  root.style.setProperty('--font-size', `${s.fontSize || 14}px`);
  root.style.setProperty('--font-weight', String(s.fontWeight || 400));

  const baseFonts = '"Consolas", "Courier New", "Fira Code", monospace';
  if (s.customFont && s.customFontData) {
    let styleEl = document.getElementById('custom-font-style') as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'custom-font-style';
      document.head.appendChild(styleEl);
    }
    const ext = s.customFontData.startsWith('data:font/woff2') ? 'woff2' :
                s.customFontData.startsWith('data:font/woff') ? 'woff' :
                s.customFontData.startsWith('data:font/otf') ? 'otf' : 'truetype';
    styleEl.textContent = `@font-face { font-family: '${s.customFont}'; src: url(${s.customFontData}) format('${ext}'); }`;
    root.style.setProperty('--font', `"${s.customFont}", ${baseFonts}`);
  } else {
    const styleEl = document.getElementById('custom-font-style');
    if (styleEl) styleEl.remove();
    root.style.setProperty('--font', baseFonts);
  }
}

export function toCssShadow(preset: string): string {
  return SHADOW_PRESETS[preset] || 'none';
}
