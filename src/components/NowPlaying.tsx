import { usePlayer } from '../contexts/PlayerContext';
import { t } from '../i18n';
import { formatTime, getFileName } from '../utils/format';

const MODE_ICONS: Record<string, string> = {
  normal: '', 'repeat-one': 'R1', 'repeat-all': 'RA', shuffle: 'SH',
};

export function NowPlaying() {
  const { playlist, currentIndex, currentTime, duration, volume, isPlaying, playMode, progressFilled, progressEmpty, progressWidth } = usePlayer();

  const trackName = currentIndex >= 0 && currentIndex < playlist.length
    ? getFileName(playlist[currentIndex])
    : t('noTrack');

  const icon = isPlaying ? '>' : '||';
  const modeStr = MODE_ICONS[playMode] || '';

  // Progress bar
  const w = progressWidth || 20;
  const filledChar = progressFilled || '=';
  const emptyChar = progressEmpty || ' ';
  let barText = '[' + emptyChar.repeat(w) + ']';
  if (duration > 0 && isFinite(duration) && currentIndex >= 0) {
    const ratio = Math.max(0, Math.min(1, currentTime / duration));
    const filled = Math.round(ratio * w);
    barText = '[' + (filled > 0 ? filledChar.repeat(filled - 1) + '>' : '') + emptyChar.repeat(Math.max(0, w - filled)) + ']';
  }

  return (
    <div id="now-playing">
      <span id="np-icon">{icon}</span>
      <span id="np-mode">{modeStr}</span>
      <span id="np-title">{trackName}</span>
      <span id="np-bar">{barText}</span>
      <span id="np-time">{formatTime(currentTime)} / {formatTime(duration)}</span>
      <span id="np-vol">{t('vol')}: {volume}</span>
    </div>
  );
}
