import { createContext, useContext, useEffect, useCallback, type ReactNode } from 'react';
import type { AppSettings, Lang, Theme } from '../types';
import { parseColor, formatColor, darken } from '../utils/color';
import { getLang, setLang as i18nSetLang } from '../i18n';

const STORAGE_KEY = 'musiccli-settings';
const THEMES_KEY = 'musiccli-themes';

export const SHADOW_PRESETS: Record<string, string> = {
  large: '0 0 8px rgba(0,0,0,0.4),0 4px 3px rgba(0,0,0,0.7)',
  medium: '0 0 6px rgba(0,0,0,0.5),0 2px 1px rgba(0,0,0,0.5)',
  small: '0 0 4px rgba(0,0,0,0.7)',
};

function toCssShadow(preset: string): string {
  return SHADOW_PRESETS[preset] || 'none';
}

const defaults: AppSettings = {
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
  progressFilled: '=',
  progressEmpty: ' ',
  progressWidth: 20,
  seekStep: 5,
  seekPause: false,
  maxLines: 500,
};

const BUILTIN_THEMES: Theme[] = [
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

interface SettingsContextValue {
  settings: AppSettings;
  themes: Theme[];
  saveSettings: (partial: Partial<AppSettings>) => void;
  resetSettings: () => void;
  lang: Lang;
  setLang: (lang: string) => boolean;
  // Theme methods
  saveCurrentTheme: (name: string) => void;
  applyTheme: (name: string) => boolean;
  deleteTheme: (name: string) => { success: boolean; error?: string };
  exportTheme: (name: string) => Theme | null;
  importTheme: (jsonStr: string) => { success: boolean; name?: string; error?: string };
  themeNames: () => string[];
  getTheme: (name: string) => Theme | null;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function loadThemeData(): Theme[] {
  try {
    const raw = localStorage.getItem(THEMES_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  const t = JSON.parse(JSON.stringify(BUILTIN_THEMES));
  localStorage.setItem(THEMES_KEY, JSON.stringify(t));
  return t;
}

function applyCssVars(s: AppSettings) {
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
    root.style.setProperty('--bg-img', `url(file:///${s['bg-img'].replace(/\\/g, '/')})`);
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

export function SettingsProvider({ children }: { children: ReactNode }) {
  // We use a module-level variable for settings to avoid re-render cascades
  // since many non-React functions need synchronous access
  const saveSettings = useCallback((partial: Partial<AppSettings>) => {
    let stored: Partial<AppSettings> = {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) stored = JSON.parse(raw);
    } catch { /* ignore */ }
    const merged = { ...defaults, ...stored, ...partial };
    if (partial.bg && !partial['bg-darker']) {
      merged['bg-darker'] = darken(partial.bg, 0.85);
    }
    applyCssVars(merged);
    const toStore: Record<string, unknown> = {};
    for (const key of Object.keys(defaults)) {
      toStore[key] = (merged as Record<string, unknown>)[key];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
    // Sync theme to floating lyrics window if available
    if (window.musicPlayer?.sendLyricsTheme) {
      const baseFonts = '"Consolas", "Courier New", "Fira Code", monospace';
      window.musicPlayer.sendLyricsTheme({
        font: merged.customFont ? `"${merged.customFont}", ${baseFonts}` : baseFonts,
        fontSize: merged.fontSize || 14,
        fg: merged.fg,
        fgDim: merged['fg-dim'],
        accent: merged.accent,
        bg: merged.bg,
        lyricsAccent: merged.lyricsAccent || '#b1b9f9',
        lyricsFg: merged.lyricsFg || '#cccccc',
        lyricsNextCount: merged.lyricsNextCount || 1,
        lyricsGap: merged.lyricsGap || 10,
        lyricsShadow: toCssShadow(merged.lyricsShadow || 'medium'),
        lyricsAlign: merged.lyricsAlign || 'center',
      });
    }
  }, []);

  const getCurrentSettings = useCallback((): AppSettings => {
    const result = { ...defaults };
    let stored: Partial<AppSettings> = {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) stored = JSON.parse(raw);
    } catch { /* ignore */ }
    Object.assign(result, stored);
    return result;
  }, []);

  const resetSettings = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    applyCssVars(defaults);
  }, []);

  // Theme methods
  const themeNames = useCallback((): string[] => {
    return loadThemeData().map(t => t.name);
  }, []);

  const getTheme = useCallback((name: string): Theme | null => {
    return loadThemeData().find(t => t.name === name) || null;
  }, []);

  const saveCurrentTheme = useCallback((name: string) => {
    const s = getCurrentSettings();
    const themes = loadThemeData();
    const existing = themes.findIndex(t => t.name === name);
    const theme: Theme = {
      name, bg: s.bg, fg: s.fg, 'fg-dim': s['fg-dim'],
      'fg-bright': s['fg-bright'], accent: s.accent, lyric: s.lyric,
      line: s.line, 'bg-img-data': s['bg-img-data'] || '',
      'bg-blur': s['bg-blur'], fontSize: s.fontSize,
      fontWeight: s.fontWeight, customFont: s.customFont || '',
      customFontData: s.customFontData || '',
    };
    if (existing >= 0) themes[existing] = theme;
    else themes.push(theme);
    localStorage.setItem(THEMES_KEY, JSON.stringify(themes));
  }, [getCurrentSettings]);

  const applyTheme = useCallback((name: string): boolean => {
    const theme = loadThemeData().find(t => t.name === name);
    if (!theme) return false;
    const partial: Partial<AppSettings> = {
      bg: theme.bg, fg: theme.fg, 'fg-dim': theme['fg-dim'],
      'fg-bright': theme['fg-bright'], accent: theme.accent,
      lyric: theme.lyric, line: theme.line, 'bg-blur': theme['bg-blur'],
      fontSize: theme.fontSize, fontWeight: theme.fontWeight,
      customFont: theme.customFont || '', customFontData: theme.customFontData || '',
    };
    if (theme['bg-img-data']) {
      const ext = theme['bg-img-data'].startsWith('/9j/') ? 'jpg' :
                  theme['bg-img-data'].startsWith('iVBOR') ? 'png' :
                  theme['bg-img-data'].startsWith('R0lG') ? 'gif' :
                  theme['bg-img-data'].startsWith('UklGR') ? 'webp' : 'jpg';
      document.documentElement.style.setProperty('--bg-img', `url(data:image/${ext};base64,${theme['bg-img-data']})`);
      partial['bg-img'] = '';
    } else {
      partial['bg-img'] = '';
      partial['bg-img-data'] = '';
      document.documentElement.style.setProperty('--bg-img', 'none');
    }
    saveSettings(partial);
    return true;
  }, [saveSettings]);

  const deleteTheme = useCallback((name: string): { success: boolean; error?: string } => {
    const themes = loadThemeData();
    const idx = themes.findIndex(t => t.name === name);
    if (idx < 0) return { success: false, error: 'notFound' };
    if (BUILTIN_THEMES.some(t => t.name === name)) return { success: false, error: 'builtin' };
    themes.splice(idx, 1);
    localStorage.setItem(THEMES_KEY, JSON.stringify(themes));
    return { success: true };
  }, []);

  const exportTheme = useCallback((name: string): Theme | null => {
    const theme = loadThemeData().find(t => t.name === name);
    if (!theme) return null;
    const s = getCurrentSettings();
    const exp = { ...theme };
    if (!exp['bg-img-data'] && s['bg-img']) {
      // Can't read base64 synchronously, handled in command handler
    }
    return exp;
  }, [getCurrentSettings]);

  const importThemeFromJson = useCallback((jsonStr: string): { success: boolean; name?: string; error?: string } => {
    let theme: Partial<Theme>;
    try { theme = JSON.parse(jsonStr); } catch { return { success: false, error: 'parse' }; }
    if (!theme.name) return { success: false, error: 'invalid' };
    const themes = loadThemeData();
    const existing = themes.findIndex(t => t.name === theme.name);
    const entry: Theme = {
      name: theme.name,
      bg: theme.bg || '#0c0c0c',
      fg: theme.fg || '#33ff33',
      'fg-dim': theme['fg-dim'] || '#1a9c1a',
      'fg-bright': theme['fg-bright'] || '#66ff66',
      accent: theme.accent || '#ffcc00',
      lyric: theme.lyric || '#1a5c1a',
      line: theme.line || '#1a3a1a',
      'bg-img-data': theme['bg-img-data'] || '',
      'bg-blur': theme['bg-blur'] || 0,
      fontSize: theme.fontSize || 14,
      fontWeight: theme.fontWeight || 400,
      customFont: theme.customFont || '',
      customFontData: theme.customFontData || '',
    };
    if (existing >= 0) themes[existing] = entry;
    else themes.push(entry);
    localStorage.setItem(THEMES_KEY, JSON.stringify(themes));
    return { success: true, name: theme.name };
  }, []);

  // Initialize on mount
  useEffect(() => {
    let stored: Partial<AppSettings> = {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) stored = JSON.parse(raw);
    } catch { /* ignore */ }
    const merged = { ...defaults, ...stored };
    if (merged['bg-img']) merged['bg-img'] = merged['bg-img'].replace(/\\/g, '/');
    applyCssVars(merged);
    // Ensure themes exist
    loadThemeData();
  }, []);

  const setLangFn = useCallback((lang: string) => {
    return i18nSetLang(lang);
  }, []);

  const currentLang = getLang();

  return (
    <SettingsContext.Provider value={{
      settings: getCurrentSettings(),
      themes: loadThemeData(),
      saveSettings,
      resetSettings,
      lang: currentLang,
      setLang: setLangFn,
      saveCurrentTheme,
      applyTheme,
      deleteTheme,
      exportTheme,
      importTheme: importThemeFromJson,
      themeNames,
      getTheme,
    }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}

// Module-level helpers for non-React code
export function getStoredSettings(): AppSettings {
  const result = { ...defaults };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) Object.assign(result, JSON.parse(raw));
  } catch { /* ignore */ }
  return result;
}
