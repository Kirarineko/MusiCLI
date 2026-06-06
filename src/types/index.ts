export type Lang = 'en' | 'zh' | 'ja';
export type PlayMode = 'normal' | 'repeat-one' | 'repeat-all' | 'shuffle';
export type LyricsMode = 'floating' | 'terminal' | 'off';
export type ColorType = 'text' | 'dim' | 'bright' | 'accent' | 'bg' | 'line' | 'lyric';

export interface AppSettings {
  bg: string;
  'bg-darker': string;
  fg: string;
  'fg-dim': string;
  'fg-bright': string;
  accent: string;
  lyric: string;
  line: string;
  'bg-img': string;
  'bg-img-data': string;
  'bg-blur': number;
  volume: number;
  musicFolder: string;
  fontSize: number;
  fontWeight: number;
  customFont: string;
  customFontData: string;
  lyricsTerminal: boolean;
  lyricsFloating: boolean;
  progressFilled: string;
  progressEmpty: string;
  progressWidth: number;
  seekStep: number;
  seekPause: boolean;
}

export interface Theme {
  name: string;
  bg: string;
  fg: string;
  'fg-dim': string;
  'fg-bright': string;
  accent: string;
  lyric: string;
  line: string;
  'bg-img-data': string;
  'bg-blur': number;
  fontSize: number;
  fontWeight: number;
  customFont: string;
  customFontData: string;
}

export interface Playlist {
  name: string;
  desc: string;
  createdAt: string;
  tracks: string[];
}

export interface PlaylistInfo {
  name: string;
  desc: string;
  createdAt: string;
  trackCount: number;
  isCurrent: boolean;
}

export interface LrcLine {
  time: number;
  text: string;
}

export interface OutputLine {
  id: number;
  text: string;
  className: string;
  raw: boolean;
}

export interface FuzzyResult {
  idx: number;
  name: string;
  score: number;
}

export interface SelectCandidate {
  idx: number;
  name: string;
}

export interface InteractiveItem {
  name: string;
  path?: string;
  selected: boolean;
  visible: boolean;
}

export interface ParsedColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

// Re-export from electron.d.ts for convenience
export type { MetadataResult } from './electron';
