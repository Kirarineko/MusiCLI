import type { Lang } from '../types';
import { LANGS, dict } from './translations';

let currentLang: Lang = 'en';

export function t(key: string, vars: Record<string, string | number> = {}): string {
  let text: string = (dict[currentLang]?.[key]) ?? (dict.en[key] ?? key);
  for (const [k, v] of Object.entries(vars)) {
    text = text.replace(`{${k}}`, String(v));
  }
  return text;
}

export function getLang(): Lang {
  return currentLang;
}

export function setLang(lang: string): boolean {
  if (!LANGS.includes(lang as Lang)) return false;
  currentLang = lang as Lang;
  try {
    localStorage.setItem('musiccli-lang', lang);
  } catch { /* ignore */ }
  return true;
}

export function loadLang(): void {
  try {
    const saved = localStorage.getItem('musiccli-lang');
    if (saved && LANGS.includes(saved as Lang)) currentLang = saved as Lang;
  } catch { /* ignore */ }
}
