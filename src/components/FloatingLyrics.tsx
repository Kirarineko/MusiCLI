import { useEffect, useState } from 'react';

interface LyricsState {
  current: string;
  next: string[];
}

export function FloatingLyrics() {
  const [lines, setLines] = useState<LyricsState>({ current: '', next: [] });

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
        if (data.lyricsAccent) root.style.setProperty('--lyrics-accent', data.lyricsAccent);
        if (data.lyricsFg) root.style.setProperty('--lyrics-fg', data.lyricsFg);
        if (data.lyricsGap != null) root.style.setProperty('--lyrics-gap', data.lyricsGap + 'px');
        if (data.lyricsShadow) root.style.setProperty('--lyrics-shadow', data.lyricsShadow);
        if (data.lyricsCurrentSize) root.style.setProperty('--lyrics-current-size', data.lyricsCurrentSize + 'px');
        if (data.lyricsNextSize) root.style.setProperty('--lyrics-next-size', data.lyricsNextSize + 'px');
        if (data.lyricsAlign) {
          root.style.setProperty('--lyrics-align', data.lyricsAlign);
          const flexMap: Record<string, string> = { left: 'flex-start', center: 'center', right: 'flex-end' };
          root.style.setProperty('--lyrics-align-flex', flexMap[data.lyricsAlign] || 'center');
        }
      });
    }
  }, []);

  return (
    <>
      {/* Drag handle dot — top-right, visible on hover */}
      <div id="lyrics-drag-dot" title="Drag to move" />
      <div id="drag-area">
        <div id="lyrics-container">
          <div className="lyric-line current" id="line-current">
            {lines.current || '♪'}
          </div>
          {lines.next.map((text, i) => (
            <div key={i} className="lyric-line next" style={{ opacity: 1 - i * 0.15 }}>
              {text}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
