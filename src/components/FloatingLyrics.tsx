import { useEffect, useState, useCallback } from 'react';
import { initBridge, getBridge } from '../bridge';

interface LyricsState {
  current: string;
  next: string[];
}

export function FloatingLyrics() {
  const [lines, setLines] = useState<LyricsState>({ current: '', next: [] });
  const [ready, setReady] = useState(false);

  // Initialize bridge first — FloatingLyrics skips AppInitializer.
  useEffect(() => {
    initBridge().then(() => setReady(true));
  }, []);

  // Make the window truly transparent (override main-window CSS).
  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.padding = '0';
    const root = document.getElementById('root');
    if (root) {
      root.style.background = 'transparent';
      root.style.padding = '0';
    }
  }, []);

  // Register event listeners after bridge is ready.
  useEffect(() => {
    if (!ready) return;

    const unsubUpdate = getBridge().onLyricsUpdate((data) => {
      setLines(data);
    });

    const unsubTheme = getBridge().onLyricsTheme((data) => {
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
      if (data.lyricsVertical) root.style.setProperty('--lyrics-vertical', data.lyricsVertical);
      if (data.lyricsAlign) {
        root.style.setProperty('--lyrics-align', data.lyricsAlign);
        const flexMap: Record<string, string> = { left: 'flex-start', center: 'center', right: 'flex-end' };
        root.style.setProperty('--lyrics-align-flex', flexMap[data.lyricsAlign] || 'center');
      }
    });

    return () => {
      unsubUpdate();
      unsubTheme();
    };
  }, [ready]);

  // Auto-size window to fit content.
  // Use scrollHeight so we measure natural content height, not the
  // viewport-constrained rendered height (avoids lines being cut off).
  const resizeWindow = useCallback(() => {
    const el = document.getElementById('lyrics-container');
    if (!el) return;
    const h = Math.ceil(el.scrollHeight);
    getBridge().autoSizeLyrics(0, h);
  }, []);

  useEffect(() => {
    if (!ready) return;
    resizeWindow();
    const el = document.getElementById('lyrics-container');
    if (!el) return;
    const ro = new ResizeObserver(() => resizeWindow());
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready, resizeWindow]);

  // Also trigger resize when lyrics content changes.
  useEffect(() => {
    if (ready) resizeWindow();
  }, [lines, ready, resizeWindow]);

  // Entire window is a drag handle.
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Don't interfere with text selection on the lyrics themselves.
    const target = e.target as HTMLElement;
    if (target.tagName === 'DIV' && (target.id === 'drag-area' || target.parentElement?.id === 'drag-area' || target.id === 'lyrics-container' || target.className.includes('lyric-line'))) {
      e.preventDefault();
      import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
        getCurrentWindow().startDragging().catch(() => {});
      });
    }
  }, []);

  return (
    <div id="drag-area" onMouseDown={handleMouseDown}>
      <div id="lyrics-container">
        {!lines.current && lines.next.length === 0 ? (
          <div className="lyric-line current" style={{ opacity: 0.35, fontSize: 'var(--lyrics-next-size)' }}>
            ♪
          </div>
        ) : (
          <>
            <div className="lyric-line current" id="line-current">
              {lines.current || '♪'}
            </div>
            {lines.next.map((text, i) => (
              <div key={i} className="lyric-line next" style={{ opacity: 1 - i * 0.09 }}>
                {text}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
