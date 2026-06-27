import { createContext, useContext, useEffect, useCallback, type ReactNode } from 'react';
import type { AppSettings, Lang, Theme } from '../types';
import { darken } from '../utils/color';
import { getLang, setLang as i18nSetLang } from '../i18n';
import { getBridge, isBridgeAvailable } from '../bridge';
import {
  getSettings as getSettingsFromStore,
  getThemes as getThemesFromStore,
  saveSettings as saveSettingsToStore,
  saveThemes as saveThemesToStore,
  DEFAULT_SETTINGS,
  BUILTIN_THEMES,
} from '../configStore';
import { applyCssVars, toCssShadow } from '../utils/css';
import { SHADOW_PRESETS } from '../constants/themes';

// eslint-disable-next-line react-refresh/only-export-components
export { applyCssVars, SHADOW_PRESETS };

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
  const themes = getThemesFromStore();
  if (themes.length > 0) return themes;
  // First launch: seed built-in themes
  const t = JSON.parse(JSON.stringify(BUILTIN_THEMES));
  saveThemesToStore(t);
  return t;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const saveSettings = useCallback((partial: Partial<AppSettings>) => {
    const current = getSettingsFromStore();
    const merged = { ...DEFAULT_SETTINGS, ...current, ...partial };
    if (partial.bg && !partial['bg-darker']) {
      merged['bg-darker'] = darken(partial.bg, 0.85);
    }
    applyCssVars(merged);
    // Persist (localStorage sync + file async)
    saveSettingsToStore(merged);
    // Sync theme to floating lyrics window if available
    if (isBridgeAvailable()) {
      const baseFonts = '"Consolas", "Courier New", "Fira Code", monospace';
      getBridge().sendLyricsTheme({
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
        lyricsCurrentSize: merged.lyricsCurrentSize || 24,
        lyricsNextSize: merged.lyricsNextSize || 14,
        lyricsVertical: { off: 'horizontal-tb', rl: 'vertical-rl', lr: 'vertical-lr' }[merged.lyricsVertical || 'off'],
      });
    }
  }, []);

  const getCurrentSettings = useCallback((): AppSettings => {
    const result = { ...DEFAULT_SETTINGS };
    const stored = getSettingsFromStore();
    Object.assign(result, stored);
    return result;
  }, []);

  const resetSettings = useCallback(() => {
    applyCssVars(DEFAULT_SETTINGS);
    saveSettingsToStore({ ...DEFAULT_SETTINGS });
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
    saveThemesToStore(themes);
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
    saveThemesToStore(themes);
    return { success: true };
  }, []);

  const exportTheme = useCallback((name: string): Theme | null => {
    const theme = loadThemeData().find(t => t.name === name);
    if (!theme) return null;
    return { ...theme };
  }, []);

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
    saveThemesToStore(themes);
    return { success: true, name: theme.name };
  }, []);

  // Initialize on mount — apply settings from in-memory cache (already loaded from localStorage)
  useEffect(() => {
    const stored = getSettingsFromStore();
    const merged = { ...DEFAULT_SETTINGS, ...stored };
    if (merged['bg-img']) merged['bg-img'] = merged['bg-img'].replace(/\\/g, '/');
    applyCssVars(merged);
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

// eslint-disable-next-line react-refresh/only-export-components
export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}

// Module-level helper for non-React code (synchronous)
// eslint-disable-next-line react-refresh/only-export-components
export function getStoredSettings(): AppSettings {
  const result = { ...DEFAULT_SETTINGS };
  const stored = getSettingsFromStore();
  Object.assign(result, stored);
  return result;
}
