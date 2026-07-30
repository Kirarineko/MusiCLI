import { register } from '../registry';
import { ctx } from './index';
import { t } from '../../i18n';
import { fuzzySearch } from '../../utils/fuzzy';
import { escapeHtml } from '../../utils/format';

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for webviews without async clipboard permission.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function registerShareCommands() {
  register('share', [], async (args) => {
    const c = ctx();
    const port = (window as unknown as Record<string, number>).__MUSICLI_PORT__;
    if (!port) {
      c.printLine(t('listenServerNotRunning'), 'error');
      return;
    }

    const pl = c.playlist;
    let track: string | undefined;
    if (args.length === 0) {
      if (c.currentIndex >= 0 && c.currentIndex < pl.length) track = pl[c.currentIndex];
      if (!track) { c.printLine(t('noTrackLoaded'), 'info'); return; }
    } else {
      if (pl.length === 0) { c.printLine(t('noTrackLoaded'), 'info'); return; }
      const arg = args.join(' ');
      if (/^\d+$/.test(arg)) {
        const num = parseInt(arg, 10);
        if (num < 1 || num > pl.length) {
          c.printLine(t('invalidIndex', { n: num, max: pl.length }), 'error');
          return;
        }
        track = pl[num - 1];
      } else {
        const results = fuzzySearch(arg, pl);
        if (results.length === 0) { c.printLine(t('noMatch', { q: arg }), 'error'); return; }
        track = pl[results[0].idx];
      }
    }
    if (!track) { c.printLine(t('noTrackLoaded'), 'info'); return; }

    // [host] is a placeholder — the user replaces it with their LAN IP or
    // tunneled domain. The webui detects ?path= and switches to file mode.
    const url = `http://[host]:${port}/listen?path=${encodeURIComponent(track)}`;

    const copied = await copyToClipboard(url);
    c.printLine(t('shareTitle'), 'success');
    c.printRaw(`  <cmd>${escapeHtml(url)}</cmd>`);
    c.printLine(copied ? t('shareCopied') : t('shareCopyFailed'), copied ? 'info' : 'error');
    c.printRaw(t('shareHostHint'));
  }, 'helpShare');
}
