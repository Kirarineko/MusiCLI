import { register } from '../registry';
import { t } from '../../i18n';
import { getBridge } from '../../bridge';
import { hasError } from '../../utils/guards';
import { escapeHtml, formatTime, getFileName } from '../../utils/format';
import { darken } from '../../utils/color';
import type { SelectCandidate, InteractiveItem, MetadataResult, Theme } from '../../types';

export interface CommandContext {
  printLine: (text: string, className?: string) => void;
  printRaw: (text: string) => void;
  printKV: (title: string | null, pairs: [string, string | number | null][]) => void;
  printList: (title: string | null, items: { name: string; meta?: string; sub?: string; highlight?: boolean }[]) => void;
  printHelp: () => void;
  clearTerminal: () => void;
  enterSelectMode: (candidates: SelectCandidate[]) => void;
  exitSelectMode: () => void;
  enterImode: (mode: 'import' | 'track-pl' | 'track-select', items: InteractiveItem[], cb: (selected: InteractiveItem[]) => void) => void;
  exitImode: () => void;
  enterSeekMode: () => void;
  exitSeekMode: () => void;
  // Player
  playlist: string[];
  currentIndex: number;
  getPlaylist: () => string[];
  addToPlaylist: (paths: string[]) => void;
  clearPlaylist: () => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  playIndex: (idx: number) => string | undefined;
  next: () => string | undefined;
  prev: () => string | undefined;
  seek: (secs: number) => void;
  setVolume: (v: number) => void;
  getVolume: () => number;
  getCurrentTime: () => number;
  getDuration: () => number;
  cyclePlayMode: () => string;
  loadLRC: (mp3Path: string) => Promise<boolean>;
  // Lyrics
  lyricsTerminal: boolean;
  lyricsFloating: boolean;
  toggleTerminalLyrics: () => void;
  toggleFloatingLyrics: () => void;
  setLyricsTerminal: (v: boolean) => Promise<void>;
  setLyricsFloating: (v: boolean) => Promise<void>;
  // Settings
  saveSettings: (partial: Record<string, unknown>) => void;
  resetSettings: () => void;
  applyTheme: (name: string) => boolean;
  // Playlists
  replaceCurrentTracks: (tracks: string[]) => void;
  addTracksToCurrent: (tracks: string[]) => void;
  getCurrentPlName: () => string;
  switchPlaylist: (name: string) => unknown;
  getPlaylistsForTrack: (path: string) => string[];
  syncTrackToPlaylists: (path: string, names: string[]) => void;
  listAllPlaylists: () => { name: string; desc: string; createdAt: string; trackCount: number; isCurrent: boolean }[];
  getCurrentPlaylist: () => { name: string; desc: string; tracks: string[] } | null;
  getPlaylistData: (name: string) => import('../../types').Playlist | null;
  createPlaylist: (name: string, desc?: string, sharer?: string) => { success: boolean; error?: string };
  createPlaylistWithTracks: (name: string, desc: string | undefined, sharer: string | undefined, tracks: string[]) => boolean;
  deletePlaylist: (name: string) => { success: boolean; error?: string };
  editPlaylist: (name: string, field: string, value: string) => { success: boolean; error?: string };
  ensureDefault: () => void;
  // Theme
  themeNames: () => string[];
  getTheme: (name: string) => Theme | null;
  saveCurrentTheme: (name: string) => void;
  deleteTheme: (name: string) => { success: boolean; error?: string };
  exportTheme: (name: string) => Theme | null;
  // Language
  setLangFn: (lang: string) => boolean;
  // Lyrics floating window
  syncLyricsTheme: () => void;
}

let _ctx: CommandContext | null = null;

export function setCommandContext(ctx: CommandContext) {
  _ctx = ctx;
}

export function ctx(): CommandContext {
  if (!_ctx) throw new Error('Command context not initialized');
  return _ctx;
}

export function sanitizeName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').slice(0, 120);
}

export async function readMetadata(filePath: string): Promise<MetadataResult | null> {
  const result = await getBridge().readMetadata(filePath);
  if (hasError(result)) {
    ctx().printLine(t('metadataError', { err: result.error }), 'error');
    return null;
  }
  return result as MetadataResult;
}

export function printNowPlaying(meta: MetadataResult) {
  const c = ctx();
  c.printRaw('');
  c.printLine(`<cmd>${t('nowPlaying')}</cmd>`, 'success');
  c.printRaw('  ' + meta.title);
  const pairs: [string, string | number | null][] = [
    [t('fieldArtist'), meta.artist],
    [t('fieldAlbum'), meta.album],
  ];
  if (meta.year) pairs.push([t('fieldYear'), String(meta.year)]);
  if (meta.genre) pairs.push([t('fieldGenre'), meta.genre]);
  c.printKV(null, pairs);
}

export function showMetadata(meta: MetadataResult | null) {
  if (!meta) return;
  const durationStr = meta.duration
    ? formatTime(meta.duration)
    : '-';
  ctx().printKV(t('metadataTitle'), [
    [t('fieldTitle'), meta.title],
    [t('fieldArtist'), meta.artist],
    [t('fieldAlbum'), meta.album],
    [t('fieldYear'), meta.year],
    [t('fieldGenre'), meta.genre],
    [t('fieldTrack'), meta.track],
    [t('fieldDuration'), durationStr],
    [t('fieldBitrate'), meta.bitrate ? meta.bitrate + ' kbps' : '-'],
    [t('fieldSampleRate'), meta.sampleRate ? meta.sampleRate + ' Hz' : '-'],
    [t('fieldCodec'), meta.codec],
  ]);
}

import { registerSystemCommands } from './system';
import { registerLyricsCommands } from './lyrics';
import { registerAppearanceCommands } from './appearance';
import { registerSyncCommands } from './sync';
import { registerPlaylistCommands } from './playlist';
import { registerPlaybackCommands } from './playback';

export function registerAllCommands() {
  registerSystemCommands();
  registerLyricsCommands();
  registerAppearanceCommands();
  registerSyncCommands();
  registerPlaylistCommands();
  registerPlaybackCommands();
}

// Register at module load time — survives Vite HMR
registerAllCommands();

export async function playTrack(filePath: string, printPlaying: boolean = true) {
  const c = ctx();
  const meta = await readMetadata(filePath);
  if (meta) {
    printNowPlaying(meta);
    await c.loadLRC(filePath);
  }
  if (printPlaying) c.printLine(t('playing'), 'success');
}
