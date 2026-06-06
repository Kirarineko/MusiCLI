import { useEffect, useRef } from 'react';
import { SettingsProvider, SHADOW_PRESETS } from './contexts/SettingsContext';
import { PlaylistProvider, usePlaylists, type PlayerSync } from './contexts/PlaylistContext';
import { PlayerProvider, usePlayer } from './contexts/PlayerContext';
import { TerminalProvider, useTerminal } from './contexts/TerminalContext';
import { TitleBar } from './components/TitleBar';
import { BackgroundLayer } from './components/BackgroundLayer';
import { Terminal } from './components/Terminal';
import { SelectList } from './components/SelectList';
import { NowPlaying } from './components/NowPlaying';
import { InputLine } from './components/InputLine';
import { FloatingLyrics } from './components/FloatingLyrics';
import { getStoredSettings } from './contexts/SettingsContext';

function AppInitializer({ children }: { children: React.ReactNode }) {
  const player = usePlayer();
  const playlists = usePlaylists();
  const terminal = useTerminal();
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Wire PlayerContext functions into PlaylistContext
    const sync: PlayerSync = {
      addToPlaylist: player.addToPlaylist,
      clearPlaylist: player.clearPlaylist,
      getPlaylist: player.getPlaylist,
    };
    playlists.registerPlayerSync(sync);

    // Wire terminal lyric printing into PlayerContext
    player.registerLyricPrinter((text, cls) => terminal.printLine(text, cls));

    playlists.ensureDefault();

    // Load current playlist tracks into player
    const pl = playlists.getCurrentPlaylist();
    if (pl && pl.tracks && pl.tracks.length > 0) {
      player.clearPlaylist();
      player.addToPlaylist(pl.tracks);
    }

    // Auto-detect music folder
    const s = getStoredSettings();
    if (!s.musicFolder) {
      try {
        window.musicPlayer?.getDefaultMusicDir().then(folder => {
          window.musicPlayer?.dirExists(folder).then(exists => {
            if (exists) {
              const stored = getStoredSettings();
              stored.musicFolder = folder;
              localStorage.setItem('musiccli-settings', JSON.stringify(stored));
            }
          });
        });
      } catch { /* browser mode - no musicPlayer */ }
    }

    // Restore volume
    if (s.volume != null) player.setVolume(s.volume);

    // Restore lyrics state (floating window is opened in PlayerProvider init)
    if (s.lyricsTerminal) {
      player.setLyricsTerminal(true);
    }
    if (s.lyricsFloating) {
      player.setLyricsFloating(true);
    }

    // Sync current lyrics settings to main process so they're cached
    // before the floating window ever opens (survives restart)
    try {
      const baseFonts = '"Consolas", "Courier New", "Fira Code", monospace';
      window.musicPlayer?.sendLyricsTheme({
        font: s.customFont ? `"${s.customFont}", ${baseFonts}` : baseFonts,
        fontSize: s.fontSize || 14, fg: s.fg, fgDim: s['fg-dim'],
        accent: s.accent, bg: s.bg,
        lyricsAccent: s.lyricsAccent || '#b1b9f9',
        lyricsFg: s.lyricsFg || '#cccccc',
        lyricsNextCount: s.lyricsNextCount || 1,
        lyricsGap: s.lyricsGap || 10,
        lyricsShadow: SHADOW_PRESETS[s.lyricsShadow] || '0 0 10px rgba(0,0,0,0.85)',
        lyricsAlign: s.lyricsAlign || 'center',
      });
    } catch {}
  }, []);

  return <>{children}</>;
}

export default function App() {
  const isLyricsWindow = window.location.hash === '#/lyrics';

  if (isLyricsWindow) {
    return <FloatingLyrics />;
  }

  return (
    <SettingsProvider>
      <PlaylistProvider>
        <PlayerProvider>
          <TerminalProvider>
            <AppInitializer>
              <BackgroundLayer />
              <TitleBar />
              <Terminal />
              <NowPlaying />
              <SelectList />
              <InputLine />
            </AppInitializer>
          </TerminalProvider>
        </PlayerProvider>
      </PlaylistProvider>
    </SettingsProvider>
  );
}
