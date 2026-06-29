import { register } from '../registry';
import { ctx } from './index';
import { t } from '../../i18n';
import { getBridge } from '../../bridge';
import { getStoredSettings } from '../../contexts/SettingsContext';
import { hasError } from '../../utils/guards';

export function registerLyricsCommands() {
  register('lyric', ['lyrics', 'lrc'], async (args) => {
    const c = ctx();
    const sub = (args[0] || '').toLowerCase();
    const rest = args[1];

    if (sub === 'f' || sub === 'floating' || sub === 'float' || sub === 'desktop') {
      const wasOn = c.lyricsFloating;
      await c.toggleFloatingLyrics();
      c.printLine(!wasOn ? t('lyricsFloatingOn') : t('lyricsOff'), 'success');
    } else if (sub === 't' || sub === 'terminal' || sub === 'term' || sub === 'inline') {
      const wasOn = c.lyricsTerminal;
      await c.toggleTerminalLyrics();
      c.printLine(!wasOn ? t('lyricsTerminalOn') : t('lyricsOff'), 'success');
    } else if (sub === 'off' || sub === 'hide' || sub === 'disable') {
      await c.setLyricsFloating(false);
      await c.setLyricsTerminal(false);
      c.printLine(t('lyricsOff'), 'info');
    } else if (sub === 'accent') {
      if (!rest || !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(rest)) {
        c.printLine(t('lyricColorUsage'), 'info'); return;
      }
      c.saveSettings({ lyricsAccent: rest });
      c.printLine(t('lyricAccentSet', { hex: rest }), 'success');
    } else if (sub === 'fg') {
      if (!rest || !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(rest)) {
        c.printLine(t('lyricColorUsage'), 'info'); return;
      }
      c.saveSettings({ lyricsFg: rest });
      c.printLine(t('lyricFgSet', { hex: rest }), 'success');
    } else if (sub === 'next') {
      const n = parseInt(rest, 10);
      if (isNaN(n) || n < 0 || n > 10) {
        c.printLine(t('lyricNextSet', { v: getStoredSettings().lyricsNextCount || 1 }), 'info');
        return;
      }
      c.saveSettings({ lyricsNextCount: n });
      c.printLine(t('lyricNextSet', { v: n }), 'success');
    } else if (sub === 'gap') {
      const g = parseInt(rest, 10);
      if (isNaN(g) || g < 0 || g > 100) {
        c.printLine(t('lyricGapSet', { v: getStoredSettings().lyricsGap || 10 }), 'info');
        return;
      }
      c.saveSettings({ lyricsGap: g });
      c.printLine(t('lyricGapSet', { v: g }), 'success');
    } else if (sub === 'size') {
      const which = (rest || '').toLowerCase();
      const val = parseInt(args[2], 10);
      if (which === 'current' || which === 'cur' || which === 'c') {
        if (isNaN(val) || val < 10 || val > 80) {
          c.printLine(t('lyricSizeUsage', { v: getStoredSettings().lyricsCurrentSize || 24 }), 'info');
          return;
        }
        c.saveSettings({ lyricsCurrentSize: val });
        c.printLine(t('lyricSizeSet', { which: 'current', v: val }), 'success');
      } else if (which === 'next' || which === 'n') {
        if (isNaN(val) || val < 8 || val > 60) {
          c.printLine(t('lyricSizeUsage', { v: getStoredSettings().lyricsNextSize || 14 }), 'info');
          return;
        }
        c.saveSettings({ lyricsNextSize: val });
        c.printLine(t('lyricSizeSet', { which: 'next', v: val }), 'success');
      } else {
        c.printLine(t('lyricSizeUsage', { v: '' }), 'info');
      }
    } else if (sub === 'align') {
      const v = (rest || '').toLowerCase();
      if (v === 'left' || v === 'l') {
        c.saveSettings({ lyricsAlign: 'left' });
        c.printLine(t('lyricAlignSet', { v: 'left' }), 'success');
      } else if (v === 'right' || v === 'r') {
        c.saveSettings({ lyricsAlign: 'right' });
        c.printLine(t('lyricAlignSet', { v: 'right' }), 'success');
      } else {
        c.saveSettings({ lyricsAlign: 'center' });
        c.printLine(t('lyricAlignSet', { v: 'center' }), 'success');
      }
    } else if (sub === 'offset') {
      const idx = c.currentIndex;
      if (idx < 0 || idx >= c.playlist.length) {
        c.printLine(t('noTrackLoaded'), 'info');
        return;
      }
      const mp3Path = c.playlist[idx];
      const s = getStoredSettings();
      const lrcDir = (s.musicFolder || mp3Path.split(/[/\\]/).slice(0, -1).join('/')) + '/lrc';
      const trackName = (mp3Path.split(/[/\\]/).pop() || '').replace(/\.[^.]+$/, '.lrc');
      const ms = parseInt(rest, 10);
      if (isNaN(ms)) {
        const offsets = await getBridge().readLrcOffsets(lrcDir);
        const cur = (!hasError(offsets) && offsets[trackName]) ? offsets[trackName] : 0;
        c.printLine(t('lyricOffsetSet', { v: cur }), 'info');
        return;
      }
      const wr = await getBridge().writeLrcOffset(lrcDir, trackName, ms);
      if (!hasError(wr)) {
        c.printLine(ms === 0 ? t('lyricOffsetCleared') : t('lyricOffsetSet', { v: ms }), 'success');
        c.loadLRC(mp3Path);
      } else {
        c.printLine(wr.error || 'Error', 'error');
      }
    } else if (sub === 'v' || sub === 'vertical') {
      const s = getStoredSettings();
      const cycle: Array<'off' | 'rl' | 'lr'> = ['off', 'rl', 'lr'];
      const idx = cycle.indexOf(s.lyricsVertical as 'off' | 'rl' | 'lr');
      const next = cycle[(idx + 1) % 3];
      c.saveSettings({ lyricsVertical: next });
      const label = next === 'off' ? t('lyricVerticalOff') : t('lyricVerticalOn') + ' (' + (next === 'rl' ? 'R→L' : 'L→R') + ')';
      c.printLine(label, 'success');
    } else if (sub === 'lock') {
      const s = getStoredSettings();
      const cur = s.lyricsLocked;
      c.saveSettings({ lyricsLocked: !cur });
      getBridge()?.setLyricsMouseEvents(cur);
      c.printLine(!cur ? t('lyricLockOn') : t('lyricLockOff'), 'success');
    } else if (sub === 'shadow') {
      const val = (rest || '').toLowerCase();
      if (val === 'off' || val === 'none') {
        c.saveSettings({ lyricsShadow: 'none' });
        c.printLine(t('lyricShadowOff'), 'success');
      } else if (val === 'small' || val === 's') {
        c.saveSettings({ lyricsShadow: 'small' });
        c.printLine(t('lyricShadowSet', { v: 'small' }), 'success');
      } else if (val === 'large' || val === 'l') {
        c.saveSettings({ lyricsShadow: 'large' });
        c.printLine(t('lyricShadowSet', { v: 'large' }), 'success');
      } else {
        c.saveSettings({ lyricsShadow: 'medium' });
        c.printLine(t('lyricShadowSet', { v: 'medium' }), 'success');
      }
    } else if (!sub) {
      const wasOn = c.lyricsTerminal;
      await c.toggleTerminalLyrics();
      c.printLine(!wasOn ? t('lyricsTerminalOn') : t('lyricsOff'), 'success');
    } else {
      c.printLine(t('lyricUsage'), 'info');
    }
  }, 'helpLyric');
}
