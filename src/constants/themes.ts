import type { Theme } from '../types';

export const SHADOW_PRESETS: Record<string, string> = {
  large: '0 0 8px rgba(0,0,0,0.4),0 4px 3px rgba(0,0,0,0.7)',
  medium: '0 0 6px rgba(0,0,0,0.5),0 2px 1px rgba(0,0,0,0.5)',
  small: '0 0 4px rgba(0,0,0,0.7)',
};

export const BUILTIN_THEMES: Theme[] = [
  {
    name: 'dark', bg: '#0c0c0c', fg: '#f2f2f2', 'fg-dim': '#cccccc',
    'fg-bright': '#b1b9f9', accent: '#888888', lyric: '#888888', line: '#686868',
    'bg-img-data': '', 'bg-blur': 0, fontSize: 14, fontWeight: 400,
    customFont: '', customFontData: '',
  },
  {
    name: 'Claude Desktop', bg: '#FAF9F5', fg: '#141413', 'fg-dim': '#5E5D59',
    'fg-bright': '#D97757', accent: '#d4a853', lyric: '#5E5D59', line: '#2d2a25',
    'bg-img-data': '', 'bg-blur': 0, fontSize: 14, fontWeight: 400,
    customFont: '', customFontData: '',
  },
];
