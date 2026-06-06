import { useEffect, useState } from 'react';

interface LyricsLine {
  prev: string;
  current: string;
  next: string;
}

export function FloatingLyrics() {
  const [lines, setLines] = useState<LyricsLine>({ prev: '', current: '', next: '' });

  useEffect(() => {
    if (window.musicPlayer?.onLyricsUpdate) {
      window.musicPlayer.onLyricsUpdate((data) => {
        setLines(data);
      });
    }
    if (window.musicPlayer?.onLyricsTheme) {
      window.musicPlayer.onLyricsTheme((data) => {
        const root = document.documentElement;
        if (data.font) root.style.setProperty('--font', data.font);
        if (data.fontSize) root.style.setProperty('--font-size', data.fontSize + 'px');
        if (data.fg) root.style.setProperty('--fg', data.fg);
        if (data.fgDim) root.style.setProperty('--fg-dim', data.fgDim);
        if (data.accent) root.style.setProperty('--accent', data.accent);
        if (data.bg) root.style.setProperty('--bg', data.bg);
      });
    }
  }, []);

  return (
    <>
      <button
        id="btn-close"
        title="Close"
        onClick={() => window.musicPlayer.hideFloatingLyrics()}
      >
        &times;
      </button>
      <div id="drag-area">
        <div id="lyrics-container">
          <div className="lyric-line prev" id="line-prev">{lines.prev}</div>
          <div className="lyric-line current" id="line-current">{lines.current || '♪'}</div>
          <div className="lyric-line next" id="line-next">{lines.next}</div>
        </div>
      </div>
    </>
  );
}
