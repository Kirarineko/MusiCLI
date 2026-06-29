import type { Lang } from '../types';
import { LANGS, dict } from './translations';
import { getLang as getLangFromStore, saveLang as saveLangToStore } from '../configStore';

// Initialize synchronously — must happen before any t() call.
// Reads from configStore's in-memory cache (populated from localStorage at module load).
function initLang(): Lang {
  const saved = getLangFromStore();
  if (saved && LANGS.includes(saved as Lang)) return saved as Lang;
  return 'en';
}

let currentLang: Lang = initLang();

export function t(key: string, vars: Record<string, string | number> = {}): string {
  let text: string = (dict[currentLang]?.[key]) ?? (dict.en[key] ?? key);
  for (const [k, v] of Object.entries(vars)) {
    text = text.replaceAll(`{${k}}`, String(v));
  }
  return text;
}

export function getLang(): Lang {
  return currentLang;
}

export function setLang(lang: string): boolean {
  if (!LANGS.includes(lang as Lang)) return false;
  currentLang = lang as Lang;
  // Persist via configStore (writes to localStorage + file)
  saveLangToStore(lang as Lang);
  return true;
}

export function loadLang(): void {
  const saved = getLangFromStore();
  if (saved && LANGS.includes(saved as Lang)) currentLang = saved as Lang;
}
