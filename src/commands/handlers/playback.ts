import { register } from '../registry';
import { ctx, playTrack } from './index';
import { t } from '../../i18n';
import { fuzzySearch } from '../../utils/fuzzy';

export function registerPlaybackCommands() {
  register('play', ['resume'], async (args) => {
    const c = ctx();
    const pl = c.playlist;
    if (pl.length === 0) { c.printLine(t('noTrackLoaded'), 'info'); return; }

    if (args.length === 0) {
      if (c.currentIndex >= 0) {
        c.play();
        c.printLine(t('playing'), 'success');
      } else {
        const fp = c.playIndex(0);
        if (fp) await playTrack(fp, true);
      }
      return;
    }

    const arg = args.join(' ');
    if (/^\d+$/.test(arg)) {
      const num = parseInt(arg, 10);
      if (num < 1 || num > pl.length) { c.printLine(t('invalidIndex', { n: num, max: pl.length }), 'error'); return; }
      const fp = c.playIndex(num - 1);
      if (fp) await playTrack(fp, true);
      return;
    }

    const results = fuzzySearch(arg, pl);
    if (results.length === 0) { c.printLine(t('noMatch', { q: arg }), 'error'); return; }
    if (results.length === 1) {
      const fp = c.playIndex(results[0].idx);
      if (fp) await playTrack(fp, true);
      return;
    }
    c.printLine(t('fuzzyResults', { q: arg, n: results.length }), 'accent');
    c.enterSelectMode(results.map(r => ({ idx: r.idx, name: r.name })));
  }, 'helpPlay');

  register('pause', ['paus'], () => {
    ctx().pause();
    ctx().printLine(t('paused'), 'info');
  }, 'helpPause');

  register('stop', [], () => {
    ctx().stop();
    ctx().printLine(t('stopped'), 'info');
  }, 'helpStop');

  register('next', ['n', 'skip'], async () => {
    const c = ctx();
    const fp = c.next();
    if (!fp) { c.printLine(t('noMoreTracks'), 'info'); return; }
    await playTrack(fp, false);
    c.printLine(t('skippedNext'), 'success');
  }, 'helpNext');

  register('prev', ['p', 'back', 'previous'], async () => {
    const c = ctx();
    const fp = c.prev();
    if (!fp) { c.printLine(t('noPrevTrack'), 'info'); return; }
    await playTrack(fp, false);
    c.printLine(t('backPrev'), 'success');
  }, 'helpPrev');
}
