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
  lyricsFg: string;
  lyricsAccent: string;
  lyricsNextCount: number;
  lyricsGap: number;
  lyricsShadow: 'none' | 'small' | 'medium' | 'large';
  lyricsAlign: 'left' | 'center' | 'right';
  lyricsLocked: boolean;
  lyricsCurrentSize: number;
  lyricsNextSize: number;
  lyricsVertical: 'off' | 'rl' | 'lr';
  progressFilled: string;
  progressEmpty: string;
  progressWidth: number;
  seekStep: number;
  seekPause: boolean;
  maxLines: number;
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
  updatedAt?: string;
  sharer?: string;
  tracks: string[];
}

export interface SyncTrackMeta {
  filename: string;
  title: string;
  artist: string;
  album: string;
  year: number | null;
  genre: string | null;
  duration: number;
  lrcFile?: string;
  lrcOffset?: number;
}

export interface SyncManifest {
  version: number;
  type: 'playlist';
  source: string;
  playlist: {
    name: string;
    desc: string;
    createdAt: string;
    updatedAt: string;
    sharer: string;
    tracks: SyncTrackMeta[];
  };
  lrcOffsets?: Record<string, number>;
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
