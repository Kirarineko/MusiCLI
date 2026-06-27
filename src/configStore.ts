/**
 * configStore — Unified config persistence layer.
 *
 * All config is stored as JSON files in {musicFolder}/config/.
 * localStorage is kept as a synchronous cache so existing sync accessors
 * (getStoredSettings, loadPlaylistsFromStorage, initLang) continue to work.
 *
 * Key design:
 * - musicFolder is the ONLY bootstrap key stored solely in localStorage
 * - On module load, the in-memory cache is populated from localStorage (sync)
 * - initConfig() reads from files (async), overwriting cache + localStorage
 * - All save functions write to BOTH file (async) and localStorage (sync)
 */

import type { AppSettings, Theme, Playlist, Lang } from './types';
import { isBridgeAvailable, getBridge } from './bridge';

// ── helpers ──────────────────────────────────────────────────────────

function hasError(obj: unknown): obj is { error: string } {
  return typeof obj === 'object' && obj !== null && 'error' in obj;
}

// ── bootstrap ────────────────────────────────────────────────────────

const BOOTSTRAP_KEY = 'musicli-musicfolder';

export function getMusicFolder(): string {
  try {
    return localStorage.getItem(BOOTSTRAP_KEY) || '';
  } catch {
    return '';
  }
}

export function setMusicFolder(path: string): void {
  try {
    if (path) {
      localStorage.setItem(BOOTSTRAP_KEY, path);
    } else {
      localStorage.removeItem(BOOTSTRAP_KEY);
    }
  } catch { /* ignore */ }
}

// legacy localStorage keys (used as cache)
const LS_KEYS = {
  settings: 'musiccli-settings',
  themes: 'musiccli-themes',
  playlists: 'musiccli-playlists',
  currentPl: 'musiccli-current-pl',
  lang: 'musiccli-lang',
} as const;

type ConfigKey = 'settings' | 'themes' | 'playlists' | 'lang';

// ── defaults ─────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: AppSettings = {
  bg: '#0c0c0c',
  'bg-darker': '#0a0a0a',
  fg: '#f2f2f2',
  'fg-dim': '#cccccc',
  'fg-bright': '#b1b9f9',
  accent: '#888888',
  lyric: '#888888',
  line: '#686868',
  'bg-img': '',
  'bg-img-data': '',
  'bg-blur': 0,
  volume: 80,
  musicFolder: '',
  fontSize: 14,
  fontWeight: 400,
  customFont: '',
  customFontData: '',
  lyricsTerminal: false,
  lyricsFloating: false,
  lyricsFg: '#cccccc',
  lyricsAccent: '#b1b9f9',
  lyricsNextCount: 1,
  lyricsGap: 10,
  lyricsShadow: 'medium',
  lyricsAlign: 'center',
  lyricsLocked: false,
  lyricsCurrentSize: 24,
  lyricsNextSize: 14,
  lyricsVertical: 'off',
  progressFilled: '=',
  progressEmpty: ' ',
  progressWidth: 20,
  seekStep: 5,
  seekPause: false,
  maxLines: 500,
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

function defaultPlaylistsData(): { pls: Record<string, Playlist>; cur: string } {
  const name = 'Default';
  return {
    pls: { [name]: { name, desc: '', createdAt: new Date().toISOString(), tracks: [] } },
    cur: name,
  };
}

// ── in-memory cache ──────────────────────────────────────────────────

// Populated synchronously from localStorage on module load.
// initConfig() refreshes them asynchronously from files.

function loadFromLs<T>(lsKey: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(lsKey);
    if (raw) return JSON.parse(raw) as T;
  } catch { /* ignore */ }
  return fallback;
}

let _settings: AppSettings = (() => {
  const stored = loadFromLs<Partial<AppSettings>>(LS_KEYS.settings, {});
  return { ...DEFAULT_SETTINGS, ...stored };
})();

let _themes: Theme[] = (() => {
  const stored = loadFromLs<Theme[]>(LS_KEYS.themes, []);
  if (stored.length > 0) return stored;
  // First launch: seed with built-in themes
  const copy = JSON.parse(JSON.stringify(BUILTIN_THEMES));
  try { localStorage.setItem(LS_KEYS.themes, JSON.stringify(copy)); } catch {}
  return copy;
})();

let _playlists: Record<string, Playlist> = (() => {
  const stored = loadFromLs<Record<string, Playlist>>(LS_KEYS.playlists, {});
  if (Object.keys(stored).length > 0) return stored;
  const def = defaultPlaylistsData();
  try {
    localStorage.setItem(LS_KEYS.playlists, JSON.stringify(def.pls));
    localStorage.setItem(LS_KEYS.currentPl, def.cur);
  } catch {}
  return def.pls;
})();

let _currentPlName: string = (() => {
  try {
    const cur = localStorage.getItem(LS_KEYS.currentPl);
    if (cur && _playlists[cur]) return cur;
    // Fallback to first playlist
    const first = Object.keys(_playlists)[0];
    if (first) {
      localStorage.setItem(LS_KEYS.currentPl, first);
      return first;
    }
  } catch {}
  return '';
})();

let _lang: Lang = (() => {
  try {
    const raw = localStorage.getItem(LS_KEYS.lang);
    if (raw === 'zh' || raw === 'ja' || raw === 'en') return raw;
  } catch {}
  return 'en';
})();

// Ensure currentPlName is valid
if (!_currentPlName || !_playlists[_currentPlName]) {
  const first = Object.keys(_playlists)[0];
  if (first) {
    _currentPlName = first;
    try { localStorage.setItem(LS_KEYS.currentPl, first); } catch {}
  }
}

// ── internal file I/O ────────────────────────────────────────────────

async function readConfigFile<T>(key: ConfigKey, fallback: T): Promise<T> {
  const mf = getMusicFolder();
  if (!mf || !isBridgeAvailable()) {
    // No music folder set or no IPC — use localStorage as source of truth
    const lsKey = key === 'playlists' ? LS_KEYS.playlists
                : key === 'settings' ? LS_KEYS.settings
                : key === 'themes' ? LS_KEYS.themes
                : LS_KEYS.lang;
    return loadFromLs<T>(lsKey, fallback);
  }

  try {
    const result = await getBridge().readConfig(mf, key);
    if (result === null) {
      // File doesn't exist yet — use localStorage
      const lsKey = key === 'playlists' ? LS_KEYS.playlists
                  : key === 'settings' ? LS_KEYS.settings
                  : key === 'themes' ? LS_KEYS.themes
                  : LS_KEYS.lang;
      return loadFromLs<T>(lsKey, fallback);
    }
    if (hasError(result)) {
      console.warn(`[configStore] read ${key} error:`, result.error);
      return fallback;
    }
    return result as T;
  } catch (err) {
    console.warn(`[configStore] read ${key} failed:`, err);
    return fallback;
  }
}

async function writeConfigFile(key: ConfigKey, data: unknown): Promise<void> {
  // Always write to localStorage first (sync cache)
  try {
    if (key === 'playlists') {
      const d = data as { pls: Record<string, Playlist>; cur: string };
      localStorage.setItem(LS_KEYS.playlists, JSON.stringify(d.pls));
      localStorage.setItem(LS_KEYS.currentPl, d.cur);
    } else if (key === 'settings') {
      localStorage.setItem(LS_KEYS.settings, JSON.stringify(data));
    } else if (key === 'themes') {
      localStorage.setItem(LS_KEYS.themes, JSON.stringify(data));
    } else if (key === 'lang') {
      localStorage.setItem(LS_KEYS.lang, String(data));
    }
  } catch { /* ignore */ }

  // Then write to file (async, best-effort)
  const mf = getMusicFolder();
  if (mf && isBridgeAvailable()) {
    try {
      const result = await getBridge().writeConfig(mf, key, data);
      if (hasError(result)) {
        console.warn(`[configStore] write ${key} error:`, result.error);
      }
    } catch (err) {
      console.warn(`[configStore] write ${key} failed:`, err);
    }
  }
}

// ── public sync getters ──────────────────────────────────────────────

export function getSettings(): AppSettings {
  return _settings;
}

export function getThemes(): Theme[] {
  return _themes;
}

export function getPlaylists(): { pls: Record<string, Playlist>; cur: string } {
  return { pls: _playlists, cur: _currentPlName };
}

export function getLang(): Lang {
  return _lang;
}

// ── public init ──────────────────────────────────────────────────────

/**
 * Initialize config from files (async). Call once on app startup.
 * Reads {musicFolder}/config/*.json and updates the in-memory cache + localStorage.
 * This is a READ-ONLY operation — it does NOT write back to files.
 * Files are only written by explicit save operations (commands, settings changes).
 */
export async function initConfig(): Promise<AppSettings | null> {
  let mf = getMusicFolder();

  // Migration: if bootstrap key is empty, try to recover musicFolder from legacy settings
  if (!mf) {
    try {
      const raw = localStorage.getItem(LS_KEYS.settings);
      if (raw) {
        const legacy = JSON.parse(raw) as Partial<AppSettings>;
        if (legacy.musicFolder) {
          mf = legacy.musicFolder;
          setMusicFolder(mf);
          console.log('[configStore] migrated musicFolder from legacy settings:', mf);
        }
      }
    } catch { /* ignore */ }
  }

  if (!mf) {
    console.log('[configStore] no musicFolder set — using localStorage only');
    return null;
  }

  console.log('[configStore] loading config from', mf + '/config/');

  // Load all 4 config files in parallel
  const [settings, themes, playlists, lang] = await Promise.all([
    readConfigFile<AppSettings>('settings', { ...DEFAULT_SETTINGS }),
    readConfigFile<Theme[]>('themes', JSON.parse(JSON.stringify(BUILTIN_THEMES))),
    readConfigFile<{ pls: Record<string, Playlist>; cur: string }>('playlists', defaultPlaylistsData()),
    readConfigFile<string>('lang', 'en'),
  ]);

  // Update in-memory cache from file data
  _settings = { ...DEFAULT_SETTINGS, ...settings };
  _settings.musicFolder = mf; // bootstrap key always wins

  if (Array.isArray(themes) && themes.length > 0) {
    _themes = themes;
  }

  if (playlists && typeof playlists === 'object' && playlists.pls && Object.keys(playlists.pls).length > 0) {
    _playlists = playlists.pls;
    _currentPlName = playlists.cur || Object.keys(playlists.pls)[0];
  }

  const validLangs = ['en', 'zh', 'ja'];
  if (typeof lang === 'string' && validLangs.includes(lang)) {
    _lang = lang as Lang;
  }

  // Sync file-loaded values back to localStorage cache (so module-load init is correct next time)
  try {
    localStorage.setItem(LS_KEYS.settings, JSON.stringify(_settings));
    localStorage.setItem(LS_KEYS.themes, JSON.stringify(_themes));
    localStorage.setItem(LS_KEYS.playlists, JSON.stringify(_playlists));
    localStorage.setItem(LS_KEYS.currentPl, _currentPlName);
    localStorage.setItem(LS_KEYS.lang, _lang);
  } catch { /* ignore */ }

  console.log('[configStore] config loaded from files');
  return _settings;
}

// ── public save functions ────────────────────────────────────────────

export async function saveSettings(partialOrFull: Partial<AppSettings> | AppSettings): Promise<void> {
  // Check if it's a partial update or full replacement
  // Heuristic: if all required fields are present, treat as full
  const isFull = 'bg' in partialOrFull && 'fg' in partialOrFull && 'volume' in partialOrFull;
  if (isFull) {
    _settings = { ...DEFAULT_SETTINGS, ...partialOrFull };
    // Preserve musicFolder from bootstrap
    const mf = getMusicFolder();
    if (mf) _settings.musicFolder = mf;
  } else {
    Object.assign(_settings, partialOrFull);
  }
  await writeConfigFile('settings', _settings);
}

export async function saveThemes(themes: Theme[]): Promise<void> {
  _themes = themes;
  await writeConfigFile('themes', themes);
}

export async function savePlaylists(pls: Record<string, Playlist>, cur: string): Promise<void> {
  _playlists = pls;
  _currentPlName = cur;
  await writeConfigFile('playlists', { pls, cur });
}

export async function saveLang(lang: Lang): Promise<void> {
  _lang = lang;
  await writeConfigFile('lang', lang);
}
